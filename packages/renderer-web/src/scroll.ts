/**
 * Pure scroll-offset math shared by the layout pass (clamping on relayout) and
 * the input handlers (wheel/drag). No DOM — kept separate so it's unit
 * testable without a canvas.
 */

import type { ScrollAxis } from "@zabloo/format";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps main/cross-axis content overflow to physical x/y scroll bounds, per
 * the flex `direction` (main axis = x for "row", y for "column"), then zeroes
 * whichever axis the ScrollView's `axis` prop doesn't enable.
 */
/** Overlay scrollbar geometry along one axis, in track-relative px. */
export interface ScrollbarThumb {
  /** Distance from the track's start to the thumb. */
  start: number;
  length: number;
}

/**
 * The thumb that indicates the scroll position on one axis: length proportional
 * to the visible fraction of the content, position proportional to the offset.
 * Null when there is nothing to indicate — no overflow, or no room to draw it.
 *
 * `track` is the drawable run (the viewport minus the bar's own margins), which
 * is why it is separate from `viewport`: the proportion comes from the content,
 * the pixels from the track.
 */
export function scrollbarThumb(
  track: number,
  viewport: number,
  max: number,
  offset: number,
  minLength: number,
): ScrollbarThumb | null {
  if (!(max > 0) || !(track > 0) || !(viewport > 0)) return null;
  const visibleFraction = viewport / (viewport + max);
  const length = clamp(track * visibleFraction, Math.min(minLength, track), track);
  return { start: clamp(offset / max, 0, 1) * (track - length), length };
}

/**
 * How far one axis has to scroll to bring `[start, start + size]` inside the
 * viewport `[viewStart, viewStart + viewSize]` — the auto-scroll that follows the
 * focus (ZAB-47), which the ScrollView spec deferred to the gamepad phase.
 *
 * It is the SMALLEST move that does it, and 0 when the target already fits:
 * navigating must not jump the list around under a player who can already see
 * where the focus went. A target bigger than the viewport aligns its leading edge
 * — the beginning of something too big is the useful half — unless it already
 * covers the viewport, in which case it is as visible as it will ever be.
 */
export function revealDelta(
  start: number,
  size: number,
  viewStart: number,
  viewSize: number,
): number {
  const before = viewStart - start;
  const after = start + Math.max(0, size) - (viewStart + viewSize);
  if (before > 0 && after > 0) return 0;
  if (before > 0) return -before;
  return after > 0 ? Math.min(after, -before) : 0;
}

export function resolveScrollMax(
  direction: "row" | "column",
  axis: ScrollAxis | undefined,
  mainOverflow: number,
  crossOverflow: number,
): { x: number; y: number } {
  const main = Math.max(0, mainOverflow);
  const cross = Math.max(0, crossOverflow);
  const max = direction === "row" ? { x: main, y: cross } : { x: cross, y: main };
  const resolvedAxis = axis ?? "vertical";
  if (resolvedAxis === "vertical") max.x = 0;
  else if (resolvedAxis === "horizontal") max.y = 0;
  return max;
}
