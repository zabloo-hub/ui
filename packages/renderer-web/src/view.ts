/**
 * The web view — the browser sibling of the Unity SDK's ZablooView + Document:
 * builds the node tree from an envelope, owns runtime state keyed by type
 * (Button pressed, Collapse open, Toggle checked, group behaviors, the overlay
 * layer's focus stack and auto-close timers), resolves tokens and bindings, runs
 * the renderer's own layout pass and re-tessellates on change. The browser
 * provides a GPU canvas and pointer events — nothing else.
 *
 * Every frame starts with the EXPANSION pass (ZAB-31): the `Repeat` nodes turn the
 * bound arrays into instances of their template — as many as the viewport can show
 * — so everything after it works on an ordinary tree of nodes. Then the resolve
 * pass: tokens and states collapse into each node's animatable values, the
 * transition engine tweens the ones that moved, and measure/arrange/paint run on
 * that result. While anything is animating the view schedules the next frame
 * itself; otherwise it repaints only on change.
 *
 * Layout and paint then run in two passes: the tree, and above it the overlay
 * layer (`overlay.ts` owns the layering, input-capture and focus-scope rules).
 */

import {
  type ActionContext,
  clampProgress,
  type Diagnostic,
  type Dim,
  type Easing,
  type Envelope,
  type ImageFit,
  ITEM_ALIAS,
  type ItemScope,
  itemKey,
  itemPath,
  type RepeatNode,
  type ResolvedBind,
  resolveBinding,
  type ScrollAxis,
  type SliderAxis,
  type Style,
  type TokenValue,
  type Transition,
  type ZNode,
} from "@zabloo/format";
import { ImageLibrary } from "./assets.js";
import { type Clip, intersectClip, isEmptyClip } from "./clip.js";
import { closedHeight, collapseTarget } from "./collapse.js";
import { CARET, FieldEditor, type FieldHost } from "./controls/field.js";
import { affects, DataStore } from "./data.js";
import { loadEnvelope } from "./envelope.js";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { type Batch, GLRenderer } from "./gl.js";
import { FontLibrary, type GlyphAtlas } from "./glyphs.js";
import { childClip } from "./hit.js";
import {
  claimInput,
  focusYieldsKeys,
  type InputView,
  ownsInput,
  registerView,
  unregisterView,
} from "./input/ownership.js";
import { PadController, type PadHost } from "./input/pad.js";
import { PointerHandler, type PointerHost, type SliderGesture } from "./input/pointer.js";
import {
  arrange,
  createLayoutNode,
  inFlow,
  inLayout,
  type LayoutNode,
  measure,
  type Rect,
  type RepeatState,
  selfAndAncestors,
  type TextKey,
  wrapsLines,
} from "./layout.js";
import {
  autofocusIn,
  collectLayer,
  deflate,
  focusScope,
  isPressTriggered,
  type Point,
  selectedOptionIn,
  topModal,
} from "./overlay.js";
import { type OverlayHost, OverlayLayer } from "./overlays/layer.js";
import {
  emptySlots,
  INITIAL_WINDOW,
  type ItemSpan,
  itemsOf,
  itemsPerLine,
  itemTemplate,
  reconcileWindow,
  visibleSpan,
  windowSlots,
} from "./repeat.js";
import { clamp, revealDelta, scrollbarThumb } from "./scroll.js";
import { clampSelected, resolveTabsGroup } from "./select.js";
import {
  growsUpward,
  quantize,
  resolveRange,
  type SliderRange,
  stepBy,
  valueAt,
} from "./slider.js";
import { snapshotView, type ViewSnapshot } from "./snapshot.js";
import { beadOpacity, DEFAULT_PERIOD } from "./spinner.js";
import { effectiveStyle } from "./states.js";
import { type Color, fade, GeometryBuilder } from "./tessellator.js";
import { layoutText, type PlacedLine, placeLines, type TextLayoutOptions } from "./text.js";
import {
  caretAt,
  caretVisible,
  caretXOf,
  clampSelection,
  hasSelection,
  length,
  moveCaret,
  moveToEdge,
  selectAll,
  span,
} from "./textinput.js";
import { isSelected, nextChecked, slotOpacity } from "./toggle.js";
import {
  clearNodeAnim,
  loopPhase,
  type ResolvedTransition,
  type ResolvedValues,
  stepNode,
  stepValue,
} from "./transition.js";
import { decodeBase64, loadFont, type StbFont } from "./ttf.js";

const DEFAULT_FONT_SIZE = 16;
/**
 * Where a resolved `fontSize` stops (ZAB-69). Rasterizing is quadratic in the
 * point size — a glyph at 20000px is a ~200 MB coverage buffer, past that the
 * WASM allocation throws — and the clamp has to live HERE, at resolution time,
 * because a token or a state can hand any finite number to a `Text` mid-frame.
 * 512 is a real display size and still leaves several glyphs per row in the
 * biggest atlas (4096²) at dpr 2. Documented in `docs/format/style.md`; silent
 * on purpose, since this runs on every node on every frame.
 */
const MAX_FONT_SIZE = 512;
/** Paint fallbacks for a declared color whose token does not resolve (author error). */
const MISSING_COLOR: Color = [1, 0, 1, 1];
const DEFAULT_TEXT_COLOR: Color = [1, 1, 1, 1];
/** No tint: an Image with no `color` shows its own pixels (decision 2026-08-11, ZAB-13). */
const UNTINTED: Color = [1, 1, 1, 1];

/** Loose view of a node — the union fields the renderer reads. */
interface AnyNode {
  type: string;
  id?: string;
  visible?: unknown;
  disabled?: unknown;
  layout?: ZNode["layout"];
  style?: Style;
  states?: Record<string, { style?: Style } | undefined>;
  children?: ZNode[];
  onClick?: string;
  text?: unknown;
  src?: unknown;
  fit?: ImageFit;
  open?: boolean;
  scrollbar?: boolean;
  group?: string;
  selected?: unknown;
  autofocus?: boolean;
  checked?: unknown;
  onChange?: string;
  /** Toggle option / group selection, and the ProgressBar's 0..1 fraction. */
  value?: unknown;
  transition?: Transition;
  // Slider (the rest of its contract — `value`/`onChange` are shared above).
  // `min` doubles as the Spinner's wave floor: one loose bag, two node types.
  min?: number;
  max?: number;
  step?: number;
  axis?: string;
  onCommit?: string;
  /** Spinner: cycle length and ramp curve. */
  period?: Dim;
  easing?: Easing;
  /** Repeat: the bound array (always a binding — the IR carries no literal data). */
  items?: { bind: string };
  // TextInput (`value`/`onChange` are shared above, like the Slider's).
  placeholder?: string;
  onSubmit?: string;
  maxLength?: number;
}

/**
 * The parts of a `keydown` the view reads. A real `KeyboardEvent` satisfies it as
 * it comes, and the gamepad synthesizes one (ZAB-47) — which is what lets a d-pad
 * walk a TextInput's caret through the very same code the arrows go through,
 * instead of a second copy of the rules that would drift from it.
 */
interface KeyIntent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** Whether the key is auto-repeating: a held Enter must not re-fire `onSubmit`. */
  repeat: boolean;
  preventDefault(): void;
}

/** The identity a `Repeat` keyed an instance by — the reverse of its own map. */
function identityOf(
  instances: ReadonlyMap<string, LayoutNode> | undefined,
  instance: LayoutNode,
): string | null {
  if (instances === undefined) return null;
  for (const [identity, node] of instances) {
    if (node === instance) return identity;
  }
  return null;
}

/** A synthetic arrow press, for the gamepad directions that reach a focused field. */
function arrowIntent(key: string): KeyIntent {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    repeat: false,
    preventDefault() {},
  };
}

/**
 * Overlay scrollbar (spec 2026-08-11): painted by the SDK inside the
 * ScrollView's rect, on the edge of its axis. Not in layout, not hit-testable
 * in F1 — it indicates the position, it doesn't take input. Styling it is a
 * deferred, compatible extension (`scrollbar` boolean → object).
 */
const SCROLLBAR = { thickness: 4, margin: 2, minLength: 16, color: [1, 1, 1, 0.35] as Color };

/**
 * The focus of a virtualized row that is no longer realized (ZAB-70). It names
 * the ITEM and not the node, because the node is gone: the `Repeat` it belongs
 * to, the identity reconciliation keys that item by, and the child-index path
 * from the instance root down to the node that had the focus.
 */
interface PendingFocus {
  repeat: LayoutNode;
  identity: string;
  path: number[];
}

interface MountOptions {
  /** View ID to render (default: the envelope's first view). */
  view?: string;
  /**
   * Named actions declared in the IR (e.g. onClick: "buy") fire here. From inside
   * a repeated item the action carries the `ActionContext` that says WHICH one
   * (decision 2026-08-11, ZAB-29) — the innermost item's absolute path, its raw
   * key and its position. Outside a `Repeat` there is no context to carry.
   */
  onAction?: (action: string, context?: ActionContext) => void;
  /**
   * The return leg of the data channel (decision 2026-08-11): fires whenever a
   * control writes its value into a bound path, so the game learns the new value
   * without polling. Never fires for `setData` — that value came from the game.
   */
  onDataChanged?: (path: string, value: unknown) => void;
  /**
   * Where the loading contract's diagnostics go (ZAB-72). Every `warn` the
   * validator repaired and every `fatal` that refused the payload arrives here as
   * the STRUCTURED `Diagnostic` — stable `code`, `path` into the envelope — for
   * both `mount` and `reload`. The fatal ones arrive BEFORE `mount` throws.
   *
   * It is what an error overlay, the CLI preview and the future editor show
   * authoring errors from; without it they would be scraping console lines.
   * Omitted, the warnings go to the console exactly as they always have.
   */
  onDiagnostic?: (diagnostic: Diagnostic) => void;
  /** Canvas clear color (CSS hex). */
  background?: string;
  /**
   * Device pixel ratio to render at, instead of the browser's own (ZAB-78).
   *
   * The renderer reads `globalThis.devicePixelRatio` everywhere it turns logical
   * pixels into device ones — the canvas backing store, the glyph atlas scale, the
   * pixel grid glyph quads snap to — so a host that wants to see a UI as another
   * screen would show it has to override all of them at once, or see a mix. This
   * is that one knob: the preview's DPR selector, and the golden harness's fixed
   * ratio, are the same need.
   *
   * Changing it means rebuilding the glyph atlases, so it is fixed for the life of
   * the mount: a host that offers it as a control remounts.
   */
  dpr?: number;
  /**
   * Fires once per frame actually PAINTED, with what that frame cost (ZAB-78).
   *
   * `stats()` answers "what did the last frame cost"; a host cannot poll it into a
   * frame RATE, because the renderer paints on demand — a still scene paints
   * nothing at all, and the caller's own `requestAnimationFrame` would measure the
   * page, not the renderer. Only the renderer knows when it drew, so only the
   * renderer can say how often.
   *
   * `ms` is the time inside tessellate + submit, which is the work this callback's
   * reader can act on; it excludes the GPU's own asynchronous execution.
   */
  onFrame?: (stats: FrameStats & { ms: number }) => void;
}

/**
 * What the last painted frame cost, in renderer terms (ZAB-55). Perf telemetry
 * for the web target only — none of it is cross-target metrics, so it lives
 * beside `snapshot()` instead of inside it. It is what the performance budgets
 * are asserted against.
 */
interface FrameStats {
  /** Draw calls submitted (batches with geometry in them). */
  drawCalls: number;
  /** Vertices across those batches. */
  vertices: number;
  /** Indices across those batches. */
  indices: number;
  /** Live glyph atlases — one GPU texture and one CPU canvas each. */
  atlases: number;
  /** CPU-side bytes of those atlas bitmaps (RGBA); the GPU copies mirror them. */
  atlasBytes: number;
  /**
   * Nodes the resolve pass visited (ZAB-73) — the size of the frame's CPU work
   * before layout even starts. Zero on a repaint-only frame.
   */
  resolved: number;
  /**
   * Texts this frame actually broke into lines (ZAB-73). Since ZAB-69 a `Text`
   * whose content, metrics and options did not move reuses its block, so a
   * steady frame over a static scene must sit at zero: anything else is a wrap
   * key that stopped matching, which is a whole re-wrap of the scene per frame.
   */
  textLayouts: number;
  /**
   * Geometry buffers that had to grow this frame (ZAB-73). Zero once the scene
   * has been painted at its full size — the builder keeps its arrays across
   * frames (ZAB-55), and a steady frame that keeps reallocating them is the
   * regression that reuse exists to prevent.
   */
  bufferGrowths: number;
  /**
   * The frame skipped the whole pipeline before tessellation (ZAB-73): nothing
   * about the tree, its values or its boxes changed, so only paint ran. What a
   * blinking caret costs — see `renderCaret`.
   */
  repaintOnly: boolean;
}

interface ZablooHandle {
  /**
   * The envelope's view ids, as of NOW: a hot-update may add, drop or rename
   * views, so this is read on every access instead of frozen when the handle was
   * made (ZAB-72). A caller that keeps the array around (a view picker, say) gets
   * a snapshot of that moment — re-read it after `reload`.
   */
  readonly viewIds: string[];
  /**
   * Resolves once the view has swapped in its OWN text rasterizer and repainted
   * with it (see `loadRasterizer`). Until then text is measured with the
   * browser's, so the first frames are not the ones the other targets produce —
   * which is why anything comparing metrics (the golden harness, a screenshot)
   * waits on this. It never rejects: a failed load keeps the fallback.
   */
  readonly ready: Promise<void>;
  /**
   * Same loading path as the SDK: any versioned payload (dev push, hot-update).
   *
   * It never throws (decision 2026-08-12, ZAB-37). A payload the validator refuses —
   * truncated, corrupt, a major version this reader does not implement — is reported
   * to the console and DISCARDED: the envelope currently on screen stays exactly as
   * it is. A bad hot-update costs the player an update, never their session.
   */
  reload(envelope: string | object): void;
  /** The game/page data channel — bound Text/visible/checked react (cached + replayed). */
  setData(path: string, value: unknown): void;
  setOpen(id: string, open: boolean): boolean;
  /** Selects a tab of an `"exclusive-select"` group by its container id. */
  setSelectedTab(id: string, index: number): boolean;
  setChecked(id: string, checked: boolean): boolean;
  /** Moves a Slider — exactly the gesture the player would have made, hooks included. */
  setValue(id: string, value: number): boolean;
  /** Writes a TextInput's text — the same edit the player would have typed. */
  setText(id: string, text: string): boolean;
  setScroll(id: string, x: number, y: number): boolean;
  /**
   * Metrics of the frame on screen: rects, wrap points, baselines, clips, layer
   * order and focus/hover/press. The cross-target contract of the golden tests
   * (ZAB-48/ZAB-38) and what a canvas overlaying this view draws against.
   */
  snapshot(): ViewSnapshot;
  /** What the last painted frame cost — see `FrameStats`. */
  stats(): FrameStats;
  dispose(): void;
}

/**
 * Mounts an envelope on a canvas. JSON text or a parsed value, both fine.
 *
 * Warnings from the validator go to the console and the load continues without the
 * broken parts; a FATAL one throws an `EnvelopeError` whose message names the field
 * and the version (decision 2026-08-12, ZAB-37). It throws here — and only here —
 * because there is no previous UI to protect: the caller has to hear that its
 * payload never became a view. Once mounted, `reload` swallows the same failure.
 */
function mount(
  canvas: HTMLCanvasElement,
  envelope: string | object,
  options: MountOptions = {},
): ZablooHandle {
  const view = new WebView(canvas, loadEnvelope(envelope, options.onDiagnostic), options);
  return view.handle();
}

