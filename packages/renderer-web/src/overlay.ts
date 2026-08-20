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
 *
 * Plus the two things an overlay does that no other node does: it **fades in and
 * out** of the layer (`stepPresence`), which is why a closing modal outlives the
 * `visible` that closed it by exactly one transition, and it can be **anchored**
 * to another node's rect (`anchorBox`, decision 2026-08-11, ZAB-46) — the one
 * placement in v1 that is relative to a rect the node does not contain.
 *
 * An anchored overlay may also be a **popover** (`trigger: "press"`, decision
 * 2026-08-12, ZAB-25): the anchor's press opens it and the SDK owns that state, so
 * a dismiss or a selection inside can close it. That is the whole of `<Select>` —
 * the dropdown is a `Button`, a modal anchored `Overlay` and an `"exclusive-check"`
 * group, with no primitive of its own.
 */

import type { AnchorAt, Dim, OverlayAnchor, OverlayTrigger } from "@zabloo/format";
import { intersectClip, isEmptyClip } from "./clip.js";
import { childClip, effectiveClip, hitTest, type NodeRadius } from "./hit.js";
import { contains, inLayout, type LayoutNode, type Rect, selfAndAncestors } from "./layout.js";
import { type NodeAnim, type ResolvedTransition, stepValue } from "./transition.js";

interface Point {
  x: number;
  y: number;
}

