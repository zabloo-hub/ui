/**
 * The web renderer's flexbox pass — the v1 Yoga subset (direction, justify,
 * align, gap, padding, width/height, grow), same semantics as the Unity SDK's
 * FlexLayout (runtime layout in the renderer; the browser's layout engine is
 * never used — golden rule: the core owns layout).
 *
 * It resolves no tokens: the view runs its resolve pass first and leaves the
 * final numbers in `node.resolved`, which is also where a running transition
 * writes its interpolated dims. Layout is pure geometry over resolved inputs.
 */

import type { ItemScope, Layout, ScrollAxis, SliderAxis, ZNode } from "@zabloo/format";
import { fillRect } from "./progress.js";
import type { ItemSpan } from "./repeat.js";
import { clamp, resolveScrollMax } from "./scroll.js";
import { fractionOf, growsUpward, resolveRange, sliderGeometry } from "./slider.js";
import type { TextBlock } from "./text.js";
import { caretAt, type Selection } from "./textinput.js";
import { createNodeAnim, type NodeAnim, type ResolvedValues } from "./transition.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A `Repeat`'s runtime state (ZAB-31) — the instances it has realized, keyed by
 * the identity of the item they show, plus the uniform size the virtualization
 * assumes. Owned by the view; layout only ever reads `virtual`.
 */
export interface RepeatState {
  /** Live template instances, by `itemIdentity` — this is what reordering moves. */
  instances: Map<string, LayoutNode>;
  /** The empty-state slot (`children[1..]`), built once and kept out of layout. */
  empty: LayoutNode[];
  /** One line's measured size on the stacking axis, or null until a frame measured it. */
  extent: number | null;
  /** One item's measured size on the main axis — what decides how many fit per line. */
  itemMain: number | null;
  /** The width those two were measured at: another one means they are stale. */
  measuredWidth: number | null;
  /** Elements in the bound array on the last expansion. */
  itemCount: number;
  /** The window that expansion realized — what the next frame's plan is compared against. */
  first: number;
  count: number;
}

