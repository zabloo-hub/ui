/**
 * What the Stage draws from: the logical size, the scale, and the caption. The
 * one rule that must never break is that the zoom cannot go above 1 (ZAB-78).
 */

import type { Problem } from "./problems";
import {
  bindingCount,
  captionParts,
  fatalCount,
  hasFatal,
  logicalSize,
  orderedProblems,
  problemSummary,
  warnCount,
  zoom,
} from "./selectors";
import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

function staged(width = 960, height = 540) {
  const store = createPreviewStore({ storage: memoryStorage() });
  store.getState().setStageSize({ width, height });
  return store;
}

describe("logicalSize", () => {
  it("is the preset's own size, whatever the window is doing", () => {
    const store = staged();
    store.getState().setPreset("1080p");

    expect(logicalSize(store.getState())).toEqual({ width: 1920, height: 1080 });
  });

  it("is the stage itself under fit", () => {
    const store = staged(800, 480);

    expect(logicalSize(store.getState())).toEqual({ width: 800, height: 480 });
  });

  it("is the typed size under custom", () => {
    const store = staged();
    store.getState().setCustom({ width: 1024, height: 640 });
    store.getState().setPreset("custom");

    expect(logicalSize(store.getState())).toEqual({ width: 1024, height: 640 });
  });
});

describe("zoom", () => {
  it("shrinks a preset to what the stage can show", () => {
    const store = staged(768, 480);
    store.getState().setPreset("steamdeck");

    expect(zoom(store.getState())).toBeCloseTo(0.6);
  });

  it("never magnifies a view to fill a bigger screen", () => {
    const store = staged(3840, 2160);
    store.getState().setPreset("switch");

    expect(zoom(store.getState())).toBe(1);
  });

  it("is 1 under fit, where nothing is being scaled", () => {
    expect(zoom(staged(300, 200).getState())).toBe(1);
  });

  it("is 1 before the stage has been measured", () => {
    const store = createPreviewStore({ storage: memoryStorage() });
    store.getState().setPreset("4k");

    expect(zoom(store.getState())).toBe(1);
  });
});

describe("captionParts", () => {
  it("says preset, size, DPR and zoom", () => {
    const store = staged(768, 480);
    store.getState().setPreset("steamdeck");
    store.getState().setDpr(1);

    expect(captionParts(store.getState())).toEqual({
      preset: "Steam Deck",
      size: "1280×800",
      dpr: "@1×",
      zoom: "60%",
    });
  });

  it("reports the real size and no zoom under fit", () => {
    const store = staged(1440, 900);

    expect(captionParts(store.getState())).toEqual({
      preset: "Fit window",
      size: "1440×900",
      dpr: "@auto",
      zoom: null,
    });
  });

  it("names the custom size as Custom", () => {
    const store = staged(2000, 2000);
    store.getState().setCustom({ width: 640, height: 480 });
    store.getState().setPreset("custom");

    expect(captionParts(store.getState())).toMatchObject({
      preset: "Custom",
      size: "640×480",
      zoom: "100%",
    });
  });
});

describe("bindingCount", () => {
  it("counts what the panel shows, not what the store remembers", () => {
    const store = staged();
    store.getState().declare([
      { path: "player.gold", type: "number" },
      { path: "player.name", type: "string" },
    ]);
    store.getState().setFromUI("shop.items.3.fav", true);

    expect(bindingCount(store.getState())).toBe(2);
  });
});

/**
 * The one thing worth proving about the problem selectors is not what they count
 * — it is that they count it ONCE. They are read from four places, each through
 * a hook whose selector runs on every notification the store makes, and
 * `recordFrame` notifies at frame rate: three scans per frame was the bug.
 */
