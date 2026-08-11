/**
 * @zabloo/format — the zabloo IR: a versioned, engine-agnostic envelope of views.
 *
 * The IR is a payload consumed at runtime by engine SDKs (and hot-updated over the
 * wire), never build-time source. Design rules (see decisions 2026-08-01):
 * - v1 vocabulary is a closed set grown by capability: Container, Text, Button,
 *   Collapse, ScrollView, Image, Overlay, Toggle, Repeat, ProgressBar, Spinner,
 *   Slider.
 * - Overlay nodes leave their parent's flow and are painted in a single top layer
 *   above the whole view, ordered by `(z, document order)` (decision 2026-08-11).
 * - Assets travel embedded (base64) in an `assets` manifest; nodes reference them as `asset:<id>` (decision 2026-08-11).
 * - Styles are resolved per node and reference a flat token dictionary in the envelope.
 * - Layout is runtime Flexbox in the SDK (Yoga subset) — no baked rects.
 * - Paint is 100% implicit from style in v1 (no explicit draw-command layer).
 * - Two dynamic mechanisms only: named actions and data-path bindings. Bindings
 *   are READ/WRITE from v1 on the controls that own a value (Toggle, Slider): the
 *   SDK writes the new value into its own data store and notifies the game through
 *   one callback (decision 2026-08-11, ZAB-23).
 * - Data drives STRUCTURE too: a `Repeat` node instantiates its template once per
 *   element of a bound array, and named actions gained an `ActionContext` so a
 *   press inside an item says WHICH one (decision 2026-08-11, ZAB-29).
 * - Style/layout changes may be tweened by a per-node `transition` (duration + easing
 *   from a closed curve set) — no keyframes, no timelines (decision 2026-08-11).
 * - Forward-tolerant: SDKs ignore unknown props, render unknown node types as a
 *   Container preserving `layout`/`style`/`visible`/`children` (normative rule,
 *   decision 2026-08-11), and refuse only on a major-version mismatch.
 */

/** Major IR version implemented by this package. */
export const IR_VERSION = 1;

/** A reference to a design token, e.g. `"{color.primary}"`. */
export type TokenRef = `{${string}}`;

/** Token values in the envelope's flat dictionary. */
export type TokenValue = string | number;

/**
 * A static value or a data-path binding, e.g. `{ bind: "player.gold" }`.
 *
 * A path is a dot-separated address INTO the data, not an opaque key: a numeric
 * segment indexes an array (`"shop.items.3.name"`), which is what array bindings
 * need to address one element (decision 2026-08-11, ZAB-29). Inside a `Repeat`
 * template a path may start with the item alias (`"item.name"`) and is resolved
 * against the current element — see `resolveBinding`.
 */
export type Bindable<T> = T | { bind: string };

/** Dimension: a number (px) or a token reference. */
export type Dim = number | TokenRef;

/** Color: a literal (e.g. `"#4f46e5"`) or a token reference. */
export type ColorValue = string | TokenRef;

/** A reference to an asset in the envelope's manifest, e.g. `"asset:icons/coin.png"`. */
export type AssetRef = `asset:${string}`;

/**
 * One asset in the envelope's manifest (decision 2026-08-11, ZAB-10). `hash` is the
 * content identity (SHA-256 hex): dedup today, content-addressed caching/CDN once the
 * platform exists. `data` is optional in the SCHEMA only — v1 exports always inline
 * it; a future platform may omit it and let SDKs resolve bytes by hash (deferred
 * resolution) without a format change.
 */
export interface AssetEntry {
  hash: string;
  /** MIME type, e.g. "image/png". The format is generic; accepted MIMEs are an export concern. */
  mime: string;
  /** Byte size of the decoded content. */
  size: number;
  /** Pixel dimensions (images): lets layout reserve space before decoding. */
  width?: number;
  height?: number;
  /** Content bytes, base64-encoded. */
  data?: string;
}

/**
 * Versioned multi-view envelope — the unit the SDK loader consumes, whether it comes
 * from a manual import or a platform hot-update (one loading path).
 */
export interface Envelope {
  /** IR version. SDKs refuse only on a major mismatch. */
  v: number;
  /** Flat token dictionary, e.g. `{ "color.primary": "#4f46e5" }`. */
  tokens: Record<string, TokenValue>;
  /** Documents (views/scenes) keyed by view ID. */
  views: Record<string, ZNode>;
  /** Asset manifest keyed by logical id. Optional: envelopes without assets stay valid as-is. */
  assets?: Record<string, AssetEntry>;
}

/** v1 node vocabulary (closed set). */
export type ZNode =
  | ContainerNode
  | TextNode
  | ButtonNode
  | CollapseNode
  | ScrollViewNode
  | ImageNode
  | OverlayNode
  | ToggleNode
  | RepeatNode
  | ProgressBarNode
  | SpinnerNode
  | SliderNode;

/**
 * Runtime states a node can be styled in. The SDK owns the state itself, keyed by
 * component type — `selected` is the state a member of an `"exclusive-select"`
 * group carries while it is the chosen one (decision 2026-08-11, Tabs), and
 * `checked` the one a `Toggle` carries while it is on (decision 2026-08-11,
 * ZAB-23). Both are *value* states, not transient interactions; they merge before
 * the interaction ones: base → selected/checked → focused → pressed.
 */
export type StateName = "hover" | "pressed" | "disabled" | "focused" | "selected" | "checked";

/** Per-state style overrides. The SDK owns runtime state, keyed by component type. */
export interface StateOverride {
  style?: Style;
}

