/**
 * Pure `Repeat` semantics (ZAB-29) — the slots, the identity of each instance and
 * the virtualization geometry. No DOM and no tree: kept apart so it is unit
 * testable without a canvas, and so the Unity SDK (ZAB-30) has an unambiguous
 * reference for the same rules.
 *
 * **Virtualization is a renderer concern, not an IR one** (spec 2026-08-11): the
 * format carries no size hints, so the window is derived from ONE assumption —
 * every instance of a template is the same size along the axis it stacks on.
 * That is what turns "hundreds of items" into a constant amount of work: the node
 * reserves the space of the whole array, instantiates the lines the viewport can
 * see (plus a buffer) and offsets them by the space it skipped, so the scroll
 * bounds and the scrollbar stay exact while only the visible rows exist.
 *
 * A wrapping `Repeat` (the `<Grid>` of ZAB-32) stacks its LINES on the cross axis,
 * so the same math applies one level up: `perLine` items per line, and a line is
 * what the window counts.
 */

import { itemIdentity, itemKey, type ZNode } from "@zabloo/format";

/** Lines kept realized beyond each edge of the viewport, so a scroll never shows a hole. */
const BUFFER_LINES = 2;

/** How many items are realized before the first layout has measured anything. */
const INITIAL_WINDOW = 24;

/** One realized position: the element it shows and the identity its state is keyed by. */
interface ItemSlot {
  index: number;
  identity: string;
}

/** The uniform geometry a virtualized `Repeat` assumes, along the axis its lines stack on. */
interface ItemMetrics {
  /** One line's size on the stacking axis (an item's own size when nothing wraps). */
  extent: number;
  /** The node's `gap`, which separates lines as much as items. */
  gap: number;
  /** Items per line. 1 unless the node wraps. */
  perLine: number;
}

/** The realized window plus the space reserved around it — layout's whole share of it. */
interface ItemSpan {
  /** First realized item. */
  first: number;
  /** How many items are realized. */
  count: number;
  /** Space skipped before the first realized line: what puts it at its real position. */
  lead: number;
  /** Size of every line, realized or not — what the node measures on the stacking axis. */
  reserved: number;
  /** Items per line, so layout breaks exactly where the window assumed it would. */
  perLine: number;
}

/** `children[0]` is the item template — the node instantiated once per element. */
function itemTemplate(ir: ZNode): ZNode | undefined {
  return childrenOf(ir)[0];
}

/** `children[1..]` are the empty state, in layout only while there is nothing to repeat. */
function emptySlots(ir: ZNode): ZNode[] {
  return childrenOf(ir).slice(1);
}

function childrenOf(ir: ZNode): ZNode[] {
  return (ir as { children?: ZNode[] }).children ?? [];
}

/**
 * The elements to repeat. Anything that is not an array — missing data, a value
 * of the wrong shape — is the empty case, which is exactly when the empty-state
 * slot enters layout (decision 2026-08-11, ZAB-29).
 */
function itemsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The identities of a window of items. Reconciliation is keyed by these: reusing
 * an instance is what carries its state (focus, `checked`, an inner scroll offset,
 * a transition in flight) across a `SetData` that reorders the array.
 *
 * Two elements resolving the SAME key is a data error, and it cannot be honored:
 * one identity is one instance. The duplicate falls back to its POSITIONAL
 * identity — disjoint from the keyed space by construction (`itemIdentity`), so
 * the list still reconciles deterministically instead of rebuilding a row per
 * frame; it is only that row that stops travelling with its data.
 */
/** `from…to-1`, as values — an index range the caller can iterate with `const`. */
function indexRange(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

function windowSlots(
  items: readonly unknown[],
  keyPath: string | undefined,
  first: number,
  count: number,
): ItemSlot[] {
  const slots: ItemSlot[] = [];
  const seen = new Set<string>();
  const end = Math.min(items.length, first + count);
  for (const index of indexRange(Math.max(0, first), end)) {
    const keyed = itemIdentity(itemKey(items[index], keyPath), index);
    const identity = seen.has(keyed) ? itemIdentity(undefined, index) : keyed;
    seen.add(identity);
    slots.push({ index, identity });
  }
  return slots;
}

interface Reconciliation<T> {
  /** The window in order: an existing instance to reuse, or nothing to build one. */
  entries: Array<{ slot: ItemSlot; instance: T | undefined }>;
  /** Instances that left the window (or the array) — theirs is the state that dies. */
  dropped: T[];
}

/** Matches a window against the instances of the previous frame, by identity. */
function reconcileWindow<T>(
  previous: ReadonlyMap<string, T>,
  slots: readonly ItemSlot[],
): Reconciliation<T> {
  const kept = new Set<string>();
  const entries = slots.map((slot) => {
    const instance = kept.has(slot.identity) ? undefined : previous.get(slot.identity);
    if (instance !== undefined) kept.add(slot.identity);
    return { slot, instance };
  });
  const dropped: T[] = [];
  for (const [identity, instance] of previous) {
    if (!kept.has(identity)) dropped.push(instance);
  }
  return { entries, dropped };
}

/**
 * How many items fit on one line — the greedy first-fit the wrap pass performs,
 * computed from the uniform item size so the window and layout break in the same
 * place. Always at least one: an item wider than the line still gets a line.
 */
function itemsPerLine(content: number, item: number, gap: number): number {
  if (!(content > 0) || !(item > 0)) return 1;
  return Math.max(1, Math.floor((content + gap) / (item + gap)));
}

function lineCount(items: number, perLine: number): number {
  return perLine > 0 ? Math.ceil(items / perLine) : 0;
}

/**
 * The window a viewport sees, in item indices, plus the space that stands in for
 * everything outside it. `viewStart` is how far into the node's content the
 * viewport begins (negative while the node has not been reached yet) and
 * `viewLength` how much of it is visible.
 *
 * The window is computed from the PREVIOUS frame's rects — the only ones that
 * exist when a frame starts — so a fast scroll can outrun it by one frame. That
 * is what the buffer is for: it is the lines that make the lag invisible.
 */
function visibleSpan(
  itemCount: number,
  metrics: ItemMetrics,
  viewStart: number,
  viewLength: number,
  buffer: number = BUFFER_LINES,
): ItemSpan {
  const perLine = Math.max(1, Math.floor(metrics.perLine));
  const lines = lineCount(itemCount, perLine);
  const gap = Math.max(0, metrics.gap);
  const stride = metrics.extent + gap;
  const reserved = lines > 0 ? lines * metrics.extent + gap * (lines - 1) : 0;
  if (lines === 0 || !(stride > 0)) {
    return { first: 0, count: itemCount, lead: 0, reserved, perLine };
  }
  const firstLine = clampLine(Math.floor(viewStart / stride) - buffer, lines);
  const lastLine = clampLine(
    Math.floor((viewStart + Math.max(0, viewLength)) / stride) + buffer,
    lines,
  );
  const first = firstLine * perLine;
  return {
    first,
    count: Math.min(itemCount, (lastLine + 1) * perLine) - first,
    lead: firstLine * stride,
    reserved,
    perLine,
  };
}

function clampLine(line: number, lines: number): number {
  return Math.min(lines - 1, Math.max(0, line));
}

export type { ItemMetrics, ItemSlot, ItemSpan, Reconciliation };
export {
  BUFFER_LINES,
  emptySlots,
  INITIAL_WINDOW,
  itemsOf,
  itemsPerLine,
  itemTemplate,
  lineCount,
  reconcileWindow,
  visibleSpan,
  windowSlots,
};
