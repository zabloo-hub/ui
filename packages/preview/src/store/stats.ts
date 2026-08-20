/**
 * What the last painted frame cost, and how many of them the last second held.
 *
 * `fps` is counted from the frames the RENDERER reports, not from a rAF loop of
 * our own: the renderer paints on demand, so a page-driven counter would be
 * measuring the page. A still scene reports zero, which the Stats tab prints as
 * `idle` — the system working, not a stall.
 *
 * The window is recomputed by `tickStats`, which V12 calls four times a second
 * while the tab is visible, and NOT by `recordFrame`: the count has to be able to
 * fall to zero, and nothing arrives to make it fall.
 *
 * The timestamps live in a closure instead of the state — they are a ring buffer
 * nobody renders, and putting them in the state would wake every subscriber on
 * every frame.
 */

import type { Getter, Setter } from "./state";

/** One frame, as the renderer reports it (`FrameStats & { ms }`), renamed to fit. */
export interface FrameSample {
  frameMs: number;
  drawCalls: number;
  vertices: number;
  atlases: number;
  atlasBytes: number;
  resolved: number;
  repaintOnly: boolean;
}

/** The window `fps` is counted over. */
export const FPS_WINDOW_MS = 1000;

export interface StatsSlice {
  stats: {
    last: FrameSample | null;
    fps: number;
  };
  recordFrame(frame: FrameSample): void;
  /** Re-counts the window. Cheap, and a no-op for subscribers when nothing moved. */
  tickStats(): void;
}

export function createStatsSlice(set: Setter, get: Getter, now: () => number): StatsSlice {
  // A slot, because `tickStats` REPLACES the array (filtered) rather than
  // mutating it: the window is a value recomputed each tick.
  const window = { painted: [] as number[] };
  return {
    stats: { last: null, fps: 0 },

    recordFrame: (frame) => {
      window.painted.push(now());
      set({ stats: { last: frame, fps: get().stats.fps } });
    },

    tickStats: () => {
      const cutoff = now() - FPS_WINDOW_MS;
      window.painted = window.painted.filter((at) => at >= cutoff);
      const { last, fps } = get().stats;
      if (window.painted.length === fps) return;
      set({ stats: { last, fps: window.painted.length } });
    },
  };
}
