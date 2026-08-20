/**
 * What the last painted frame cost, as the badge shows it.
 *
 * Ported from `packages/cli/src/preview-client.ts` (ZAB-78). `formatStats` is
 * unchanged; the one-second window the CLI page kept inline — a `filter` inside
 * the redraw timer — is `fpsWindow` here so the store can hold the timestamps
 * and the counting stays testable without a timer.
 */

import type { FrameStats } from "@zabloo/renderer-web";

/** How long a painted frame counts towards the rate. */
const WINDOW_MS = 1000;

/**
 * What the last painted frame cost, as the badge shows it. `stats()` has been on
 * the handle all along and was reachable only by typing `zabloo.stats()` into the
 * console — which is exactly when you are not looking at the screen (ZAB-78).
 *
 * `idle` rather than `0 fps` because the renderer paints ON DEMAND: a still scene
 * painting nothing is the system working, not a stall.
 */
export function formatStats(frame: (FrameStats & { ms: number }) | null, fps: number): string {
  if (frame === null) return "no frame painted yet";
  return [
    fps > 0 ? `${fps} fps` : "idle",
    `${frame.ms.toFixed(2)} ms`,
    `${frame.drawCalls} draws`,
    `${compact(frame.vertices)} verts`,
    `${frame.atlases} atlas ${(frame.atlasBytes / 1048576).toFixed(1)} MB`,
    frame.repaintOnly ? "repaint only" : `${frame.resolved} resolved`,
  ].join(" · ");
}

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/**
 * The frames painted in the last second, which is the frame RATE: its length.
 *
 * Frames are counted as the RENDERER reports them (`onFrame`), never with the
 * page's own `requestAnimationFrame` — the renderer paints on demand, so a rAF
 * loop here would be measuring the page instead. The window has to be re-derived
 * against `now` rather than only on arrival, or a scene that stopped painting
 * would keep reporting the rate it had when it stopped.
 */
export function fpsWindow(timestamps: readonly number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  return timestamps.filter((at) => at >= cutoff);
}
