/**
 * Pointer hit-testing over the laid-out tree — pure, so the rule "a clipped-away
 * child receives no input" is unit-testable without a canvas.
 *
 * Hit-testing runs on the same rects the paint pass uses (already translated by
 * any ancestor ScrollView's offset) under the same clipping regions, which is
 * what keeps `clip` honest: clipping paint only would leave invisible buttons
 * that still respond to taps (decision 2026-08-11).
 */

import { type Clip, clipContains, intersectClip, isEmptyClip } from "./clip.js";
import { contains, inFlow, type LayoutNode } from "./layout.js";

/** Resolves a node's painted corner radius (effective style + tokens live in the view). */
export type NodeRadius = (node: LayoutNode) => number;

/** A ScrollView always clips; any node opts in with `clip: true`. */
export function clipsChildren(node: LayoutNode): boolean {
  return node.ir.type === "ScrollView" || node.ir.clip === true;
}

/** The clipping region a node's children inherit (its own is `inherited`). */
export function childClip(
  node: LayoutNode,
  inherited: Clip | null,
  radiusOf: NodeRadius,
): Clip | null {
  return clipsChildren(node) ? intersectClip(inherited, node.rect, radiusOf(node)) : inherited;
}

/**
 * Deepest in-flow node under the point (later siblings win — they paint last).
 * Overlay subtrees are skipped: they belong to the layer, which `resolveHit`
 * walks first and against the view rect, not against this tree's clips.
 *
 * Children are searched even where they overflow their parent's rect: only a
 * clip cuts input, exactly as only a clip cuts paint. Bailing out on the
 * parent's rect instead — what this did before clipping existed — made an
 * overflowing child that IS painted unreachable, the same paint/input mismatch
 * as clipping paint alone, just in the opposite direction.
 */
export function hitTest(
  root: LayoutNode,
  point: { x: number; y: number },
  radiusOf: NodeRadius,
  inherited: Clip | null = null,
): LayoutNode | null {
  if (!inFlow(root) || !clipContains(inherited, point)) return null;

  const clip = childClip(root, inherited, radiusOf);
  // Outside this node's own clip: it prunes the subtree (`clip === inherited`
  // when the node doesn't clip, so this only ever costs a re-check).
  if (!isEmptyClip(clip) && clipContains(clip, point)) {
    for (let i = root.children.length - 1; i >= 0; i--) {
      const hit = hitTest(root.children[i], point, radiusOf, clip);
      if (hit) return hit;
    }
  }
  return contains(root.rect, point) ? root : null;
}

/**
 * The clipping region a node's OWN rect is subject to: the intersection of every
 * clipping ancestor. Used to re-check a press on release, where the tree walk of
 * `hitTest` would answer a different question (which node is under the pointer
 * NOW, possibly a child of the pressed one).
 *
 * The walk stops at an `Overlay`: a layer entry is laid out against the view
 * rect, so the clips of wherever it was DECLARED never apply to it — the same
 * boundary `findUp` and the paint pass draw.
 */
export function effectiveClip(node: LayoutNode, radiusOf: NodeRadius): Clip | null {
  const ancestors: LayoutNode[] = [];
  for (let current = node.parent; current; current = current.parent) {
    ancestors.push(current); // the Overlay's own clip still applies to its children
    if (current.ir.type === "Overlay") break;
  }

  let clip: Clip | null = null;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    clip = childClip(ancestors[i], clip, radiusOf);
  }
  return clip;
}