/** Yoga subset decided for v1: direction, justify, align, gap, padding, width/height, grow. */
export interface Layout {
  direction?: "row" | "column";
  justify?: "start" | "center" | "end" | "space-between";
  align?: "start" | "center" | "end" | "stretch";
  gap?: Dim;
  padding?: Dim;
  width?: Dim;
  height?: Dim;
  grow?: number;
}

/** Alignment of a text block inside its rect, on either axis. */
export type TextAlign = "start" | "center" | "end";

/**
 * What happens to text that does not fit (decision 2026-08-11, ZAB-17):
 * - `"clip"` (default): the glyphs that would cross the boundary are dropped, so
 *   nothing ever paints outside the layout rect — the same invariant `Image` keeps.
 * - `"ellipsis"`: the truncation is marked with `…` (U+2026), trimming glyphs from
 *   the end of the last line until the mark fits.
 */
export type TextOverflow = "clip" | "ellipsis";

/**
 * Resolved per-node style. Paint is implicit: `background`/`radius`/`borderWidth`
 * imply the rounded-rect fill/stroke the tessellator derives.
 *
 * The text properties live here, next to `fontSize`/`color`, so they are themeable
 * through tokens and overridable per state (`states.focused.style.textAlign`) like
 * every other visual input. They are read from a `Text` node and ignored elsewhere.
 */
export interface Style {
  background?: ColorValue;
  radius?: Dim;
  borderWidth?: Dim;
  borderColor?: ColorValue;
  color?: ColorValue;
  fontSize?: Dim;
  opacity?: number;
  /** Horizontal alignment of each line inside the rect. Default: "start". */
  textAlign?: TextAlign;
  /** Vertical alignment of the whole block inside the rect. Default: "start". */
  textAlignY?: TextAlign;
  /**
   * Distance between the tops of two consecutive lines, in px (a `Dim`, so
   * `"{text.line}"` works). Absent = the font's own metric (ascent + descent), which
   * is what a single-line `Text` has always measured. The extra space a bigger value
   * introduces is split evenly above and below each line (half-leading), so raising
   * it never moves a single-line `Text` off-centre.
   */
  lineHeight?: Dim;
  /** Word wrap to the available width. Default: true. */
  wrap?: boolean;
  /** How text that does not fit is cut. Default: "clip". */
  overflow?: TextOverflow;
  /**
   * Maximum number of lines. Absent = unbounded (the block grows and the flexbox
   * gives it the room). Extra lines are dropped and, with `overflow: "ellipsis"`,
   * the last kept line ends in `…`.
   */
  maxLines?: number;
}

/**
 * Closed set of easing curves (decision 2026-08-11). Defined as closed-form cubic
 * polynomials rather than CSS cubic-béziers so every target computes the SAME number
 * without a solver — see `easeProgress`, the normative reference implementation.
 */
export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

/**
 * Declarative transition for a node's animatable values. The SDK tweens whenever a
 * RESOLVED animatable value changes, whatever caused the change (entering/leaving a
 * state, `SetData` on a bound input, a token swap) — there is no trigger list.
 *
 * Animatable: `background`, `borderColor`, `color` (componentwise lerp in straight
 * sRGB with straight alpha), `opacity`, `radius`, `borderWidth`, and the layout dims
 * `width`, `height`, `gap`, `padding`. Everything else snaps: `fontSize` (the glyph
 * atlas key), the text-layout properties (`wrap`, `textAlign`, `textAlignY`,
 * `lineHeight`, `overflow`, `maxLines` — a re-wrap has no intermediate value),
 * `grow`, the layout enums, and every structural prop (`visible`, `clip`,
 * `text`, `open`, `src`, `fit`, `axis`, `scrollbar`, the Slider's `value`/`min`/
 * `max`/`step` — a control's value is state the player is dragging, not a visual
 * magnitude to catch up with — and the Overlay's `modal`/`z`/`autoCloseMs`, the
 * last two numeric but ordering and timing).
 *
 * Both endpoints must resolve to numbers/colors — an `undefined` (auto) endpoint
 * snaps. Mounting and envelope reloads snap too (no previous value to tween from);
 * an interruption retargets from the current interpolated value over a full duration.
 *
 * A component's own behavior may drive this same machinery with endpoints it
 * computes, and then the tween is spec of that component rather than a value of the
 * animatable set: `ProgressBar` tweens its `value` (never the fill rect) and
 * `Spinner` loops on `period`, which is why neither prop appears in the set above.
 */
export interface Transition {
  /** Duration in milliseconds. A `Dim` so motion is themeable (`"{motion.fast}"`); <= 0 is instant. */
  duration: Dim;
  /** Default: "ease-out". */
  easing?: Easing;
}

interface NodeBase {
  id?: string;
  /** Single hiding mechanism — `display:none` semantics (leaves layout). */
  visible?: Bindable<boolean>;
  layout?: Layout;
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
  /**
   * Tweens this node's own animatable values when they change (no cascade — a node
   * never inherits its parent's transition). Read from the base node only: a
   * per-state transition (asymmetric in/out) is a compatible future extension.
   */
  transition?: Transition;
  /**
   * Receives initial focus (decision 2026-08-03 §7: navigation is automatic
   * spatial — the SDK moves focus from live layout rects; focusability derives
   * from component identity; `states.focused` styles the focused node).
   */
  autofocus?: boolean;
  /**
   * Clips children's paint AND hit-testing to this node's layout rect
   * (paint-only config, like `opacity` — no runtime state). Overflowing
   * children neither draw nor receive input outside the rect; a node's
   * effective clipping rect is the intersection with all ancestor clips.
   */
  clip?: boolean;
}

