/**
 * The web renderer's flexbox pass — the v1 Yoga subset (direction, justify,
 * align, gap, padding, width/height, grow), same semantics as the Unity SDK's
 * FlexLayout (runtime layout in the renderer; the browser's layout engine is
 * never used — golden rule: the core owns layout).
 */

import type { Layout, ScrollAxis, ZNode } from "@zabloo/format";
import { clamp, resolveScrollMax } from "./scroll.js";

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
  /** Toggle only: the control's value. In a group it mirrors the group's selection. */
  checked: boolean;
  /** `"exclusive-check"` group only: the selected value its options compare against. */
  groupValue: unknown;
  /** `visible` value (bound or static) — display:none semantics. */
  visibleFlag: boolean;
  /** False while hidden by the parent's state: content of a closed Collapse, or the Toggle indicator slot that is off. */
  sectionShown: boolean;
  /** Runtime scroll position (ScrollView only) — re-clamped on every relayout. */
  scrollOffset: { x: number; y: number };
  /** Content overflow bounds for `scrollOffset`, recomputed on every relayout. */
  scrollMax: { x: number; y: number };
}

export function inLayout(node: LayoutNode): boolean {
  return node.visibleFlag && node.sectionShown;
}

export type TokenDim = (value: unknown, fallback?: number) => number;
export type MeasureLeaf = (ir: ZNode) => { x: number; y: number };

function layoutOf(node: LayoutNode): Layout | undefined {
  return node.ir.layout;
}

/** Bottom-up measure. `measureLeaf` sizes childless nodes (Text). */
export function measure(
  node: LayoutNode,
  dim: TokenDim,
  measureLeaf: MeasureLeaf,
): { x: number; y: number } {
  const l = layoutOf(node);
  const padding = dim(l?.padding);
  let size: { x: number; y: number };

  if (node.children.length === 0) {
    const leaf = measureLeaf(node.ir);
    size = { x: leaf.x + padding * 2, y: leaf.y + padding * 2 };
  } else {
    const row = l?.direction === "row";
    const gap = dim(l?.gap);
    let main = 0;
    let cross = 0;
    let active = 0;
    for (const child of node.children) {
      if (!inLayout(child)) continue; // display:none — out of layout
      const cs = measure(child, dim, measureLeaf);
      main += row ? cs.x : cs.y;
      cross = Math.max(cross, row ? cs.y : cs.x);
      active++;
    }
    main += gap * Math.max(0, active - 1) + padding * 2;
    cross += padding * 2;
    size = row ? { x: main, y: cross } : { x: cross, y: main };
  }

  if (l?.width !== undefined) size.x = dim(l.width, size.x);
  if (l?.height !== undefined) size.y = dim(l.height, size.y);
  node.measured = size;
  return size;
}

/** Top-down arrange into `rect` (view space). */
export function arrange(node: LayoutNode, rect: Rect, dim: TokenDim): void {
  node.rect = rect;
  const children = node.children.filter(inLayout);
  const count = children.length;
  if (count === 0) return;

  const l = layoutOf(node);
  const row = l?.direction === "row";
  const padding = dim(l?.padding);
  const gap = dim(l?.gap);
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
    arrange(child, childRect, dim);
    cursor += mains[i] + between;
  }
}
