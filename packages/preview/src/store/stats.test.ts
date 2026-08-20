/**
 * The frame counter. It has to be able to fall to zero on its own — the renderer
 * paints on demand, and a still scene is the system working, not a stall.
 */

import { FPS_WINDOW_MS, type FrameSample } from "./stats";
import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const FRAME: FrameSample = {
  frameMs: 1.9,
  drawCalls: 12,
  vertices: 3400,
  atlases: 2,
  atlasBytes: 1048576,
  resolved: 41,
  repaintOnly: false,
};

/** A clock the test moves by hand — `performance.now()` is not faked by default. */
function clocked() {
  const clock = { at: 0 };
  const store = createPreviewStore({ storage: memoryStorage(), now: () => clock.at });
  return {
    store,
    advance(ms: number) {
      clock.at += ms;
    },
  };
}

describe("stats", () => {
  it("holds the last frame the renderer reported", () => {
    const { store } = clocked();

    store.getState().recordFrame(FRAME);

    expect(store.getState().stats.last).toEqual(FRAME);
  });

  it("counts the frames of the last window, not of all time", () => {
    const { store, advance } = clocked();

    store.getState().recordFrame(FRAME);
    advance(300);
    store.getState().recordFrame(FRAME);
    advance(300);
    store.getState().recordFrame(FRAME);
    store.getState().tickStats();

    expect(store.getState().stats.fps).toBe(3);
  });

  it("falls to idle when nothing is painting any more", () => {
    const { store, advance } = clocked();
    store.getState().recordFrame(FRAME);
    store.getState().tickStats();
    expect(store.getState().stats.fps).toBe(1);

    advance(FPS_WINDOW_MS + 1);
    store.getState().tickStats();

    expect(store.getState().stats.fps).toBe(0);
    // The cost of the last frame stays: it is the last one there WAS.
    expect(store.getState().stats.last).toEqual(FRAME);
  });

  it("wakes nobody up when the count did not move", () => {
    const { store } = clocked();
    store.getState().tickStats();
    const before = store.getState().stats;

    store.getState().tickStats();

    expect(store.getState().stats).toBe(before);
  });
});