/**
 * Declarative group behaviors (decision 2026-08-03, composites): composites are
 * NOT IR types — they flatten to primitives at authoring time, and cross-child
 * behavior is declared with `group` and implemented generically by the SDK.
 * Older SDKs ignore unknown `group` values, so composites degrade gracefully
 * (an Accordion becomes independent Collapses) instead of failing to render.
 *
 * - `"exclusive-open"` (Accordion): when a child `Collapse` opens, its siblings close.
 * - `"exclusive-select"` (Tabs, decision 2026-08-11): exactly one child is shown at a
 *   time. Positional contract, like Collapse's header — no id wiring in the JSON:
 *   `children[0]` is the **tab bar**, whose own children are the tab buttons, and
 *   `children[1..n]` are the **panels**, one per button in bar order. Selecting index
 *   `i` puts `children[i + 1]` in layout (siblings leave it, `display:none`
 *   semantics) and gives bar button `i` the `selected` state.
 * - `"exclusive-check"` (RadioGroup, decision 2026-08-11): one descendant Toggle is
 *   checked, identified by VALUE rather than by position — `value` on the group is
 *   the selection, `value` on each Toggle is its option.
 *
 * One behavior governs one state: `open` (Collapse), `selected` (index, Tabs),
 * `checked` (Toggle).
 */
export type GroupBehavior = "exclusive-open" | "exclusive-select" | "exclusive-check";

export interface ContainerNode extends NodeBase {
  type: "Container";
  /** Cross-child behavior the SDK enforces (e.g. Accordion = "exclusive-open"). */
  group?: GroupBehavior;
  /**
   * Initially selected index for `group: "exclusive-select"` (default: 0), the
   * counterpart of `CollapseNode.open` — initial state travels in the IR, the
   * runtime state belongs to the SDK. Ignored without that group behavior.
   */
  selected?: number;
  /**
   * Selected value of an `"exclusive-check"` group (RadioGroup): a descendant
   * Toggle is checked when its `value` equals this one, and tapping a Toggle
   * writes its `value` here. Meaningless on any other group — the whole point of
   * a radio group is that the selection is ONE value, not N booleans. (Tabs use
   * `selected` instead: an index, because tabs are positional.)
   */
  value?: Bindable<string | number>;
  children?: ZNode[];
}

/**
 * A run of text. A LEAF with an intrinsic size: it takes no children, and the
 * layout pass sizes it from the font metrics.
 *
 * **Multiline (decision 2026-08-11, ZAB-17).** Text wraps by default to the width
 * the flexbox offers it, and every text knob is `style` (`wrap`, `textAlign`,
 * `textAlignY`, `lineHeight`, `overflow`, `maxLines`). Because break points must be
 * IDENTICAL on every target, the algorithm is normative — an SDK implements exactly
 * this, not "whatever the platform's text engine does":
 *
 * 1. **Available width.** The view offers its own width to the root; each node passes
 *    down what it received minus its `padding` on both sides, and an explicit
 *    `layout.width` REPLACES the offer for that subtree. Row and column behave the
 *    same (a child is offered the parent's full content width, never a share of it —
 *    v1 measures no cross-child competition). A `ScrollView` offers nothing on a
 *    scrollable axis: its children measure unconstrained there, so a horizontal
 *    scroller never wraps. No offer (or one <= 0) means no wrapping.
 * 2. **Hard breaks.** `\r\n` and `\r` normalize to `\n`, which always breaks. An empty
 *    paragraph still produces a line, so a blank line takes vertical space.
 * 3. **Word wrap** (greedy, first fit). Break opportunities are runs of SPACE (U+0020)
 *    and TAB (U+0009) — no other character breaks, so a non-breaking space holds. A
 *    word is appended to the current line while the total fits; otherwise the line
 *    ends and the word starts the next one, and the spaces at the break are dropped
 *    (they never count toward a line's width, though spaces that start a line do —
 *    indentation is preserved). Every width includes the font's KERNING between
 *    consecutive glyphs, and a break ends the chain: the pair straddling it never
 *    applies, which is what keeps a measured line exactly as wide as the painted one.
 * 4. **Long words.** A word that does not fit on a line of its own is broken between
 *    glyphs, at the last one that fits, with a minimum of one glyph per line.
 * 5. **Truncation.** Lines past `maxLines` are dropped; then `overflow` cuts what is
 *    still too wide — `wrap: false` only, since a wrapped line already fits and the
 *    minimum-one-glyph rule wins over the cut — and, if `"ellipsis"`, marks the last
 *    line with `…`, dropping glyphs and trailing spaces until the mark fits.
 * 6. **Placement.** Block height = lines × `lineHeight`. Line `i` sits at
 *    `top + i · lineHeight`, and its baseline at
 *    `+ (lineHeight − fontLineHeight) / 2 + ascent` (half-leading). `textAlign`
 *    aligns each line inside the content box by its own width; `textAlignY` aligns
 *    the block as a whole.
 *
 * The text properties SNAP like `fontSize` — none of them is animatable by a
 * `transition` (a re-wrap has no meaningful intermediate value).
 */
export interface TextNode extends NodeBase {
  type: "Text";
  text: Bindable<string>;
}

export interface ButtonNode extends NodeBase {
  type: "Button";
  /** Named action, exposed idiomatically per engine (C# event / signal / Blueprint). */
  onClick?: string;
  children?: ZNode[];
}