class WebView implements InputView {
  private envelope: Envelope;
  private viewId: string;
  private readonly gl: GLRenderer;
  private readonly fonts: FontLibrary;
  private readonly images: ImageLibrary;
  private readonly clearColor: Color;
  /** Device pixels per logical pixel — `MountOptions.dpr`, or the browser's. */
  private readonly dpr: number;
  private readonly onFrame?: (stats: FrameStats & { ms: number }) => void;
  private readonly onAction?: (action: string, context?: ActionContext) => void;
  private readonly onDataChanged?: (path: string, value: unknown) => void;
  private readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  /**
   * Memoized by the literal string: the resolve pass parses every declared color
   * every frame, and nothing in the renderer ever mutates a `Color` (they are
   * shared identities already — `MISSING_COLOR`, the token dictionary), so one
   * array per distinct literal is safe and an animation frame parses nothing.
   *
   * Per VIEW, not per module (ZAB-72): a module-level map is shared by every view
   * the page ever mounts, grows with each distinct literal — an animated color
   * writes one entry per frame — and nothing ever empties it. This one dies with
   * the view that filled it.
   */
  private readonly parsedColors = new Map<string, Color | null>();

  private root!: LayoutNode;
  /** The view's overlays, flattened and ordered — rebuilt on every render. */
  private layer: LayoutNode[] = [];
  /** The layer the last frame PAINTED — the live one plus whatever was fading out. */
  private paintLayer: readonly LayoutNode[] = [];
  /** The layer's frame-to-frame state (ZAB-19/ZAB-46/ZAB-25) — wiring in `overlays/layer.ts`. */
  private readonly overlays = new OverlayLayer(this.overlayHost());
  private byId = new Map<string, LayoutNode>();
  /**
   * Nodes whose STATE comes from data — a bound `visible`, `checked`, group
   * `value`, Slider `value` or TextInput `value`. They are re-derived when a write
   * touches the path they read, and the set is what a released item instance leaves.
   *
   * It is a set of nodes and not a path→nodes index on purpose: inside a `Repeat`
   * the path a node reads depends on the item it is showing, so it changes every
   * time an instance is reused at another index — an index keyed by path would go
   * stale on every reorder.
   */
  private readonly bound = new Set<LayoutNode>();
  /**
   * The node kinds a frame used to go looking for, kept as the tree is built and
   * released instead (ZAB-73). Five full walks ran before layout even started —
   * on a thousand-row list that is five thousand visits to find three overlays,
   * one field and one `Repeat`.
   *
   * Insertion order is top-down by construction (`buildNode` recurses that way),
   * which `repeats` depends on: expanding an outer list is what creates the inner
   * ones, and they register from inside that very expansion — a `Set` iteration
   * visits what is added while it runs, so nested lists still expand in order.
   */
  private readonly overlayNodes = new Set<LayoutNode>();
  private readonly textInputs = new Set<LayoutNode>();
  private readonly repeats = new Set<LayoutNode>();
  private readonly data = new DataStore();
  private focusedNode: LayoutNode | null = null;
  /**
   * The node a just-opened popover focused, to be revealed once this frame's
   * boxes are final (ZAB-25). Navigation reveals its own focus immediately, from
   * rects that are already laid out; a popover's are not, so this defers it by
   * exactly one pass instead of by one frame. See `revealOpenedPopover`.
   */
  private pendingReveal: LayoutNode | null = null;
  /**
   * The focus while the row that holds it is not realized (ZAB-70) — see
   * `rememberFocus`. It is the LOGICAL focus: `focusedNode` is null, nothing
   * paints focused, and the view refuses to hand the focus to anything else
   * until this item comes back or the player asks for a move.
   */
  private pendingFocus: PendingFocus | null = null;
  /** Slider being nudged with the keyboard (the pointer's drag lives in `input/pointer.ts`). */
  private sliderKeys: SliderGesture | null = null;
  /** The focused TextInput's buffer, caret and hidden field (ZAB-26) — wiring in `controls/field.ts`. */
  private readonly field = new FieldEditor(this.fieldHost());
  /** The canvas listeners and the gestures that span them — wiring in `input/pointer.ts`. */
  private readonly pointer = new PointerHandler(this.pointerHost(), this.field, this.overlays);
  /** Pending self-scheduled frame, while a transition is in flight. */
  private frame: number | null = null;
  /** The gamepad's poll loop and edge state (ZAB-47) — wiring in `input/pad.ts`. */
  private readonly pad = new PadController(this.padHost());
  /** Set by the resolve pass when any node still has a tween running. */
  private animating = false;
  /**
   * Set by the resolve pass when a focused field's caret is blinking (ZAB-73).
   * Deliberately NOT `animating`: a blink moves no value, so the frames it asks
   * for are repaints of a scene that did not change, and they are asked for at
   * the instant the caret flips rather than sixty times a second.
   */
  private caretBlinking = false;
  /** The pending blink flip — see `scheduleCaret`. */
  private caretTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Bumped by every full frame — the stamp `styleOf` caches against (ZAB-73).
   * Not a clock: it counts frames that could have changed something, which is
   * why a repaint-only frame leaves it alone.
   */
  private frameId = 0;
  /** Refilled per node by the resolve pass — see the note there (ZAB-55). */
  private readonly scratchTargets: ResolvedValues = {};
  /** The frame's geometry, buffers reused across frames — see `render` (ZAB-55). */
  private readonly geometry = new GeometryBuilder();
  /** What the last painted frame cost — recomputed at the end of `render()`. */
  private lastStats: FrameStats = {
    drawCalls: 0,
    vertices: 0,
    indices: 0,
    atlases: 0,
    atlasBytes: 0,
    resolved: 0,
    textLayouts: 0,
    bufferGrowths: 0,
    repaintOnly: false,
  };
  /** Nodes the resolve pass visited this frame — counted for `FrameStats`. */
  private resolvedCount = 0;
  /** Texts this frame re-broke into lines — counted for `FrameStats`. */
  private textLayoutCount = 0;
  /** Our TTF rasterizer, once its WASM has loaded (see `loadRasterizer`). */
  private font: StbFont | null = null;
  /** Settles when that rasterizer is in and the view has repainted with it. */
  private readonly ready: Promise<void>;
  /** Disposed views must not touch GL from work that was already in flight. */
  private disposed = false;
  /** So a game looping over a dead handle gets one warning, not one per call. */
  private warnedDisposed = false;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    envelope: Envelope,
    options: MountOptions,
  ) {
    this.envelope = envelope;
    this.viewId = options.view ?? Object.keys(envelope.views)[0];
    this.onAction = options.onAction;
    this.onDataChanged = options.onDataChanged;
    this.onDiagnostic = options.onDiagnostic;
    this.onFrame = options.onFrame;
    // Read once and kept: the atlases are rasterized at this scale, so a value
    // that changed under the view would leave every cached glyph at the old one.
    this.dpr = options.dpr ?? globalThis.devicePixelRatio ?? 1;
    this.clearColor = this.parseColor(options.background ?? "#101218") ?? [0.06, 0.07, 0.09, 1];
    // A restored context comes back empty and blank: the repaint is what puts
    // the view back on screen (ZAB-68). The GL layer rebuilds its own resources
    // and re-uploads every atlas and image on that very frame.
    this.gl = new GLRenderer(canvas, () => this.render());
    // The LRU eviction releases the dropped atlas's GPU texture (ZAB-55) — the
    // same contract `adopt` already has for the fallback-era atlases.
    this.fonts = new FontLibrary(this.dpr, null, (atlas) => this.gl.evict(atlas));
    this.images = new ImageLibrary(envelope.assets ?? {}, {
      // Decoding is async: repaint when a bitmap lands.
      onReady: () => this.render(),
      onEvict: (asset) => this.gl.evict(asset),
    });

    this.build();
    this.listen();
    this.resize();
    this.ready = this.loadRasterizer();
  }

  /**
   * Brings up our own rasterizer (stb_truetype in WASM over the TTF we ship) and
   * swaps it in for the Canvas2D fallback the first frames rendered with.
   *
   * It cannot be done in the constructor: browsers refuse to compile a WASM
   * module this size synchronously on the main thread. So `mount` stays
   * synchronous — text paints immediately with the browser's rasterizer — and
   * this re-renders once the real one is ready. The atlases built meanwhile are
   * thrown away, textures included.
   */
  private loadRasterizer(): Promise<void> {
    return loadFont(decodeBase64(DEFAULT_FONT_BASE64)).then(
      (font) => {
        if (this.disposed) {
          font.dispose();
          return;
        }
        this.font = font;
        for (const replaced of this.fonts.adopt(font)) this.gl.evict(replaced);
        this.render();
      },
      (error: unknown) => {
        // Not fatal: text keeps rendering through Canvas2D, it just will not be
        // pixel-identical to the other targets.
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[zabloo] Text rasterizer unavailable, using the browser's — ${detail}`);
      },
    );
  }

  handle(): ZablooHandle {
    // Every other member is an arrow that closes over `this`; a getter cannot be
    // one, hence the name for the view it reads from.
    const view = this;
    return {
      // A getter, not a snapshot: `reload` can bring a different set of views and
      // the caller must not be left listing the old ones (ZAB-72).
      get viewIds(): string[] {
        return Object.keys(view.envelope.views);
      },
      ready: this.ready,
      reload: (input) => {
        if (!this.alive("reload")) return;
        // A corrupt hot-update never takes down a UI that is already on screen
        // (decision 2026-08-12, ZAB-37): it reports and the current envelope stays.
        const next = ((): Envelope | null => {
          try {
            return loadEnvelope(input, this.onDiagnostic);
          } catch (error) {
            // The sink already heard the fatal diagnostic, with its code and path —
            // the console line is for the caller that installed no sink.
            if (!this.onDiagnostic) {
              const detail = error instanceof Error ? error.message : String(error);
              console.warn(`[zabloo] reload rejected, keeping the current envelope — ${detail}`);
            }
            return null;
          }
        })();
        if (next === null) return;
        this.envelope = next;
        if (!this.envelope.views[this.viewId]) {
          this.viewId = Object.keys(this.envelope.views)[0];
        }
        // Assets the new envelope still references keep their texture; the rest
        // are evicted (content-addressed, so a re-export of the same image is free).
        this.images.swap(this.envelope.assets ?? {});
        this.build();
        this.render();
      },
      // Every mutator goes through the same guard: after `dispose` the tree, the
      // atlases and the GL objects are gone, and driving them would either throw
      // or paint into a dead context (ZAB-68). The readers below stay open — they
      // touch no GPU resource and answering with the last known frame is honest.
      setData: (path, value) => {
        if (this.alive("setData")) this.setData(path, value);
      },
      // The `id` setters answer whether they found the control; on a disposed
      // view the honest answer is "no, nothing was applied".
      setOpen: (id, open) => this.alive("setOpen") && this.setOpen(id, open),
      setSelectedTab: (id, index) => this.alive("setSelectedTab") && this.setSelectedTab(id, index),
      setChecked: (id, checked) => this.alive("setChecked") && this.setChecked(id, checked),
      setValue: (id, value) => this.alive("setValue") && this.setValue(id, value),
      setText: (id, text) => this.alive("setText") && this.setText(id, text),
      setScroll: (id, x, y) => this.alive("setScroll") && this.setScroll(id, x, y),
      snapshot: () => this.snapshot(),
      stats: () => ({ ...this.lastStats }),
      dispose: () => {
        // Idempotent: a host that disposes twice (React strict mode does) must
        // not re-run the teardown over resources that are already released.
        if (this.disposed) return;
        this.disposed = true;
        this.cancelFrame();
        for (const dispose of this.disposers) dispose();
        this.overlays.clearAutoClose();
        this.images.dispose();
        // The atlases hold a canvas EACH, up to 4096² RGBA: waiting for the GC to
        // notice a disposed view is how a page that mounts and drops views keeps
        // hundreds of MB alive (ZAB-72). Their GPU textures die with `gl.dispose`.
        this.fonts.dispose();
        this.parsedColors.clear();
        this.font?.dispose();
        this.gl.dispose();
      },
    };
  }

  /**
   * Whether the handle can still act. A call on a disposed view is a no-op and
   * warns ONCE — a game polling a stale handle every frame would otherwise flood
   * the console with the same line.
   */
  private alive(call: string): boolean {
    if (!this.disposed) return true;
    if (!this.warnedDisposed) {
      this.warnedDisposed = true;
      console.warn(`[zabloo] ${call}() on a disposed view — ignored`);
    }
    return false;
  }

  // --- build ---

  private build(): void {
    const rootIr = this.envelope.views[this.viewId];
    if (!rootIr) throw new Error(`zabloo renderer: view "${this.viewId}" not found`);
    this.byId = new Map();
    this.bound.clear();
    this.overlayNodes.clear();
    this.textInputs.clear();
    this.repeats.clear();
    this.focusedNode = null;
    this.sliderKeys = null;
    // Every render that sets this consumes it before returning, so it is only
    // ever null here — but this is the list of "references to the tree that just
    // died", and leaving one out is how the next one gets forgotten too.
    this.pendingReveal = null;
    this.pendingFocus = null;
    this.pointer.reset();
    // The hidden field OUTLIVES the tree: it belongs to the canvas, not to the
    // document on it, so a composition in flight has to be dropped with the node
    // it was editing (ZAB-57). The pad needs nothing — see the note in
    // `input/pad.ts` for why resetting it would be the bug.
    this.field.reset();
    // The tree is new, so every node identity the layer state referenced is gone.
    this.layer = [];
    this.overlays.reset();
    this.root = this.buildNode(rootIr, null, NO_SCOPES);
    // Initial focus (`autofocus`) is settled by the first render, together with
    // the overlay layer — a modal that starts open owns the focus from frame one.
  }

  private buildNode(
    ir: ZNode,
    parent: LayoutNode | null,
    scopes: readonly ItemScope[],
  ): LayoutNode {
    // Fresh state: the first resolve pass has nothing to tween from, so this
    // node snaps into its initial values — which is also why a reload snaps.
    const node = createLayoutNode(ir, parent);
    node.scopes = scopes;
    const any = ir as AnyNode;

    // An `id` inside a template is worn by every instance of it: the map keeps the
    // last one realized, so the host channel (`setChecked`, `setOpen`, …) still
    // reaches ONE of them. Addressing a particular row by id is not a thing v1 has
    // — an action from inside a row comes back with its `ActionContext` instead.
    if (any.id) this.byId.set(any.id, node);
    // The registries a frame reads instead of walking the tree (ZAB-73). Here,
    // and not after the children: the sets are top-down, which is what lets the
    // expansion pass iterate `repeats` and still reach a nested list in the same
    // sweep that created it.
    if (any.type === "Overlay") this.overlayNodes.add(node);
    else if (any.type === "TextInput") this.textInputs.add(node);

    if (any.type === "Repeat") {
      this.repeats.add(node);
      // The template is NOT built here: its instances come from the data, and the
      // expansion pass builds one per element of the window it can see. What the
      // document contributes is the empty state, out of layout until it is needed.
      node.repeat = {
        instances: new Map(),
        empty: emptySlots(ir).map((slotIr) => {
          const slot = this.buildNode(slotIr, node, scopes);
          slot.sectionShown = false;
          return slot;
        }),
        extent: null,
        itemMain: null,
        measuredWidth: null,
        itemCount: 0,
        first: 0,
        count: 0,
      };
      node.children.push(...node.repeat.empty);
    } else {
      for (const childIr of any.children ?? []) {
        const childAny = childIr as AnyNode;
        // Static visible:false prunes the subtree; bindings build normally.
        if (childAny.visible === false) continue;
        node.children.push(this.buildNode(childIr, node, scopes));
      }
    }

    if (any.type === "Collapse") {
      node.open = any.open ?? true;
      this.applyOpen(node);
    }
    if (any.type === "ProgressBar") {
      // `children[0]` is the fill and the rest is reserved: taking them out of
      // layout is what makes "reserved" true for paint and input too.
      for (const reserved of node.children.slice(1)) reserved.sectionShown = false;
    }
    if (any.group === "exclusive-select") {
      const { buttons } = this.tabsOf(node, true);
      node.selectedIndex = clampSelected(any.selected, buttons.length);
      this.applySelection(node);
    }
    if (this.stateBinds(node).some((value) => bindPath(value) !== null)) this.bound.add(node);
    this.applyBindings(node, true);
    return node;
  }

  /**
   * The values whose BINDING drives this node's state. Text is not one of them:
   * it is read at measure time, so it needs no registration and follows the data
   * of whatever item its instance is showing without any bookkeeping.
   */
  private stateBinds(node: LayoutNode): unknown[] {
    const any = node.ir as AnyNode;
    const values: unknown[] = [any.visible, any.disabled];
    if (
      any.type === "Slider" ||
      any.type === "TextInput" ||
      (any.type === "Container" && any.group === "exclusive-check")
    ) {
      values.push(any.value);
    }
    if (any.type === "Toggle") values.push(any.checked);
    return values;
  }

  /**
   * Derives from data everything this node's state reads. The single place those
   * states are computed, so building a node, a `SetData` landing on it and an item
   * instance being reused for another element all settle it the same way.
   *
   * `settle` says the node is starting ON this data — a fresh node, or one an item
   * instance just carried to another element — so whatever would have animated
   * lands at once instead of gliding from the value it used to show.
   */
  private applyBindings(node: LayoutNode, settle = false): void {
    const any = node.ir as AnyNode;
    const visible = this.resolveBind(node, any.visible);
    // Bound visibility: hidden until data says so (same default as the SDK).
    if (visible) node.visibleFlag = isTruthy(this.readBind(visible));
    // Only this node's OWN value: what an ancestor says is folded in by the
    // resolve pass, which is the one that walks top-down (ZAB-63).
    const disabled = this.resolveBind(node, any.disabled);
    node.disabledFlag = disabled ? isTruthy(this.readBind(disabled)) : any.disabled === true;
    if (any.type === "Container" && any.group === "exclusive-check") {
      const bound = this.resolveBind(node, any.value);
      node.groupValue = bound ? this.readBind(bound) : any.value;
      this.applyGroupValue(node);
    }
    if (any.type === "Slider") {
      const range = this.rangeOf(node);
      const bound = this.resolveBind(node, any.value);
      // Unbound, `value` is the initial number; bound, the store decides — and
      // an empty store leaves the control at its minimum, as the SDK does.
      const initial = bound ? this.readBind(bound) : any.value;
      node.sliderValue = quantize(toNumber(initial, range.min), range);
    }
    if (any.type === "TextInput") {
      const bound = this.resolveBind(node, any.value);
      // Unbound, `value` is the initial text; bound, the store decides — and an
      // empty store leaves the field empty, showing its placeholder. The game's
      // own string is shown as it is: `maxLength` bounds what the PLAYER types,
      // never what the data holds (decision 2026-08-11, ZAB-26).
      const value = bound ? this.readBind(bound) : any.value;
      const text = typeof value === "string" ? value : formatValue(value);
      this.field.setNodeText(node, text);
      node.selection = settle
        ? caretAt(length(text))
        : clampSelection(node.selection, length(text));
      this.field.syncEditor(node);
    }
    // Inside an exclusive-check group a Toggle's state is derived from the group's
    // value, never stored per option.
    if (any.type === "Toggle" && !this.exclusiveGroupOf(node)) {
      const bound = this.resolveBind(node, any.checked);
      node.checked = bound ? isTruthy(this.readBind(bound)) : any.checked === true;
    }
    // Starting ON this data means there is nothing to animate from: the indicator
    // crossfade and the slider's glide settle at once. That is a mount — and also
    // an instance recycled onto another item, which must not slide the state of
    // the row it was showing into the one it now shows. Landing the value is only
    // half of that second case: what the tween would leave from lives in
    // `node.anim`, and dropping it is `resettle`'s half (ZAB-66).
    if (settle) {
      node.checkedProgress = node.checked ? 1 : 0;
      node.sliderDisplay = node.sliderValue;
    }
  }

  // --- bindings (resolved against the node's item scopes — decision 2026-08-11, ZAB-29) ---

  /** What a bindable value points at for THIS node, or null when it is not a binding. */
  private resolveBind(node: LayoutNode, value: unknown): ResolvedBind | null {
    const bind = bindPath(value);
    return bind === null ? null : resolveBinding(bind, node.scopes);
  }

  /** The value behind a resolved binding: the store's, or the item's own position. */
  private readBind(bound: ResolvedBind): unknown {
    return bound.kind === "index" ? bound.index : this.data.get(bound.path);
  }

  /** The absolute path a binding WRITES to — an index is a position, not a slot. */
  private writePath(node: LayoutNode, value: unknown): string | null {
    const bound = this.resolveBind(node, value);
    return bound?.kind === "path" ? bound.path : null;
  }

  // --- Repeat: expansion, item scopes and the life of an instance (ZAB-31) ---

  /**
   * Turns the `Repeat` nodes of the tree into nodes, top-down: the window each one
   * can show becomes instances of its template, and everything outside it stays
   * reserved space. It is the first thing a frame does — before the overlay layer
   * is collected — so an Overlay declared inside a row joins the layer on the very
   * frame that row appears, and the resolve pass sees a plain tree of nodes.
   *
   * Nested lists come out right by construction: expanding the outer one creates
   * the instances the inner ones live in, and the walk reaches them right after.
   */
  private syncRepeats(): void {
    // The registry, not a walk: it is top-down, and a `Set` iteration sees what
    // is added while it runs — so the instances an outer list creates bring their
    // own inner lists into this same sweep, exactly as the recursion did.
    for (const node of this.repeats) this.expand(node);
  }

  private expand(node: LayoutNode): void {
    const state = node.repeat;
    if (!state) return;
    const ir = node.ir as RepeatNode;
    // `items` is a binding by construction (the IR does not carry literal data):
    // anything else repeats nothing, and the empty state takes over.
    const bound = this.resolveBind(node, ir.items);
    const arrayPath = bound?.kind === "path" ? bound.path : null;
    const items = arrayPath === null ? [] : itemsOf(this.data.get(arrayPath));
    state.itemCount = items.length;

    const template = itemTemplate(ir);
    const window = this.planWindow(node, items.length);
    node.virtual = window.span;
    state.first = window.first;
    state.count = window.count;
    const slots =
      template === undefined || arrayPath === null
        ? []
        : windowSlots(items, ir.key, window.first, window.count);
    const { entries, dropped } = reconcileWindow(state.instances, slots);
    for (const instance of dropped) {
      // Before the release, which is what would forget it: the focus of a row
      // that leaves the window survives as the ITEM it was on (ZAB-70).
      this.rememberFocus(node, instance);
      this.release(instance);
    }

    const alias = ir.as ?? ITEM_ALIAS;
    const instances = new Map<string, LayoutNode>();
    const children: LayoutNode[] = [];
    for (const { slot, instance } of entries) {
      const path = itemPath(arrayPath ?? "", slot.index);
      const child =
        instance ?? this.buildInstance(template as ZNode, node, alias, path, slot.index);
      if (instance !== undefined) this.rescope(child, alias, path, slot.index);
      instances.set(slot.identity, child);
      children.push(child);
      // Back in the window: the item the focus is waiting on takes it again.
      this.restoreFocus(node, slot.identity, child);
    }
    state.instances = instances;
    // The empty state is in layout exactly while there is nothing to repeat — the
    // `display:none` semantics of every other slot (decision 2026-08-11, ZAB-29).
    for (const slot of state.empty) slot.sectionShown = items.length === 0;
    node.children = [...children, ...state.empty];
  }

  /** A fresh instance of the template, scoped to one element of the array. */
  private buildInstance(
    template: ZNode,
    node: LayoutNode,
    alias: string,
    path: string,
    index: number,
  ): LayoutNode {
    const scope: ItemScope = { alias, path, index };
    return this.buildNode(template, node, [...node.scopes, scope]);
  }

  /**
   * Points a reused instance at another element — what a `SetData` that reorders,
   * inserts or removes comes down to. The scope object is SHARED by every node of
   * the subtree (nested lists included, which hold it as the head of their own
   * stack), so moving a row is one mutation however deep it is, and every binding
   * inside follows on its next read.
   */
  private rescope(instance: LayoutNode, alias: string, path: string, index: number): void {
    const scope = instance.scopes[instance.scopes.length - 1];
    if (scope === undefined) return;
    if (scope.path === path && scope.index === index && scope.alias === alias) return;
    scope.alias = alias;
    scope.path = path;
    scope.index = index;
    // The subtree now reads another element: everything derived from data has to
    // be derived again (its text follows on its own — it is read at measure time).
    this.resettle(instance);
  }

  /**
   * Starts a reused instance ON the element it now points at: every value it
   * derives from data is derived again, and the transition state of every node in
   * it is dropped so this frame's values are PAINTED instead of tweened towards
   * (ZAB-66).
   *
   * Both halves are needed and neither is enough alone. `applyBindings(settle)`
   * lands the states a binding drives (a Toggle's crossfade, a Slider's glide),
   * but the declared props are tweened out of `node.anim`, which still holds the
   * values of the row this instance used to be: without the clear the very next
   * resolve pass sees a target that moved, retargets from the old value and
   * UNDOES the settle. And the clear alone would leave those states derived from
   * the previous element.
   *
   * It walks the whole subtree and not `this.bound` for the same reason: a node
   * whose look depends on the item without reading data itself — the label of a
   * row whose `disabled` came from the element, anything under an inherited state
   * — has nothing to re-derive and everything to snap.
   */
  private resettle(node: LayoutNode): void {
    if (this.bound.has(node)) this.applyBindings(node, true);
    this.forgetTweens(node);
    for (const child of node.children) this.resettle(child);
  }

  /**
   * How much of the array to realize this frame. Every item is realized when there
   * is nothing to window against — a `Repeat` outside a ScrollView, or one whose
   * lines stack across the axis its scroller scrolls — because then the whole list
   * is on screen anyway and virtualizing it would only cost a measurement.
   */
  private planWindow(
    node: LayoutNode,
    itemCount: number,
  ): { span: ItemSpan | null; first: number; count: number } {
    const whole = { span: null, first: 0, count: itemCount };
    const state = node.repeat;
    if (!state) return whole;
    // Nothing to repeat: the node is not a list this frame, it is its empty state
    // — and reserving the space of zero items would flatten it to nothing.
    if (itemCount === 0) return whole;
    const scroller = this.scrollerOf(node);
    if (scroller === null) return whole;
    // The lines of a wrapping node stack across it, so a grid is scrolled on the
    // cross axis — vertically, since `wrap` only takes effect on a row.
    const wrapping = wrapsLines(node);
    const vertical = wrapping || (node.ir.layout?.direction ?? "column") !== "row";
    if (!scrollsOn(scroller, vertical)) return whole;

    const extent = state.extent;
    const viewLength = vertical ? scroller.rect.height : scroller.rect.width;
    if (extent === null || !(extent > 0) || !(viewLength > 0)) {
      // Nothing measured yet — the first frame of a list, or of a reload. Realize
      // a batch, and let the next frame settle the window with real rects.
      return itemCount <= INITIAL_WINDOW ? whole : { span: null, first: 0, count: INITIAL_WINDOW };
    }

    const gap = node.resolved.gap ?? 0;
    const padding = node.resolved.padding ?? 0;
    const perLine = wrapping
      ? itemsPerLine(Math.max(0, node.rect.width - padding * 2), state.itemMain ?? 0, gap)
      : 1;
    const start = vertical ? node.rect.y : node.rect.x;
    const viewStart = (vertical ? scroller.rect.y : scroller.rect.x) - start - padding;
    const span = visibleSpan(itemCount, { extent, gap, perLine }, viewStart, viewLength);
    return { span, first: span.first, count: span.count };
  }

  /**
   * The scroller the right stick moves: the focused node's, or — while the focus
   * is waiting on an un-realized row — the one the list itself lives in. Without
   * that second half, pushing a focused row off the window would cut the gesture
   * that was pushing it (ZAB-70), which is precisely the moment a player is
   * holding the stick.
   */
  private focusedScroller(): LayoutNode | null {
    const focused = this.focusedNode;
    if (focused) return inLayout(focused) ? this.scrollerOf(focused) : null;
    return this.pendingFocus ? this.scrollerOf(this.pendingFocus.repeat) : null;
  }

  /** The ScrollView this node scrolls inside, if any — an Overlay is its own scope. */
  private scrollerOf(node: LayoutNode): LayoutNode | null {
    for (const current of selfAndAncestors(node.parent)) {
      if (current.ir.type === "Overlay") return null;
      if (current.ir.type === "ScrollView") return current;
    }
    return null;
  }

  /**
   * Learns one line's size from the instances that were just laid out. The
   * assumption virtualization rests on is that every instance of a template
   * measures the same, so ONE of them is the measurement. When it moves — the
   * first frame of a list, the frame the real rasterizer lands on, a resize that
   * changes how many cells fit — the window this frame used came from the old
   * number, so the frame is repeated with the new one.
   */
  private syncExtents(): void {
    for (const node of this.repeats) this.syncExtent(node);
  }

  private syncExtent(node: LayoutNode): void {
    const state = node.repeat;
    const instance = state && state.instances.size > 0 ? node.children[0] : undefined;
    if (state && instance) {
      // A width that moved is a relayout: whatever was learnt for the old one
      // (rows that wrapped differently, another number of cells per line) is not
      // a measurement of this list any more.
      if (state.measuredWidth !== null && moved(state.measuredWidth, node.rect.width)) {
        state.extent = null;
        state.itemMain = null;
      }
      state.measuredWidth = node.rect.width;
      const row = (node.ir.layout?.direction ?? "column") === "row";
      const main = row ? instance.measured.x : instance.measured.y;
      const extent = wrapsLines(node) ? (row ? instance.measured.y : instance.measured.x) : main;
      // The BIGGEST instance seen wins. With the uniform items the assumption is
      // about, that is the item's own size on the first frame and it never moves
      // again; with rows of unequal size it converges upwards in a few frames
      // instead of oscillating between two windows forever, each of which would
      // schedule the next. The list is looser than it should be, never busy.
      const nextExtent = state.extent === null ? extent : Math.max(state.extent, extent);
      const nextMain = state.itemMain === null ? main : Math.max(state.itemMain, main);
      state.extent = nextExtent;
      state.itemMain = nextMain;
    }
    // Whether this frame's rects would now produce a different window than the
    // one it was laid out with. They usually would not — but a scroll moved the
    // rects AFTER the expansion pass read them, and the frame the game asked for
    // is not the one that shows the rows it scrolled to. So the view asks for one
    // more, and it converges there: what the plan reads (the scroller's rect, the
    // node's own reserved size) does not depend on which items are realized.
    if (state && this.windowDrifted(node, state)) this.scheduleFrame();
  }

  private windowDrifted(node: LayoutNode, state: RepeatState): boolean {
    const next = this.planWindow(node, state.itemCount);
    return next.first !== state.first || next.count !== state.count;
  }

  /**
   * The item an action fires from — nothing outside a `Repeat`. It describes the
   * INNERMOST item, which is enough for nested lists because its `path` already
   * embeds every enclosing index (decision 2026-08-11, ZAB-29).
   */
  private contextOf(node: LayoutNode): ActionContext | undefined {
    const repeat = this.repeatOf(node);
    const scope = node.scopes[node.scopes.length - 1];
    if (repeat === null || scope === undefined) return undefined;
    const key = itemKey(this.data.get(scope.path), (repeat.ir as RepeatNode).key);
    const context: ActionContext = { path: scope.path, index: scope.index };
    // Absent when identity is positional: the game gets a key only if there is one.
    if (key !== undefined) context.key = key;
    return context;
  }

  /**
   * The `Repeat` this node was instantiated by, i.e. the one that owns its
   * innermost scope. A node of the EMPTY state is not inside an item, so it walks
   * past its `Repeat` and finds whatever list encloses the whole thing.
   */
  private repeatOf(node: LayoutNode): LayoutNode | null {
    for (const current of selfAndAncestors(node)) {
      const parent = current.parent;
      if (parent?.repeat && !parent.repeat.empty.includes(current)) return parent;
    }
    return null;
  }

  /**
   * Lets an instance go: it left the window, or its item left the array. Every
   * piece of state the view keyed by node identity dies with it — which is exactly
   * the state that does NOT travel with the item, and the reason a `key` is worth
   * declaring.
   */
  private release(node: LayoutNode): void {
    // The list itself is going: there is nothing left for a pending focus to
    // come back to.
    if (this.pendingFocus?.repeat === node) this.pendingFocus = null;
    this.bound.delete(node);
    this.overlayNodes.delete(node);
    this.textInputs.delete(node);
    this.repeats.delete(node);
    this.overlays.forget(node);
    const id = (node.ir as AnyNode).id;
    if (id !== undefined && this.byId.get(id) === node) this.byId.delete(id);
    if (this.focusedNode === node) this.focusedNode = null;
    if (this.sliderKeys?.node === node) this.sliderKeys = null;
    this.pointer.forget(node);
    for (const child of node.children) this.release(child);
  }

  /**
   * Keeps the focus of a row that is about to be un-realized, as the ITEM it sat
   * on (ZAB-70). Scrolling a focused row out of the window is not the player
   * giving up the focus — it is the renderer recycling a node — so what would
   * otherwise happen is the worst of both: `release` drops the focus, and the
   * next frame's `syncModalFocus`, seeing none, hands it to the view's
   * `autofocus`, which can be at the other end of the screen. Nobody asked for
   * that, and a wheel, a drag or the right stick all trigger it.
   *
   * So the focus becomes LOGICAL: nothing wears it, `syncModalFocus` refuses to
   * give it away, the pad keeps scrolling the list it was in, and the row takes
   * it back when it is realized again — which is `restoreFocus`.
   */
  private rememberFocus(repeat: LayoutNode, instance: LayoutNode): void {
    const focused = this.focusedNode;
    if (focused === null) return;
    const path: number[] = [];
    for (const current of selfAndAncestors(focused)) {
      if (current === instance) break;
      const parent = current.parent;
      if (parent === null) return; // the focus is not inside this instance
      path.unshift(parent.children.indexOf(current));
    }
    const identity = identityOf(repeat.repeat?.instances, instance);
    if (identity === null) return;
    this.pendingFocus = { repeat, identity, path };
    // The hidden field belongs to the canvas and outlives the node it was
    // editing: a field scrolled out of the window must not keep the keyboard.
    if (focused.ir.type === "TextInput") this.field.focusEditor(null);
  }

  /**
   * Gives the focus back to an item that was realized again. The path is walked
   * against the new instance — a subtree whose SHAPE changed (a nested list with
   * another window inside it) simply does not resolve, and the focus is then
   * honestly nowhere rather than on some other node of the row.
   */
  private restoreFocus(repeat: LayoutNode, identity: string, instance: LayoutNode): void {
    const pending = this.pendingFocus;
    if (pending === null || pending.repeat !== repeat || pending.identity !== identity) return;
    // Realized again, whatever comes of the walk: it stops being pending here.
    this.pendingFocus = null;
    const target = pending.path.reduce<LayoutNode | undefined>(
      (at, index) => at?.children[index],
      instance,
    );
    if (target && this.isFocusable(target)) this.setFocus(target);
  }

  // --- behavior (renderer-owned, keyed by component type) ---

  /**
   * The content is in layout while the Collapse is open — and for as long as the
   * height tween runs, which is what a closing Collapse animates over.
   */
  private applyOpen(node: LayoutNode): void {
    const shown = node.open || node.collapseAnimating;
    for (const content of node.children.slice(1)) content.sectionShown = shown;
  }

  /**
   * Single state-mutation path (tap, setOpen — `open` bindings later). With a
   * usable `transition` the box animates between the header's height and the
   * content's (decision 2026-08-11 §5); without one the content snaps in and out,
   * which is the pre-F7 behavior exactly.
   */
  private setCollapseOpen(node: LayoutNode, open: boolean): void {
    if (node.open === open) return;
    node.open = open;
    this.startCollapse(node);
    if (open) this.enforceGroup(node);
    this.render();
  }

  /**
   * Puts a Collapse's new `open` state into effect: the height tween if the node
   * declares a usable transition and does not declare its own height (a declared
   * box belongs to the author — the behavior does not fight it), the plain
   * show/hide otherwise.
   */
  private startCollapse(node: LayoutNode): void {
    if (this.animates(node) && node.ir.layout?.height === undefined) {
      // The content enters layout now so the next measure can size it; while it
      // was out there is no honest open height, hence the one pending frame.
      node.collapsePending = !node.collapseAnimating && node.open;
      node.collapseAnimating = true;
    }
    this.applyOpen(node);
  }

  /** Whether this node's declared transition would actually tween anything. */
  private animates(node: LayoutNode): boolean {
    const transition = this.transitionOf(node);
    return transition !== null && transition.duration > 0 && Number.isFinite(transition.duration);
  }

  /**
   * The tab bar's buttons and their panels (decision 2026-08-11): `children[0]`
   * is the bar, `children[1..n]` the panels. `report` logs a structural
   * complaint once per build instead of on every tap.
   */
  private tabsOf(
    group: LayoutNode,
    report = false,
  ): { buttons: LayoutNode[]; panels: LayoutNode[] } {
    const { buttons, panels, warning } = resolveTabsGroup(
      group.children,
      (node) => node.ir.type,
      (node) => node.children,
    );
    if (warning && report) console.warn(`[zabloo] exclusive-select group: ${warning}.`);
    return { buttons, panels };
  }

  /** Only the selected panel stays in layout; its button carries `states.selected`. */
  private applySelection(group: LayoutNode): void {
    const { buttons, panels } = this.tabsOf(group);
    for (const [i, panel] of panels.entries()) {
      panel.sectionShown = i === group.selectedIndex;
      buttons[i].selected = i === group.selectedIndex;
    }
  }

  /** Single state-mutation path for tabs (tap, Enter/gamepad, `setSelected`). */
  private setSelected(group: LayoutNode, index: number): void {
    const { buttons } = this.tabsOf(group);
    const next = clampSelected(index, buttons.length);
    if (next === group.selectedIndex) return;
    group.selectedIndex = next;
    this.applySelection(group);
    this.render();
  }

  /** The index this button occupies in its `"exclusive-select"` group, if it is a tab. */
  private tabIndexOf(button: LayoutNode): { group: LayoutNode; index: number } | null {
    const group = button.parent?.parent;
    if (!group || (group.ir as AnyNode).group !== "exclusive-select") return null;
    if (button.parent !== group.children[0]) return null; // in the panels, not the bar
    const index = this.tabsOf(group).buttons.indexOf(button);
    return index < 0 ? null : { group, index };
  }

  /**
   * Activating a control — the one path shared by pointer taps and Enter/gamepad.
   * A Button fires its named action (and moves the selection when it is a tab); a
   * Toggle flips, which in an `"exclusive-check"` group means selecting it.
   */
  private activate(node: LayoutNode): void {
    // The last gate before anything fires. The input paths already refuse a
    // disabled control, so this catches whatever reaches activation by another
    // route — a held key, a pad button, a gesture that started before the game
    // disabled the section. The host API is deliberately NOT gated: the game
    // writing a value is out-of-band, like a `SetData` on a bound path.
    if (node.disabled) return;
    if (node.ir.type === "Toggle") {
      this.setToggleChecked(node, nextChecked(node.checked, this.exclusiveGroupOf(node) !== null));
      return;
    }
    const action = (node.ir as AnyNode).onClick;
    // Fired with the item it belongs to, if any: a press inside a row has to say
    // WHICH one (decision 2026-08-11, ZAB-29).
    if (action) this.onAction?.(action, this.contextOf(node));
    const tab = this.tabIndexOf(node);
    if (tab) this.setSelected(tab.group, tab.index);
    // Opening a popover is behavior on top of the action, never instead of it: a
    // `<Select>` trigger is an ordinary Button that happens to be an anchor.
    if (this.overlays.togglePopovers(node)) this.render();
  }

  private enforceGroup(opened: LayoutNode): void {
    const group = (opened.parent?.ir as AnyNode | undefined)?.group;
    if (group === undefined || group === "exclusive-select") return; // not an open-driven behavior
    if (group !== "exclusive-open") {
      if (group !== "exclusive-check") {
        console.warn(`[zabloo] Unknown group behavior "${group}" — ignoring.`);
      }
      return;
    }
    for (const sibling of opened.parent?.children ?? []) {
      if (sibling !== opened && sibling.ir.type === "Collapse" && sibling.open) {
        sibling.open = false;
        // Through the same path as a tap: in an accordion the one that closes
        // animates shut while the one that opens animates open.
        this.startCollapse(sibling);
      }
    }
  }

  // --- Toggle: checked state, indicator slots and exclusive-check groups ---
  // Both indicator slots stay in layout, sharing one box: which one you see is
  // opacity, tweened by `crossfadeSlots` (decision 2026-08-11, ZAB-36).

  /** The nearest `"exclusive-check"` ancestor, if this Toggle is one of its options. */
  private exclusiveGroupOf(node: LayoutNode): LayoutNode | null {
    for (const current of selfAndAncestors(node.parent)) {
      const any = current.ir as AnyNode;
      if (any.type === "Container" && any.group === "exclusive-check") return current;
    }
    return null;
  }

  /** The Toggles this group owns — a nested group owns its own. */
  private groupOptions(group: LayoutNode, node = group, out: LayoutNode[] = []): LayoutNode[] {
    for (const child of node.children) {
      const any = child.ir as AnyNode;
      if (any.type === "Container" && any.group === "exclusive-check") continue;
      if (any.type === "Toggle") out.push(child);
      this.groupOptions(group, child, out);
    }
    return out;
  }

  /** Re-derives every option's state from the group's selected value. */
  private applyGroupValue(group: LayoutNode): void {
    for (const option of this.groupOptions(group)) {
      option.checked = isSelected(group.groupValue, (option.ir as AnyNode).value);
    }
  }

  /**
   * Single state-mutation path for Toggles (tap, Enter/gamepad, `setChecked`):
   * updates the state, writes the new value into its bound path — the return leg
   * of the data channel — and fires the named actions: the option's own, and the
   * group's when the selection of one moved (ZAB-64).
   */
  private setToggleChecked(node: LayoutNode, checked: boolean): void {
    const any = node.ir as AnyNode;
    const group = this.exclusiveGroupOf(node);
    // The group speaks only when the selection actually MOVED; a slot, because
    // the branch below is also the one that can bail out early.
    const fired: { groupAction?: string } = {};

    if (group) {
      // A radio only ever turns ON; the group's value is the state that moves.
      if (!checked) return;
      // Choosing is the gesture that ends the menu (decision 2026-08-12, ZAB-25),
      // and it ends it even when the choice is the option already selected — a
      // dropdown that stayed open on "I meant this one" would be a dead end.
      this.overlays.closeEnclosingPopover(node);
      if (node.checked) {
        this.render();
        return;
      }
      group.groupValue = any.value;
      this.applyGroupValue(group);
      const path = this.writePath(group, (group.ir as AnyNode).value);
      if (path !== null) this.writeData(path, any.value);
      // The selection MOVED — the early return above is what keeps re-picking
      // the current option silent — so the group speaks too. Its hook is the one
      // a `<Select>` declares: the option only ever says "me".
      fired.groupAction = (group.ir as AnyNode).onChange;
    } else {
      if (node.checked === checked) return;
      node.checked = checked;
      // Inside an item this resolves to `shop.items.3.enabled`: a write into the
      // array, on the same channel and with no per-component API (ZAB-29).
      const path = this.writePath(node, any.checked);
      if (path !== null) this.writeData(path, checked);
    }

    // Inner first, then the group: the same order a press reads, and both carry
    // the context of the OPTION — inside a `Repeat` that is the item the choice
    // was made in, which is strictly more than the group could say (ZAB-29).
    if (any.onChange) this.onAction?.(any.onChange, this.contextOf(node));
    if (fired.groupAction) this.onAction?.(fired.groupAction, this.contextOf(node));
    this.render();
  }

  setChecked(id: string, checked: boolean): boolean {
    const node = this.byId.get(id);
    if (node?.ir.type !== "Toggle") {
      console.warn(`[zabloo] setChecked: no Toggle with id "${id}".`);
      return false;
    }
    this.setToggleChecked(node, checked);
    return true;
  }

  // --- Slider: value state, pointer/keyboard gestures and the two hooks ---

  private rangeOf(node: LayoutNode): SliderRange {
    const any = node.ir as AnyNode;
    return resolveRange(any.min, any.max, any.step);
  }

  private sliderVertical(node: LayoutNode): boolean {
    return growsUpward((node.ir as { axis?: SliderAxis }).axis);
  }

  /**
   * Single state-mutation path for Sliders (drag, tap on the track, arrow keys,
   * `setValue`): clamps and quantizes, writes the new value into its bound path
   * — the return leg of the data channel — and fires the live `onChange`.
   * `onCommit` is NOT fired here: it belongs to the end of a gesture.
   */
  private setSliderValue(node: LayoutNode, value: number): void {
    const next = quantize(value, this.rangeOf(node));
    if (next === node.sliderValue) return;
    node.sliderValue = next;
    const any = node.ir as AnyNode;
    const path = this.writePath(node, any.value);
    if (path !== null) this.writeData(path, next);
    if (any.onChange) this.onAction?.(any.onChange, this.contextOf(node));
    this.render();
  }

  /** Ends a gesture: `onCommit` fires only if the player actually moved the value. */
  private commitSlider(gesture: SliderGesture): void {
    const action = (gesture.node.ir as AnyNode).onCommit;
    if (action && gesture.node.sliderValue !== gesture.from) {
      this.onAction?.(action, this.contextOf(gesture.node));
    }
  }

  /**
   * The value a point on the track selects. Mirrors `arrangeSlider` exactly —
   * same padding, same thumb inset — so the thumb lands under the finger and
   * stays there for the rest of the drag.
   */
  private valueAtPoint(node: LayoutNode, point: Point): number {
    const vertical = this.sliderVertical(node);
    const padding = node.resolved.padding ?? 0;
    const length = Math.max(0, (vertical ? node.rect.height : node.rect.width) - padding * 2);
    const start = (vertical ? node.rect.y : node.rect.x) + padding;
    const thumb = node.children[1];
    const thumbSize = thumb ? Math.min(vertical ? thumb.measured.y : thumb.measured.x, length) : 0;
    const position = vertical ? point.y : point.x;
    return valueAt(position, start, length, thumbSize, this.rangeOf(node), vertical);
  }

  /**
   * One arrow-key press on the focused Slider. Only the keys ALONG its axis get
   * here (the cross-axis ones keep navigating), and on a vertical slider up
   * means more — the value grows upward, like the track does.
   */
  private nudgeSlider(node: LayoutNode, dx: number, dy: number): void {
    const vertical = this.sliderVertical(node);
    const direction = vertical ? -dy : dx;
    if (!this.sliderKeys) this.sliderKeys = { node, from: node.sliderValue };
    this.setSliderValue(node, stepBy(node.sliderValue, direction, this.rangeOf(node)));
  }

  /** True while this arrow key adjusts the focused Slider instead of moving the focus. */
  private sliderAxisKey(node: LayoutNode | null, dx: number): node is LayoutNode {
    if (node?.ir.type !== "Slider" || !inLayout(node)) return false;
    return this.sliderVertical(node) ? dx === 0 : dx !== 0;
  }

  /** The game/page channel for sliders — the `setChecked` counterpart, gesture included. */
  setValue(id: string, value: number): boolean {
    const node = this.byId.get(id);
    if (node?.ir.type !== "Slider") {
      console.warn(`[zabloo] setValue: no Slider with id "${id}".`);
      return false;
    }
    const gesture: SliderGesture = { node, from: node.sliderValue };
    this.setSliderValue(node, value);
    this.commitSlider(gesture);
    return true;
  }

  // --- TextInput (ZAB-26) ---
  // `textinput.ts` owns the editing model; `controls/field.ts` owns the buffer,
  // the caret and the hidden field that run it. This is the slice of the view
  // they read: the focus, the metrics, and the return leg of the data channel.

  private fieldHost(): FieldHost {
    return {
      focused: () => this.focusedNode,
      // The metrics this field measures with — the caret and the paint share them.
      metrics: (node) => this.fonts.get(this.fontSize(this.styleOf(node))),
      // The box a node's content lives in: its rect minus its padding.
      contentBox: (node) => deflate(node.rect, node.resolved.padding ?? 0),
      textEdited: (node) => {
        const any = node.ir as AnyNode;
        // Inside an item this resolves to `shop.items.3.name`, like Toggle/Slider.
        const path = this.writePath(node, any.value);
        if (path !== null) this.writeData(path, node.text);
        if (any.onChange) this.onAction?.(any.onChange, this.contextOf(node));
      },
      attachEditor: (editor) => {
        (this.canvas.parentElement ?? document.body).appendChild(editor);
      },
      addDisposer: (dispose) => {
        this.disposers.push(dispose);
      },
      render: () => this.render(),
    };
  }

  /** The game/page channel for text fields — the `setValue` counterpart. */
  setText(id: string, text: string): boolean {
    const node = this.byId.get(id);
    if (node?.ir.type !== "TextInput") {
      console.warn(`[zabloo] setText: no TextInput with id "${id}".`);
      return false;
    }
    // The whole field is replaced, so the caret goes to the end — where a player
    // handed a prefilled value would start typing.
    this.field.applyEdit(node, { text: String(text), selection: caretAt(length(String(text))) });
    this.field.syncEditor(node);
    return true;
  }

  setOpen(id: string, open: boolean): boolean {
    const node = this.byId.get(id);
    if (node?.ir.type !== "Collapse") {
      console.warn(`[zabloo] setOpen: no Collapse with id "${id}".`);
      return false;
    }
    this.setCollapseOpen(node, open);
    return true;
  }

  /** The game/page channel for tabs — the `SetOpen` counterpart for `"exclusive-select"`. */
  setSelectedTab(id: string, index: number): boolean {
    const node = this.byId.get(id);
    if (!node || (node.ir as AnyNode).group !== "exclusive-select") {
      console.warn(`[zabloo] setSelectedTab: no exclusive-select group with id "${id}".`);
      return false;
    }
    this.setSelected(node, index);
    return true;
  }

  /** Single state-mutation path (wheel, drag, setScroll) — clamps against the last relayout's bounds. */
  private setScrollOffset(node: LayoutNode, x: number, y: number): void {
    const next = {
      x: clamp(x, 0, node.scrollMax.x),
      y: clamp(y, 0, node.scrollMax.y),
    };
    if (next.x === node.scrollOffset.x && next.y === node.scrollOffset.y) return;
    node.scrollOffset = next;
    this.render();
  }

  /**
   * Reveals the focus a POPOVER opened on, once this frame's boxes are final.
   *
   * `revealFocused` is otherwise navigation-only, and deliberately so: a pointer
   * press focuses what the player is already looking at, and a focus restored
   * during a render would scroll a frame late. A popover is the case that rule
   * does not cover — it opens ON its selection (ZAB-25), so the list has to be
   * scrolled to an option that the frame it appears on has only just been laid
   * out. Doing it here, after arrange, is what makes it the SAME frame: only
   * scroll offsets change, and arrange is the only pass that reads them back.
   */
  private revealOpenedPopover(): boolean {
    const node = this.pendingReveal;
    if (node === null) return false;
    this.pendingReveal = null;
    if (!inLayout(node)) return false;
    const before = this.scrollerOf(node);
    const from = before ? { ...before.scrollOffset } : null;
    this.revealFocused(node);
    return from !== null && before !== null
      ? from.x !== before.scrollOffset.x || from.y !== before.scrollOffset.y
      : false;
  }

  /**
   * The game/page channel for scrolling — the `setOpen` counterpart. Host API,
   * not IR: the offset has no prop to author (decision 2026-08-11, ZAB-9), and
   * whatever lands here is clamped to the last relayout's bounds.
   */
  setScroll(id: string, x: number, y: number): boolean {
    const node = this.byId.get(id);
    if (node?.ir.type !== "ScrollView") {
      console.warn(`[zabloo] setScroll: no ScrollView with id "${id}".`);
      return false;
    }
    this.setScrollOffset(node, x, y);
    return true;
  }

  setData(path: string, value: unknown): void {
    this.applyData(path, value);
    // Bound text is resolved at tessellation time — a render is enough.
    this.render();
  }

  /** A control writing its own value: same store update, plus the game callback. */
  private writeData(path: string, value: unknown): void {
    this.applyData(path, value);
    this.onDataChanged?.(path, value);
  }

  /**
   * The one place a data path lands on the tree, whoever wrote it. Every bound
   * node whose own path is touched re-derives its state from the store: writing
   * an array moves the bindings INSIDE it (`shop.items` → `shop.items.3.name`)
   * and writing into an item moves a binding watching the whole array, which is
   * what `affects` decides. How many items there are is settled apart, by the
   * expansion pass — every write ends in a render, and that is where it runs.
   */
  private applyData(path: string, value: unknown): void {
    this.data.set(path, value);
    for (const node of this.bound) {
      if (this.watches(node, path)) this.applyBindings(node);
    }
  }

  /** Whether a write to `written` changes what this node's state reads. */
  private watches(node: LayoutNode, written: string): boolean {
    for (const raw of this.stateBinds(node)) {
      const bound = this.resolveBind(node, raw);
      if (bound?.kind === "path" && affects(written, bound.path)) return true;
    }
    return false;
  }

  // --- focus & directional navigation (decision 2026-08-03 §7) ---
  // Automatic spatial navigation from live layout rects: zero authoring cost,
  // survives relayout/hot-update/Collapse. Focusability derives from component
  // identity (Button, Collapse header); `states.focused` styles the focused node.

  /**
   * Focusability derives from component identity, with exactly one exception:
   * `disabled` takes a node out of the interaction model (ZAB-63). Answering
   * false here is what removes it from navigation AND from hover — the hover set
   * is defined as the focusable one, so a mouse and a pad see the same dead
   * control — and the pointer's own press paths carry the same guard.
   */
  private isFocusable(node: LayoutNode): boolean {
    if (node.disabled) return false;
    return (
      node.ir.type === "Button" ||
      node.ir.type === "Toggle" ||
      node.ir.type === "Slider" ||
      node.ir.type === "TextInput" ||
      isCollapseHeader(node)
    );
  }

  /**
   * Navigation candidates: everything focusable inside the current focus scope —
   * the whole view, or just the topmost modal while one is up (the focus-trap
   * derives from `modal`, decision 2026-08-11). Overlay children are reached by
   * walking the tree in place, so a non-modal toast's Button is a normal
   * candidate without trapping anything.
   */
  private collectFocusables(node = this.scope(), out: LayoutNode[] = []): LayoutNode[] {
    if (!inLayout(node)) return out; // pruned subtrees have stale rects
    // A closed popover is pruned the same way, but by the LAYER's predicate:
    // `popoverOpen` is overlay state, not a layout flag, so `inLayout` alone
    // would offer its options — stale rects included — as candidates (ZAB-53).
    if (node.ir.type === "Overlay" && !this.layer.includes(node)) return out;
    if (this.isFocusable(node)) out.push(node);
    for (const child of node.children) this.collectFocusables(child, out);
    return out;
  }

  private scope(): LayoutNode {
    return focusScope(this.root, this.layer);
  }

  /**
   * The scope's initial focus. A popover opens ON its selection — the option the
   * group already holds, so a list of twenty languages lands where the player left
   * it (decision 2026-08-12, ZAB-25) — and everything else opens on its declared
   * `autofocus`.
   */
  private autofocus(scope: LayoutNode = this.scope()): LayoutNode | null {
    if (isPressTriggered(scope)) {
      // Whatever it lands on has to be SEEN: the list opens scrolled to it.
      const reveal = (node: LayoutNode | null): LayoutNode | null => {
        this.pendingReveal = node;
        return node;
      };
      const option = selectedOptionIn(scope);
      if (option && this.isFocusable(option)) return reveal(option);
      // Nothing chosen yet: the FIRST option, never nothing. A menu the player
      // opened is a menu they are in, and one that starts with no focus cannot be
      // walked with the arrows at all — the keyboard would have nowhere to step
      // from. (Only a popover does this: everywhere else "no autofocus" honestly
      // means the author asked for none.)
      return reveal(
        autofocusIn(scope, (node) => this.isFocusable(node)) ??
          this.collectFocusables(scope)[0] ??
          null,
      );
    }
    return autofocusIn(scope, (node) => this.isFocusable(node));
  }

  /**
   * Releases what a node that has just become disabled was holding: the focus
   * here, the hover and the gestures in the pointer. Focus goes to NOTHING rather
   * than to a neighbour — the player did not ask to move, and the next arrow press
   * starts the walk again from the scope's `autofocus`.
   */
  private pruneDisabled(): void {
    if (this.focusedNode?.disabled) this.setFocus(null);
    // The KEYBOARD's slider gesture goes the same way the pointer's does, one
    // line below: cancelled, never committed, because the value never settled
    // (ZAB-63). Dropping it here rather than letting `settleSliderKeys` find it
    // is what keeps a held arrow from committing a control the game just killed.
    if (this.sliderKeys?.node.disabled) this.sliderKeys = null;
    this.pointer.pruneDisabled();
  }

  private setFocus(node: LayoutNode | null): void {
    // A real focus decision — a tap, a move, a modal opening — settles the
    // question a pending one was holding open (ZAB-70).
    this.pendingFocus = null;
    if (this.focusedNode === node) return;
    if (this.focusedNode) this.focusedNode.focused = false;
    this.focusedNode = node;
    if (node) {
      node.focused = true;
      // A field that gets the focus starts with a solid caret, not mid-blink.
      if (node.ir.type === "TextInput") node.caretSince = now();
    }
    // The keyboard follows the focus: into the hidden field when a TextInput has
    // it, back out to the canvas for everything else.
    this.field.focusEditor(node);
  }

  /** Moves focus in a direction (unit axis): the console-UI spatial algorithm. */
  moveFocus(dx: number, dy: number): void {
    const candidates = this.collectFocusables();
    if (candidates.length === 0) return;

    const current = this.focusedNode;
    if (!current || !candidates.includes(current)) {
      // A direction pressed while the focus is waiting on an un-realized row
      // DROPS it and starts the walk again, which is the rule already documented
      // for having no focus at all: the player asked to move, and there is no
      // rect to move from (ZAB-70).
      this.setFocus(this.autofocus() ?? candidates[0]);
      this.render();
      return;
    }

    const from = center(current.rect);
    const scored = candidates.flatMap((candidate) => {
      if (candidate === current) return [];
      const to = center(candidate.rect);
      const deltaX = to.x - from.x;
      const deltaY = to.y - from.y;
      const projection = deltaX * dx + deltaY * dy;
      if (projection <= 0.5) return []; // must lie in the direction of travel
      const orthogonal = Math.abs(deltaX * dy) + Math.abs(deltaY * dx);
      return [{ candidate, score: projection + orthogonal * 2 }];
    });
    // First one wins a tie, as the old scan did with its strict `<`.
    const best = scored.reduce<(typeof scored)[number] | null>(
      (winner, entry) => (winner === null || entry.score < winner.score ? entry : winner),
      null,
    )?.candidate;
    if (best) {
      this.setFocus(best);
      this.revealFocused(best);
      this.render();
    }
  }

  /**
   * Brings the node the focus just moved to into view — the auto-scroll the
   * ScrollView spec deferred to "the gamepad phase" (2026-08-11, ZAB-9). Without
   * it, directional navigation walks into rows that are scrolled out of sight:
   * the focus is real and its highlight invisible, and a pad has no wheel to go
   * looking for it. It is SDK behavior, not IR: nothing new to author.
   *
   * It bubbles the way the browser's `scrollIntoView` does — each scroller reveals
   * the child of its own that contains the focus, which is the node itself for the
   * innermost one and the scroller below it for every one above. That converges in
   * one pass instead of measuring an inner rect the inner scroll has just moved.
   *
   * Only navigation calls it: a pointer press focuses what the player is already
   * looking at, and the focus a modal restores lands during a render, where a
   * scroll of its own would be a frame late anyway.
   */
  private revealFocused(node: LayoutNode): void {
    // Outward through the nested scrollers, each one revealing the one inside it.
    const reveal = { target: node, scroller: this.scrollerOf(node) };
    while (reveal.scroller) {
      const scroller = reveal.scroller;
      const view = deflate(scroller.rect, scroller.resolved.padding ?? 0);
      this.setScrollOffset(
        scroller,
        scroller.scrollOffset.x +
          revealDelta(reveal.target.rect.x, reveal.target.rect.width, view.x, view.width),
        scroller.scrollOffset.y +
          revealDelta(reveal.target.rect.y, reveal.target.rect.height, view.y, view.height),
      );
      reveal.target = scroller;
      reveal.scroller = this.scrollerOf(scroller);
    }
  }

  /**
   * The keys a focused TextInput claims, and whether it consumed this one. `false`
   * lets the view's ordinary handling run, which is what makes ↑/↓ — and a ←/→ that
   * finds the caret already against an end — navigate away instead of trapping the
   * player inside the field (decision 2026-08-11, ZAB-26).
   *
   * Typing never reaches here: characters, composition and paste arrive as `input`
   * events on the hidden field. This owns only the caret, deletion and submission.
   *
   * It takes an INTENT, not an event, so the gamepad's d-pad enters and leaves a
   * field by exactly the same rule as the arrows (ZAB-47).
   */
  private editKey(event: KeyIntent): boolean {
    const node = this.focusedNode;
    if (node?.ir.type !== "TextInput" || !inLayout(node)) return false;
    const shortcut = event.metaKey || event.ctrlKey;
    if (shortcut) {
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        this.field.setSelection(node, selectAll(node.text));
        return true;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        this.field.setSelection(
          node,
          moveToEdge(node.text, node.selection, event.key === "ArrowRight", event.shiftKey)
            .selection,
        );
        return true;
      }
      // Copy, cut, paste, undo: the browser's own field does them and its `input`
      // event brings the result back — intercepting them would only break them.
      return false;
    }
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const step = moveCaret(
          node.text,
          node.selection,
          event.key === "ArrowLeft" ? -1 : 1,
          event.shiftKey,
        );
        if (step.atBoundary) return false; // nothing left to walk: navigate out
        event.preventDefault();
        this.field.setSelection(node, step.selection);
        return true;
      }
      case "Home":
      case "End":
        event.preventDefault();
        this.field.setSelection(
          node,
          moveToEdge(node.text, node.selection, event.key === "End", event.shiftKey).selection,
        );
        return true;
      case "Backspace":
      case "Delete":
        event.preventDefault();
        this.field.deleteText(node, event.key === "Delete");
        return true;
      case "Enter": {
        event.preventDefault();
        const action = (node.ir as AnyNode).onSubmit;
        if (action && !event.repeat) this.onAction?.(action, this.contextOf(node));
        return true;
      }
      case "Tab":
        // Navigation here is spatial, so a Tab would only hand the keyboard to
        // whatever the page has next and leave the field looking focused.
        event.preventDefault();
        return true;
      case " ":
        // A space is text: consumed so it does not press anything, but NOT
        // prevented — the hidden field is the one that inserts it.
        return true;
      default:
        return false;
    }
  }

  /** Press/release the focused node (Enter/Space/gamepad-A semantics). */
  pressFocused(down: boolean): void {
    const node = this.focusedNode;
    if (!node || !inLayout(node)) return;
    // A Slider has nothing to activate: it is adjusted with the axis arrows, and
    // pressing it must not fall through to the Collapse branch below. A TextInput
    // has nothing either — Enter submits it, and the on-screen keyboard a console
    // would need is v1.x.
    if (node.ir.type === "Slider" || node.ir.type === "TextInput") return;
    if (down) {
      node.pressed = true;
      this.render();
      return;
    }
    if (!node.pressed) return;
    node.pressed = false;
    this.render();
    if (node.ir.type === "Button" || node.ir.type === "Toggle") {
      this.activate(node);
    } else if (node.parent) {
      this.setCollapseOpen(node.parent, !node.parent.open);
    }
  }

  // --- gamepad (ZAB-47) ---
  // One more source of input over the machinery that already exists: the pad
  // resolves to the intentions the keyboard produces (a direction, a press, a
  // dismiss, a scroll) and feeds them into the very same handlers. `gamepad.ts`
  // owns the rules; `input/pad.ts` owns the loop that runs them; this is where
  // each intention lands.

  /**
   * Starts or stops the pad's poll loop to match what this view owns (ZAB-70).
   * `navigator.getGamepads()` is the PAGE's, so exactly one view may read it —
   * two polling views would each move their own focus with the same stick.
   */
  syncPad(): void {
    if (this.disposed || !ownsInput(this)) this.pad.stop();
    else this.pad.sync();
  }

  private padHost(): PadHost {
    const view = this;
    return {
      get disposed() {
        return view.disposed;
      },
      moveFocus: (dx, dy) => this.moveFocus(dx, dy),
      pressFocused: (down) => this.pressFocused(down),
      editArrowKey: (key) => this.editKey(arrowIntent(key)),
      nudgeFocusedSlider: (dx, dy) => {
        const focused = this.focusedNode;
        if (!this.sliderAxisKey(focused, dx)) return false;
        this.nudgeSlider(focused, dx, dy);
        return true;
      },
      settleSliderKeys: () => {
        const gesture = this.sliderKeys;
        if (!gesture) return;
        this.sliderKeys = null;
        this.commitSlider(gesture);
      },
      cancelFocusedPress: () => {
        if (!this.focusedNode?.pressed) return;
        this.focusedNode.pressed = false;
        this.render();
      },
      dismissTopModal: () => {
        const modal = topModal(this.layer);
        if (modal) this.overlays.requestDismiss(modal);
      },
      scrollFocusedBy: (delta) => {
        const scroller = this.focusedScroller();
        if (!scroller) return;
        this.setScrollOffset(
          scroller,
          scroller.scrollOffset.x + delta.x,
          scroller.scrollOffset.y + delta.y,
        );
      },
    };
  }

  // --- overlay layer (decision 2026-08-11, ZAB-19) ---
  // `overlay.ts` owns the pure rules and `overlays/layer.ts` the state that
  // runs them frame to frame; this is the slice of the view they read.

  private overlayHost(): OverlayHost {
    return {
      root: () => this.root,
      eachOverlay: (visit) => {
        for (const overlay of this.overlayNodes) visit(overlay);
      },
      layer: () => this.layer,
      focused: () => this.focusedNode,
      focusPending: () => this.pendingFocus !== null,
      nodeById: (id) => this.byId.get(id),
      scope: () => this.scope(),
      isFocusable: (node) => this.isFocusable(node),
      autofocus: (scope) => this.autofocus(scope),
      setFocus: (node) => this.setFocus(node),
      closeVisible: (overlay) => {
        const path = this.writePath(overlay, (overlay.ir as AnyNode).visible);
        if (path !== null) this.writeData(path, false);
      },
      dismissed: (overlay, action) => this.onAction?.(action, this.contextOf(overlay)),
      transitionOf: (node) => this.transitionOf(node),
      markAnimating: () => {
        this.animating = true;
      },
      radiusOf: (node) => this.radiusOf(node),
      dim: (value, fallback) => this.dim(value, fallback),
      render: () => this.render(),
    };
  }

  // --- input (pointer → hit test on layout rects, in `input/pointer.ts`) ---
  // The pointer's listeners and gestures live in `input/pointer.ts`; the
  // keyboard and the gamepad wire up here, and all three resolve to the same
  // handlers (focus, press, scroll, slider, caret).

  private pointerHost(): PointerHost {
    const view = this;
    return {
      get canvas() {
        return view.canvas;
      },
      claimInput: () => claimInput(this),
      takeDomFocus: () => this.takeDomFocus(),
      root: () => this.root,
      layer: () => this.layer,
      radiusOf: (node) => this.radiusOf(node),
      isFocusable: (node) => this.isFocusable(node),
      isCollapseHeader: (node) => isCollapseHeader(node),
      setFocus: (node) => this.setFocus(node),
      activate: (node) => this.activate(node),
      setCollapseOpen: (node, open) => this.setCollapseOpen(node, open),
      setSliderValue: (node, value) => this.setSliderValue(node, value),
      valueAtPoint: (node, point) => this.valueAtPoint(node, point),
      commitSlider: (gesture) => this.commitSlider(gesture),
      setScrollOffset: (node, x, y) => this.setScrollOffset(node, x, y),
      addDisposer: (dispose) => {
        this.disposers.push(dispose);
      },
      render: () => this.render(),
    };
  }

  /**
   * The keys the page just received: are they this view's to read (ZAB-109)?
   *
   * Two questions, both in `input/ownership.ts`: whether the page's own focus
   * leaves them to the renderer at all — a chrome button with the focus keeps
   * its Enter — and, when the focus points at nothing in particular, which of
   * the mounted views is the one the player is using (ZAB-70).
   */
  private hasKeys(): boolean {
    if (!ownsInput(this)) return false;
    return focusYieldsKeys({
      active: document.activeElement,
      canvas: this.canvas,
      editor: this.field.element,
      body: document.body,
    });
  }

  /**
   * Puts the page's focus on the canvas, unless this view already holds it —
   * either on the canvas or on the hidden field a `TextInput` types through.
   *
   * A press is the browser's own moment to move the focus onto a focusable
   * element, and the canvas is one from `listen()` onwards; doing it explicitly
   * is what makes "the player is in the game now" true for the headless rig too,
   * and it is the answer to "who has the keyboard?" that the chrome around the
   * canvas needs (ZAB-109). The press that lands ON a field takes the focus back
   * into the hidden one right after — see `input/pointer.ts`.
   */
  private takeDomFocus(): void {
    const active = document.activeElement;
    if (active === this.canvas || (this.field.element && active === this.field.element)) return;
    this.canvas.focus?.({ preventScroll: true });
  }

  private listen(): void {
    this.pointer.listen();
    // Focusable from here on, so the page can be TABBED into the game and out of
    // it again, and so the focus has somewhere to be that means "the canvas"
    // (ZAB-109). A host that set its own `tabindex` — including `-1`, which says
    // "programmatically only" — has already answered the question.
    if (!this.canvas.hasAttribute?.("tabindex")) this.canvas.tabIndex = 0;
    // Tabbing INTO a canvas is using that view, exactly as pressing it is: the
    // page's focus and the input owner must never point at two different views.
    const focus = () => claimInput(this);
    const keydown = (event: KeyboardEvent) => {
      // The keys are a PAGE event, not a canvas one: a second mounted view would
      // move its own focus with the same arrow (ZAB-70), and a focused button of
      // the host's chrome would never see the Enter the browser owes it
      // (ZAB-109). This is asked BEFORE any `preventDefault()` — the damage is
      // not the renderer acting, it is the browser being stopped.
      if (!this.hasKeys()) return;
      // A focused text field owns the keys that edit it; everything it does not
      // claim (the cross-axis arrows, Escape) falls through to the usual handling.
      if (this.editKey(event)) return;
      const direction = KEY_DIRECTIONS[event.key];
      if (direction) {
        event.preventDefault();
        // On a focused Slider the arrows ALONG its axis adjust the value; the
        // cross-axis ones keep navigating, so the player is never trapped in
        // the control (decision 2026-08-11, ZAB-24). Repeats slide it.
        const focused = this.focusedNode;
        if (this.sliderAxisKey(focused, direction[0])) {
          this.nudgeSlider(focused, direction[0], direction[1]);
          return;
        }
        this.moveFocus(direction[0], direction[1]);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!event.repeat) this.pressFocused(true);
      } else if (event.key === "Escape") {
        // The web's gamepad-B: a dismiss request for the modal that owns input.
        const modal = topModal(this.layer);
        if (modal) {
          event.preventDefault();
          this.overlays.requestDismiss(modal);
        }
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (!this.hasKeys()) return;
      if (event.key === "Enter" || event.key === " ") this.pressFocused(false);
      // Releasing an arrow ends the keyboard gesture — the same commit a
      // pointer release fires, so both ways of moving a slider settle alike.
      else if (KEY_DIRECTIONS[event.key] && this.sliderKeys) {
        const gesture = this.sliderKeys;
        this.sliderKeys = null;
        this.commitSlider(gesture);
      }
    };
    const resize = () => this.resize();
    // Connect/disconnect is all the Gamepad API pushes — the buttons are polled.
    // A pad that was already announced before this view mounted is picked up by
    // the same call, which is why it also runs once here.
    const padChanged = () => this.syncPad();
    // Registering may hand this view input (it is the first one mounted), and
    // that is what starts its pad loop.
    registerView(this);
    this.disposers.push(() => unregisterView(this));

    this.canvas.addEventListener("focus", focus);
    globalThis.addEventListener("keydown", keydown);
    globalThis.addEventListener("keyup", keyup);
    globalThis.addEventListener("resize", resize);
    globalThis.addEventListener("gamepadconnected", padChanged);
    globalThis.addEventListener("gamepaddisconnected", padChanged);
    this.disposers.push(() => {
      this.canvas.removeEventListener("focus", focus);
      globalThis.removeEventListener("keydown", keydown);
      globalThis.removeEventListener("keyup", keyup);
      globalThis.removeEventListener("resize", resize);
      globalThis.removeEventListener("gamepadconnected", padChanged);
      globalThis.removeEventListener("gamepaddisconnected", padChanged);
      this.pad.stop();
      // A view that is gone holds nothing, the page's focus included: left on a
      // canvas nobody is rendering to, it would keep the keys away from the view
      // still standing and from the chrome alike (ZAB-109).
      if (document.activeElement === this.canvas) this.canvas.blur?.();
    });
  }

  // --- tokens / style resolution ---

  private token(value: unknown): TokenValue | undefined {
    if (
      typeof value === "string" &&
      value.length > 2 &&
      value.startsWith("{") &&
      value.endsWith("}")
    ) {
      // A token the dictionary does not define resolves to "no value" and the
      // property falls back to its default. It is not reported HERE: this runs on
      // every style resolution, so the warning would repeat frame after frame —
      // the load pass already emitted it once, naming the node and the property
      // it sits on (decision 2026-08-12, ZAB-37).
      return this.envelope.tokens[value.slice(1, -1)];
    }
    return value as TokenValue;
  }

  private dim = (value: unknown, fallback = 0): number => {
    const resolved = this.token(value);
    return typeof resolved === "number" ? resolved : fallback;
  };

  /**
   * The painted corner radius of a node — what its clip rounds to. Read from the
   * resolve pass, so paint and input share it even mid-tween.
   */
  private radiusOf = (node: LayoutNode): number => node.resolved.radius ?? 0;

  private color(value: unknown, fallback: Color): Color {
    const resolved = this.token(value);
    return (typeof resolved === "string" && this.parseColor(resolved)) || fallback;
  }

  /** `#rrggbb[aa]` → a `Color`, memoized in this view's `parsedColors`. */
  private parseColor(hex: string): Color | null {
    const cached = this.parsedColors.get(hex);
    if (cached !== undefined) return cached;

    const color = parseColorLiteral(hex);
    this.parsedColors.set(hex, color);
    return color;
  }

  /**
   * This frame's style: the base plus every active state, in `STATE_ORDER`,
   * merged ONCE per node and frame (ZAB-73).
   *
   * Three passes ask for it — resolve, measure and paint — and the merge
   * allocates an object per active state, so a node wearing hover+focus cost six
   * objects a frame for one answer. The cache is stamped with the view's frame
   * counter rather than invalidated by hand: every state change in the renderer
   * goes on to call `render()`, which bumps the stamp, so "same frame" and
   * "nothing has moved" are the same statement. A repaint-only frame keeps the
   * stamp on purpose — nothing moved, so last frame's merge still answers.
   */
  private styleOf(node: LayoutNode): Style | undefined {
    if (node.styleFrame === this.frameId) return node.styleCache;
    const any = node.ir as AnyNode;
    const style = effectiveStyle(any.style, any.states, node);
    node.styleFrame = this.frameId;
    node.styleCache = style;
    return style;
  }

  private fontSize(style: Style | undefined): number {
    const size = Math.round(this.dim(style?.fontSize, DEFAULT_FONT_SIZE));
    return Math.min(MAX_FONT_SIZE, Math.max(1, size));
  }

  /**
   * The text-layout knobs, resolved against the font (decision 2026-08-11, ZAB-17):
   * text wraps by default, to the width the flexbox offered the node.
   */
  private textOptions(
    style: Style | undefined,
    fontLineHeight: number,
    maxWidth: number | null,
  ): TextLayoutOptions {
    const maxLines = style?.maxLines;
    return {
      wrap: style?.wrap ?? true,
      maxWidth,
      lineHeight: Math.max(0, this.dim(style?.lineHeight, fontLineHeight)),
      // A cap below one line is not a cap: it would leave nothing to paint.
      maxLines: typeof maxLines === "number" && maxLines >= 1 ? Math.floor(maxLines) : null,
      overflow: style?.overflow ?? "clip",
    };
  }

  /** A declared color, or `undefined` — an undeclared endpoint has nothing to tween from. */
  private optionalColor(value: unknown, fallback: Color): Color | undefined {
    return value === undefined ? undefined : this.color(value, fallback);
  }

  /** A declared dim, or `undefined` for auto — including a token that does not resolve. */
  private optionalDim(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    const resolved = this.token(value);
    return typeof resolved === "number" ? resolved : undefined;
  }

  private transitionOf(node: LayoutNode): ResolvedTransition | null {
    // Read from the base node only: no cascade, and no per-state transition (both
    // are compatible future extensions, not v1 surface).
    const transition = (node.ir as AnyNode).transition;
    if (!transition) return null;
    return { duration: this.dim(transition.duration), easing: transition.easing ?? "ease-out" };
  }

  // --- resolve pass (tokens + states + transitions → this frame's values) ---

  /**
   * Collapses each node's declared inputs into numbers and colors and lets the
   * engine tween the ones that moved. It runs BEFORE measure, so layout sees an
   * ordinary tree of resolved values: one layout pass per frame, and the computed
   * rects never feed back into their own input (decision 2026-08-11 §4).
   */
  private resolve(node: LayoutNode, now: number): void {
    if (!inLayout(node) && !this.overlays.isExiting(node)) {
      // Out of layout: nothing to paint, and no honest previous value for the day
      // it comes back — dropping the state makes that return snap, like a mount.
      // An overlay mid-exit is the exception: it is still on screen this frame.
      this.forgetAnim(node);
      return;
    }
    this.resolvedCount++;
    node.forcedClip = false;
    // Effective `disabled` BEFORE the style resolves, since it is a state
    // `effectiveStyle` has to see this very frame (ZAB-63). It inherits from the
    // parent — one prop on a section answers for every control in it — and an
    // `Overlay` restarts the chain: a layer entry is the top of its own input
    // scope, the same boundary `effectiveClip` and the pointer's `findUp` draw, so
    // a modal declared inside a disabled panel stays operable and dismissable.
    node.disabled =
      node.disabledFlag || (node.ir.type !== "Overlay" && node.parent?.disabled === true);
    const style = this.styleOf(node);
    const layout = node.ir.layout;
    // One scratch object for the whole tree, refilled per node: `stepNode`
    // consumes it synchronously and never keeps it, so an animation frame does
    // not allocate a targets object per node (ZAB-55). Every prop is assigned,
    // `undefined` included — a leftover from the previous node would otherwise
    // read as a declared value.
    const targets = this.scratchTargets;
    targets.background = this.optionalColor(style?.background, MISSING_COLOR);
    // An undeclared border color HOLDS the last one instead of dropping it: the
    // border it paints is leaving through `borderWidth`, and a focus ring that
    // loses its color halfway out would flash the missing-color magenta.
    targets.borderColor =
      this.optionalColor(style?.borderColor, MISSING_COLOR) ?? node.resolved.borderColor;
    targets.color = this.optionalColor(style?.color, DEFAULT_TEXT_COLOR);
    // These have renderer defaults, so both endpoints always resolve and a state
    // that introduces one still animates (only auto sizes and colors can snap).
    targets.opacity = Math.min(1, Math.max(0, style?.opacity ?? 1));
    targets.radius = this.dim(style?.radius);
    targets.borderWidth = this.dim(style?.borderWidth);
    targets.gap = this.dim(layout?.gap);
    targets.padding = this.dim(layout?.padding);
    targets.width = this.optionalDim(layout?.width);
    targets.height = this.optionalDim(layout?.height);
    const transition = this.transitionOf(node);
    // The node's own `resolved` is the out-param: the step rewrites it in place,
    // after the previous frame's values above were already read.
    const { animating } = stepNode(node.anim, targets, transition, now, node.resolved);
    if (animating) this.animating = true;
    // Behaviors that tween a value of their own, with endpoints they compute
    // (decision 2026-08-11 §5) — they run BEFORE the children, since a Collapse
    // decides here whether its content is in layout at all this frame.
    if (node.ir.type === "ProgressBar") this.resolveProgress(node, transition, now);
    else if (node.ir.type === "Slider") this.resolveSlider(node, transition, now);
    else if (node.ir.type === "Collapse") this.resolveCollapse(node, transition, now);
    // A focused field owns the clock while its caret blinks, and it stops as soon
    // as the focus leaves. It does NOT own the pipeline: the blink is a closed
    // form of the time since the last edit, so nothing about the tree, its values
    // or its boxes depends on it (ZAB-73) — see `scheduleCaret` and `renderCaret`.
    else if (node.ir.type === "TextInput" && node.focused) this.caretBlinking = true;
    for (const child of node.children) this.resolve(child, now);
    // After the children: these modulate values they have already resolved.
    if (node.ir.type === "Spinner") this.spin(node, now);
    else if (node.ir.type === "Toggle") this.crossfadeSlots(node, transition, now);
  }

  /**
   * The Slider's painted value. A change that comes from the game (a binding,
   * `setValue`) glides; the one in the player's hand does NOT — a thumb that
   * lags the finger reads as a broken control, not as juice — so a gesture in
   * flight steps with no transition, which is the engine's instant path.
   */
  private resolveSlider(
    node: LayoutNode,
    transition: ResolvedTransition | null,
    now: number,
  ): void {
    const gesturing = this.pointer.isSliderDragging(node) || this.sliderKeys?.node === node;
    const stepped = stepValue(
      node.anim,
      "value",
      node.sliderValue,
      gesturing ? null : transition,
      now,
    );
    node.sliderDisplay = stepped.value;
    if (stepped.animating) this.animating = true;
  }

  /**
   * The Collapse's open/close: the behavior tweens the node's OWN height between
   * the header's box and the height measured with the content in (`collapse.ts`),
   * clipping while it runs. The content stays in layout for exactly that long, so
   * a closed Collapse still costs nothing once the tween ends.
   */
  private resolveCollapse(
    node: LayoutNode,
    transition: ResolvedTransition | null,
    now: number,
  ): void {
    if (!node.collapseAnimating) return;
    const closed = closedHeight(node.children[0]?.natural.y ?? 0, node.resolved.padding ?? 0);
    // While pending, this frame's measure is what learns the open height: aim at
    // the closed box so the content that just entered layout does not flash.
    const target = node.collapsePending
      ? closed
      : collapseTarget(node.open, node.natural.y, closed);
    const stepped = stepValue(node.anim, "collapse", target, transition, now);

    if (node.collapsePending || stepped.animating) {
      node.collapsePending = false;
      node.resolved.height = stepped.value;
      node.forcedClip = true;
      this.animating = true;
      return;
    }
    // Settled: the override goes away and the box is whatever the content asks
    // for — a closed one drops its content out of layout, as it always did.
    node.collapseAnimating = false;
    this.applyOpen(node);
  }

  /**
   * The Toggle's indicator: the two slots share a box, so which one you see is
   * their opacity — multiplied onto whatever they resolved, like the Spinner's
   * wave. With no transition the progress is 0 or 1 and the swap is instant,
   * exactly as it was before F7.
   */
  private crossfadeSlots(
    node: LayoutNode,
    transition: ResolvedTransition | null,
    now: number,
  ): void {
    const stepped = stepValue(node.anim, "checked", node.checked ? 1 : 0, transition, now);
    node.checkedProgress = stepped.value;
    if (stepped.animating) this.animating = true;
    for (const [i, slot] of node.children.slice(0, 2).entries()) {
      if (!inLayout(slot)) continue;
      slot.resolved.opacity = (slot.resolved.opacity ?? 1) * slotOpacity(i, stepped.value);
    }
  }

  /**
   * The ProgressBar's fraction: read (or bound), clamped, and tweened on the VALUE
   * with the node's own `transition` — behavior driving the interpolation engine
   * with endpoints it computes (decision 2026-08-11 §5). Layout then derives the
   * fill's rect from this number, so there is still one layout pass per frame and
   * the rect never feeds back into its own input.
   */
  private resolveProgress(
    node: LayoutNode,
    transition: ResolvedTransition | null,
    now: number,
  ): void {
    const raw = (node.ir as AnyNode).value;
    const bound = this.resolveBind(node, raw);
    const target = clampProgress(bound ? this.readBind(bound) : raw);
    const stepped = stepValue(node.anim, "progress", target, transition, now);
    node.progress = stepped.value;
    if (stepped.animating) this.animating = true;
  }

  /**
   * The Spinner's loop: one phase per frame, spread over the beads, multiplied onto
   * the opacity they just resolved (multiplicative like every other opacity in the
   * system — decision 2026-08-06). It is renderer-owned behavior keyed by node
   * identity, exactly like the scroll offset: nothing about it is in the IR beyond
   * the node's own knobs.
   */
  private spin(node: LayoutNode, now: number): void {
    const beads = node.children.filter(inFlow);
    if (beads.length === 0) return;
    const any = node.ir as AnyNode;
    const period = this.dim(any.period, DEFAULT_PERIOD);
    // A period of 0 is how a "reduce motion" theme stops the loop: the wave freezes
    // at its first frame instead of the spinner disappearing.
    const running = period > 0 && Number.isFinite(period);
    if (node.loopStartedAt === null) node.loopStartedAt = now;
    const phase = running ? loopPhase(node.loopStartedAt, now, period) : 0;
    for (const [i, bead] of beads.entries()) {
      const pulse = beadOpacity(i, beads.length, phase, any.min, any.easing);
      bead.resolved.opacity = (bead.resolved.opacity ?? 1) * pulse;
    }
    if (running) this.animating = true;
  }

  private forgetAnim(node: LayoutNode): void {
    this.forgetTweens(node);
    for (const child of node.children) this.forgetAnim(child);
  }

  /**
   * One node's motion, forgotten: the next step snaps, like a mount. Shared by
   * the two things that ask for exactly that — a subtree leaving layout, and an
   * item instance reused for another element (`resettle`).
   */
  private forgetTweens(node: LayoutNode): void {
    clearNodeAnim(node.anim);
    // A spinner that comes back starts its wave over, like a mount.
    node.loopStartedAt = null;
    if (node.collapseAnimating) {
      // A Collapse taken out of layout mid-tween lands on its logical state: it
      // comes back open or closed, never halfway through a motion nobody saw.
      node.collapseAnimating = false;
      node.collapsePending = false;
      node.forcedClip = false;
      this.applyOpen(node);
    }
  }

  // --- frame loop ---

  private scheduleFrame(): void {
    if (this.frame !== null || typeof globalThis.requestAnimationFrame !== "function") return;
    this.frame = globalThis.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  private cancelFrame(): void {
    this.cancelCaret();
    if (this.frame === null) return;
    globalThis.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /**
   * Asks for the frame the caret next FLIPS on, instead of one every 16 ms
   * (ZAB-73). `caretVisible` is a closed form of the time since the last edit —
   * on for the first half of every period — so the only frames a blink needs are
   * the two per period where that answer changes, and each of them is a repaint
   * (`renderCaret`). A field left focused went from 60 full pipelines a second
   * to ~2 repaints.
   *
   * A timer and not `requestAnimationFrame` on purpose: rAF is the wrong tool for
   * "in 530 ms", and a backgrounded tab throttling this to a caret that blinks
   * slowly is the correct outcome.
   */
  private scheduleCaret(): void {
    if (this.caretTimer !== null || typeof globalThis.setTimeout !== "function") return;
    const field = this.focusedNode;
    if (field?.ir.type !== "TextInput") return;
    const half = CARET.blinkMs / 2;
    if (!(half > 0) || !Number.isFinite(half)) return; // blink disabled: solid caret
    const elapsed = now() - (field.caretSince ?? 0);
    const phase = ((elapsed % half) + half) % half;
    this.caretTimer = globalThis.setTimeout(
      () => {
        this.caretTimer = null;
        this.renderCaret();
      },
      Math.max(1, half - phase),
    );
  }

  private cancelCaret(): void {
    if (this.caretTimer === null) return;
    globalThis.clearTimeout(this.caretTimer);
    this.caretTimer = null;
  }

  /**
   * The blink's own frame: paint and submit, and nothing before them (ZAB-73).
   *
   * Everything the skipped passes produce — the instances, the layer, the
   * resolved values, the boxes, the wrapped lines — is state kept on the tree,
   * and a blink changes none of its inputs. Anything that WOULD change them goes
   * through `render()` (every mutator in the renderer ends in one), so a repaint
   * can never be looking at values a full frame should have refreshed.
   */
  private renderCaret(): void {
    if (this.disposed) return;
    const field = this.focusedNode;
    // The focus moved, or the row holding it left layout, between the flip being
    // scheduled and it arriving: a full frame is the honest answer.
    if (field?.ir.type !== "TextInput" || !inLayout(field)) {
      this.render();
      return;
    }
    const { width, height } = this.logicalSize();
    if (!(width > 0) || !(height > 0)) return;
    this.resolvedCount = 0;
    this.textLayoutCount = 0;
    this.submit(width, height, true);
    this.scheduleCaret();
  }

  /**
   * Tessellates the tree and the painted layer and hands the batches to GL — the
   * tail both a full frame and a caret repaint end in.
   */
  private submit(width: number, height: number, repaintOnly: boolean): void {
    const started = now();
    // ONE builder for the view's whole life: `reset` rewinds the cursors and
    // keeps the buffers, so a steady animation frame reallocates no geometry.
    const geometry = this.geometry.reset(this.dpr);
    this.paint(this.root, geometry);
    // Then the layer, in `(z, document order)` — each entry is a paint root, so
    // it does not inherit the opacity of wherever it was declared, only its own
    // presence: the backdrop and the panel fade in and out together.
    for (const overlay of this.paintLayer) {
      // Each entry is a paint root, so it opens its own group: sharing the tree's
      // would put the tree's glyphs over this panel, since a group draws all its
      // solids before all its text.
      geometry.startRoot();
      this.paint(overlay, geometry, this.overlays.presenceOf(overlay));
    }
    const batches = geometry.batches();
    this.gl.draw(batches, width, height, this.clearColor);
    this.lastStats = this.frameStats(batches, repaintOnly);
    this.onFrame?.({ ...this.lastStats, ms: now() - started });
  }

  /**
   * The string a Text paints. Resolved at measure time — never registered — so an
   * instance reused for another item picks up that item's data with no bookkeeping:
   * its scopes moved, and the path moves with them.
   */
  private resolveText(node: LayoutNode): string {
    const raw = (node.ir as AnyNode).text;
    if (typeof raw === "string") return raw;
    const bound = this.resolveBind(node, raw);
    return bound ? formatValue(this.readBind(bound)) : "";
  }

  // --- layout + paint ---

  private resize(): void {
    const dpr = this.dpr;
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    // Assigning `width`/`height` throws the drawing buffer away even when the
    // number is the same, so a resize that did not change the backing store must
    // not touch it: the preview announces a RESCALE as a resize (ZAB-108), and
    // that one changes where the canvas is drawn, not what it is drawn into.
    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }
    // A canvas that was resized — or rescaled — has very likely moved on the page
    // too (ZAB-73), and its rect is the pointer's map of it either way.
    this.pointer.invalidateBounds();
    this.render();
  }

  private logicalSize(): { width: number; height: number } {
    return { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr };
  }

  private measureLeaf = (
    node: LayoutNode,
    availableWidth: number | null,
  ): { x: number; y: number } => {
    const ir = node.ir;
    if (ir.type === "Text") {
      // Wrapping happens HERE, once per frame: the block is kept on the node so
      // paint reuses these very lines instead of breaking the text a second time.
      // And since ZAB-69 the node also keeps WHAT it wrapped, so the frames that
      // changed none of it — most of them, for the static labels a UI is mostly
      // made of — reuse the block instead of breaking the text again.
      const style = this.styleOf(node);
      const atlas = this.fonts.get(this.fontSize(style));
      const options = this.textOptions(style, atlas.lineHeight, availableWidth);
      const content = this.resolveText(node);
      const key: TextKey = { content, metrics: atlas, options: textOptionsKey(options) };
      const cached = node.textBlock;
      if (cached !== null && sameTextKey(node.textKey, key)) {
        return { x: cached.width, y: cached.height };
      }

      const block = layoutText(content, atlas, options);
      node.textBlock = block;
      node.textKey = key;
      this.textLayoutCount++;
      return { x: block.width, y: block.height };
    }
    if (ir.type === "Image") {
      // Intrinsic size straight from the manifest — no decode needed, so the
      // image occupies its space from the very first frame.
      const asset = this.images.get((ir as AnyNode).src);
      return asset ? { x: asset.width, y: asset.height } : { x: 0, y: 0 };
    }
    if (ir.type === "TextInput") {
      // ONE line tall, and no intrinsic width: a field must not grow and shrink
      // with what is being typed into it, so its width comes from its own
      // `layout` (`@zabloo/react`'s `<TextInput>` fills one in) and the content
      // scrolls inside that box.
      const style = this.styleOf(node);
      const atlas = this.fonts.get(this.fontSize(style));
      return { x: 0, y: Math.max(0, this.dim(style?.lineHeight, atlas.lineHeight)) };
    }
    return { x: 0, y: 0 };
  };

  /**
   * Every TextInput of the tree — from the registry, so the caret pass does not
   * walk it looking for them (ZAB-73; the comment here used to claim exactly
   * that while the function did the walk).
   */
  private eachTextInput(visit: (field: LayoutNode) => void): void {
    for (const field of this.textInputs) visit(field);
  }

  render(): void {
    // Work that was already in flight when the view died (an image decode
    // landing, a restored context, a queued frame) still calls in here — and
    // painting would submit to GL objects that no longer exist (ZAB-68).
    if (this.disposed) return;
    const { width, height } = this.logicalSize();
    if (!(width > 0) || !(height > 0)) return;
    const viewRect: Rect = { x: 0, y: 0, width, height };
    this.frameId++;
    this.resolvedCount = 0;
    this.textLayoutCount = 0;

    // Data-driven structure comes first: how many nodes there are is settled
    // before anything asks what they look like or where they are (ZAB-31).
    this.syncRepeats();
    // The layer settles next: the focus an opening modal moves has to reach THIS
    // frame's resolve pass — otherwise `states.focused` would land one frame late.
    // An anchored entry is the one thing here that reads rects, and it reads the
    // ones already laid out (see `isOnScreen`).
    this.layer = collectLayer(this.overlayNodes, this.overlays.layerPresent);
    this.overlays.syncModalFocus();
    this.overlays.syncAutoClose();
    // A control that left layout under the pointer (a tab panel switching, a
    // Collapse closing) must not keep wearing the hover state on its way back.
    this.pointer.pruneHover();

    // The resolve pass walks the whole tree, overlay subtrees included: a node in
    // the layer tweens like any other, it just gets laid out and painted apart.
    this.animating = false;
    // Any pending blink is this frame's business now: it would repaint values a
    // full frame is about to rewrite anyway.
    this.caretBlinking = false;
    this.cancelCaret();
    const frameTime = now();
    // Before resolve: a closing overlay is still painted for one transition, and
    // that is what keeps the resolve pass from dropping its subtree mid-fade.
    this.overlays.syncPresence(frameTime);
    this.resolve(this.root, frameTime);
    // After resolve, because that is the pass that settles the inherited flag: a
    // control the game just switched off releases the focus, hover and press it
    // was holding (ZAB-63). Doing it here costs a frame of stale flags, and that
    // frame is invisible — `disabled` merges last, so its override is already
    // painting over the focus ring this very frame.
    this.pruneDisabled();

    // The view's own width is the offer the constraint chain starts from — that is
    // what a Text with no explicit width wraps to.
    measure(this.root, this.measureLeaf, width);
    arrange(this.root, viewRect);
    // What the instances measured is the input the NEXT window is computed from.
    this.syncExtents();
    // The painted layer is the live one plus whatever is still fading out, in the
    // same `(z, document order)` — a closing modal keeps its place under the toast
    // that was above it.
    const paintLayer = !this.overlays.anyExiting()
      ? this.layer
      : collectLayer(
          this.overlayNodes,
          (node) => this.overlays.layerPresent(node) || this.overlays.isExiting(node),
        );
    this.paintLayer = paintLayer;
    for (const overlay of paintLayer) {
      measure(overlay, this.measureLeaf, width);
      this.overlays.arrangeOverlay(overlay, viewRect);
    }
    // After arrange, where the boxes are final: a popover that just opened scrolls
    // its list to the option it focused. It only ever writes scroll offsets, so
    // re-running arrange settles it — and arrange is the only pass an offset feeds.
    if (this.revealOpenedPopover()) {
      arrange(this.root, viewRect);
      for (const overlay of paintLayer) this.overlays.arrangeOverlay(overlay, viewRect);
    }
    // After arrange, where the boxes are final: each field slides its content just
    // enough to keep its caret inside. It reads rects and writes only its own
    // scroll, so it never feeds back into the layout it just ran.
    this.eachTextInput((field) => {
      if (inLayout(field)) this.field.syncTextScroll(field);
    });

    this.submit(width, height, false);

    // A tween in flight owns the clock: keep painting until everything settles.
    // A caret that is merely blinking does not: it asks for the frame it flips
    // on, and that frame is a repaint (ZAB-73).
    if (this.animating) this.scheduleFrame();
    else if (this.caretBlinking) this.scheduleCaret();
  }

  private frameStats(batches: Batch[], repaintOnly: boolean): FrameStats {
    const drawn = batches.filter((batch) => batch.indices.length > 0);
    const drawCalls = drawn.length;
    const vertices = drawn.reduce((sum, batch) => sum + batch.vertices.length / 8, 0);
    const indices = drawn.reduce((sum, batch) => sum + batch.indices.length, 0);

    const live = [...this.fonts.all()];
    const atlases = live.length;
    const atlasBytes = live.reduce(
      (sum, atlas) => sum + atlas.canvas.width * atlas.canvas.height * 4,
      0,
    );
    return {
      drawCalls,
      vertices,
      indices,
      atlases,
      atlasBytes,
      resolved: this.resolvedCount,
      textLayouts: this.textLayoutCount,
      bufferGrowths: this.geometry.growths(),
      repaintOnly,
    };
  }

  /**
   * Paints from `node.resolved` — the resolve pass already applied tokens and
   * tweens — under `clip` (null = unclipped). A node's own background and border
   * paint under the INHERITED clip, never its own: nothing paints outside a
   * layout rect (inset borders, decision 2026-08-06), so a node can only ever
   * clip its children. Each layer entry is a paint root, so an Overlay declared
   * inside a ScrollView is not cut by it.
   */
  private paint(
    node: LayoutNode,
    geometry: GeometryBuilder,
    parentOpacity = 1,
    clip: Clip | null = null,
  ): void {
    if (!inLayout(node) && !this.overlays.isExiting(node)) return;
    const values = node.resolved;

    // Opacity inherits multiplicatively down the subtree (per-vertex alpha;
    // not render-to-texture group opacity — decision 2026-08-06).
    const opacity = (values.opacity ?? 1) * parentOpacity;
    if (opacity <= 0) return; // invisible — but still occupies layout

    geometry.setClip(clip);
    const radius = values.radius ?? 0;
    if (values.background !== undefined) {
      geometry.roundedRect(node.rect, radius, fade(values.background, opacity));
    }
    const borderWidth = values.borderWidth ?? 0;
    if (borderWidth > 0) {
      geometry.roundedRectBorder(
        node.rect,
        radius,
        borderWidth,
        fade(values.borderColor ?? MISSING_COLOR, opacity),
      );
    }
    if (node.ir.type === "Text") {
      const placed = this.placeText(node);
      if (placed) {
        const color = fade(values.color ?? DEFAULT_TEXT_COLOR, opacity);
        for (const line of placed.lines) {
          geometry.text(line.x, line.y, line.text, placed.atlas, color);
        }
      }
    } else if (node.ir.type === "TextInput") {
      this.paintField(node, geometry, opacity, clip);
    } else if (node.ir.type === "Image") {
      const asset = this.images.get((node.ir as AnyNode).src);
      if (asset) {
        // `color` tints the pixels, exactly as it colors a Text's glyphs — absent
        // means white, i.e. the image as it is (decision 2026-08-11, ZAB-13).
        geometry.image(node.rect, asset, {
          fit: (node.ir as AnyNode).fit,
          color: fade(values.color ?? UNTINTED, opacity),
          radius,
        });
      }
    }
    const inner = childClip(node, clip, this.radiusOf);
    // Fully clipped away: the whole subtree (and the scrollbar) paints nothing.
    if (isEmptyClip(inner)) return;
    // Overlay children are skipped here: they paint in the layer pass, above.
    for (const child of node.children) {
      if (inFlow(child)) this.paint(child, geometry, opacity, inner);
    }
    if (node.ir.type === "ScrollView") this.paintScrollbar(node, geometry, opacity, inner);
  }

  /**
   * Where this frame's lines of a `Text` sit, and the atlas they are painted
   * with. Paint and the metrics snapshot go through this one function on purpose:
   * a baseline recorded in a golden file has to be the baseline the tessellator
   * actually used, not a second computation of it that could drift.
   *
   * Null on anything that is not a `Text`, and on a `Text` the measure pass has
   * not broken into lines yet (out of layout for the whole frame).
   */
  private placeText(node: LayoutNode): { lines: PlacedLine[]; atlas: GlyphAtlas } | null {
    const block = node.textBlock;
    if (node.ir.type !== "Text" || !block) return null;
    const style = this.styleOf(node);
    const atlas = this.fonts.get(this.fontSize(style));
    // Lines are placed inside the padding box: a Text's own padding already grew
    // its measured size, so it has to keep the glyphs off the edge too.
    const box = deflate(node.rect, node.resolved.padding ?? 0);
    return {
      lines: placeLines(
        block,
        box,
        atlas,
        style?.textAlign ?? "start",
        style?.textAlignY ?? "start",
      ),
      atlas,
    };
  }

  /**
   * The metrics of the frame currently on screen (ZAB-48) — rects, wrap points,
   * baselines, clips, layer order and where the focus/hover/press landed.
   *
   * Public because it is not a test detail: it is the contract the cross-target
   * comparison of ZAB-38 asks BOTH targets for, and the rects the visual editor's
   * canvas needs to draw selection over the same tree the renderer laid out. It
   * describes the last painted frame — it never renders one — so calling it can
   * neither move the view forward nor perturb what is being measured.
   */
  snapshot(): ViewSnapshot {
    return snapshotView({
      view: this.viewId,
      size: this.logicalSize(),
      root: this.root,
      layer: this.paintLayer.map((overlay) => ({
        node: overlay,
        presence: this.overlays.presenceOf(overlay),
      })),
      focused: this.focusedNode,
      hovered: this.pointer.hovered(),
      pressed: this.pointer.pressed(),
      radiusOf: this.radiusOf,
      textOf: (node) => {
        const placed = this.placeText(node);
        return placed ? { lines: placed.lines, ascent: placed.atlas.ascent } : null;
      },
    });
  }

  /**
   * The field's content: the selection highlight, the text (or the placeholder,
   * while it is empty) and the caret — all of it clipped to the padding box and
   * shifted by the field's own horizontal scroll, so a long value runs under the
   * edge instead of over it.
   *
   * The caret and the highlight are the field's `style.color`, the same "color of
   * this node's content" that already paints its glyphs, so they follow a state
   * override for free and `Style` gains nothing.
   */
  private paintField(
    node: LayoutNode,
    geometry: GeometryBuilder,
    opacity: number,
    clip: Clip | null,
  ): void {
    const style = this.styleOf(node);
    const atlas = this.fonts.get(this.fontSize(style));
    const values = node.resolved;
    const box = deflate(node.rect, values.padding ?? 0);
    // Everything below is cut to the content box: it is the field's own paint, so
    // it clips whether or not the author asked the node to clip its children.
    const inner = intersectClip(clip, box, 0);
    if (isEmptyClip(inner)) return;
    geometry.setClip(inner);

    const contentColor = values.color ?? DEFAULT_TEXT_COLOR;
    const placeholder = (node.ir as AnyNode).placeholder;
    const showing = node.text.length > 0 ? node.text : (placeholder ?? "");
    // One line, centred in the box — the same half-leading a `Text` places with.
    const lineHeight = Math.max(0, this.dim(style?.lineHeight, atlas.lineHeight));
    const top = box.y + Math.max(0, (box.height - lineHeight) / 2);
    const originX = box.x - node.textScroll;

    // Split once for the whole field: the highlight and the caret below both
    // count in code points, and so did the scroll pass that already ran (ZAB-73).
    const glyphs = this.field.charsOf(node);

    if (node.focused && hasSelection(node.selection)) {
      const { start, end } = span(node.selection, glyphs.length);
      const from = caretXOf(glyphs, start, atlas);
      const to = caretXOf(glyphs, end, atlas);
      geometry.roundedRect(
        { x: originX + from, y: top, width: to - from, height: lineHeight },
        0,
        fade(contentColor, opacity * CARET.selectionAlpha),
      );
    }
    if (showing.length > 0) {
      const y = top + (lineHeight - atlas.lineHeight) / 2;
      geometry.text(originX, y, showing, atlas, fade(contentColor, opacity));
    }
    // The caret hides while a range is selected (the highlight already says where
    // the edit will land) and blinks from the last edit, so it is solid as you type.
    if (
      node.focused &&
      !hasSelection(node.selection) &&
      caretVisible(now() - (node.caretSince ?? 0), CARET.blinkMs)
    ) {
      geometry.roundedRect(
        {
          x: originX + caretXOf(glyphs, node.selection.focus, atlas),
          y: top,
          width: CARET.width,
          height: lineHeight,
        },
        0,
        fade(contentColor, opacity),
      );
    }
  }

  /** Overlay position indicator, inside the viewport and over the content. */
  private paintScrollbar(
    node: LayoutNode,
    geometry: GeometryBuilder,
    opacity: number,
    clip: Clip | null,
  ): void {
    if ((node.ir as AnyNode).scrollbar === false) return;
    const { thickness, margin, minLength, color } = SCROLLBAR;
    const rect = node.rect;
    const bars: Rect[] = [];

    const vertical = scrollbarThumb(
      rect.height - margin * 2,
      rect.height,
      node.scrollMax.y,
      node.scrollOffset.y,
      minLength,
    );
    if (vertical) {
      bars.push({
        x: rect.x + rect.width - margin - thickness,
        y: rect.y + margin + vertical.start,
        width: thickness,
        height: vertical.length,
      });
    }
    const horizontal = scrollbarThumb(
      rect.width - margin * 2,
      rect.width,
      node.scrollMax.x,
      node.scrollOffset.x,
      minLength,
    );
    if (horizontal) {
      bars.push({
        x: rect.x + margin + horizontal.start,
        y: rect.y + rect.height - margin - thickness,
        width: horizontal.length,
        height: thickness,
      });
    }
    if (bars.length === 0) return;

    geometry.setClip(clip);
    for (const bar of bars) geometry.roundedRect(bar, thickness * 0.5, fade(color, opacity));
  }
}

