/**
 * The size the UI is laid out at. The forgiving bits are deliberate: a box being
 * typed into is not an error, and a stage that reports the size it already had
 * must not wake the chrome up.
 */

import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

describe("viewport", () => {
  it("starts fitting the window, at the browser's own DPR", () => {
    expect(store().getState()).toMatchObject({
      viewport: { preset: "fit" },
      dpr: "auto",
      stageSize: { width: 0, height: 0 },
    });
  });

  it("takes a preset and a DPR", () => {
    const preview = store();

    preview.getState().setPreset("steamdeck");
    preview.getState().setDpr(2);

    expect(preview.getState()).toMatchObject({ viewport: { preset: "steamdeck" }, dpr: 2 });
  });

  it("holds the custom size without stealing the preset you are looking at", () => {
    const preview = store();
    preview.getState().setPreset("1080p");

    preview.getState().setCustom({ width: 1024, height: 640 });

    expect(preview.getState().custom).toEqual({ width: 1024, height: 640 });
    expect(preview.getState().viewport.preset).toBe("1080p");
  });

  it("keeps the last good custom size while one is being typed", () => {
    const preview = store();
    preview.getState().setCustom({ width: 1024, height: 640 });

    preview.getState().setCustom({ width: 0, height: 640 });
    preview.getState().setCustom({ width: Number.NaN, height: 640 });

    expect(preview.getState().custom).toEqual({ width: 1024, height: 640 });
  });

  it("takes the stage's measurement, and ignores it when it did not change", () => {
    const preview = store();

    preview.getState().setStageSize({ width: 900, height: 600 });
    const measured = preview.getState().stageSize;
    preview.getState().setStageSize({ width: 900, height: 600 });

    expect(preview.getState().stageSize).toBe(measured);
  });
});