/**
 * Collapsible region (the `<details>`/`<summary>` model): `children[0]` is the
 * header — always visible, tapping it toggles — and the rest is content that
 * enters/leaves layout with `display:none` semantics. The SDK owns the runtime
 * open state (keyed by type) and re-runs layout on toggle; the game can also
 * drive it programmatically (`SetOpen(id, open)`).
 */
export interface CollapseNode extends NodeBase {
  type: "Collapse";
  /** Initial state (default: true). */
  open?: boolean;
  /** `children[0]` = header; `children[1..]` = collapsible content. */
  children?: ZNode[];
}

/** Scrollable axis of a ScrollView. */
export type ScrollAxis = "vertical" | "horizontal" | "both";

/**
 * Scrollable region (5th primitive, decision 2026-08-11). A normal flex
 * container on both sides: its own size comes from its layout props, and
 * `direction`/`justify`/`align`/`gap`/`padding` apply to its children — but
 * children are measured UNCONSTRAINED on the scrollable axis, and the SDK owns
 * the runtime scroll offset (clamped to `max(0, contentSize - viewport)` on
 * every relayout) plus the wheel/drag input and the overlay scrollbar.
 * Padding counts as content (pads the children, expands scrollable bounds).
 * Always clips, paint AND hit-testing; an explicit `clip: false` is ignored.
 *
 * **No states, no events (decision 2026-08-11, ZAB-9).** The offset is runtime
 * state, not a *style* state: a ScrollView is not focusable and carries no
 * `hover`/`pressed`/`selected`/`checked`, so `states.*` on this node never
 * applies (its children keep theirs — scrolling by drag does not become a click
 * on the Button under the finger). It emits no action either: there is no
 * `onScroll` in v1. A game moves it through the SDK's host channel
 * (`SetScroll(id, x, y)` — the `SetOpen` counterpart), which is API, not IR.
 *
 * Deferred, all compatible extensions: an authored/bindable offset and
 * auto-scrolling to the focused node land with gamepad input; inertia, a
 * styleable scrollbar (`scrollbar` boolean → object) and snapping come after.
 */
export interface ScrollViewNode extends NodeBase {
  type: "ScrollView";
  /** Scrollable axis. Default: "vertical". */
  axis?: ScrollAxis;
  /** Overlay position indicator painted by the SDK. Default: true. */
  scrollbar?: boolean;
  children?: ZNode[];
}

/**
 * How an image fills its layout rect (decision 2026-08-11, ZAB-13). Every mode
 * paints INSIDE the rect — `cover` crops the source through its UVs instead of
 * overflowing, so the "nothing paints outside the layout rect" invariant that
 * makes hit-testing on rects honest holds without any clipping machinery.
 *
 * - `"contain"` (default): the whole image, undistorted, centered — letterboxed.
 * - `"cover"`: fills the rect, undistorted, cropping the overflowing axis evenly.
 * - `"stretch"`: fills the rect exactly, distorting the aspect ratio.
 */
export type ImageFit = "contain" | "cover" | "stretch";

/**
 * Textured rectangle (6th primitive). A content-bearing LEAF, like `Text`: its
 * intrinsic size is the source's pixel size from the manifest — which is why it is
 * a node type and not a `Container` with a texture paint (decision 2026-08-11,
 * ZAB-13). It takes no children.
 *
 * `src` references the envelope's asset manifest; at authoring time the prop carries
 * a path relative to `src/assets/` and `zabloo export` rewrites it to the final
 * `asset:<id>` ref. It is static — an asset reference is collected at export time,
 * so it is never a binding.
 *
 * Paint stays implicit from style, with no new fields:
 * - `style.color` **tints** the image (multiplied per channel; absent = white =
 *   the pixels as they are), the same "color of this node's content" `Text` uses
 *   for its glyphs — so `states.*.style.color` tints per state for free.
 * - `style.radius` rounds the painted image, matching the node's own background.
 * - `style.background`/`borderWidth` ARE the loading placeholder: an image paints
 *   nothing until its bytes are decoded, and layout has already reserved the space
 *   from the manifest's `width`/`height`. No `loading` state exists — the
 *   placeholder is authored, not a runtime state.
 */
export interface ImageNode extends NodeBase {
  type: "Image";
  src: AssetRef;
  /** How the source fills the layout rect. Default: "contain". */
  fit?: ImageFit;
}

/**
 * Two-state control (8th primitive, decision 2026-08-11): the checkbox, the
 * switch and the radio are ONE type — they differ in styling and in the group
 * they sit in, not in behavior. The SDK owns the runtime `checked` state (keyed
 * by type, like Button's pressed and Collapse's open) and toggles it on
 * tap/Enter/gamepad-A.
 *
 * **Indicator slots** — paint stays implicit (no explicit paint layer in v1), so
 * the check/knob is composed, not drawn by a new primitive command:
 * `children[0]` is shown only while checked, `children[1]` only while unchecked,
 * and `children[2..]` are always shown (the label). The slots enter/leave layout
 * with `display:none` semantics — the same mechanism as Collapse content, so a
 * switch moves its knob by swapping two `justify`-ed slots and a checkbox shows
 * its tick. `@zabloo/react`'s `<Checkbox>`/`<Switch>`/`<Radio>` build the slots;
 * hand-writing them is not the expected authoring path.
 *
 * **Value.** Standalone, a Toggle carries a boolean: `checked` may be a static
 * initial value or a READ/WRITE binding — the SDK writes the new value back into
 * its data store and notifies the game. Inside an `"exclusive-check"` group its
 * `checked` is DERIVED from the group's `value` (never stored per node), and
 * tapping it writes its own `value` into the group's binding.
 */