/** A layout-ready tree node (built by the view from IR nodes). */
export interface LayoutNode {
  ir: ZNode;
  parent: LayoutNode | null;
  children: LayoutNode[];
  /** Preferred size from the measure pass. */
  measured: { x: number; y: number };
  /**
   * The size the measure pass computed from the CONTENT, before a declared
   * `width`/`height` (or a behavior's override) replaced it. The Collapse's
   * motion reads it: it is the only honest source for "how tall is this with the
   * content in", and it costs nothing to keep — measure computes it anyway.
   */
  natural: { x: number; y: number };
  /** Final rect in view space from the arrange pass. */
  rect: Rect;
  // Runtime state owned by the renderer (same split as the Unity SDK).
  pressed: boolean;
  /** Under the pointer — mouse-only, so it never gates anything a gamepad needs. */
  hovered: boolean;
  focused: boolean;
  open: boolean;
  /** True while this node is the chosen button of an "exclusive-select" group (a tab). */
  selected: boolean;
  /** Chosen tab index — on the group container of an "exclusive-select" group (Tabs). */
  selectedIndex: number;
  /** Toggle only: the control's value. In a group it mirrors the group's selection. */
  checked: boolean;
  /**
   * Toggle only: this frame's crossfade between the indicator slots (0 unchecked,
   * 1 checked), tweened by the view. The slots share a box, so this is what tells
   * them apart.
   */
  checkedProgress: number;
  /** Slider only: the runtime value, already clamped and quantized to its range. */
  sliderValue: number;
  /**
   * Slider only: the value this frame PAINTS, which trails `sliderValue` while a
   * bound change glides into place. The gesture writes both at once — a thumb
   * under the finger is never interpolated.
   */
  sliderDisplay: number;
  /** `"exclusive-check"` group only: the selected value its options compare against. */
  groupValue: unknown;
  /** `visible` value (bound or static) — display:none semantics. */
  visibleFlag: boolean;
  /** This node's OWN `disabled` value (bound or static) — never an ancestor's. */
  disabledFlag: boolean;
  /**
   * Effective `disabled` (ZAB-63): this node's own value OR any ancestor's, which
   * is what the interaction model and `states.disabled` both read. Computed
   * top-down by the resolve pass, like the clip a node inherits — the flag on a
   * form section is the one that answers for every control inside it.
   */
  disabled: boolean;
  /**
   * False while hidden by the parent's state: content of a closed Collapse, an
   * unselected tab panel, or the Toggle indicator slot that is off.
   */
  sectionShown: boolean;
  /**
   * ProgressBar only: this frame's fraction (0..1), already clamped and tweened by
   * the view. The fill's main size derives from it — the bar interpolates its value,
   * never its rect.
   */
  progress: number;
  /**
   * Collapse only: true while the height tween runs. The content stays in layout
   * (and the box clips) for exactly that long — that is what the open/close
   * motion is made of.
   */
  collapseAnimating: boolean;
  /**
   * Collapse only: set when the content has just entered layout and its height
   * has not been measured yet. The frame it is true, the box holds shut.
   */
  collapsePending: boolean;
  /**
   * Clipping a behavior turns on for this frame, on top of the node's declared
   * `clip` — the Collapse cutting its content down to a box that is closing.
   */
  forcedClip: boolean;
  /**
   * Spinner only: when its loop started, or `null` while it has never been in
   * layout. Leaving layout clears it, so a spinner that comes back starts its wave
   * from the trough instead of jumping into the middle of a cycle.
   */
  loopStartedAt: number | null;
  /**
   * `Overlay` with `anchor.trigger: "press"` only: whether the popover is open
   * (decision 2026-08-12, ZAB-25). Runtime state the renderer owns, like the
   * Collapse's `open` — the anchor's press toggles it, and a dismiss or a
   * selection inside closes it. Every other overlay ignores it: what puts those
   * in the layer is `visible`.
   */
  popoverOpen: boolean;
  /** Runtime scroll position (ScrollView only) — re-clamped on every relayout. */
  scrollOffset: { x: number; y: number };
  /** Content overflow bounds for `scrollOffset`, recomputed on every relayout. */
  scrollMax: { x: number; y: number };
  /** TextInput only: the runtime text buffer (the value the player is editing). */
  text: string;
  /** TextInput only: true while `text` is empty — the `empty` state (ZAB-26). */
  empty: boolean;
  /** TextInput only: the caret, and the selection when its two ends differ. */
  selection: Selection;
  /**
   * TextInput only: how far the content is scrolled left to keep the caret in the
   * box. The field's own state, like the ScrollView's offset — it is never authored.
   */
  textScroll: number;
  /**
   * TextInput only: when the caret's blink cycle last restarted (every edit and
   * every caret move restarts it, so the caret is solid while typing). Null while
   * the field has never been focused.
   */
  caretSince: number | null;
  /**
   * This frame's animatable values, tokens resolved and transitions applied — the
   * inputs both this pass and paint read. Rewritten by the view's resolve pass.
   */
  resolved: ResolvedValues;
  /**
   * `Text` only: the lines this frame's measure pass broke the content into, kept
   * so paint does not wrap a second time (text is measured once per frame, with the
   * width the flexbox offered). Null on every other node type.
   */
  textBlock: TextBlock | null;
  /** Tweens in flight for this node. Rebuilding the tree drops them, so a reload snaps. */
  anim: NodeAnim;
  /**
   * The item scopes in effect for this node, innermost last (decision 2026-08-11,
   * ZAB-29) — empty outside a `Repeat` template. Every binding of the node resolves
   * against it, which is what makes `{bind: "item.name"}` an address into the array.
   */
  scopes: readonly ItemScope[];
  /** `Repeat` only: its instances and the geometry they are windowed by. */
  repeat: RepeatState | null;
  /**
   * `Repeat` only: the realized window and the space that stands in for the rest.
   * Null when the node is not virtualized (no scroller to window against, or an
   * array short enough to realize whole), and then it lays out like any container.
   */
  virtual: ItemSpan | null;
}

/**
 * A fresh node in the state a mount starts from: nothing measured, no state on,
 * no tween in flight (which is why a mount — and a reload — snaps). The shape
 * lives with the type it belongs to, so the view and the tests build it the same
 * way and adding runtime state is one edit, not four.
 */
