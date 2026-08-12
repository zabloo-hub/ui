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
  type Dim,
  type Easing,
  type Envelope,
  type ImageFit,
  ITEM_ALIAS,
  type ItemScope,
  itemKey,
  itemPath,
  parseEnvelope,
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
import { type Clip, clipContains, intersectClip, isEmptyClip } from "./clip.js";
import { closedHeight, collapseTarget } from "./collapse.js";
import { affects, DataStore } from "./data.js";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { GLRenderer } from "./gl.js";
import { FontLibrary, type GlyphAtlas } from "./glyphs.js";
import { childClip, effectiveClip } from "./hit.js";
import {
  arrange,
  contains,
  createLayoutNode,
  inFlow,
  inLayout,
  type LayoutNode,
  measure,
  type Rect,
  type RepeatState,
  wrapsLines,
} from "./layout.js";
import {
  ANCHOR_OFFSET,
  anchorBox,
  anchorSpec,
  autofocusIn,
  collectLayer,
  focusScope,
  isModal,
  isOnScreen,
  isWithin,
  overlaySpec,
  type Point,
  resolveHit,
  stepPresence,
  topModal,
} from "./overlay.js";
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
import { clamp, scrollbarThumb } from "./scroll.js";
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
import {
  layoutText,
  type PlacedLine,
  placeLines,
  type TextLayoutOptions,
  type TextMetrics,
} from "./text.js";
import {
  caretAt,
  caretVisible,
  caretX,
  clampSelection,
  codePointIndex,
  type Edit,
  hasSelection,
  indexAtX,
  insert,
  length,
  moveCaret,
  moveToEdge,
  remove,
  type Selection,
  scrollFor,
  selectAll,
  span,
  utf16Offset,
} from "./textinput.js";
import { isSelected, nextChecked, slotOpacity } from "./toggle.js";
import {
  clearNodeAnim,
  createNodeAnim,
  loopPhase,
  type NodeAnim,
  type ResolvedTransition,
  type ResolvedValues,
  stepNode,
  stepValue,
} from "./transition.js";
import { decodeBase64, loadFont, type StbFont } from "./ttf.js";

const DEFAULT_FONT_SIZE = 16;
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

/** In-progress pointer drag on a ScrollView, before the click-vs-drag threshold resolves it. */
interface ScrollDrag {
  node: LayoutNode;
  startPoint: { x: number; y: number };
  lastPoint: { x: number; y: number };
  moved: boolean;
}

/** Below this many px of pointer travel, a gesture still counts as a click/tap. */
const DRAG_THRESHOLD = 4;

/**
 * A Slider gesture in flight (pointer or held arrow key). `from` is the value it
 * started at: `onCommit` is "the value the player settled on", so a gesture that
 * ends where it began fires nothing.
 */
interface SliderGesture {
  node: LayoutNode;
  from: number;
}

/**
 * Overlay scrollbar (spec 2026-08-11): painted by the SDK inside the
 * ScrollView's rect, on the edge of its axis. Not in layout, not hit-testable
 * in F1 — it indicates the position, it doesn't take input. Styling it is a
 * deferred, compatible extension (`scrollbar` boolean → object).
 */
const SCROLLBAR = { thickness: 4, margin: 2, minLength: 16, color: [1, 1, 1, 0.35] as Color };

/**
 * The caret and the selection highlight a focused TextInput paints (ZAB-26).
 * Both derive from the field's own `style.color` — the "color of this node's
 * content" that already tints glyphs and images — so nothing new enters `Style`.
 * The blink is renderer behavior, like the Spinner's loop: it is not authored,
 * and styling either of them is a compatible extension, exactly as it is for the
 * ScrollView's scrollbar.
 */
const CARET = { width: 2, blinkMs: 1060, selectionAlpha: 0.3 };

export interface MountOptions {
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
  /** Canvas clear color (CSS hex). */
  background?: string;
}

export interface ZablooHandle {
  readonly viewIds: string[];
  /**
   * Resolves once the view has swapped in its OWN text rasterizer and repainted
   * with it (see `loadRasterizer`). Until then text is measured with the
   * browser's, so the first frames are not the ones the other targets produce —
   * which is why anything comparing metrics (the golden harness, a screenshot)
   * waits on this. It never rejects: a failed load keeps the fallback.
   */
  readonly ready: Promise<void>;
  /** Same loading path as the SDK: any versioned payload (dev push, hot-update). */
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
  dispose(): void;
}

export function mount(
  canvas: HTMLCanvasElement,
  envelope: string | object,
  options: MountOptions = {},
): ZablooHandle {
  const view = new WebView(canvas, toEnvelope(envelope), options);
  return view.handle();
}

function toEnvelope(input: string | object): Envelope {
  return parseEnvelope(typeof input === "string" ? JSON.parse(input) : input);
}

class WebView {
  private envelope: Envelope;
  private viewId: string;
  private readonly gl: GLRenderer;
  private readonly fonts: FontLibrary;
  private readonly images: ImageLibrary;
  private readonly clearColor: Color;
  private readonly onAction?: (action: string, context?: ActionContext) => void;
  private readonly onDataChanged?: (path: string, value: unknown) => void;