export interface ToggleNode extends NodeBase {
  type: "Toggle";
  /** Initial state, or a read/write data-path binding. Default: false. */
  checked?: Bindable<boolean>;
  /** This option's value inside an `"exclusive-check"` group (radio). */
  value?: string | number;
  /** Named action fired after every change, like Button's `onClick`. */
  onChange?: string;
  /** `children[0]` = checked slot; `children[1]` = unchecked slot; `children[2..]` = always shown. */
  children?: ZNode[];
}

/** Orientation of a Slider's track. Vertical runs bottom-to-top, like a fader. */
export type SliderAxis = "horizontal" | "vertical";

/**
 * Continuous value control (9th primitive, decision 2026-08-11, ZAB-24). The
 * capacity it forces is the one no primitive could express: a NUMBER the player
 * sets by pointing, whose geometry is a function of that number rather than of
 * the flex pass. The SDK owns the runtime value (keyed by type, like Toggle's
 * `checked`) and drives it from the drag, a tap on the track, the axis arrow
 * keys and the game's own API.
 *
 * **The node IS the track**: its `style` paints the rail through the ordinary
 * implicit paint (no new draw command, no third slot), and it takes exactly two
 * positional children the SDK arranges from the value instead of laying them
 * out in flow:
 *
 * | Index | What it is | How the SDK places it |
 * |---|---|---|
 * | `children[0]` | the fill | from the track's start to the value's fraction |
 * | `children[1]` | the thumb | its own size, centered on the value's position |
 *
 * The thumb's travel is inset by half its own size, so it never paints outside
 * the node's rect (the border-box invariant of 2026-08-06 holds and hit-testing
 * on layout rects stays honest). A Slider **measures as a leaf**: the slots
 * never contribute to its size — the track's length and thickness come from its
 * own `layout` (`@zabloo/react`'s `<Slider>` fills them in).
 *
 * **Value.** `value` may be a static initial number or a READ/WRITE binding: the
 * SDK writes every new value into its data store and notifies the game, exactly
 * like `Toggle.checked` (decision 2026-08-11, ZAB-23). It is clamped to
 * `[min, max]` and, with a `step`, quantized to `min + k * step`.
 */
export interface SliderNode extends NodeBase {
  type: "Slider";
  /** Current value, or a read/write data-path binding. Default: `min`. */
  value?: Bindable<number>;
  /** Lower end of the range. Default: 0. */
  min?: number;
  /** Upper end of the range. Default: 1. */
  max?: number;
  /** Quantization step from `min`. Absent (or <= 0) means a continuous value. */
  step?: number;
  /** Track orientation. Default: "horizontal". */
  axis?: SliderAxis;
  /**
   * Named action fired on every value change, however it was caused — the live
   * hook (a volume preview follows the drag).
   */
  onChange?: string;
  /**
   * Named action fired when a gesture ENDS (pointer release, arrow key up): the
   * value the player settled on. The expensive-to-apply setting (graphics
   * quality, resolution) hangs here instead of debouncing `onChange` game-side.
   */
  onCommit?: string;
  /** `children[0]` = fill; `children[1]` = thumb. Both optional, both positional. */
  children?: ZNode[];
}

/**
 * Content lifted out of the normal flow into the view's overlay layer (decision
 * 2026-08-11, ZAB-19). Declared in place in the tree — wherever the UI that opens
 * it lives — but it never affects its siblings' layout: the SDK collects every
 * visible Overlay of the view into ONE layer painted above the whole tree, sorted
 * by `(z, document order)`.
 *
 * The overlay's own rect IS the view rect, so `layout.justify`/`align`/`padding`
 * position its content (centered modal, bottom-right toast) and its `style`
 * paints the backdrop — a translucent `background` is the backdrop, with no extra
 * field and paint still implicit from style. `layout.width`/`height` on the
 * Overlay itself are ignored (a layer is not sized); size the child instead.
 *
 * `visible` behaves as everywhere else: a hidden Overlay contributes no layer, no
 * backdrop and no input blocking.
 */
export interface OverlayNode extends NodeBase {
  type: "Overlay";
  /**
   * Blocks input to everything below (including lower overlays) and confines
   * focus navigation to this subtree. Default: true. `false` (toast, tooltip)
   * paints above but leaves the layer's own rect inert to input — only its
   * children receive events, everything else passes through.
   */
  modal?: boolean;
  /** Explicit stacking inside the overlay layer; ties break by document order. Default: 0. */
  z?: number;
  /**
   * Named action fired on a dismiss request (Escape / gamepad B / a tap on the
   * backdrop). A declared hook like `onClick` — closing itself is the SDK's
   * default behavior plus the game→SDK API, never logic in the JSON.
   */
  onDismiss?: string;
  /**
   * Milliseconds this overlay stays up before the SDK requests its own dismissal
   * (a Toast that fades on its own). Same dismiss path as Escape or a backdrop
   * tap — the SDK clears the bound `visible` and fires `onDismiss`. The clock
   * starts when the overlay enters the layer and resets if it leaves and returns.
   * Omitted (the default) means it stays until something closes it.
   *
   * A plain number, not a `Dim`: it is a behavior timeout, not motion — nothing
   * about it is themeable the way `transition.duration` is.
   */
  autoCloseMs?: number;
  children?: ZNode[];
}

/** Default item alias of a `Repeat` template (`as`). */
export const ITEM_ALIAS = "item";

