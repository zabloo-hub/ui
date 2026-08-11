/**
 * The overlay layer: how `Overlay` nodes leave the tree's flow and become ONE
 * layer above the view (decision 2026-08-11, ZAB-19), and what that does to
 * input and focus. Everything here is pure tree/rect math over layout nodes —
 * no canvas, no DOM, no timers — so the layering rules are unit tested without a
 * browser (same split as `scroll.ts`, `select.ts` and `toggle.ts`).
 *
 * The three rules it encodes:
 * - **Paint:** the whole tree first, then every visible Overlay of the view in
 *   `(z, document order)`. Nested overlays flatten into the same layer.
 * - **Input:** the layer is hit-tested top-down before the tree. A `modal`
 *   overlay CAPTURES — nothing below it (lower overlays included) sees the
 *   event, and a point that lands on no child of it is a tap on the backdrop.
 *   A non-modal one is inert: only its children take events.
 * - **Focus:** the trap derives from `modal` — while a modal is up, only its
 *   subtree offers navigation candidates.
 */

import { childClip, hitTest, type NodeRadius } from "./hit.js";
import { contains, inLayout, type LayoutNode } from "./layout.js";

export interface Point {
  x: number;
  y: number;
}

/** An Overlay's layer props with the IR defaults applied. */
export interface OverlaySpec {
  /** Captures input below and confines focus. Default: true. */
  modal: boolean;
  /** Order inside the layer; ties break by document order. Default: 0. */
  z: number;
  /** Named action fired on a dismiss request. */
  onDismiss?: string;
  /** Self-dismiss delay in ms, once it is in the layer. Absent = stays up. */
  autoCloseMs?: number;
}

/** The layer props of an Overlay node, or null for anything else. */
export function overlaySpec(node: LayoutNode): OverlaySpec | null {
  const ir = node.ir;
  if (ir.type !== "Overlay") return null;
  return {
    modal: ir.modal !== false,
    z: numberOr(ir.z, 0),
    onDismiss: ir.onDismiss,
    // A non-positive timeout is a typo, not "close immediately".
    autoCloseMs: positiveOr(ir.autoCloseMs),
  };
}

export function isModal(node: LayoutNode): boolean {
  return overlaySpec(node)?.modal === true;
}

/**
 * Every Overlay of the view that is in layout, flattened into one layer ordered
 * by `(z, document order)`. Hidden overlays contribute nothing — no layer, no
 * backdrop, no input blocking — and neither does anything under them.
 */
export function collectLayer(root: LayoutNode): LayoutNode[] {
  const found: LayoutNode[] = [];
  collect(root, found);
  return found
    .map((node, index) => ({ node, index, z: overlaySpec(node)?.z ?? 0 }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map((entry) => entry.node);
}

function collect(node: LayoutNode, out: LayoutNode[]): void {
  if (!inLayout(node)) return;
  // Keep descending through an overlay: a nested one is legal and joins the
  // same layer, ordered like any other entry.
  if (node.ir.type === "Overlay") out.push(node);
  for (const child of node.children) collect(child, out);
}

/** The modal that owns input and focus right now: the highest one in the layer. */
export function topModal(layer: readonly LayoutNode[]): LayoutNode | null {
  for (let i = layer.length - 1; i >= 0; i--) {
    if (isModal(layer[i])) return layer[i];
  }
  return null;
}

/**
 * The subtree focus navigation is confined to: the topmost modal, or the whole
 * view when there is none. Non-modal overlays never trap — their children join
 * the normal navigation like any other node.
 */
export function focusScope(root: LayoutNode, layer: readonly LayoutNode[]): LayoutNode {
  return topModal(layer) ?? root;
}

/** Whether `node` is `ancestor` or lives inside it. */
export function isWithin(node: LayoutNode, ancestor: LayoutNode): boolean {
  let current: LayoutNode | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/**
 * The initial focus candidate of a subtree: the first `autofocus` node in
 * document order that is in layout and focusable (`accept`). This is what an
 * opening modal focuses.
 */
export function autofocusIn(
  scope: LayoutNode,
  accept: (node: LayoutNode) => boolean,
): LayoutNode | null {
  if (!inLayout(scope)) return null;
  if (scope.ir.autofocus === true && accept(scope)) return scope;
  for (const child of scope.children) {
    const found = autofocusIn(child, accept);
    if (found) return found;
  }
  return null;
}

/** What a pointer landed on, once the layer has had its say. */
export type LayerHit =
  | { kind: "node"; node: LayoutNode }
  | { kind: "backdrop"; overlay: LayoutNode }
  | { kind: "miss" };

/**
 * Resolves a point against the layer first (top-down) and only then the tree.
 * A modal stops the walk: either one of its children took the event, or the
 * point is a backdrop tap — which never falls through to what it covers.
 *
 * Both walks go through `hitTest`, so clipping cuts input here too (`radiusOf`
 * resolves each clipping node's corner radius).
 */
export function resolveHit(
  root: LayoutNode,
  layer: readonly LayoutNode[],
  point: Point,
  radiusOf: NodeRadius,
): LayerHit {
  for (let i = layer.length - 1; i >= 0; i--) {
    const overlay = layer[i];
    const spec = overlaySpec(overlay);
    if (spec === null || !inLayout(overlay)) continue;
    const hit = hitChildren(overlay, point, radiusOf);
    if (hit) return { kind: "node", node: hit };
    if (spec.modal && contains(overlay.rect, point)) return { kind: "backdrop", overlay };
  }
  const hit = hitTest(root, point, radiusOf);
  return hit ? { kind: "node", node: hit } : { kind: "miss" };
}

/**
 * The overlay's own rect is backdrop, never a target: only its children can be
 * hit. The layer starts a fresh clipping scope — an Overlay is arranged against
 * the view rect, so the clips where it was declared don't apply — but its OWN
 * clip does.
 */
function hitChildren(overlay: LayoutNode, point: Point, radiusOf: NodeRadius): LayoutNode | null {
  const clip = childClip(overlay, null, radiusOf);
  for (let i = overlay.children.length - 1; i >= 0; i--) {
    const hit = hitTest(overlay.children[i], point, radiusOf, clip);
    if (hit) return hit;
  }
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