  private root!: LayoutNode;
  /** The view's overlays, flattened and ordered — rebuilt on every render. */
  private layer: LayoutNode[] = [];
  /** The layer the last frame PAINTED — the live one plus whatever was fading out. */
  private paintLayer: readonly LayoutNode[] = [];
  /** Open modals, innermost last, each with the focus it interrupted. */
  private readonly modalStack: Array<{ overlay: LayoutNode; previousFocus: LayoutNode | null }> =
    [];
  /** Live `autoCloseMs` timers, keyed by the overlay they will dismiss. */
  private readonly autoCloseTimers = new Map<LayoutNode, ReturnType<typeof setTimeout>>();
  /**
   * The enter/exit fade of each Overlay, kept OUT of the node's own `NodeAnim`:
   * the resolve pass drops that one when a node leaves layout, and an exit whose
   * starting point is erased by the exit itself would never animate.
   */
  private readonly overlayAnim = new Map<LayoutNode, NodeAnim>();
  /** This frame's presence per overlay (absent = 0, nothing to paint). */
  private readonly presence = new Map<LayoutNode, number>();
  /** Overlays already out of the live layer but still fading — pixels, never input. */
  private readonly exiting = new Set<LayoutNode>();
  private byId = new Map<string, LayoutNode>();
  /** Anchor ids already reported as missing — the warning is per author error, not per frame. */
  private warnedAnchors = new Set<string>();
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
  private readonly data = new DataStore();
  private pressedNode: LayoutNode | null = null;
  private focusedNode: LayoutNode | null = null;
  /** Node under the mouse, if any — the only state the pointer owns by itself. */
  private hoveredNode: LayoutNode | null = null;
  private scrollDrag: ScrollDrag | null = null;
  /** Slider being dragged with the pointer, and the one being nudged with the keyboard. */
  private sliderDrag: SliderGesture | null = null;
  private sliderKeys: SliderGesture | null = null;
  /** TextInput whose selection the pointer is dragging out. */
  private textDrag: LayoutNode | null = null;
  /** TextInput with an IME composition in flight — its text is not final yet. */
  private composing: LayoutNode | null = null;
  /**
   * The hidden field the browser types into while a TextInput has the focus. It is
   * what buys real IME composition, the clipboard and the mobile keyboard — none of
   * which a canvas can get from raw `keydown` (decision 2026-08-11, ZAB-26).
   */
  private editor: HTMLTextAreaElement | null = null;
  /** Overlay whose backdrop took the pointer down, pending a release on it. */
  private backdropPress: LayoutNode | null = null;
  /** Pending self-scheduled frame, while a transition is in flight. */
  private frame: number | null = null;
  /** Set by the resolve pass when any node still has a tween running. */
  private animating = false;
  /** Our TTF rasterizer, once its WASM has loaded (see `loadRasterizer`). */
  private font: StbFont | null = null;
  /** Settles when that rasterizer is in and the view has repainted with it. */
  private readonly ready: Promise<void>;
  /** Disposed views must not touch GL from work that was already in flight. */
  private disposed = false;
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
    this.clearColor = parseColor(options.background ?? "#101218") ?? [0.06, 0.07, 0.09, 1];
    this.gl = new GLRenderer(canvas);
    this.fonts = new FontLibrary(globalThis.devicePixelRatio ?? 1);
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
    return {
      viewIds: Object.keys(this.envelope.views),
      ready: this.ready,
      reload: (input) => {
        this.envelope = toEnvelope(input);
        if (!this.envelope.views[this.viewId]) {
          this.viewId = Object.keys(this.envelope.views)[0];
        }
        // Assets the new envelope still references keep their texture; the rest
        // are evicted (content-addressed, so a re-export of the same image is free).
        this.images.swap(this.envelope.assets ?? {});
        this.build();
        this.render();
      },
      setData: (path, value) => this.setData(path, value),
      setOpen: (id, open) => this.setOpen(id, open),
      setSelectedTab: (id, index) => this.setSelectedTab(id, index),
      setChecked: (id, checked) => this.setChecked(id, checked),
      setValue: (id, value) => this.setValue(id, value),
      setText: (id, text) => this.setText(id, text),
      setScroll: (id, x, y) => this.setScroll(id, x, y),
      snapshot: () => this.snapshot(),
      dispose: () => {
        this.disposed = true;
        this.cancelFrame();
        for (const dispose of this.disposers) dispose();
        this.clearAutoClose();
        this.images.dispose();
        this.font?.dispose();
        this.gl.dispose();
      },
    };
  }

  // --- build ---

  private build(): void {
    const rootIr = this.envelope.views[this.viewId];
    if (!rootIr) throw new Error(`zabloo renderer: view "${this.viewId}" not found`);
    this.byId = new Map();
    this.bound.clear();
    this.warnedAnchors = new Set();
    this.pressedNode = null;
    this.focusedNode = null;
    this.hoveredNode = null;
    this.scrollDrag = null;
    this.sliderDrag = null;
    this.sliderKeys = null;
    this.textDrag = null;
    this.backdropPress = null;
    // The tree is new, so every node identity the layer state referenced is gone.
    this.layer = [];
    this.modalStack.length = 0;
    this.clearAutoClose();
    // Presence dies with the document, like every other tween: a reload snaps.
    this.overlayAnim.clear();
    this.presence.clear();
    this.exiting.clear();
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

    if (any.type === "Repeat") {
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
      for (let i = 1; i < node.children.length; i++) node.children[i].sectionShown = false;
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
    const values: unknown[] = [any.visible];
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
      this.setNodeText(node, text);
      node.selection = settle
        ? caretAt(length(text))
        : clampSelection(node.selection, length(text));
      this.syncEditor(node);
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
    // the row it was showing into the one it now shows.
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
  private syncRepeats(node: LayoutNode = this.root): void {
    if (node.repeat) this.expand(node);
    for (const child of node.children) this.syncRepeats(child);
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
    for (const instance of dropped) this.release(instance);

    const alias = ir.as ?? ITEM_ALIAS;
    const instances = new Map<string, LayoutNode>();
    const children: LayoutNode[] = [];
    for (const { slot, instance } of entries) {
      const path = itemPath(arrayPath ?? "", slot.index);
      let child = instance;
      if (child === undefined) {
        const scope: ItemScope = { alias, path, index: slot.index };
        child = this.buildNode(template as ZNode, node, [...node.scopes, scope]);
      } else {
        this.rescope(child, alias, path, slot.index);
      }
      instances.set(slot.identity, child);
      children.push(child);
    }
    state.instances = instances;
    // The empty state is in layout exactly while there is nothing to repeat — the
    // `display:none` semantics of every other slot (decision 2026-08-11, ZAB-29).
    for (const slot of state.empty) slot.sectionShown = items.length === 0;
    node.children = [...children, ...state.empty];
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
    this.refreshBindings(instance);
  }

  private refreshBindings(node: LayoutNode): void {
    // `settle`: the subtree is showing another element now, so its states start
    // there rather than sliding over from the row this instance used to be.
    if (this.bound.has(node)) this.applyBindings(node, true);
    for (const child of node.children) this.refreshBindings(child);
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

  /** The ScrollView this node scrolls inside, if any — an Overlay is its own scope. */
  private scrollerOf(node: LayoutNode): LayoutNode | null {
    let current = node.parent;
    while (current) {
      if (current.ir.type === "Overlay") return null;
      if (current.ir.type === "ScrollView") return current;
      current = current.parent;
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
  private syncExtents(node: LayoutNode = this.root): void {
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
    for (const child of node.children) this.syncExtents(child);
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
    let current: LayoutNode | null = node;
    while (current) {
      const parent: LayoutNode | null = current.parent;
      if (parent?.repeat && !parent.repeat.empty.includes(current)) return parent;
      current = parent;
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
    this.bound.delete(node);
    this.overlayAnim.delete(node);
    const id = (node.ir as AnyNode).id;
    if (id !== undefined && this.byId.get(id) === node) this.byId.delete(id);
    if (this.focusedNode === node) this.focusedNode = null;
    if (this.pressedNode === node) this.pressedNode = null;
    if (this.backdropPress === node) this.backdropPress = null;
    if (this.scrollDrag?.node === node) this.scrollDrag = null;
    if (this.sliderDrag?.node === node) this.sliderDrag = null;
    if (this.sliderKeys?.node === node) this.sliderKeys = null;
    for (let i = this.modalStack.length - 1; i >= 0; i--) {
      if (this.modalStack[i].overlay === node) this.modalStack.splice(i, 1);
      else if (this.modalStack[i].previousFocus === node) this.modalStack[i].previousFocus = null;
    }
    for (const child of node.children) this.release(child);
  }

  // --- behavior (renderer-owned, keyed by component type) ---

  /**
   * The content is in layout while the Collapse is open — and for as long as the
   * height tween runs, which is what a closing Collapse animates over.
   */
  private applyOpen(node: LayoutNode): void {
    const shown = node.open || node.collapseAnimating;
    for (let i = 1; i < node.children.length; i++) {
      node.children[i].sectionShown = shown;
    }
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
    for (let i = 0; i < panels.length; i++) {
      panels[i].sectionShown = i === group.selectedIndex;
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
    let current = node.parent;
    while (current) {
      const any = current.ir as AnyNode;
      if (any.type === "Container" && any.group === "exclusive-check") return current;
      current = current.parent;
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
   * of the data channel — and fires the node's named action.
   */
  private setToggleChecked(node: LayoutNode, checked: boolean): void {
    const any = node.ir as AnyNode;
    const group = this.exclusiveGroupOf(node);

    if (group) {
      // A radio only ever turns ON; the group's value is the state that moves.
      if (!checked || node.checked) return;
      group.groupValue = any.value;
      this.applyGroupValue(group);
      const path = this.writePath(group, (group.ir as AnyNode).value);
      if (path !== null) this.writeData(path, any.value);
    } else {
      if (node.checked === checked) return;
      node.checked = checked;
      // Inside an item this resolves to `shop.items.3.enabled`: a write into the
      // array, on the same channel and with no per-component API (ZAB-29).
      const path = this.writePath(node, any.checked);
      if (path !== null) this.writeData(path, checked);
    }

    if (any.onChange) this.onAction?.(any.onChange, this.contextOf(node));
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

  // --- TextInput: the buffer, the caret and the two hooks (ZAB-26) ---

  /** The buffer and the state derived from it — `empty` is what styles the placeholder. */
  private setNodeText(node: LayoutNode, text: string): void {
    node.text = text;
    node.empty = text.length === 0;
  }

  /** The metrics this field measures with — the caret and the paint share them. */
  private textMetrics(node: LayoutNode): TextMetrics {
    return this.fonts.get(this.fontSize(this.effectiveStyle(node)));
  }

  /** The box the content lives in: the node's rect minus its padding. */
  private textBox(node: LayoutNode): Rect {
    return deflate(node.rect, node.resolved.padding ?? 0);
  }

  /**
   * Single state-mutation path for the text (typing, IME, paste, delete,
   * `setText`): writes the buffer, writes the new value into the bound path — the
   * return leg of the data channel — and fires the live `onChange`. The caret moves
   * with it, and its blink restarts so it stays solid while the player types.
   */
  private applyEdit(node: LayoutNode, edit: Edit, silent = false, commit = false): void {
    const changed = edit.text !== node.text;
    this.setNodeText(node, edit.text);
    node.selection = clampSelection(edit.selection, length(edit.text));
    node.caretSince = now();
    // `silent` is a composition in flight (the field shows it, the game is not told
    // yet); `commit` is the end of one, where the settled text must go out even
    // though the silent frames already put it in the buffer.
    if ((changed || commit) && !silent) {
      const any = node.ir as AnyNode;
      const path = bindPath(any.value);
      if (path !== null) this.writeData(path, edit.text);
      if (any.onChange) this.onAction?.(any.onChange);
    }
    this.render();
  }

  /** Moves the caret (or the selection) without touching the text. */
  private setSelection(node: LayoutNode, selection: Selection): void {
    node.selection = clampSelection(selection, length(node.text));
    node.caretSince = now();
    this.syncEditor(node);
    this.render();
  }

  private deleteText(node: LayoutNode, forward: boolean): void {
    this.applyEdit(node, remove(node.text, node.selection, forward));
    this.syncEditor(node);
  }

  /** The caret index a point selects, in the field's own content coordinates. */
  private textIndexAt(node: LayoutNode, point: Point): number {
    const box = this.textBox(node);
    return indexAtX(node.text, point.x - box.x + node.textScroll, this.textMetrics(node));
  }

  /**
   * Keeps the caret inside the box after a change — the field's own horizontal
   * scroll, the counterpart of the ScrollView's offset (never authored). It runs
   * after arrange, where the rect is final, and it is idempotent.
   */
  private syncTextScroll(node: LayoutNode): void {
    const metrics = this.textMetrics(node);
    const box = this.textBox(node);
    node.textScroll = scrollFor(
      node.textScroll,
      caretX(node.text, node.selection.focus, metrics),
      box.width,
      caretX(node.text, length(node.text), metrics),
      CARET.width,
    );
  }

  // --- TextInput: the hidden field the browser types into ---
  //
  // A canvas receives keystrokes but not TEXT: IME composition, the clipboard and
  // the mobile keyboard all belong to a real editable element. So one lives
  // off-screen, mirroring the focused field both ways — we push our buffer into it
  // and fold whatever the browser did back into ours. It is the same trick Figma
  // and Docs use, and it stays entirely inside the web renderer (the Unity SDK
  // will have its own answer).

  private ensureEditor(): HTMLTextAreaElement | null {
    if (this.editor) return this.editor;
    if (typeof document === "undefined") return null;
    const editor = document.createElement("textarea");
    // Off-screen but REAL: `display:none` or `visibility:hidden` would take no
    // focus, and without focus there is no composition and no virtual keyboard.
    Object.assign(editor.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      border: "0",
      outline: "none",
      resize: "none",
      opacity: "0",
      zIndex: "-1",
      pointerEvents: "none",
    });
    editor.setAttribute("autocomplete", "off");
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocorrect", "off");
    editor.setAttribute("aria-hidden", "true");
    editor.spellcheck = false;
    editor.tabIndex = -1;

    const input = () => {
      const node = this.focusedNode;
      if (node?.ir.type !== "TextInput") return;
      // Mid-composition the field shows what is being composed but the game is not
      // told yet: half a syllable is not a value. `compositionend` commits it.
      this.readEditor(node, this.composing === node);
    };
    const compositionstart = () => {
      const node = this.focusedNode;
      if (node?.ir.type === "TextInput") this.composing = node;
    };
    const compositionend = () => {
      const node = this.composing;
      this.composing = null;
      if (node) this.readEditor(node, false, true);
    };
    editor.addEventListener("input", input);
    editor.addEventListener("compositionstart", compositionstart);
    editor.addEventListener("compositionupdate", input);
    editor.addEventListener("compositionend", compositionend);

    (this.canvas.parentElement ?? document.body).appendChild(editor);
    this.editor = editor;
    this.disposers.push(() => {
      editor.removeEventListener("input", input);
      editor.removeEventListener("compositionstart", compositionstart);
      editor.removeEventListener("compositionupdate", input);
      editor.removeEventListener("compositionend", compositionend);
      editor.remove();
      this.editor = null;
    });
    return editor;
  }

  /** Pushes our buffer and caret into the hidden field, so the browser edits THIS. */
  private syncEditor(node: LayoutNode): void {
    const editor = this.editor;
    if (!editor || this.focusedNode !== node || this.composing === node) return;
    if (editor.value !== node.text) editor.value = node.text;
    const { start, end } = span(node.selection, length(node.text));
    const backward = node.selection.anchor > node.selection.focus;
    editor.setSelectionRange(
      utf16Offset(node.text, start),
      utf16Offset(node.text, end),
      backward ? "backward" : "forward",
    );
  }

  /**
   * Folds the hidden field back into ours. Everything the browser can do to text —
   * typing, composing, pasting, cutting, autocorrect — arrives here as "this is the
   * new value and this is where the caret is", so the whole value is run through the
   * editing model as one replacement: that is what applies `maxLength` and the
   * single-line rule here exactly as it applies them to a keystroke on a target that
   * feeds characters in one at a time.
   */
  private readEditor(node: LayoutNode, silent: boolean, commit = false): void {
    const editor = this.editor;
    if (!editor) return;
    const limited = insert(
      node.text,
      selectAll(node.text),
      editor.value,
      (node.ir as AnyNode).maxLength,
    ).text;
    // The caret is the browser's, not the model's: it knows where the edit landed.
    const backward = editor.selectionDirection === "backward";
    const start = codePointIndex(limited, editor.selectionStart ?? 0);
    const end = codePointIndex(limited, editor.selectionEnd ?? 0);
    this.applyEdit(
      node,
      {
        text: limited,
        selection: backward ? { anchor: end, focus: start } : { anchor: start, focus: end },
      },
      silent,
      commit,
    );
    // Truncated, or a newline folded away: the browser's copy is no longer ours.
    if (limited !== editor.value) this.syncEditor(node);
  }

  /** Hands the keyboard to the hidden field, or takes it back when focus leaves. */
  private focusEditor(node: LayoutNode | null): void {
    if (node?.ir.type !== "TextInput") {
      this.composing = null;
      this.editor?.blur();
      return;
    }
    const editor = this.ensureEditor();
    if (!editor) return;
    this.syncEditor(node);
    if (document.activeElement !== editor) editor.focus({ preventScroll: true });
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
    this.applyEdit(node, { text: String(text), selection: caretAt(length(String(text))) });
    this.syncEditor(node);
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

  private isFocusable(node: LayoutNode): boolean {
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
    if (this.isFocusable(node)) out.push(node);
    for (const child of node.children) this.collectFocusables(child, out);
    return out;
  }

  private scope(): LayoutNode {
    return focusScope(this.root, this.layer);
  }

  /** The scope's declared initial focus (`autofocus`), if it is really focusable. */
  private autofocus(scope: LayoutNode = this.scope()): LayoutNode | null {
    return autofocusIn(scope, (node) => this.isFocusable(node));
  }

  private setFocus(node: LayoutNode | null): void {
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
    this.focusEditor(node);
  }

  /** Moves focus in a direction (unit axis): the console-UI spatial algorithm. */
  moveFocus(dx: number, dy: number): void {
    const candidates = this.collectFocusables();
    if (candidates.length === 0) return;

    const current = this.focusedNode;
    if (!current || !candidates.includes(current)) {
      this.setFocus(this.autofocus() ?? candidates[0]);
      this.render();
      return;
    }

    const from = center(current.rect);
    let best: LayoutNode | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (candidate === current) continue;
      const to = center(candidate.rect);
      const deltaX = to.x - from.x;
      const deltaY = to.y - from.y;
      const projection = deltaX * dx + deltaY * dy;
      if (projection <= 0.5) continue; // must lie in the direction of travel
      const orthogonal = Math.abs(deltaX * dy) + Math.abs(deltaY * dx);
      const score = projection + orthogonal * 2;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) {
      this.setFocus(best);
      this.render();
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
   */
  private editKey(event: KeyboardEvent): boolean {
    const node = this.focusedNode;
    if (node?.ir.type !== "TextInput" || !inLayout(node)) return false;
    const shortcut = event.metaKey || event.ctrlKey;
    if (shortcut) {
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        this.setSelection(node, selectAll(node.text));
        return true;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        this.setSelection(
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
        this.setSelection(node, step.selection);
        return true;
      }
      case "Home":
      case "End":
        event.preventDefault();
        this.setSelection(
          node,
          moveToEdge(node.text, node.selection, event.key === "End", event.shiftKey).selection,
        );
        return true;
      case "Backspace":
      case "Delete":
        event.preventDefault();
        this.deleteText(node, event.key === "Delete");
        return true;
      case "Enter": {
        event.preventDefault();
        const action = (node.ir as AnyNode).onSubmit;
        if (action && !event.repeat) this.onAction?.(action);
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

  // --- overlay layer (decision 2026-08-11, ZAB-19) ---

  /**
   * Keeps focus inside the layer's rules across relayouts: an opening modal
   * remembers the focus it interrupts and hands it to its `autofocus`, and a
   * closing one gives that focus back. Runs on every render — the single funnel
   * every state change already goes through — so it never misses an overlay
   * opened by a binding, a reload or the game.
   */
  private syncModalFocus(): void {
    const modals = this.layer.filter(isModal);

    // Gone from the layer (closed or hidden): the OUTERMOST one that left owns
    // the restore, so closing a whole stack returns to what preceded all of it.
    let restored: LayoutNode | null = null;
    for (let i = this.modalStack.length - 1; i >= 0; i--) {
      if (modals.includes(this.modalStack[i].overlay)) continue;
      restored = this.modalStack[i].previousFocus;
      this.modalStack.splice(i, 1);
    }
    for (const modal of modals) {
      if (this.modalStack.some((entry) => entry.overlay === modal)) continue;
      this.modalStack.push({ overlay: modal, previousFocus: this.focusedNode });
      restored = null; // opening wins over closing: the new modal owns the focus
    }

    const scope = this.scope();
    const current = this.focusedNode;
    if (current && inLayout(current) && isWithin(current, scope)) return;
    // Outside the scope (or gone): the restored node if it still qualifies,
    // otherwise the scope's `autofocus` — and nothing at all if neither does,
    // rather than leaving a node under the modal wearing the focused state.
    const candidate =
      restored && inLayout(restored) && this.isFocusable(restored) && isWithin(restored, scope)
        ? restored
        : this.autofocus(scope);
    this.setFocus(candidate);
  }

  /**
   * A dismiss request — Escape, a tap on the backdrop, an `autoCloseMs` timeout.
   * Closing is the renderer's default behavior: it writes `false` into the bound
   * `visible` path (the read/write binding mechanism of decision 2026-08-11,
   * which also notifies the game) and fires the declared `onDismiss` action.
   * With a static `visible` there is nothing to write — only the action fires,
   * and closing is the game's call.
   */
  private requestDismiss(overlay: LayoutNode): void {
    const spec = overlaySpec(overlay);
    if (spec === null) return;
    const path = this.writePath(overlay, (overlay.ir as AnyNode).visible);
    if (path !== null) this.writeData(path, false);
    if (spec.onDismiss) this.onAction?.(spec.onDismiss, this.contextOf(overlay));
    this.render();
  }

  /**
   * The layer's enter/exit fade: one presence tween per Overlay of the view,
   * whether it is up or not — a hidden one has to sit at 0 so that opening it is a
   * change to animate from, instead of the snap a first observation would give.
   *
   * The tween runs on the overlay's OWN `transition`, so this adds no IR surface:
   * without one, presence jumps and the frame looks exactly like it did before F7.
   */
  private syncPresence(now: number): void {
    this.presence.clear();
    this.exiting.clear();
    this.eachOverlay(this.root, (overlay) => {
      let anim = this.overlayAnim.get(overlay);
      if (!anim) {
        anim = createNodeAnim();
        this.overlayAnim.set(overlay, anim);
      }
      const live = this.layer.includes(overlay);
      const stepped = stepPresence(anim, live, this.transitionOf(overlay), now);
      if (stepped.animating) this.animating = true;
      // Recorded even at 0 — the frame an overlay opens on starts there, and a
      // missing entry would paint it fully opaque for exactly that frame, which
      // reads as a flash right before the fade in.
      this.presence.set(overlay, stepped.value);
      // Out of the live layer but still visible: it paints, and nothing else. It
      // takes no input, traps no focus and re-arms no timer, because every one of
      // those reads `this.layer`, which it already left.
      if (!live && stepped.value > 0) this.exiting.add(overlay);
    });
  }

  /** Every Overlay of the tree, hidden ones included — presence is tracked for all. */
  private eachOverlay(node: LayoutNode, visit: (overlay: LayoutNode) => void): void {
    if (node.ir.type === "Overlay") visit(node);
    for (const child of node.children) this.eachOverlay(child, visit);
  }

  // --- anchoring (decision 2026-08-11, ZAB-46) ---

  /**
   * The node an overlay is anchored to. An `id` that resolves to nothing is
   * authoring error, not runtime state: it warns once (repeating it every frame
   * would bury the console) and the overlay falls back to the layer placement it
   * still carries, so a typo shows a v1 tooltip instead of nothing at all.
   */
  private anchorNode(id: string): LayoutNode | null {
    const node = this.byId.get(id);
    if (node) return node;
    if (!this.warnedAnchors.has(id)) {
      this.warnedAnchors.add(id);
      console.warn(`[zabloo] Overlay anchor "${id}" matches no node in this view`);
    }
    return null;
  }

  /**
   * Whether an anchored overlay may be in the layer this frame — everything else
   * is unconditionally allowed, so this composes with `inLayout` as the layer's
   * predicate.
   *
   * Two rules, both from the relation: an overlay whose anchor is off screen has
   * nothing to point at and leaves (fading out like any other close), and a
   * hover-triggered one is up exactly while its anchor is hovered or focused — the
   * pointer and the gamepad answer of the same question. `visible` still gates
   * both, since it gates entry into the layer in the first place.
   */
  /**
   * The layer's predicate: in layout, and — for an anchored overlay — with its
   * anchor still on screen and, when it rides its hover, under the pointer or the
   * focus. Everything the layer owns (input, focus, timers, the presence tween's
   * target) reads it through `this.layer`, so the two capabilities of ZAB-46 need
   * no wiring of their own anywhere else.
   */
  private layerPresent = (node: LayoutNode): boolean => inLayout(node) && this.anchorAllows(node);

  private anchorAllows(node: LayoutNode): boolean {
    const spec = anchorSpec(node);
    if (spec === null) return true;
    const anchor = this.anchorNode(spec.id);
    if (anchor === null) return true;
    if (!isOnScreen(anchor, this.radiusOf)) return false;
    if (spec.trigger === "manual") return true;
    // Hover lights up exactly the focusable set (decision 2026-08-11, ZAB-36), so
    // an anchor that takes no input is never hovered NOR focused and the hint
    // would simply never appear. Say so instead of staying dark.
    if (!this.isFocusable(anchor) && !this.warnedAnchors.has(spec.id)) {
      this.warnedAnchors.add(spec.id);
      console.warn(
        `[zabloo] Overlay anchor "${spec.id}" is a ${anchor.ir.type}, which takes no ` +
          `hover or focus: a trigger:"hover" overlay anchored to it never shows.`,
      );
    }
    return anchor.hovered || anchor.focused;
  }

  /**
   * Lays one layer entry out. Unanchored, the entry IS the view: its own flex
   * places the content anywhere on the layer. Anchored, the content goes where
   * `anchorBox` puts it around the anchor, while the entry's own rect stays the
   * view's — that is what keeps a modal popover dimming and capturing the whole
   * screen while its panel hangs off a button.
   *
   * The content is sized from `natural`, so `layout.width`/`height` on an Overlay
   * stay ignored (a layer is not sized — size the child), and `padding` keeps
   * meaning "margin from the view's edges": it is taken out of the box and given
   * back around it, so the same number does the same job anchored or not.
   */
  private arrangeOverlay(overlay: LayoutNode, viewRect: Rect): void {
    const spec = anchorSpec(overlay);
    const anchor = spec === null ? null : this.anchorNode(spec.id);
    if (spec === null || anchor === null) {
      arrange(overlay, viewRect);
      return;
    }
    const padding = overlay.resolved.padding ?? 0;
    const box = anchorBox(
      anchor.rect,
      { x: overlay.natural.x - padding * 2, y: overlay.natural.y - padding * 2 },
      spec.at,
      this.dim(spec.offset, ANCHOR_OFFSET),
      deflate(viewRect, padding),
    );
    arrange(overlay, {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    });
    overlay.rect = viewRect;
  }

  /**
   * Arms `autoCloseMs` while an overlay is in the layer; disarms it when it leaves.
   * Never for a hover-triggered one: what dismisses that is leaving the anchor, and
   * a timer would take the hint away from under a pointer still resting on it.
   */
  private syncAutoClose(): void {
    for (const [overlay, timer] of this.autoCloseTimers) {
      if (this.layer.includes(overlay)) continue;
      clearTimeout(timer);
      this.autoCloseTimers.delete(overlay);
    }
    for (const overlay of this.layer) {
      const ms = overlaySpec(overlay)?.autoCloseMs;
      if (ms === undefined || this.autoCloseTimers.has(overlay)) continue;
      if (anchorSpec(overlay)?.trigger === "hover") continue;
      const timer = setTimeout(() => {
        this.autoCloseTimers.delete(overlay);
        this.requestDismiss(overlay);
      }, ms);
      this.autoCloseTimers.set(overlay, timer);
    }
  }

  private clearAutoClose(): void {
    for (const timer of this.autoCloseTimers.values()) clearTimeout(timer);
    this.autoCloseTimers.clear();
  }

  // --- input (pointer → hit test on layout rects) ---

  private listen(): void {
    const down = (event: PointerEvent) => {
      const point = this.eventPoint(event);
      const resolved = this.hitTest(point);
      if (resolved.kind === "backdrop") {
        // A tap on a modal's backdrop: dismissed on release, like a button click.
        this.backdropPress = resolved.overlay;
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      const hit = resolved.kind === "node" ? resolved.node : null;
      // Sliders take the pointer first: the gesture starts on the press (the
      // thumb jumps to the finger) and the control lives inside scrollable
      // screens, where the drag must move the value, not the list.
      const slider = hit && this.findUp(hit, (n) => n.ir.type === "Slider");
      if (slider) {
        this.sliderDrag = { node: slider, from: slider.sliderValue };
        slider.pressed = true;
        this.setFocus(slider);
        this.canvas.setPointerCapture(event.pointerId);
        this.setSliderValue(slider, this.valueAtPoint(slider, point));
        this.render();
        return;
      }
      // A text field takes the pointer for the same reason a Slider does: the press
      // places the caret and the drag selects, and neither may become a scroll of
      // the screen the field sits in.
      const field = hit && this.findUp(hit, (n) => n.ir.type === "TextInput");
      if (field) {
        this.textDrag = field;
        this.setFocus(field);
        this.focusEditor(field); // the canvas press blurs the hidden field: take it back
        this.canvas.setPointerCapture(event.pointerId);
        this.setSelection(field, caretAt(this.textIndexAt(field, point)));
        return;
      }
      const pressable =
        hit && this.findUp(hit, (n) => n.ir.type === "Button" || n.ir.type === "Toggle");
      if (pressable) {
        pressable.pressed = true;
        this.pressedNode = pressable;
        this.setFocus(pressable); // pointer and directional nav share one focus
        this.canvas.setPointerCapture(event.pointerId);
        this.render();
        return;
      }
      // Not yet a scroll gesture — held back until the drag threshold clears
      // it, so a plain tap still reaches the Collapse-toggle handling in `up`.
      const scrollable = hit && this.findUp(hit, (n) => n.ir.type === "ScrollView");
      if (scrollable) {
        this.scrollDrag = {
          node: scrollable,
          startPoint: point,
          lastPoint: point,
          moved: false,
        };
        this.canvas.setPointerCapture(event.pointerId);
      }
    };
    const move = (event: PointerEvent) => {
      // Hover is a MOUSE state: a finger that taps and leaves would otherwise
      // keep a control lit up with nothing over it.
      if (event.pointerType === "" || event.pointerType === "mouse") {
        if (this.setHover(this.hoverableAt(this.eventPoint(event)))) this.render();
      }
      const slider = this.sliderDrag;
      if (slider) {
        // No drag threshold: a slider follows the finger from the first pixel
        // (there is no tap-vs-drag ambiguity — the press already set a value).
        this.setSliderValue(slider.node, this.valueAtPoint(slider.node, this.eventPoint(event)));
        return;
      }
      const field = this.textDrag;
      if (field) {
        // The anchor stays where the press landed and the focus follows the
        // pointer — the same `{anchor, focus}` a shift+arrow moves.
        this.setSelection(field, {
          anchor: field.selection.anchor,
          focus: this.textIndexAt(field, this.eventPoint(event)),
        });
        return;
      }
      const drag = this.scrollDrag;
      if (!drag) return;
      const point = this.eventPoint(event);
      if (!drag.moved) {
        const dx = point.x - drag.startPoint.x;
        const dy = point.y - drag.startPoint.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
      }
      const dx = point.x - drag.lastPoint.x;
      const dy = point.y - drag.lastPoint.y;
      drag.lastPoint = point;
      this.setScrollOffset(drag.node, drag.node.scrollOffset.x - dx, drag.node.scrollOffset.y - dy);
    };
    const keydown = (event: KeyboardEvent) => {
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
          this.requestDismiss(modal);
        }
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") this.pressFocused(false);
      // Releasing an arrow ends the keyboard gesture — the same commit a
      // pointer release fires, so both ways of moving a slider settle alike.
      else if (KEY_DIRECTIONS[event.key] && this.sliderKeys) {
        const gesture = this.sliderKeys;
        this.sliderKeys = null;
        this.commitSlider(gesture);
      }
    };
    const up = (event: PointerEvent) => {
      const point = this.eventPoint(event);
      if (this.textDrag) {
        this.textDrag = null;
        return;
      }
      const slider = this.sliderDrag;
      if (slider) {
        this.sliderDrag = null;
        slider.node.pressed = false;
        this.render();
        this.commitSlider(slider);
        return;
      }
      const pressed = this.pressedNode;
      if (pressed) {
        pressed.pressed = false;
        this.pressedNode = null;
        this.render();
        // Released over the control it pressed — and still inside the clip, so
        // scrolling the button out from under the finger cancels the tap.
        if (this.reachableAt(pressed, point)) this.activate(pressed);
        return;
      }
      const backdrop = this.backdropPress;
      this.backdropPress = null;
      if (backdrop) {
        const resolved = this.hitTest(point);
        if (resolved.kind === "backdrop" && resolved.overlay === backdrop) {
          this.requestDismiss(backdrop);
        }
        return;
      }
      const drag = this.scrollDrag;
      this.scrollDrag = null;
      if (drag?.moved) return; // a scroll gesture, not a tap
      // Collapse header toggle (the <details>/<summary> model).
      const resolved = this.hitTest(point);
      const hit = resolved.kind === "node" ? resolved.node : null;
      const header = hit && this.findUp(hit, isCollapseHeader);
      if (header?.parent) this.setCollapseOpen(header.parent, !header.parent.open);
    };
    const wheel = (event: WheelEvent) => {
      const resolved = this.hitTest(this.eventPoint(event));
      if (resolved.kind === "backdrop") {
        event.preventDefault(); // the modal captures the wheel: nothing below scrolls
        return;
      }
      const hit = resolved.kind === "node" ? resolved.node : null;
      const scrollable = hit && this.findUp(hit, (n) => n.ir.type === "ScrollView");
      if (!scrollable) return;
      event.preventDefault();
      this.setScrollOffset(
        scrollable,
        scrollable.scrollOffset.x + event.deltaX,
        scrollable.scrollOffset.y + event.deltaY,
      );
    };
    const leave = () => {
      if (this.setHover(null)) this.render();
    };
    const resize = () => this.resize();

    this.canvas.addEventListener("pointerdown", down);
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointerleave", leave);
    this.canvas.addEventListener("wheel", wheel, { passive: false });
    globalThis.addEventListener("keydown", keydown);
    globalThis.addEventListener("keyup", keyup);
    globalThis.addEventListener("resize", resize);
    this.disposers.push(() => {
      this.canvas.removeEventListener("pointerdown", down);
      this.canvas.removeEventListener("pointermove", move);
      this.canvas.removeEventListener("pointerup", up);
      this.canvas.removeEventListener("pointerleave", leave);
      this.canvas.removeEventListener("wheel", wheel);
      globalThis.removeEventListener("keydown", keydown);
      globalThis.removeEventListener("keyup", keyup);
      globalThis.removeEventListener("resize", resize);
    });
  }

  private eventPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  /** The overlay layer first (top-down, a modal captures), then the tree — clipped subtrees excluded. */
  private hitTest(point: Point) {
    return resolveHit(this.root, this.layer, point, this.radiusOf);
  }

  /**
   * The control the pointer is over, if any. Hoverable is the same set as
   * focusable — what takes input is what may look different under the pointer —
   * so hover and directional navigation light up exactly the same nodes, and a
   * modal's backdrop (which captures input) lights up nothing below it.
   */
  private hoverableAt(point: Point): LayoutNode | null {
    const resolved = this.hitTest(point);
    if (resolved.kind !== "node") return null;
    return this.findUp(resolved.node, (node) => this.isFocusable(node));
  }

  /** Moves the hover, returning whether anything changed (the caller repaints). */
  private setHover(node: LayoutNode | null): boolean {
    if (this.hoveredNode === node) return false;
    if (this.hoveredNode) this.hoveredNode.hovered = false;
    this.hoveredNode = node;
    if (node) node.hovered = true;
    return true;
  }

  /** Is this node's own rect reachable at that point, given its ancestors' clips? */
  private reachableAt(node: LayoutNode, point: Point): boolean {
    return contains(node.rect, point) && clipContains(effectiveClip(node, this.radiusOf), point);
  }

  /**
   * Nearest ancestor matching `predicate`, stopping at an `Overlay`: a layer
   * entry is the top of its own input scope, so a gesture inside a modal never
   * reaches the ScrollView or Collapse it happens to be declared inside.
   */
  private findUp(node: LayoutNode, predicate: (n: LayoutNode) => boolean): LayoutNode | null {
    let current: LayoutNode | null = node;
    while (current) {
      if (current.ir.type === "Overlay") return null;
      if (predicate(current)) return current;
      current = current.parent;
    }
    return null;
  }

  // --- tokens / style resolution ---

  private token(value: unknown): TokenValue | undefined {
    if (
      typeof value === "string" &&
      value.length > 2 &&
      value.startsWith("{") &&
      value.endsWith("}")
    ) {
      const key = value.slice(1, -1);
      const resolved = this.envelope.tokens[key];
      if (resolved === undefined) console.warn(`[zabloo] Unknown design token ${value}`);
      return resolved;
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
    return (typeof resolved === "string" && parseColor(resolved)) || fallback;
  }

  /** This frame's style: the base plus every active state, in `STATE_ORDER`. */
  private effectiveStyle(node: LayoutNode): Style | undefined {
    const any = node.ir as AnyNode;
    return effectiveStyle(any.style, any.states, node);
  }

  private fontSize(style: Style | undefined): number {
    return Math.max(1, Math.round(this.dim(style?.fontSize, DEFAULT_FONT_SIZE)));
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
    if (!inLayout(node) && !this.exiting.has(node)) {
      // Out of layout: nothing to paint, and no honest previous value for the day
      // it comes back — dropping the state makes that return snap, like a mount.
      // An overlay mid-exit is the exception: it is still on screen this frame.
      this.forgetAnim(node);
      return;
    }
    node.forcedClip = false;
    const style = this.effectiveStyle(node);
    const layout = node.ir.layout;
    const targets: ResolvedValues = {
      background: this.optionalColor(style?.background, MISSING_COLOR),
      // An undeclared border color HOLDS the last one instead of dropping it: the
      // border it paints is leaving through `borderWidth`, and a focus ring that
      // loses its color halfway out would flash the missing-color magenta.
      borderColor:
        this.optionalColor(style?.borderColor, MISSING_COLOR) ?? node.resolved.borderColor,
      color: this.optionalColor(style?.color, DEFAULT_TEXT_COLOR),
      // These have renderer defaults, so both endpoints always resolve and a state
      // that introduces one still animates (only auto sizes and colors can snap).
      opacity: Math.min(1, Math.max(0, style?.opacity ?? 1)),
      radius: this.dim(style?.radius),
      borderWidth: this.dim(style?.borderWidth),
      gap: this.dim(layout?.gap),
      padding: this.dim(layout?.padding),
      width: this.optionalDim(layout?.width),
      height: this.optionalDim(layout?.height),
    };
    const transition = this.transitionOf(node);
    const { values, animating } = stepNode(node.anim, targets, transition, now);
    node.resolved = values;
    if (animating) this.animating = true;
    // Behaviors that tween a value of their own, with endpoints they compute
    // (decision 2026-08-11 §5) — they run BEFORE the children, since a Collapse
    // decides here whether its content is in layout at all this frame.
    if (node.ir.type === "ProgressBar") this.resolveProgress(node, transition, now);
    else if (node.ir.type === "Slider") this.resolveSlider(node, transition, now);
    else if (node.ir.type === "Collapse") this.resolveCollapse(node, transition, now);
    // A focused field owns the clock while its caret blinks — the same reason a
    // Spinner does, and it stops as soon as the focus leaves.
    else if (node.ir.type === "TextInput" && node.focused) this.animating = true;
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
    const gesturing = this.sliderDrag?.node === node || this.sliderKeys?.node === node;
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
    for (let i = 0; i < node.children.length && i < 2; i++) {
      const slot = node.children[i];
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
    for (let i = 0; i < beads.length; i++) {
      const bead = beads[i];
      const pulse = beadOpacity(i, beads.length, phase, any.min, any.easing);
      bead.resolved.opacity = (bead.resolved.opacity ?? 1) * pulse;
    }
    if (running) this.animating = true;
  }

  private forgetAnim(node: LayoutNode): void {
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
    for (const child of node.children) this.forgetAnim(child);
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
    if (this.frame === null) return;
    globalThis.cancelAnimationFrame(this.frame);
    this.frame = null;
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
    const dpr = globalThis.devicePixelRatio ?? 1;
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.render();
  }

  private logicalSize(): { width: number; height: number } {
    const dpr = globalThis.devicePixelRatio ?? 1;
    return { width: this.canvas.width / dpr, height: this.canvas.height / dpr };
  }

  private measureLeaf = (
    node: LayoutNode,
    availableWidth: number | null,
  ): { x: number; y: number } => {
    const ir = node.ir;
    if (ir.type === "Text") {
      // Wrapping happens HERE, once per frame: the block is kept on the node so
      // paint reuses these very lines instead of breaking the text a second time.
      const style = this.effectiveStyle(node);
      const atlas = this.fonts.get(this.fontSize(style));
      const block = layoutText(
        this.resolveText(node),
        atlas,
        this.textOptions(style, atlas.lineHeight, availableWidth),
      );
      node.textBlock = block;
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
      const style = this.effectiveStyle(node);
      const atlas = this.fonts.get(this.fontSize(style));
      return { x: 0, y: Math.max(0, this.dim(style?.lineHeight, atlas.lineHeight)) };
    }
    return { x: 0, y: 0 };
  };

  /** Every TextInput of the tree, so the caret pass does not walk it looking for them. */
  private eachTextInput(node: LayoutNode, visit: (field: LayoutNode) => void): void {
    if (node.ir.type === "TextInput") visit(node);
    for (const child of node.children) this.eachTextInput(child, visit);
  }

  render(): void {
    const { width, height } = this.logicalSize();
    if (!(width > 0) || !(height > 0)) return;
    const viewRect: Rect = { x: 0, y: 0, width, height };

    // Data-driven structure comes first: how many nodes there are is settled
    // before anything asks what they look like or where they are (ZAB-31).
    this.syncRepeats();
    // The layer settles next: the focus an opening modal moves has to reach THIS
    // frame's resolve pass — otherwise `states.focused` would land one frame late.
    // An anchored entry is the one thing here that reads rects, and it reads the
    // ones already laid out (see `isOnScreen`).
    this.layer = collectLayer(this.root, this.layerPresent);
    this.syncModalFocus();
    this.syncAutoClose();
    // A control that left layout under the pointer (a tab panel switching, a
    // Collapse closing) must not keep wearing the hover state on its way back.
    if (this.hoveredNode && !inLayout(this.hoveredNode)) this.setHover(null);

    // The resolve pass walks the whole tree, overlay subtrees included: a node in
    // the layer tweens like any other, it just gets laid out and painted apart.
    this.animating = false;
    const frameTime = now();
    // Before resolve: a closing overlay is still painted for one transition, and
    // that is what keeps the resolve pass from dropping its subtree mid-fade.
    this.syncPresence(frameTime);
    this.resolve(this.root, frameTime);

    // The view's own width is the offer the constraint chain starts from — that is
    // what a Text with no explicit width wraps to.
    measure(this.root, this.measureLeaf, width);
    arrange(this.root, viewRect);
    // What the instances measured is the input the NEXT window is computed from.
    this.syncExtents();
    // The painted layer is the live one plus whatever is still fading out, in the
    // same `(z, document order)` — a closing modal keeps its place under the toast
    // that was above it.
    const paintLayer =
      this.exiting.size === 0
        ? this.layer
        : collectLayer(this.root, (node) => this.layerPresent(node) || this.exiting.has(node));
    this.paintLayer = paintLayer;
    for (const overlay of paintLayer) {
      measure(overlay, this.measureLeaf, width);
      this.arrangeOverlay(overlay, viewRect);
    }
    // After arrange, where the boxes are final: each field slides its content just
    // enough to keep its caret inside. It reads rects and writes only its own
    // scroll, so it never feeds back into the layout it just ran.
    this.eachTextInput(this.root, (field) => {
      if (inLayout(field)) this.syncTextScroll(field);
    });

    const geometry = new GeometryBuilder(globalThis.devicePixelRatio ?? 1);
    this.paint(this.root, geometry);
    // Then the layer, in `(z, document order)` — each entry is a paint root, so
    // it does not inherit the opacity of wherever it was declared, only its own
    // presence: the backdrop and the panel fade in and out together.
    for (const overlay of paintLayer) {
      this.paint(overlay, geometry, this.presence.get(overlay) ?? 1);
    }
    this.gl.draw(geometry.batches(), width, height, this.clearColor);

    // A tween in flight owns the clock: keep painting until everything settles.
    if (this.animating) this.scheduleFrame();
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
    if (!inLayout(node) && !this.exiting.has(node)) return;
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
    const style = this.effectiveStyle(node);
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
        presence: this.presence.get(overlay) ?? 1,
      })),
      focused: this.focusedNode,
      hovered: this.hoveredNode,
      pressed: this.pressedNode,
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
    const style = this.effectiveStyle(node);
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

    if (node.focused && hasSelection(node.selection)) {
      const { start, end } = span(node.selection, length(node.text));
      const from = caretX(node.text, start, atlas);
      const to = caretX(node.text, end, atlas);
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
          x: originX + caretX(node.text, node.selection.focus, atlas),
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

const KEY_DIRECTIONS: Record<string, [number, number] | undefined> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A rect's content box: the same inset the measure pass reserved for `padding`. */
function deflate(rect: Rect, padding: number): Rect {
  if (padding <= 0) return rect;
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width: Math.max(0, rect.width - padding * 2),
    height: Math.max(0, rect.height - padding * 2),
  };
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

function parseColor(hex: string): Color | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const rgb = Number.parseInt(match[1], 16);
  const alpha = match[2] !== undefined ? Number.parseInt(match[2], 16) / 255 : 1;
  return [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, alpha];
}