/** Reserved leaf segment inside an item scope: `"item.$index"` → the element's position. */
export const INDEX_SEGMENT = "$index";

/**
 * Data-driven repetition (9th primitive, decision 2026-08-11, ZAB-29): the first
 * node whose CHILDREN come from data instead of from the document. `items` binds an
 * array and the SDK instantiates `children[0]` — the template — once per element.
 *
 * A node type and not a prop on `Container` for the reason that already sank
 * `checkable` on Button (ZAB-23) and `overflow` on ScrollView (ZAB-5): the SDK
 * dispatches behavior BY TYPE, never by type *and* prop. Old SDKs fall into the
 * normative fallback for unknown types (render as a Container preserving children),
 * so the content survives as one static, unresolved copy of the template.
 *
 * The Repeat IS the flex container of the instances: its own `layout` (direction,
 * gap, padding, …) lays the items out, which is what lets `@zabloo/react`'s
 * `<List>`/`<Grid>` be authoring sugar over it rather than IR types of their own.
 *
 * **Slots** (positional, like Collapse's header and Toggle's indicator):
 * `children[0]` is the item template, `children[1..]` the EMPTY state — in layout
 * only while the bound value is an empty array, absent, or not an array at all
 * (`display:none` semantics, the one hiding mechanism). It exists because "show
 * *No items yet*" would otherwise need a boolean expression over the data, and the
 * IR has no expressions by design.
 *
 * **Identity.** `key` is a path RELATIVE to the item pointing at a stable field
 * (`"id"`, `"meta.sku"`); without it identity is positional. Identity is what makes
 * `SetData` updates stable: reordering a keyed array moves the SDK's per-item state
 * (focus, `checked`, scroll offset, in-flight transitions) with the item instead of
 * leaving it pinned to a position. See `itemKey`/`itemIdentity`.
 */
export interface RepeatNode extends NodeBase {
  type: "Repeat";
  /**
   * The bound array. Always a binding — a literal array here would put DATA in the
   * document, and the IR carries structure while the game owns the data.
   */
  items: { bind: string };
  /**
   * Alias the template binds against. Default: `"item"`. Declared rather than
   * reserved so nested lists can reach the outer element (a category's id from
   * inside a product row); the innermost matching alias wins, so an alias also
   * shadows an absolute root of the same name — pick names that are not data roots.
   */
  as?: string;
  /** Path relative to the item naming its stable identity. Absent = positional. */
  key?: string;
  /** `children[0]` = item template; `children[1..]` = empty state. */
  children?: ZNode[];
}

/**
 * One item scope open while the SDK instantiates a template — a stack of these
 * grows one entry per enclosing `Repeat`.
 */
export interface ItemScope {
  /** The enclosing Repeat's `as` (default `"item"`). */
  alias: string;
  /** Absolute data path of this element, e.g. `"shop.items.3"`. */
  path: string;
  /** Position in the array — what `"<alias>.$index"` resolves to. */
  index: number;
}

/**
 * Result of resolving a binding inside a template: either an absolute data path or
 * the element's position, which is a number the data does not contain.
 */
export type ResolvedBind = { kind: "path"; path: string } | { kind: "index"; index: number };

/**
 * Context a named action carries when it fires from inside a repeated item
 * (decision 2026-08-11, ZAB-29) — `onClick: "buy"` has to say WHICH one. The same
 * move `onDataChanged(path, value)` made for data in ZAB-23: actions stop coming
 * back empty. Actions outside a Repeat still fire with no context.
 *
 * It describes the INNERMOST item; that is enough for nested lists because `path`
 * already embeds every enclosing index (`"shop.cats.2.items.5"`), so the game can
 * address the whole chain from it.
 */
export interface ActionContext {
  /** Absolute data path of the item, e.g. `"shop.items.3"`. */
  path: string;
  /** The item's raw key when the Repeat declares one; absent when identity is positional. */
  key?: string | number;
  /** Position in the array. */
  index: number;
}

/**
 * Normative reference implementation of binding resolution inside templates — like
 * `easeProgress`, it lives here because all three targets must compute the SAME
 * path from the same input, and every SDK ports these exact rules.
 *
 * Innermost scope wins (so nesting shadows). A path under no known alias is
 * absolute and passes through untouched, which is how an item row still binds
 * `player.gold`. Only the exact leaf `"<alias>.$index"` is reserved; anything
 * deeper (`"item.a.$index"`) is an ordinary segment that will simply read
 * `undefined`.
 */
export function resolveBinding(bind: string, scopes: readonly ItemScope[]): ResolvedBind {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope === undefined || scope.alias.length === 0) continue;
    if (bind === scope.alias) return { kind: "path", path: scope.path };
    if (!bind.startsWith(`${scope.alias}.`)) continue;
    const rest = bind.slice(scope.alias.length + 1);
    if (rest === INDEX_SEGMENT) return { kind: "index", index: scope.index };
    return { kind: "path", path: `${scope.path}.${rest}` };
  }
  return { kind: "path", path: bind };
}

/** Absolute path of element `index` of the array at `arrayPath`. */
export function itemPath(arrayPath: string, index: number): string {
  return `${arrayPath}.${index}`;
}

const ARRAY_INDEX = /^\d+$/;

/**
 * Read a dot-separated path out of a plain data value. Normative: a numeric segment
 * indexes an array (nothing else does — `"length"` is not a field), anything missing
 * or walked through a non-object yields `undefined` rather than throwing. Bound UI
 * degrades to "no value", it never breaks the frame.
 */
