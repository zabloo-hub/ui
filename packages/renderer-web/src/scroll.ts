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
