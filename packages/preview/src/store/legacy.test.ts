/**
 * What the old page left behind. This is the whole "nobody loses their setup"
 * promise, and it only ever runs while the new blob is missing.
 */

import { readLegacyViewport } from "./legacy";
import { memoryStorage } from "./storage";

describe("readLegacyViewport", () => {
  it("defaults to fit when nothing was ever stored", () => {
    expect(readLegacyViewport(memoryStorage())).toEqual({
      preset: "fit",
      custom: { width: 1280, height: 720 },
      dpr: "auto",
    });
  });

  it("maps the old fixed resolutions onto the presets that ARE them", () => {
    const storage = memoryStorage({
      "zabloo.preview.viewport": "1920x1080",
      "zabloo.preview.dpr": "2",
    });

    expect(readLegacyViewport(storage)).toMatchObject({ preset: "1080p", dpr: 2 });
    expect(
      readLegacyViewport(memoryStorage({ "zabloo.preview.viewport": "1280x720" })),
    ).toMatchObject({ preset: "switch" });
  });

  it("keeps a custom size and its preset", () => {
    const storage = memoryStorage({
      "zabloo.preview.viewport": "custom",
      "zabloo.preview.custom": "1024x640",
    });

    expect(readLegacyViewport(storage)).toMatchObject({
      preset: "custom",
      custom: { width: 1024, height: 640 },
    });
  });

  it("rescues a hand-set resolution that is not a preset", () => {
    const storage = memoryStorage({ "zabloo.preview.viewport": "1024x640" });

    expect(readLegacyViewport(storage).preset).toBe("custom");
  });

  it("falls back rather than trusting garbage", () => {
    const storage = memoryStorage({
      "zabloo.preview.viewport": "???",
      "zabloo.preview.custom": "wide",
      "zabloo.preview.dpr": "9",
    });

    expect(readLegacyViewport(storage)).toEqual({
      preset: "fit",
      custom: { width: 1280, height: 720 },
      dpr: "auto",
    });
  });
});