// --- helpers ---

/**
 * The frame clock. One monotonic source for the whole view, sampled once per
 * render so every node on a frame interpolates against the same instant.
 */
function now(): number {
  return performance.now();
}

function isCollapseHeader(node: LayoutNode): boolean {
  return node.parent?.ir.type === "Collapse" && node.parent.children[0] === node;
}

/**
 * The wrapping inputs that are plain values, as one comparable string — the rest
 * of the key (the content and the atlas) is compared by value and by identity.
 * `maxWidth` is in here too: the width the flexbox offered is what the lines were
 * broken to, so a resize invalidates them like a style change does.
 */
function textOptionsKey(options: TextLayoutOptions): string {
  return `${options.wrap}|${options.maxWidth}|${options.lineHeight}|${options.maxLines}|${options.overflow}`;
}

function sameTextKey(previous: TextKey | null, next: TextKey): boolean {
  return (
    previous !== null &&
    previous.content === next.content &&
    previous.metrics === next.metrics &&
    previous.options === next.options
  );
}

const KEY_DIRECTIONS: Record<string, [number, number] | undefined> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function bindPath(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "bind" in value) {
    const path = (value as { bind: unknown }).bind;
    if (typeof path === "string" && path.length > 0) return path;
  }
  return null;
}

/**
 * A number off the data channel. Numeric strings are accepted for the same
 * reason `isSelected` tolerates them: the game may have pushed a value that
 * crossed a text field or a JSON payload, and a control bound to live data must
 * not hinge on which side did the parsing.
 */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && !Number.isInteger(value))
    return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return String(value);
}

/** The scopes of a node outside every template — shared, and never written to. */
const NO_SCOPES: readonly ItemScope[] = [];

/** Whether a ScrollView scrolls on the axis a virtualized list stacks its lines on. */
function scrollsOn(scroller: LayoutNode, vertical: boolean): boolean {
  const axis = (scroller.ir as { axis?: ScrollAxis }).axis ?? "vertical";
  return axis === "both" || axis === (vertical ? "vertical" : "horizontal");
}

/** Whether a measurement moved enough to matter — a subpixel wobble is not a relayout. */
function moved(previous: number | null, next: number): boolean {
  return previous === null || Math.abs(previous - next) > 0.5;
}

/** `#rrggbb` / `#rrggbbaa` → normalized RGBA, or null if it is neither. */
function parseColorLiteral(hex: string): Color | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const rgb = Number.parseInt(match[1], 16);
  const alpha = match[2] !== undefined ? Number.parseInt(match[2], 16) / 255 : 1;
  return [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, alpha];
}

export type { FrameStats, MountOptions, ZablooHandle };
export { mount };
