/**
 * What the last painted frame cost. From `packages/cli/src/preview-client.ts`
 * (ZAB-78); the one-second window it kept inline in its redraw timer is
 * `fpsWindow` here, so the store can hold the timestamps.
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
 * The frames painted in the last second — the rate is its length. Re-derived
 * against `now` and not only on arrival, or a scene that stopped painting would
 * keep reporting the rate it had when it stopped.
 */
export function fpsWindow(timestamps: readonly number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  return timestamps.filter((at) => at >= cutoff);
}
