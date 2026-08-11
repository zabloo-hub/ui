/**
 * The web view — the browser sibling of the Unity SDK's ZablooView + Document:
 * builds the node tree from an envelope, owns runtime state keyed by type
 * (Button pressed, Collapse open, exclusive-open groups), resolves tokens and
 * bindings, runs the renderer's own layout pass and re-tessellates on change.
 * The browser provides a GPU canvas and pointer events — nothing else.
 */

import {
  type Envelope,
  parseEnvelope,
  type Style,
  type TokenValue,
  type ZNode,
} from "@zabloo/format";
import { ImageLibrary } from "./assets.js";
import { GLRenderer } from "./gl.js";
import { FontLibrary } from "./glyphs.js";
import { arrange, inLayout, type LayoutNode, measure, type Rect } from "./layout.js";
import { clamp } from "./scroll.js";
import { type Color, fade, GeometryBuilder } from "./tessellator.js";

const DEFAULT_FONT_SIZE = 16;

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
  open?: boolean;
  group?: string;
  autofocus?: boolean;
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

export interface MountOptions {
  /** View ID to render (default: the envelope's first view). */
  view?: string;
  /** Named actions declared in the IR (e.g. onClick: "buy") fire here. */
  onAction?: (action: string) => void;
  /** Canvas clear color (CSS hex). */
  background?: string;
}

export interface ZablooHandle {
  readonly viewIds: string[];
  /** Same loading path as the SDK: any versioned payload (dev push, hot-update). */
  reload(envelope: string | object): void;
  /** The game/page data channel — bound Text/visible react (cached + replayed). */
  setData(path: string, value: unknown): void;
  setOpen(id: string, open: boolean): boolean;
  setScroll(id: string, x: number, y: number): boolean;
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
  private readonly onAction?: (action: string) => void;