export function readPath(root: unknown, path: string): unknown {
  if (path.length === 0) return undefined;
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (segment.length === 0) return undefined;
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * The item's raw key — the one that travels to the game in `ActionContext.key`.
 * Only a string or a finite number identifies an item; anything else (an object, a
 * missing field, an empty string) means "this element has no key" and identity
 * falls back to its position.
 */
export function itemKey(item: unknown, keyPath: string | undefined): string | number | undefined {
  if (keyPath === undefined || keyPath.length === 0) return undefined;
  const value = readPath(item, keyPath);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Reconciliation identity: the string an SDK keys its per-item state by across a
 * `SetData` that reorders, inserts or removes elements.
 *
 * Keyed identities are prefixed so the two spaces stay DISJOINT — without it a list
 * where only some elements resolve a key would let item `{id: "0"}` collide with the
 * unkeyed element at position 0 and inherit its state.
 */
export function itemIdentity(key: string | number | undefined, index: number): string {
  return key === undefined ? String(index) : `k:${key}`;
}

/**
 * Fractional indicator (decision 2026-08-11, ZAB-35). The NODE IS THE TRACK — its
 * `style` paints the groove and its `layout` sizes it — and `children[0]` is the
 * FILL, a normal node whose own style paints the bar. A positional slot, like
 * Collapse's header and Toggle's indicators: paint stays implicit, so the fill is a
 * composed child and not a new draw command.
 *
 * It is a node type rather than authoring sugar because nothing in v1 can express
 * "a fraction of my parent": `Layout` dims are px and are not bindable, and `grow`
 * is neither. The fraction is exactly the capability this primitive adds.
 *
 * **Geometry (normative).** Along `layout.direction` (`"row"` = horizontal, the
 * default; `"column"` = vertical) the SDK sizes the fill at `contentMain * value`,
 * where `contentMain` is the track's main axis minus its padding, and stretches it
 * across the whole cross axis. `layout.justify` anchors it: `"start"` (default)
 * grows from the left/top, `"end"` from the right/bottom. The fill's OWN
 * `layout.width`/`height`/`grow` on the main axis are ignored — the SDK owns that
 * number. `children[1..]` are reserved: v1 lays out nothing else inside the track
 * (a label on top of the bar needs overlapping placement, which v1 does not have).
 *
 * **Value.** `0..1`, clamped; a non-finite value (or a binding whose data is missing
 * or not a number) reads as `0`. A read binding (`{ bind: "player.hp" }`) is the
 * expected authoring path — `SetData` moves the bar.
 *
 * **Motion.** A `transition` on this node tweens the VALUE, not the computed rect:
 * the SDK interpolates the fraction and then runs its normal layout pass with it, so
 * there is still one pass per frame and both targets get the same number (decision
 * 2026-08-11 §4). The fill's own `transition` never sees the change, since its main
 * size is not one of its declared inputs.
 *
 * Forward-tolerance: an SDK that does not know this type renders it as a Container
 * (normative unknown-type rule), i.e. the track with an unsized fill inside — the
 * bar loses its fraction, never the layout around it.
 */
export interface ProgressBarNode extends NodeBase {
  type: "ProgressBar";
  /** Progress in 0..1 (clamped). Static or a read binding. Default: 0. */
  value?: Bindable<number>;
  /** `children[0]` = the fill; further children are reserved (unused in v1). */
  children?: ZNode[];
}

/**
 * Indeterminate activity indicator (decision 2026-08-11, ZAB-35): a node whose
 * children pulse in a travelling wave — the three dots that breathe.
 *
 * It does not spin. v1 has no transform (no translate/rotate/scale, decision
 * 2026-08-11 §2), so a rotating arc is not expressible; what IS expressible, and
 * portable to every target down to the last decimal, is a periodic modulation of
 * `opacity`. It is a node type because an infinite loop is behavior owned by the SDK
 * and keyed by component identity (like the scroll offset) — that identity has to
 * exist in the IR, and nothing else in it repeats forever.
 *
 * **Wave (normative).** With `n` children, child `i` carries the phase
 * `frac(elapsed / period - i / n)` and the SDK MULTIPLIES its resolved `opacity` by
 * `min + (1 - min) * spinnerPulse(phase, easing)`. Multiplicative, like every other
 * opacity in the system (decision 2026-08-06), so a dot that authored `opacity: 0.5`
 * still pulses, just dimmer. Children keep their normal layout: the beads are laid
 * out by the node's own `direction`/`gap`/`align` like any container's.
 *
 * Forward-tolerance: an older SDK renders it as a Container — the beads show, at
 * rest. The degradation is the absence of the loop, never a layout change.
 */
export interface SpinnerNode extends NodeBase {
  type: "Spinner";
  /**
   * Full cycle in milliseconds. A `Dim` so the loop is themeable like the rest of
   * motion (`"{motion.loop}"`, and a "reduce motion" theme stops it dead).
   * Default: 900. `<= 0` or non-finite freezes the wave at its first frame.
   */
  period?: Dim;
  /** Trough of the wave: the opacity multiplier at its dimmest, 0..1. Default: 0.25. */
  min?: number;
  /** Curve of the ramp up and back down. Default: "ease-in-out". */
  easing?: Easing;
  /** The beads, in wave order — normal children in every other respect. */
  children?: ZNode[];
}

/** True if this package's reader can consume content with version `v`. */
export function supportsVersion(v: number): boolean {
  return Number.isInteger(v) && v === IR_VERSION;
}

/**
 * Minimal structural validation of an envelope. Forward-tolerant by design: unknown
 * props and node types pass through — only the envelope shape and the major version
 * are enforced.
 */
export function parseEnvelope(data: unknown): Envelope {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("IR envelope: expected a JSON object");
  }
  const env = data as Record<string, unknown>;
  if (typeof env.v !== "number") {
    throw new Error("IR envelope: missing numeric `v` field");
  }
  if (!supportsVersion(env.v)) {
    throw new Error(
      `IR envelope: unsupported major version ${env.v} (this reader implements v${IR_VERSION})`,
    );
  }
  if (typeof env.tokens !== "object" || env.tokens === null) {
    throw new Error("IR envelope: missing `tokens` dictionary");
  }
  if (typeof env.views !== "object" || env.views === null) {
    throw new Error("IR envelope: missing `views` map");
  }
  if (env.assets !== undefined) {
    if (typeof env.assets !== "object" || env.assets === null || Array.isArray(env.assets)) {
      throw new Error("IR envelope: `assets` must be an object");
    }
    for (const [id, entry] of Object.entries(env.assets)) {
      validateAssetEntry(id, entry);
    }
  }
  return data as Envelope;
}

/**
 * Decode an asset's inlined bytes. Browser-safe on purpose (atob, no `node:` imports)
 * — shared by the web renderer and the CLI preview; the Unity SDK decodes on its side
 * (Convert.FromBase64String).
 */
export function decodeAssetData(entry: AssetEntry): Uint8Array {
  if (entry.data === undefined) {
    throw new Error("asset has no inline `data` (deferred resolution is not supported yet)");
  }
  const binary = atob(entry.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * True if `value` is a well-formed asset reference (`"asset:<id>"` with a non-empty
 * id). SDK consumers should use this instead of hand-rolled `startsWith("asset:")`
 * string surgery.
 */
export function isAssetRef(value: unknown): value is AssetRef {
  return typeof value === "string" && value.startsWith("asset:") && value.length > "asset:".length;
}

/**
 * Extract the manifest id from an asset ref (strips the `asset:` prefix). SDK
 * consumers should use this instead of hand-rolled string surgery.
 */
export function assetIdFromRef(ref: AssetRef): string {
  return ref.slice("asset:".length);
}

/**
 * Normative reference implementation of the closed easing set: maps linear progress
 * `t` (0..1) to eased progress. Shared by the web renderer and the CLI preview; the
 * Unity SDK ports these exact polynomials, which is what keeps the curves identical
 * across targets. `t` outside 0..1 clamps; an unknown curve (newer content on an
 * older reader) falls back to linear rather than refusing to animate.
 */
export function easeProgress(easing: Easing, t: number): number {
  if (!(t > 0)) return 0; // also catches NaN
  if (t >= 1) return 1;
  switch (easing) {
    case "ease-in":
      return t * t * t;
    case "ease-out":
      return 1 - (1 - t) ** 3;
    case "ease-in-out":
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    default:
      return t;
  }
}

/**
 * Normative reference implementation of the `Spinner`'s wave (decision 2026-08-11,
 * ZAB-35): maps a bead's phase to its 0..1 pulse. Built on `easeProgress` for the
 * same reason it exists — closed-form arithmetic is what keeps every target on the
 * same number — and shaped as a symmetric ramp, up over the first half of the cycle
 * and back down over the second, so the loop is seamless: `f(0) = 0`, `f(0.5) = 1`,
 * and `f` approaches 0 again as the phase completes. Phases outside 0..1 wrap
 * (including negative ones, which is how a bead's offset arrives).
 */
export function spinnerPulse(phase: number, easing: Easing = "ease-in-out"): number {
  if (!Number.isFinite(phase)) return 0;
  const p = phase - Math.floor(phase);
  return p < 0.5 ? easeProgress(easing, p * 2) : easeProgress(easing, (1 - p) * 2);
}

/**
 * Normative reading of a `ProgressBar`'s `value` (decision 2026-08-11, ZAB-35):
 * clamps to 0..1 and reads anything that is not a finite number — missing data, a
 * string, NaN — as 0. Shared so "what does a broken binding show" has one answer
 * across targets: an empty bar, never a full one and never a crash.
 */
export function clampProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0; // NaN too
  return value > 1 ? 1 : value;
}

const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Cheap shape checks only — `data` is never decoded here (that would pay the cost twice). */
function validateAssetEntry(id: string, value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`IR envelope: asset "${id}" must be an object`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.hash !== "string" || entry.hash.length === 0) {
    throw new Error(`IR envelope: asset "${id}": missing non-empty \`hash\``);
  }
  if (typeof entry.mime !== "string" || entry.mime.length === 0) {
    throw new Error(`IR envelope: asset "${id}": missing non-empty \`mime\``);
  }
  if (typeof entry.size !== "number" || !Number.isFinite(entry.size) || entry.size < 0) {
    throw new Error(`IR envelope: asset "${id}": missing numeric \`size\``);
  }
  if (
    entry.width !== undefined &&
    (typeof entry.width !== "number" || !Number.isFinite(entry.width))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`width\` must be a number`);
  }
  if (
    entry.height !== undefined &&
    (typeof entry.height !== "number" || !Number.isFinite(entry.height))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`height\` must be a number`);
  }
  if (
    entry.data !== undefined &&
    (typeof entry.data !== "string" ||
      entry.data.length % 4 !== 0 ||
      !BASE64_SHAPE.test(entry.data))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`data\` is not base64`);
  }
}