/** An Overlay's layer props with the IR defaults applied. */
interface OverlaySpec {
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
function overlaySpec(node: LayoutNode): OverlaySpec | null {
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

function isModal(node: LayoutNode): boolean {
  return overlaySpec(node)?.modal === true;
}

/** Distance kept from the anchor's edge when the node declares none. */
const ANCHOR_OFFSET = 8;

const ANCHOR_AT: readonly AnchorAt[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** An Overlay's anchor with the IR defaults applied. `offset` is still a `Dim`. */
interface AnchorSpec {
  id: string;
  at: AnchorAt;
  offset: Dim | undefined;
  trigger: OverlayTrigger;
}

/**
 * The anchor of an Overlay node, or null for anything else — including an
 * `anchor` with no `id`, which anchors nothing.
 *
 * Read loosely, like the rest of the IR: an `at` this build does not know falls
 * back to the default instead of failing, so a newer placement degrades to a
 * tooltip in the wrong-ish place rather than to no tooltip.
 */
function anchorSpec(node: LayoutNode): AnchorSpec | null {
  if (node.ir.type !== "Overlay") return null;
  const anchor = (node.ir as { anchor?: OverlayAnchor }).anchor;
  if (!anchor || typeof anchor.id !== "string" || anchor.id === "") return null;
  return {
    id: anchor.id,
    at: anchor.at !== undefined && ANCHOR_AT.includes(anchor.at) ? anchor.at : "top",
    offset: anchor.offset,
    // Unknown triggers read as `manual`, the pre-ZAB-46 gate: newer content
    // degrades to an overlay its `visible` opens, never to one that cannot open.
    trigger: anchor.trigger === "hover" ? "hover" : anchor.trigger === "press" ? "press" : "manual",
  };
}

/**
 * Whether this overlay rides its anchor's hover/focus. Such an overlay is also
 * INERT to input (see `resolveHit`): a bubble that took the pointer would steal
 * the hover from the very anchor holding it up, and the two would flicker against
 * each other for as long as the pointer sat between them.
 */
function isHoverTriggered(node: LayoutNode): boolean {
  return anchorSpec(node)?.trigger === "hover";
}

/**
 * Whether this overlay is a POPOVER: opened and closed by its anchor's press, with
 * the SDK owning that state (decision 2026-08-12, ZAB-25). Unlike a hover-triggered
 * one it is a surface, not a hint — it takes input normally, which is what lets the
 * player pick something inside it.
 */
function isPressTriggered(node: LayoutNode): boolean {
  return anchorSpec(node)?.trigger === "press";
}

/**
 * The `"exclusive-check"` groups inside a subtree, outermost first — the popover's
 * own lists. Descending stops at each group: a nested one belongs to that group's
 * options, and the popover closes on ITS selection, not on its children's.
 */
function checkGroupsIn(node: LayoutNode, out: LayoutNode[] = []): LayoutNode[] {
  const ir = node.ir as { type: string; group?: string };
  if (ir.type === "Container" && ir.group === "exclusive-check") {
    out.push(node);
    return out;
  }
  for (const child of node.children) checkGroupsIn(child, out);
  return out;
}

/**
 * Where the focus goes when a popover opens: the option the group already holds,
 * so a list of twenty languages opens ON the one in use instead of at the top.
 * Null when nothing is selected — the caller falls back to `autofocus`.
 *
 * It reads `checked`, which an `"exclusive-check"` group derives from its value, so
 * it needs no second notion of "the current one".
 */
function selectedOptionIn(overlay: LayoutNode): LayoutNode | null {
  for (const group of checkGroupsIn(overlay)) {
    const found = checkedOption(group);
    if (found) return found;
  }
  return null;
}

function checkedOption(node: LayoutNode): LayoutNode | null {
  for (const child of node.children) {
    const ir = child.ir as { type: string; group?: string };
    // A nested group owns its own options, exactly as `groupOptions` reads it.
    if (ir.type === "Container" && ir.group === "exclusive-check") continue;
    if (ir.type === "Toggle" && child.checked && inLayout(child)) return child;
    const found = checkedOption(child);
    if (found) return found;
  }
  return null;
}

/**
 * Whether a node is actually on screen right now: in layout with every ancestor in
 * layout, and not entirely clipped away by one of them (scrolled out of a
 * `ScrollView`). It is what decides whether an anchored overlay still has something
 * to point at — a tooltip hanging over the edge of a list whose row has scrolled
 * past is pointing at nothing.
 *
 * It reads the rects of the frame that has already been laid out, so a scroll takes
 * the tooltip away one frame later — invisible at 60fps, and the alternative would
 * be laying the tree out twice per frame to answer a question about a bubble.
 */
function isOnScreen(node: LayoutNode, radiusOf: NodeRadius): boolean {
  for (const current of selfAndAncestors(node)) {
    if (!inLayout(current)) return false;
  }
  const clip = effectiveClip(node, radiusOf);
  return clip === null || !isEmptyClip(intersectClip(clip, node.rect, 0));
}

/** Which side of the anchor the content takes, and how it aligns along that side. */
function placement(at: AnchorAt): {
  side: "top" | "bottom" | "left" | "right" | "on";
  align: number;
} {
  switch (at) {
    case "center":
      return { side: "on", align: 0.5 };
    case "top":
      return { side: "top", align: 0.5 };
    case "bottom":
      return { side: "bottom", align: 0.5 };
    case "left":
      return { side: "left", align: 0.5 };
    case "right":
      return { side: "right", align: 0.5 };
    case "top-left":
      return { side: "top", align: 0 };
    case "top-right":
      return { side: "top", align: 1 };
    case "bottom-left":
      return { side: "bottom", align: 0 };
    default:
      return { side: "bottom", align: 1 };
  }
}

const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;

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

/**
 * Where an anchored overlay's content goes: `at` around `anchor`, `offset` px away,
 * flipped to the opposite side when the preferred one does not fit and the other
 * does, and finally clamped into `bounds` (the view, inset by the overlay's own
 * padding). Pure rect math, and therefore the literal reference for the Unity
 * ticket, like `stepPresence`.
 *
 * Flip before clamp, and never both on the same axis for the same reason: a bubble
 * that does not fit above belongs below, whereas one that runs off the side of the
 * screen only needs sliding — flipping it there would move it away from the word it
 * points at. `center` neither flips nor offsets: it is placed ON the anchor.
 */
function anchorBox(
  anchor: Rect,
  size: { x: number; y: number },
  at: AnchorAt,
  offset: number,
  bounds: Rect,
): Rect {
  const { side: preferred, align } = placement(at);
  const box = { x: 0, y: 0, width: size.x, height: size.y };
  if (preferred === "on") {
    box.x = anchor.x + (anchor.width - size.x) * 0.5;
    box.y = anchor.y + (anchor.height - size.y) * 0.5;
  } else {
    const side =
      fits(preferred, anchor, size, offset, bounds) ||
      !fits(OPPOSITE[preferred], anchor, size, offset, bounds)
        ? preferred
        : OPPOSITE[preferred];
    if (side === "top" || side === "bottom") {
      box.y = sideStart(side, anchor, size, offset);
      box.x = anchor.x + (anchor.width - size.x) * align;
    } else {
      box.x = sideStart(side, anchor, size, offset);
      box.y = anchor.y + (anchor.height - size.y) * align;
    }
  }
  box.x = clampAxis(box.x, size.x, bounds.x, bounds.width);
  box.y = clampAxis(box.y, size.y, bounds.y, bounds.height);
  return box;
}

/** The content's near edge on the side's own axis. */
function sideStart(
  side: "top" | "bottom" | "left" | "right",
  anchor: Rect,
  size: { x: number; y: number },
  offset: number,
): number {
  switch (side) {
    case "top":
      return anchor.y - offset - size.y;
    case "bottom":
      return anchor.y + anchor.height + offset;
    case "left":
      return anchor.x - offset - size.x;
    default:
      return anchor.x + anchor.width + offset;
  }
}

/** Whether that side has room inside `bounds` — what decides the flip. */
function fits(
  side: "top" | "bottom" | "left" | "right",
  anchor: Rect,
  size: { x: number; y: number },
  offset: number,
  bounds: Rect,
): boolean {
  const start = sideStart(side, anchor, size, offset);
  switch (side) {
    case "top":
      return start >= bounds.y;
    case "bottom":
      return start + size.y <= bounds.y + bounds.height;
    case "left":
      return start >= bounds.x;
    default:
      return start + size.x <= bounds.x + bounds.width;
  }
}

/** Slides a span inside the bounds; content wider than them starts at their edge. */
function clampAxis(start: number, size: number, boundsStart: number, boundsSize: number): number {
  if (size >= boundsSize) return boundsStart;
  return Math.min(Math.max(start, boundsStart), boundsStart + boundsSize - size);
}

/**
 * Whether a node still counts for the layer. The default is `inLayout` — the live
 * layer that owns input, focus and the auto-close timers. The paint pass widens it
 * to the overlays that are still fading out (`stepPresence`), which is the ONLY
 * difference between the two: an overlay on its way out is pixels, never input.
 */
type Present = (node: LayoutNode) => boolean;

/**
 * The Overlays hanging under `root`, present or not — the candidates a layer is
 * collected from. The view does not call this: it keeps the same set as the tree
 * is built and released (ZAB-73), because re-walking a thousand-row list once a
 * frame to find three overlays is the walk, not the finding. This is here for
 * the rule's own tests and for anyone holding a tree and nothing else.
 */
function overlaysOf(root: LayoutNode): LayoutNode[] {
  const found: LayoutNode[] = [];
  collect(root, found);
  return found;
}

function collect(node: LayoutNode, out: LayoutNode[]): void {
  // Keep descending through an overlay: a nested one is legal and joins the
  // same layer, ordered like any other entry.
  if (node.ir.type === "Overlay") out.push(node);
  for (const child of node.children) collect(child, out);
}

/**
 * The `overlays` that are present, flattened into one layer ordered by
 * `(z, document order)`. Hidden overlays contribute nothing — no layer, no
 * backdrop, no input blocking — and neither does anything under them, which is
 * why presence is asked of the whole chain up to the root and not of the entry
 * alone: an overlay inside a closed Collapse is as absent as one with
 * `visible:false`.
 */
function collectLayer(overlays: Iterable<LayoutNode>, present: Present = inLayout): LayoutNode[] {
  const found: Array<{ node: LayoutNode; path: number[]; z: number }> = [];
  for (const node of overlays) {
    if (!chainPresent(node, present)) continue;
    found.push({ node, path: documentPath(node), z: overlaySpec(node)?.z ?? 0 });
  }
  return found.sort((a, b) => a.z - b.z || comparePaths(a.path, b.path)).map((entry) => entry.node);
}

function chainPresent(node: LayoutNode, present: Present): boolean {
  for (const current of selfAndAncestors(node)) {
    if (!present(current)) return false;
  }
  return true;
}

/**
 * The node's position in the document, as the child index of each step down from
 * the root. Comparing two of these is comparing document order — the order a
 * walk would have found them in, recovered without the walk.
 */
function documentPath(node: LayoutNode): number[] {
  const path: number[] = [];
  for (const current of selfAndAncestors(node)) {
    if (current.parent) path.push(current.parent.children.indexOf(current));
  }
  return path.reverse();
}

/** Lexicographic, so an ancestor sorts before the descendant it contains. */
function comparePaths(a: number[], b: number[]): number {
  const step = a.slice(0, b.length).find((value, i) => value !== b[i]);
  if (step === undefined) return a.length - b.length;
  return step - b[a.indexOf(step)];
}

/**
 * How present an overlay is this frame, 0 (gone) to 1 (fully up) — the enter/exit
 * fade, multiplied onto the whole layer entry when it paints.
 *
 * It is behavior driving the interpolation engine with endpoints it computes
 * (decision 2026-08-11 §5), exactly like the ProgressBar's fraction: the node's own
 * `transition` decides the duration and curve, so an overlay without one appears
 * and disappears instantly — the pre-F7 behavior, unchanged. `visible` itself never
 * animates; what animates is the overlay's presence in the layer, which is why the
 * `visible` binding stays the single mechanism and the IR gains nothing.
 *
 * The first step of a track snaps (`stepValue`), so a modal that is already open
 * when the view loads does not fade in — mounting snaps, like everywhere else.
 * Its state must therefore live outside the node's own `NodeAnim`, which the
 * resolve pass drops whenever a node leaves layout: there would be no exit to
 * animate if the exit erased its own starting point.
 */
function stepPresence(
  anim: NodeAnim,
  live: boolean,
  transition: ResolvedTransition | null,
  now: number,
): { value: number; animating: boolean } {
  return stepValue(anim, "presence", live ? 1 : 0, transition, now);
}

/** The modal that owns input and focus right now: the highest one in the layer. */
function topModal(layer: readonly LayoutNode[]): LayoutNode | null {
  return [...layer].reverse().find(isModal) ?? null;
}

/**
 * The subtree focus navigation is confined to: the topmost modal, or the whole
 * view when there is none. Non-modal overlays never trap — their children join
 * the normal navigation like any other node.
 */
function focusScope(root: LayoutNode, layer: readonly LayoutNode[]): LayoutNode {
  return topModal(layer) ?? root;
}

/** Whether `node` is `ancestor` or lives inside it. */
function isWithin(node: LayoutNode, ancestor: LayoutNode): boolean {
  for (const current of selfAndAncestors(node)) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * The initial focus candidate of a subtree: the first `autofocus` node in
 * document order that is in layout and focusable (`accept`). This is what an
 * opening modal focuses.
 */
function autofocusIn(scope: LayoutNode, accept: (node: LayoutNode) => boolean): LayoutNode | null {
  if (!inLayout(scope)) return null;
  if (scope.ir.autofocus === true && accept(scope)) return scope;
  for (const child of scope.children) {
    const found = autofocusIn(child, accept);
    if (found) return found;
  }
  return null;
}

/** What a pointer landed on, once the layer has had its say. */
type LayerHit =
  | { kind: "node"; node: LayoutNode }
  | { kind: "backdrop"; overlay: LayoutNode }
  | { kind: "miss" };

/**
 * Resolves a point against the layer first (top-down) and only then the tree.
 * A modal stops the walk: either one of its children took the event, or the
 * point is a backdrop tap — which never falls through to what it covers.
 *
 * A hover-triggered overlay is skipped entirely: it is a hint held up by its
 * anchor's hover, so taking the pointer would end it (decision 2026-08-11,
 * ZAB-46).
 *
 * Both walks go through `hitTest`, so clipping cuts input here too (`radiusOf`
 * resolves each clipping node's corner radius).
 */
function resolveHit(
  root: LayoutNode,
  layer: readonly LayoutNode[],
  point: Point,
  radiusOf: NodeRadius,
): LayerHit {
  // Topmost entry first: it is the one painted over the rest.
  for (const overlay of [...layer].reverse()) {
    const spec = overlaySpec(overlay);
    if (spec === null || !inLayout(overlay) || isHoverTriggered(overlay)) continue;
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
  for (const child of [...overlay.children].reverse()) {
    const hit = hitTest(child, point, radiusOf, clip);
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

export type { AnchorSpec, LayerHit, OverlaySpec, Point, Present };
export {
  ANCHOR_OFFSET,
  anchorBox,
  anchorSpec,
  autofocusIn,
  checkGroupsIn,
  collectLayer,
  deflate,
  focusScope,
  isHoverTriggered,
  isModal,
  isOnScreen,
  isPressTriggered,
  isWithin,
  overlaySpec,
  overlaysOf,
  resolveHit,
  selectedOptionIn,
  stepPresence,
  topModal,
};