describe("problemSummary", () => {
  const fatal = (path: string): Problem => ({
    severity: "fatal",
    code: "unknown-type",
    path,
    reason: "?",
  });
  const warn = (path: string): Problem => ({
    severity: "warn",
    code: "invalid-node",
    path,
    reason: "repaired",
  });

  function loaded(problems: Problem[]) {
    const store = createPreviewStore({ storage: memoryStorage() });
    store.getState().replaceProblems(problems);
    return store;
  }

  it("counts each severity on its own — the two are never summed", () => {
    const state = loaded([fatal("a"), warn("b"), warn("c")]).getState();

    expect(fatalCount(state)).toBe(1);
    expect(warnCount(state)).toBe(2);
    expect(hasFatal(state)).toBe(true);
  });

  it("scans the list once however many times it is asked", () => {
    const problems = [fatal("a"), warn("b")];
    const filter = vi.spyOn(problems, "filter");
    const state = loaded(problems).getState();

    fatalCount(state);
    warnCount(state);
    hasFatal(state);
    orderedProblems(state);
    fatalCount(state);

    // Two calls: one per severity, inside the single summary that was kept.
    expect(filter).toHaveBeenCalledTimes(2);
  });

  it("does not re-scan when an unrelated field moves", () => {
    const problems = [fatal("a")];
    const filter = vi.spyOn(problems, "filter");
    const store = loaded(problems);
    hasFatal(store.getState());
    filter.mockClear();

    for (const _ of Array.from({ length: 20 })) {
      store.getState().recordFrame({
        frameMs: 1.9,
        drawCalls: 4,
        vertices: 120,
        atlases: 1,
        atlasBytes: 2048,
        resolved: 0,
        repaintOnly: true,
        textLayouts: 0,
        bufferGrowths: 0,
      });
      hasFatal(store.getState());
    }

    expect(filter).not.toHaveBeenCalled();
  });

  it("counts again once the list is replaced", () => {
    const store = loaded([fatal("a")]);
    expect(fatalCount(store.getState())).toBe(1);

    store.getState().replaceProblems([warn("b"), warn("c")]);

    expect(fatalCount(store.getState())).toBe(0);
    expect(warnCount(store.getState())).toBe(2);
    expect(hasFatal(store.getState())).toBe(false);
  });
});

describe("orderedProblems", () => {
  it("puts fatals first and keeps arrival order inside a severity", () => {
    const store = createPreviewStore({ storage: memoryStorage() });
    store.getState().replaceProblems([
      { severity: "warn", code: "invalid-node", path: "first", reason: "repaired" },
      { severity: "fatal", code: "unknown-type", path: "boom", reason: "?" },
      { severity: "warn", code: "invalid-node", path: "second", reason: "repaired" },
    ]);

    expect(orderedProblems(store.getState()).map((problem) => problem.path)).toEqual([
      "boom",
      "first",
      "second",
    ]);
  });

  it("leaves the store's own order alone — the sort is made on a copy", () => {
    const store = createPreviewStore({ storage: memoryStorage() });
    store.getState().replaceProblems([
      { severity: "warn", code: "invalid-node", path: "first", reason: "repaired" },
      { severity: "fatal", code: "unknown-type", path: "boom", reason: "?" },
    ]);

    orderedProblems(store.getState());

    expect(store.getState().problems.map((problem) => problem.path)).toEqual(["first", "boom"]);
  });

  it("is the same array until the list moves — the tab re-renders for nothing else", () => {
    const store = createPreviewStore({ storage: memoryStorage() });
    store.getState().replaceProblems([{ severity: "warn", code: "c", path: "p", reason: "r" }]);
    const first = orderedProblems(store.getState());

    store.getState().selectView("hud");

    expect(orderedProblems(store.getState())).toBe(first);
  });
});

/** The summary the hooks read, exposed so a component can take all three at once. */
describe("problemSummary as a whole", () => {
  it("hands back the same object for the same list", () => {
    const store = createPreviewStore({ storage: memoryStorage() });
    store.getState().replaceProblems([{ severity: "fatal", code: "c", path: "p", reason: "r" }]);

    expect(problemSummary(store.getState())).toBe(problemSummary(store.getState()));
  });
});
