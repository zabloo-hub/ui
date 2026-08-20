/**
 * ProgressBar geometry — pure, so "how big is the fill" is unit-testable without a
 * canvas, like `scroll.ts` is for offsets.
 *
 * The whole primitive is this one rule: the fill takes a FRACTION of the track's
 * content box along the main axis and the whole cross axis. The fraction itself is
 * tweened upstream, on the value (decision 2026-08-11 §4: interpolate declared
 * inputs, never computed rects) — by the time it reaches here it is just a number,
 * which is what keeps a single layout pass per frame.
 */

import type { Layout } from "@zabloo/format";
import { clampProgress } from "@zabloo/format";
import type { Rect } from "./layout.js";

/** Main-axis size of the fill: the fraction of the content box, never negative. */
export function fillMain(contentMain: number, value: number): number {
  return Math.max(0, contentMain) * clampProgress(value);
}

/**
 * The fill's rect inside the track's content box. `justify` anchors it — `"start"`
 * (default) grows from the left/top, `"end"` from the right/bottom, and `"center"`
 * from the middle out; there is no `space-between` for a single child, so it lands
 * on the start like the flex pass would leave it.
 */
export function fillRect(
  content: Rect,
  row: boolean,
  value: number,
  justify?: Layout["justify"],
): Rect {
  const contentMain = row ? content.width : content.height;
  const main = fillMain(contentMain, value);
  const leftover = Math.max(0, contentMain - main);
  const lead = justify === "end" ? leftover : justify === "center" ? leftover * 0.5 : 0;
  return row
    ? { x: content.x + lead, y: content.y, width: main, height: content.height }
    : { x: content.x, y: content.y + lead, width: content.width, height: main };
}
