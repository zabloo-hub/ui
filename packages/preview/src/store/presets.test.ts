/**
 * The viewport vocabulary. `fitScale` is the one with history: the rule that it
 * never goes above 1 is ZAB-78's, and every zoom in the chrome comes through it.
 */

import { fitScale, isDpr, isPresetId, PRESETS, parseSize, preset, presetOfSize } from "./presets";

describe("preset", () => {
  it("answers with a preset for anything, and with fit for the unknown", () => {
    expect(preset("steamdeck").size).toEqual({ width: 1280, height: 800 });
    expect(preset("nope" as never).id).toBe("fit");
  });

  it("leaves fit and custom without a size", () => {
    expect(preset("fit").size).toBeNull();
    expect(preset("custom").size).toBeNull();
    expect(PRESETS.filter((entry) => entry.size === null)).toHaveLength(2);
  });
});

describe("isPresetId / isDpr", () => {
  it("recognizes only what the pickers can produce", () => {
    expect(isPresetId("1080p")).toBe(true);
    expect(isPresetId("1920x1080")).toBe(false);
    expect(isDpr("auto")).toBe(true);
    expect(isDpr(2)).toBe(true);
    expect(isDpr("2")).toBe(false);
    expect(isDpr(4)).toBe(false);
  });
});

describe("fitScale", () => {
  it("shrinks to whichever axis runs out first", () => {
    expect(fitScale(1920, 1080, 960, 1080)).toBeCloseTo(0.5);
    expect(fitScale(1280, 800, 768, 480)).toBeCloseTo(0.6);
  });

  it("never magnifies", () => {
    expect(fitScale(1280, 720, 3840, 2160)).toBe(1);
  });

  it("answers 1 for a size nobody has measured yet", () => {
    expect(fitScale(1280, 720, 0, 0)).toBe(1);
    expect(fitScale(0, 0, 800, 600)).toBe(1);
  });
});

describe("parseSize", () => {
  it("reads the three separators the old box accepted", () => {
    expect(parseSize("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(parseSize(" 800 × 600 ")).toEqual({ width: 800, height: 600 });
    expect(parseSize("640*480")).toEqual({ width: 640, height: 480 });
  });

  it("refuses what is not a size", () => {
    expect(parseSize("160")).toBeNull();
    expect(parseSize("0x600")).toBeNull();
    expect(parseSize("999999x1")).toBeNull();
    expect(parseSize("")).toBeNull();
  });
});

describe("presetOfSize", () => {
  it("finds the preset a raw resolution names", () => {
    expect(presetOfSize({ width: 1920, height: 1080 })?.id).toBe("1080p");
    expect(presetOfSize({ width: 1234, height: 567 })).toBeNull();
  });
});
