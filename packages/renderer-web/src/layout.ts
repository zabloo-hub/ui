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

import type { Layout, ScrollAxis, ZNode } from "@zabloo/format";
import { clamp, resolveScrollMax } from "./scroll.js";
import type { TextBlock } from "./text.js";
import type { NodeAnim, ResolvedValues } from "./transition.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A layout-ready tree node (built by the view from IR nodes). */
export interface LayoutNode {
  ir: ZNode;
  parent: LayoutNode | null;
  children: LayoutNode[];
  /** Preferred size from the measure pass. */
  measured: { x: number; y: number };
  /** Final rect in view space from the arrange pass. */
  rect: Rect;
  // Runtime state owned by the renderer (same split as the Unity SDK).
  pressed: boolean;
  focused: boolean;
  open: boolean;
  /** True while this node is the chosen button of an "exclusive-select" group (a tab). */
  selected: boolean;
  /** Chosen tab index — on the group container of an "exclusive-select" group (Tabs). */
  selectedIndex: number;
  /** Toggle only: the control's value. In a group it mirrors the group's selection. */
  checked: boolean;
  /** `"exclusive-check"` group only: the selected value its options compare against. */
  groupValue: unknown;
  /** `visible` value (bound or static) — display:none semantics. */
  visibleFlag: boolean;
  /**
   * False while hidden by the parent's state: content of a closed Collapse, an
   * unselected tab panel, or the Toggle indicator slot that is off.
   */
  sectionShown: boolean;
  /** Runtime scroll position (ScrollView only) — re-clamped on every relayout. */
  scrollOffset: { x: number; y: number };
  /** Content overflow bounds for `scrollOffset`, recomputed on every relayout. */
  scrollMax: { x: number; y: number };
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
}

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

  if (node.children.length === 0) {
    const leaf = measureLeaf(node, inner);
    size = { x: leaf.x + padding * 2, y: leaf.y + padding * 2 };
  } else {
    const row = layoutOf(node)?.direction === "row";
    const gap = node.resolved.gap ?? 0;
    const offer = childWidth(node, inner);
    let main = 0;
    let cross = 0;
    let active = 0;
    for (const child of node.children) {
      if (!inFlow(child)) continue; // display:none, or lifted to the overlay layer
      const cs = measure(child, measureLeaf, offer);
      main += row ? cs.x : cs.y;
      cross = Math.max(cross, row ? cs.y : cs.x);
      active++;
    }
    main += gap * Math.max(0, active - 1) + padding * 2;
    cross += padding * 2;
    size = row ? { x: main, y: cross } : { x: cross, y: main };
  }

  // Absent = auto: the measured size stands (that is also what an unresolvable token gives).
  if (node.resolved.width !== undefined) size.x = node.resolved.width;
  if (node.resolved.height !== undefined) size.y = node.resolved.height;
  node.measured = size;
  return size;
}

/** Top-down arrange into `rect` (view space). */
export function arrange(node: LayoutNode, rect: Rect): void {
  node.rect = rect;
  const children = node.children.filter(inFlow);
  const count = children.length;
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

  const contentMain = row ? content.width : content.height;
  const contentCross = row ? content.height : content.width;

  // Main sizes: measured + grow share of the remaining space.
  const mains = new Array<number>(count);
  let totalMain = gap * (count - 1);
  let totalGrow = 0;
  for (let i = 0; i < count; i++) {
    const child = children[i];
    mains[i] = row ? child.measured.x : child.measured.y;
    totalMain += mains[i];
    totalGrow += child.ir.layout?.grow ?? 0;
  }
  let remaining = contentMain - totalMain;
  if (remaining > 0 && totalGrow > 0) {
    for (let i = 0; i < count; i++) {
      const grow = children[i].ir.layout?.grow ?? 0;
      mains[i] += remaining * (grow / totalGrow);
    }
    remaining = 0;
  }

  // Justify: distribute leftover main-axis space.
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
      if (count > 1) between = gap + leftover / (count - 1);
      break;
  }

  const isScrollView = node.ir.type === "ScrollView";
  if (isScrollView) {
    let maxNaturalCross = 0;
    for (const child of children) {
      maxNaturalCross = Math.max(maxNaturalCross, row ? child.measured.y : child.measured.x);
    }
    const direction = row ? "row" : "column";
    const mainOverflow = totalMain - contentMain;
    const crossOverflow = maxNaturalCross - contentCross;
    const axis = (node.ir as { axis?: ScrollAxis }).axis;
    node.scrollMax = resolveScrollMax(direction, axis, mainOverflow, crossOverflow);
    node.scrollOffset = {
      x: clamp(node.scrollOffset.x, 0, node.scrollMax.x),
      y: clamp(node.scrollOffset.y, 0, node.scrollMax.y),
    };
  }

  let cursor = (row ? content.x : content.y) + lead;
  for (let i = 0; i < count; i++) {
    const child = children[i];
    let crossSize = row ? child.measured.y : child.measured.x;
    let crossOffset = 0;
    switch (l?.align) {
      case "center":
        crossOffset = (contentCross - crossSize) * 0.5;
        break;
      case "end":
        crossOffset = contentCross - crossSize;
        break;
      case "stretch":
        crossSize = contentCross;
        break;
    }
    const crossPos = (row ? content.y : content.x) + crossOffset;

    const childRect: Rect = row
      ? { x: cursor, y: crossPos, width: mains[i], height: crossSize }
      : { x: crossPos, y: cursor, width: crossSize, height: mains[i] };
    if (isScrollView) {
      childRect.x -= node.scrollOffset.x;
      childRect.y -= node.scrollOffset.y;
    }
    arrange(child, childRect);
    cursor += mains[i] + between;
  }
}