export function createLayoutNode(ir: ZNode, parent: LayoutNode | null = null): LayoutNode {
  return {
    ir,
    parent,
    children: [],
    measured: { x: 0, y: 0 },
    natural: { x: 0, y: 0 },
    rect: { x: 0, y: 0, width: 0, height: 0 },
    pressed: false,
    hovered: false,
    focused: false,
    open: true,
    selected: false,
    selectedIndex: 0,
    checked: false,
    checkedProgress: 0,
    sliderValue: 0,
    sliderDisplay: 0,
    groupValue: undefined,
    visibleFlag: true,
    disabledFlag: false,
    disabled: false,
    sectionShown: true,
    progress: 0,
    collapseAnimating: false,
    collapsePending: false,
    forcedClip: false,
    loopStartedAt: null,
    popoverOpen: false,
    scrollOffset: { x: 0, y: 0 },
    scrollMax: { x: 0, y: 0 },
    text: "",
    empty: true,
    selection: caretAt(0),
    textScroll: 0,
    caretSince: null,
    resolved: {},
    textBlock: null,
    anim: createNodeAnim(),
    scopes: NO_SCOPES,
    repeat: null,
    virtual: null,
  };
}

/** The scopes of a node outside every template — shared, and never written to. */
const NO_SCOPES: readonly ItemScope[] = [];

export function inLayout(node: LayoutNode): boolean {
  return node.visibleFlag && node.sectionShown;
}

/**
 * Whether a node participates in its parent's flow. An `Overlay` never does
 * (decision 2026-08-11): it is declared in place but belongs to the view's
 * overlay layer, so it is neither measured nor arranged by its parent — the view
 * lays it out afterwards against the view rect. Two consequences come for free:
 * `layout.width`/`height` on an Overlay are ignored, and an Overlay inside a
 * `ScrollView` does not scroll with the content.
 */
export function inFlow(node: LayoutNode): boolean {
  return inLayout(node) && node.ir.type !== "Overlay";
}

/**
 * The boxes a node lays its children into: one per in-flow child, EXCEPT a
 * Toggle's two indicator slots, which share one (decision 2026-08-11, ZAB-36).
 *
 * They are alternatives of the same thing — the checked and unchecked look of
 * one indicator — so laying them on top of each other instead of one after the
 * other is what turns the swap into a crossfade the transition engine can drive.
 * The shared box is as big as the larger slot, so the control does not resize
 * when it flips, and everything after them (the label) flows on as usual.
 */
export function flowItems(node: LayoutNode): LayoutNode[][] {
  const items: LayoutNode[][] = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!inFlow(child)) continue; // display:none, or lifted to the overlay layer
    const previous = items[items.length - 1];
    if (node.ir.type === "Toggle" && i === 1 && previous?.[0] === node.children[0]) {
      previous.push(child);
      continue;
    }
    items.push([child]);
  }
  return items;
}

export function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Sizes a childless node against the width it may use — `null` when that width is
 * unconstrained, which is what tells a `Text` not to wrap.
 */
export type MeasureLeaf = (
  node: LayoutNode,
  availableWidth: number | null,
) => {
  x: number;
  y: number;
};

function layoutOf(node: LayoutNode): Layout | undefined {
  return node.ir.layout;
}

/**
 * The width a node's children may use. A `ScrollView` offers nothing on a scrollable
 * axis: its children are measured unconstrained there (that is what makes the content
 * overflow the viewport and scroll), so a horizontal scroller never wraps its text.
 */
function childWidth(node: LayoutNode, inner: number | null): number | null {
  if (node.ir.type !== "ScrollView") return inner;
  const axis = (node.ir as { axis?: ScrollAxis }).axis ?? "vertical";
  return axis === "vertical" ? inner : null;
}

/**
 * Whether a node breaks its children into several lines (decision 2026-08-11,
 * ZAB-32 — a grid IS a row that wraps). `wrap` only takes effect on a ROW: the
 * measure pass carries a width offer and nothing else, so a column has no length
 * to break against and lays its children out on one line — the same degradation
 * an SDK that predates the flag gives.
 */
export function wrapsLines(node: LayoutNode): boolean {
  const layout = layoutOf(node);
  return layout?.wrap === true && layout.direction === "row";
}

/**
 * Groups children into the lines they lay out on, greedy first-fit — the same
 * rule `itemsPerLine` computes ahead of time for a virtualized grid, which is why
 * a realized window breaks exactly where its window assumed it would (a
 * virtualized node caps the line at `virtual.perLine` so the two can never drift).
 * Without `wrap` there is a single line: what every node emitted before ZAB-32
 * assumes, and the reason nothing else in the pass had to change.
 */
