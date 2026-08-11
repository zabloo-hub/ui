/**
 * @zabloo/format — the zabloo IR: a versioned, engine-agnostic envelope of views.
 *
 * The IR is a payload consumed at runtime by engine SDKs (and hot-updated over the
 * wire), never build-time source. Design rules (see decisions 2026-08-01):
 * - v1 vocabulary is a closed set grown by capability: Container, Text, Button,
 *   Collapse, ScrollView, Image, Overlay, Toggle.
 * - Overlay nodes leave their parent's flow and are painted in a single top layer
 *   above the whole view, ordered by `(z, document order)` (decision 2026-08-11).
 * - Assets travel embedded (base64) in an `assets` manifest; nodes reference them as `asset:<id>` (decision 2026-08-11).
 * - Styles are resolved per node and reference a flat token dictionary in the envelope.
 * - Layout is runtime Flexbox in the SDK (Yoga subset) — no baked rects.
 * - Paint is 100% implicit from style in v1 (no explicit draw-command layer).
 * - Two dynamic mechanisms only: named actions and data-path bindings. Bindings
 *   are READ/WRITE from v1 on the controls that own a value (Toggle): the SDK
 *   writes the new value into its own data store and notifies the game through
 *   one callback (decision 2026-08-11, ZAB-23).
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

/** A static value or a data-path binding, e.g. `{ bind: "player.gold" }`. */
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
  | ToggleNode;

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
 * `text`, `open`, `src`, `fit`, `axis`, `scrollbar`, and the Overlay's `modal`/`z`/
 * `autoCloseMs` — the last two are numeric but they are ordering and timing, not
 * visual magnitudes).
 *
 * Both endpoints must resolve to numbers/colors — an `undefined` (auto) endpoint
 * snaps. Mounting and envelope reloads snap too (no previous value to tween from);
 * an interruption retargets from the current interpolated value over a full duration.
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
 *    indentation is preserved).
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
 * Always clips; an explicit `clip: false` is ignored.
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