  private root!: LayoutNode;
  private byId = new Map<string, LayoutNode>();
  private visibleBindings = new Map<string, LayoutNode[]>();
  private readonly data = new Map<string, unknown>();
  private pressedNode: LayoutNode | null = null;
  private focusedNode: LayoutNode | null = null;
  private autofocusNode: LayoutNode | null = null;
  private scrollDrag: ScrollDrag | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    envelope: Envelope,
    options: MountOptions,
  ) {
    this.envelope = envelope;
    this.viewId = options.view ?? Object.keys(envelope.views)[0];
    this.onAction = options.onAction;
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
  }

  handle(): ZablooHandle {
    return {
      viewIds: Object.keys(this.envelope.views),
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
      setScroll: (id, x, y) => this.setScroll(id, x, y),
      dispose: () => {
        for (const dispose of this.disposers) dispose();
        this.images.dispose();
        this.gl.dispose();
      },
    };
  }

  // --- build ---

  private build(): void {
    const rootIr = this.envelope.views[this.viewId];
    if (!rootIr) throw new Error(`zabloo renderer: view "${this.viewId}" not found`);
    this.byId = new Map();
    this.visibleBindings = new Map();
    this.pressedNode = null;
    this.focusedNode = null;
    this.autofocusNode = null;
    this.scrollDrag = null;
    this.root = this.buildNode(rootIr, null);
    if (this.autofocusNode) this.setFocus(this.autofocusNode);
  }

  private buildNode(ir: ZNode, parent: LayoutNode | null): LayoutNode {
    const node: LayoutNode = {
      ir,
      parent,
      children: [],
      measured: { x: 0, y: 0 },
      rect: { x: 0, y: 0, width: 0, height: 0 },
      pressed: false,
      focused: false,
      open: true,
      visibleFlag: true,
      sectionShown: true,
      scrollOffset: { x: 0, y: 0 },
      scrollMax: { x: 0, y: 0 },
    };
    const any = ir as AnyNode;

    if (any.id) this.byId.set(any.id, node);
    if (any.autofocus) this.autofocusNode = node;

    const visiblePath = bindPath(any.visible);
    if (visiblePath !== null) {
      // Bound visibility: hidden until data says so (same default as the SDK).
      node.visibleFlag = isTruthy(this.data.get(visiblePath));
      pushMapList(this.visibleBindings, visiblePath, node);
    }

    for (const childIr of any.children ?? []) {
      const childAny = childIr as AnyNode;
      // Static visible:false prunes the subtree; bindings build normally.
      if (childAny.visible === false) continue;
      node.children.push(this.buildNode(childIr, node));
    }

    if (any.type === "Collapse") {
      node.open = any.open ?? true;
      this.applyOpen(node);
    }
    return node;
  }

  // --- behavior (renderer-owned, keyed by component type) ---

  private applyOpen(node: LayoutNode): void {
    for (let i = 1; i < node.children.length; i++) {
      node.children[i].sectionShown = node.open;
    }
  }

  /** Single state-mutation path (tap, setOpen — `open` bindings later). */
  private setCollapseOpen(node: LayoutNode, open: boolean): void {
    if (node.open === open) return;
    node.open = open;
    this.applyOpen(node);
    if (open) this.enforceGroup(node);
    this.render();
  }

  private enforceGroup(opened: LayoutNode): void {
    const group = (opened.parent?.ir as AnyNode | undefined)?.group;
    if (group === undefined) return;
    if (group !== "exclusive-open") {
      console.warn(`[zabloo] Unknown group behavior "${group}" — ignoring.`);
      return;
    }
    for (const sibling of opened.parent?.children ?? []) {
      if (sibling !== opened && sibling.ir.type === "Collapse" && sibling.open) {
        sibling.open = false;
        this.applyOpen(sibling);
      }
    }
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
    this.data.set(path, value);
    for (const node of this.visibleBindings.get(path) ?? []) {
      node.visibleFlag = isTruthy(value);
    }
    // Bound text is resolved at tessellation time — a render is enough.
    this.render();
  }

  // --- focus & directional navigation (decision 2026-08-03 §7) ---
  // Automatic spatial navigation from live layout rects: zero authoring cost,
  // survives relayout/hot-update/Collapse. Focusability derives from component
  // identity (Button, Collapse header); `states.focused` styles the focused node.

  private isFocusable(node: LayoutNode): boolean {
    return node.ir.type === "Button" || isCollapseHeader(node);
  }

  private collectFocusables(node: LayoutNode = this.root, out: LayoutNode[] = []): LayoutNode[] {
    if (!inLayout(node)) return out; // pruned subtrees have stale rects
    if (this.isFocusable(node)) out.push(node);
    for (const child of node.children) this.collectFocusables(child, out);
    return out;
  }

  private setFocus(node: LayoutNode | null): void {
    if (this.focusedNode === node) return;
    if (this.focusedNode) this.focusedNode.focused = false;
    this.focusedNode = node;
    if (node) node.focused = true;
  }

  /** Moves focus in a direction (unit axis): the console-UI spatial algorithm. */
  moveFocus(dx: number, dy: number): void {
    const candidates = this.collectFocusables();
    if (candidates.length === 0) return;

    const current = this.focusedNode;
    if (!current || !candidates.includes(current)) {
      this.setFocus(
        this.autofocusNode && candidates.includes(this.autofocusNode)
          ? this.autofocusNode
          : candidates[0],
      );
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

  /** Press/release the focused node (Enter/Space/gamepad-A semantics). */
  pressFocused(down: boolean): void {
    const node = this.focusedNode;
    if (!node || !inLayout(node)) return;
    if (down) {
      node.pressed = true;
      this.render();
      return;
    }
    if (!node.pressed) return;
    node.pressed = false;
    this.render();
    if (node.ir.type === "Button") {
      const action = (node.ir as AnyNode).onClick;
      if (action) this.onAction?.(action);
    } else if (node.parent) {
      this.setCollapseOpen(node.parent, !node.parent.open);
    }
  }

  // --- input (pointer → hit test on layout rects) ---

  private listen(): void {
    const down = (event: PointerEvent) => {
      const point = this.eventPoint(event);
      const hit = this.hitTest(point);
      const button = hit && this.findUp(hit, (n) => n.ir.type === "Button");
      if (button) {
        button.pressed = true;
        this.pressedNode = button;
        this.setFocus(button); // pointer and directional nav share one focus
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
      const direction = KEY_DIRECTIONS[event.key];
      if (direction) {
        event.preventDefault();
        this.moveFocus(direction[0], direction[1]);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!event.repeat) this.pressFocused(true);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") this.pressFocused(false);
    };
    const up = (event: PointerEvent) => {
      const point = this.eventPoint(event);
      const pressed = this.pressedNode;
      if (pressed) {
        pressed.pressed = false;
        this.pressedNode = null;
        this.render();
        if (contains(pressed.rect, point)) {
          const action = (pressed.ir as AnyNode).onClick;
          if (action) this.onAction?.(action);
        }
        return;
      }
      const drag = this.scrollDrag;
      this.scrollDrag = null;
      if (drag?.moved) return; // a scroll gesture, not a tap
      // Collapse header toggle (the <details>/<summary> model).
      const hit = this.hitTest(point);
      const header = hit && this.findUp(hit, isCollapseHeader);
      if (header?.parent) this.setCollapseOpen(header.parent, !header.parent.open);
    };
    const wheel = (event: WheelEvent) => {
      const hit = this.hitTest(this.eventPoint(event));
      const scrollable = hit && this.findUp(hit, (n) => n.ir.type === "ScrollView");
      if (!scrollable) return;
      event.preventDefault();
      this.setScrollOffset(
        scrollable,
        scrollable.scrollOffset.x + event.deltaX,
        scrollable.scrollOffset.y + event.deltaY,
      );
    };
    const resize = () => this.resize();

    this.canvas.addEventListener("pointerdown", down);
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("wheel", wheel, { passive: false });
    globalThis.addEventListener("keydown", keydown);
    globalThis.addEventListener("keyup", keyup);
    globalThis.addEventListener("resize", resize);
    this.disposers.push(() => {
      this.canvas.removeEventListener("pointerdown", down);
      this.canvas.removeEventListener("pointermove", move);
      this.canvas.removeEventListener("pointerup", up);
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

  /** Deepest in-layout node under the point (later siblings win). */
  private hitTest(
    point: { x: number; y: number },
    node: LayoutNode = this.root,
  ): LayoutNode | null {
    if (!inLayout(node) || !contains(node.rect, point)) return null;
    for (let i = node.children.length - 1; i >= 0; i--) {
      const hit = this.hitTest(point, node.children[i]);
      if (hit) return hit;
    }
    return node;
  }

  private findUp(node: LayoutNode, predicate: (n: LayoutNode) => boolean): LayoutNode | null {
    let current: LayoutNode | null = node;
    while (current) {
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

  private color(value: unknown, fallback: Color): Color {
    const resolved = this.token(value);
    return (typeof resolved === "string" && parseColor(resolved)) || fallback;
  }

  private effectiveStyle(node: LayoutNode): Style | undefined {
    const any = node.ir as AnyNode;
    let style = any.style;
    // Merge order: base → focused → pressed (pressed wins while held).
    if (node.focused && any.states?.focused?.style)
      style = { ...style, ...any.states.focused.style };
    if (node.pressed && any.states?.pressed?.style)
      style = { ...style, ...any.states.pressed.style };
    return style;
  }

  private fontSize(style: Style | undefined): number {
    return Math.max(1, Math.round(this.dim(style?.fontSize, DEFAULT_FONT_SIZE)));
  }

  private resolveText(ir: ZNode): string {
    const raw = (ir as AnyNode).text;
    if (typeof raw === "string") return raw;
    const path = bindPath(raw);
    if (path !== null) return formatValue(this.data.get(path));
    return "";
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

  render(): void {
    const { width, height } = this.logicalSize();
    if (!(width > 0) || !(height > 0)) return;

    measure(this.root, this.dim, (ir) => {
      if (ir.type === "Text") {
        const atlas = this.fonts.get(this.fontSize((ir as AnyNode).style));
        return atlas.measure(this.resolveText(ir));
      }
      if (ir.type === "Image") {
        // Intrinsic size straight from the manifest — no decode needed, so the
        // image occupies its space from the very first frame.
        const asset = this.images.get((ir as AnyNode).src);
        return asset ? { x: asset.width, y: asset.height } : { x: 0, y: 0 };
      }
      return { x: 0, y: 0 };
    });
    arrange(this.root, { x: 0, y: 0, width, height }, this.dim);

    const geometry = new GeometryBuilder(globalThis.devicePixelRatio ?? 1);
    this.paint(this.root, geometry);
    this.gl.draw(geometry.batches(), width, height, this.clearColor);
  }

  private paint(node: LayoutNode, geometry: GeometryBuilder, parentOpacity = 1): void {
    if (!inLayout(node)) return;
    const style = this.effectiveStyle(node);

    // Opacity inherits multiplicatively down the subtree (per-vertex alpha;
    // not render-to-texture group opacity — decision 2026-08-06).
    const opacity = Math.min(1, Math.max(0, style?.opacity ?? 1)) * parentOpacity;
    if (opacity <= 0) return; // invisible — but still occupies layout

    if (style?.background !== undefined) {
      geometry.roundedRect(
        node.rect,
        this.dim(style.radius),
        fade(this.color(style.background, [1, 0, 1, 1]), opacity),
      );
    }
    const borderWidth = this.dim(style?.borderWidth);
    if (borderWidth > 0) {
      geometry.roundedRectBorder(
        node.rect,
        this.dim(style?.radius),
        borderWidth,
        fade(this.color(style?.borderColor, [1, 0, 1, 1]), opacity),
      );
    }
    if (node.ir.type === "Text") {
      const atlas = this.fonts.get(this.fontSize(style));
      geometry.text(
        node.rect.x,
        node.rect.y,
        this.resolveText(node.ir),
        atlas,
        fade(this.color(style?.color, [1, 1, 1, 1]), opacity),
      );
    } else if (node.ir.type === "Image") {
      const asset = this.images.get((node.ir as AnyNode).src);
      if (asset) geometry.image(node.rect, asset, opacity);
    }
    for (const child of node.children) this.paint(child, geometry, opacity);
  }
}

// --- helpers ---

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

function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function bindPath(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "bind" in value) {
    const path = (value as { bind: unknown }).bind;
    if (typeof path === "string" && path.length > 0) return path;
  }
  return null;
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

function pushMapList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function parseColor(hex: string): Color | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const rgb = Number.parseInt(match[1], 16);
  const alpha = match[2] !== undefined ? Number.parseInt(match[2], 16) / 255 : 1;
  return [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, alpha];
}
