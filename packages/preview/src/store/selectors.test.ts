/**
 * What the Stage draws from: the logical size, the scale, and the caption. The
 * one rule that must never break is that the zoom cannot go above 1 (ZAB-78).
 */

import { bindingCount, captionParts, logicalSize, zoom } from "./selectors";
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