function breakLines(
  node: LayoutNode,
  mains: readonly number[],
  contentMain: number | null,
  gap: number,
): number[][] {
  const cap = node.virtual?.perLine ?? null;
  if (!wrapsLines(node) || (contentMain === null && cap === null)) {
    return [mains.map((_, index) => index)];
  }
  const lines: number[][] = [];
  let line: number[] = [];
  let used = 0;
  for (let index = 0; index < mains.length; index++) {
    const needed = line.length === 0 ? mains[index] : used + gap + mains[index];
    const full = cap !== null && line.length >= cap;
    if (line.length > 0 && (full || (contentMain !== null && needed > contentMain))) {
      lines.push(line);
      line = [];
      used = 0;
    }
    used = line.length === 0 ? mains[index] : used + gap + mains[index];
    line.push(index);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * The size the children take as a whole: the longest line on the main axis, the
 * lines stacked on the cross one. A virtualized `Repeat` overrides the axis its
 * lines stack on with the space of the WHOLE array — the realized window is a
 * fraction of it, and the scroll bounds must not depend on how much is realized.
 */
function flowSize(
  node: LayoutNode,
  lines: readonly number[][],
  mains: readonly number[],
  crosses: readonly number[],
  gap: number,
): { main: number; cross: number } {
  let main = 0;
  let cross = 0;
  for (const line of lines) {
    let lineMain = gap * Math.max(0, line.length - 1);
    let lineCross = 0;
    for (const index of line) {
      lineMain += mains[index];
      lineCross = Math.max(lineCross, crosses[index]);
    }
    main = Math.max(main, lineMain);
    cross += lineCross;
  }
  cross += gap * Math.max(0, lines.length - 1);
  const span = node.virtual;
  if (span) {
    if (wrapsLines(node)) cross = span.reserved;
    else main = span.reserved;
  }
  return { main, cross };
}

/**
 * Bottom-up measure. `measureLeaf` sizes childless nodes (Text, Image).
 *
 * `availableWidth` is the width the parent offers (the view's own width at the root,
 * `null` for unconstrained): a node's `layout.width`, when declared, REPLACES the
 * offer, and what is left after its padding flows down to every child — in a row as
 * much as in a column, since v1 measures no cross-child competition for it. Only the
 * leaves use it: it is the width a `Text` wraps to (decision 2026-08-11, ZAB-17).
 */
export function measure(
  node: LayoutNode,
  measureLeaf: MeasureLeaf,
  availableWidth: number | null = null,
): { x: number; y: number } {
  const padding = node.resolved.padding ?? 0;
  const own = node.resolved.width ?? availableWidth;
  const inner = own === null ? null : Math.max(0, own - padding * 2);
  let size: { x: number; y: number };

  if (node.ir.type === "Slider") {
    // A Slider measures as a LEAF: the rail's length and thickness are its own
    // layout props, never the sum of its slots (a 18px thumb must not define a
    // 220px track). The slots are still measured — the thumb's own size is what
    // the value-driven arrange positions — they just do not add up.
    for (const child of node.children) measure(child, measureLeaf, inner);
    size = { x: padding * 2, y: padding * 2 };
  } else if (node.children.length === 0) {
    const leaf = measureLeaf(node, inner);
    size = { x: leaf.x + padding * 2, y: leaf.y + padding * 2 };
  } else {
    const row = layoutOf(node)?.direction === "row";
    const gap = node.resolved.gap ?? 0;
    const offer = childWidth(node, inner);
    const items = flowItems(node);
    const mains: number[] = [];
    const crosses: number[] = [];
    for (const item of items) {
      // Every member is measured; a shared box takes the largest of them.
      let itemMain = 0;
      let itemCross = 0;
      for (const child of item) {
        const cs = measure(child, measureLeaf, offer);
        itemMain = Math.max(itemMain, row ? cs.x : cs.y);
        itemCross = Math.max(itemCross, row ? cs.y : cs.x);
      }
      mains.push(itemMain);
      crosses.push(itemCross);
    }
    const flow = flowSize(node, breakLines(node, mains, inner, gap), mains, crosses, gap);
    size = row
      ? { x: flow.main + padding * 2, y: flow.cross + padding * 2 }
      : { x: flow.cross + padding * 2, y: flow.main + padding * 2 };
  }

  // What the content asks for, kept before any override replaces it: the
  // Collapse's motion needs "how tall is this with the content in".
  node.natural = { x: size.x, y: size.y };
  // Absent = auto: the measured size stands (that is also what an unresolvable token gives).
  if (node.resolved.width !== undefined) size.x = node.resolved.width;
  if (node.resolved.height !== undefined) size.y = node.resolved.height;
  node.measured = size;
  return size;
}

/** Top-down arrange into `rect` (view space). */
export function arrange(node: LayoutNode, rect: Rect): void {
  node.rect = rect;
  if (node.ir.type === "Slider") {
    arrangeSlider(node, rect);
    return;
  }
  const items = flowItems(node);
  const count = items.length;
  if (count === 0) return;

  const l = layoutOf(node);
  const row = l?.direction === "row";
  const padding = node.resolved.padding ?? 0;
  const gap = node.resolved.gap ?? 0;
  const content: Rect = {
    x: rect.x + padding,
    y: rect.y + padding,
    width: Math.max(0, rect.width - padding * 2),
    height: Math.max(0, rect.height - padding * 2),
  };

  // The ProgressBar owns its child's main size (the fraction), so it never goes
  // through the flex distribution: its fill's own width/height/grow are ignored on
  // that axis by construction, and `justify` still anchors the bar (decision
  // 2026-08-11, ZAB-35). Children beyond the fill are out of layout already.
  if (node.ir.type === "ProgressBar") {
    const fill = items[0][0];
    if (fill) arrange(fill, fillRect(content, row, node.progress, l?.justify));
    return;
  }

  const contentMain = row ? content.width : content.height;
  const contentCross = row ? content.height : content.width;

  // Sizes per ITEM: a shared box takes the largest of the nodes in it.
  const measuredMains = new Array<number>(count);
  const measuredCrosses = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    measuredMains[i] = itemSize(items[i], row);
    measuredCrosses[i] = itemSize(items[i], !row);
  }
  const lines = breakLines(node, measuredMains, contentMain, gap);

  const isScrollView = node.ir.type === "ScrollView";
  if (isScrollView) {
    const flow = flowSize(node, lines, measuredMains, measuredCrosses, gap);
    const axis = (node.ir as { axis?: ScrollAxis }).axis;
    node.scrollMax = resolveScrollMax(
      row ? "row" : "column",
      axis,
      flow.main - contentMain,
      flow.cross - contentCross,
    );
    node.scrollOffset = {
      x: clamp(node.scrollOffset.x, 0, node.scrollMax.x),
      y: clamp(node.scrollOffset.y, 0, node.scrollMax.y),
    };
  }

  // A virtualized node starts its flow past the lines it did not realize, on the
  // axis those lines stack on — which is the cross axis when it wraps.
  const wrapping = wrapsLines(node);
  const span = node.virtual;
  let crossCursor = (row ? content.y : content.x) + (wrapping && span ? span.lead : 0);
  const mainLead = (row ? content.x : content.y) + (!wrapping && span ? span.lead : 0);

  for (const line of lines) {
    // Main sizes: measured + grow share of the space left ON THIS LINE (`grow` is
    // per line — the leftovers of a line are shared between the items on it), and
    // a shared box grows by its FIRST member's `grow`: the slots of a Toggle are
    // one item, so they can only ever grow as one.
    const mains = new Array<number>(line.length);
    let totalMain = gap * (line.length - 1);
    let totalGrow = 0;
    for (let i = 0; i < line.length; i++) {
      mains[i] = measuredMains[line[i]];
      totalMain += mains[i];
      totalGrow += items[line[i]][0].ir.layout?.grow ?? 0;
    }
    let remaining = contentMain - totalMain;
    if (remaining > 0 && totalGrow > 0) {
      for (let i = 0; i < line.length; i++) {
        const grow = items[line[i]][0].ir.layout?.grow ?? 0;
        mains[i] += remaining * (grow / totalGrow);
      }
      remaining = 0;
    }

    // Justify: distribute leftover main-axis space, within the line.
    let lead = 0;
    let between = gap;
    const leftover = Math.max(0, remaining);
    switch (l?.justify) {
      case "center":
        lead = leftover * 0.5;
        break;
      case "end":
        lead = leftover;
        break;
      case "space-between":
        if (line.length > 1) between = gap + leftover / (line.length - 1);
        break;
    }

    // A single line owns the whole cross axis (`align: stretch` fills the node);
    // wrapped lines own only what their tallest item takes, and stack from the
    // start — how the lines themselves distribute is out of the subset (ZAB-32).
    let lineCross = contentCross;
    if (wrapping) {
      lineCross = 0;
      for (const index of line) lineCross = Math.max(lineCross, measuredCrosses[index]);
    }

    let cursor = mainLead + lead;
    for (let i = 0; i < line.length; i++) {
      const item = items[line[i]];
      let crossSize = measuredCrosses[line[i]];
      let crossOffset = 0;
      switch (l?.align) {
        case "center":
          crossOffset = (lineCross - crossSize) * 0.5;
          break;
        case "end":
          crossOffset = lineCross - crossSize;
          break;
        case "stretch":
          crossSize = lineCross;
          break;
      }
      const crossPos = crossCursor + crossOffset;

      const childRect: Rect = row
        ? { x: cursor, y: crossPos, width: mains[i], height: crossSize }
        : { x: crossPos, y: cursor, width: crossSize, height: mains[i] };
      if (isScrollView) {
        childRect.x -= node.scrollOffset.x;
        childRect.y -= node.scrollOffset.y;
      }
      // Every member of the item gets the SAME rect: that is what "shared box" means.
      for (const child of item) arrange(child, childRect);
      cursor += mains[i] + between;
    }
    crossCursor += lineCross + gap;
  }
}

/** An item's size along an axis: the largest of the nodes sharing its box. */
function itemSize(item: LayoutNode[], row: boolean): number {
  let size = 0;
  for (const child of item) size = Math.max(size, row ? child.measured.x : child.measured.y);
  return size;
}

/**
 * The Slider's own arrange (decision 2026-08-11, ZAB-24): the node IS the track,
 * and its two positional slots are placed from the VALUE instead of by the flex
 * pass — `children[0]` (the fill) spans the value's fraction of the rail and
 * `children[1]` (the thumb) rides the travel, inset by half its own size so it
 * never paints outside the node's rect.
 *
 * Both slots keep their measured size across the track (a thin rail with a fat
 * thumb is the normal case) and are centered on it; `padding` insets the rail,
 * like it does everywhere else. A vertical slider runs bottom-to-top.
 */
function arrangeSlider(node: LayoutNode, rect: Rect): void {
  const padding = node.resolved.padding ?? 0;
  const horizontal = !growsUpward((node.ir as { axis?: SliderAxis }).axis);
  const content: Rect = {
    x: rect.x + padding,
    y: rect.y + padding,
    width: Math.max(0, rect.width - padding * 2),
    height: Math.max(0, rect.height - padding * 2),
  };
  const length = horizontal ? content.width : content.height;
  const across = horizontal ? content.height : content.width;

  const ir = node.ir as { min?: number; max?: number; step?: number };
  // The PAINTED value, which trails the logical one while a bound change glides
  // in — the same rule as the ProgressBar: the value is tweened, never the rect.
  const fraction = fractionOf(node.sliderDisplay, resolveRange(ir.min, ir.max, ir.step));

  const [fill, thumb] = node.children;
  const thumbSize = thumb ? Math.min(mainSize(thumb, horizontal), length) : 0;
  const geometry = sliderGeometry(fraction, length, thumbSize);

  // `start` runs along the axis from the rail's beginning; on a vertical track
  // that beginning is the BOTTOM, so it is mirrored into view space.
  const place = (child: LayoutNode, start: number, size: number): void => {
    // Centered across the rail, at its OWN size: the usual slider is a fat thumb
    // on a thin rail, so the thumb overflows its parent on the cross axis — which
    // is ordinary here (a `clip` is the only thing that cuts paint or input, ZAB-7).
    const crossSize = crossOf(child, horizontal, across);
    const crossPos = (horizontal ? content.y : content.x) + (across - crossSize) / 2;
    arrange(
      child,
      horizontal
        ? { x: content.x + start, y: crossPos, width: size, height: crossSize }
        : { x: crossPos, y: content.y + length - start - size, width: crossSize, height: size },
    );
  };

  if (fill && inFlow(fill)) place(fill, 0, geometry.fillLength);
  if (thumb && inFlow(thumb)) place(thumb, geometry.thumbStart, thumbSize);
  // Extra children are not part of the contract: they would have no defined
  // position, so they are left where they are (measured, never arranged).
}

function mainSize(node: LayoutNode, horizontal: boolean): number {
  return horizontal ? node.measured.x : node.measured.y;
}

/** A slot's size across the rail — its own if it declared one, else the full rail. */
function crossOf(node: LayoutNode, horizontal: boolean, fallback: number): number {
  const declared = horizontal ? node.ir.layout?.height : node.ir.layout?.width;
  if (declared === undefined) return fallback;
  return horizontal ? node.measured.y : node.measured.x;
}
