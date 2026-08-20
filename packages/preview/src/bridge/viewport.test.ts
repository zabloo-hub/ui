/** Viewport presets (ported from `preview-client.test.ts`, ZAB-78). */

import {
  fitScale,
  isViewportPreset,
  parseDpr,
  parseViewport,
  VIEWPORT_PRESETS,
} from "@/bridge/viewport";

describe("parseViewport", () => {
  it("reads the presets the picker offers", () => {
    expect(parseViewport("1920x1080", "")).toEqual({ fixed: true, width: 1920, height: 1080 });
    expect(parseViewport("1280x720", "")).toEqual({ fixed: true, width: 1280, height: 720 });
  });

  it("fits the window when nothing is pinned", () => {
    expect(parseViewport("fit", "1600x900")).toEqual({ fixed: false });
  });

  it("reads the custom box, in the shapes a person types", () => {
    for (const text of ["1600x900", "1600 x 900", " 1600×900 ", "1600*900"]) {
      expect(parseViewport("custom", text), text).toEqual({
        fixed: true,
        width: 1600,
        height: 900,
      });
    }
  });

  it("falls back to fitting while the custom box is half-typed", () => {
    // Not an error worth shouting about: it is a box mid-edit, and something
    // has to stay on screen while you type the rest.
    for (const text of ["", "1600", "1600x", "nope", "0x900"]) {
      expect(parseViewport("custom", text), text).toEqual({ fixed: false });
    }
  });

  it("has an answer for every preset it offers", () => {
    for (const preset of VIEWPORT_PRESETS) {
      expect(() => parseViewport(preset, "1600x900"), preset).not.toThrow();
    }
  });
});

describe("isViewportPreset", () => {
  it("accepts what the picker offers and rejects the rest", () => {
    expect(isViewportPreset("1920x1080")).toBe(true);
    expect(isViewportPreset("fit")).toBe(true);
    expect(isViewportPreset("800x600")).toBe(false);
    expect(isViewportPreset("")).toBe(false);
  });
});

describe("fitScale", () => {
  it("shrinks a viewport that does not fit", () => {
    expect(fitScale(1920, 1080, 960, 1080)).toBe(0.5);
    expect(fitScale(1920, 1080, 1920, 540)).toBe(0.5);
  });

  it("never scales UP — that would be showing you resampling, not your UI", () => {
    expect(fitScale(1280, 720, 3840, 2160)).toBe(1);
  });

  it("stays at 1 when the stage has not been laid out yet", () => {
    expect(fitScale(1920, 1080, 0, 0)).toBe(1);
  });
});

describe("parseDpr", () => {
  it("passes a forced ratio through", () => {
    expect(parseDpr("1")).toBe(1);
    expect(parseDpr("2")).toBe(2);
  });

  it("leaves the browser's own in place for `auto`", () => {
    expect(parseDpr("auto")).toBeUndefined();
    expect(parseDpr("")).toBeUndefined();
  });

  it("refuses a ratio no screen has, however it got into storage", () => {
    expect(parseDpr("0")).toBeUndefined();
    expect(parseDpr("-2")).toBeUndefined();
    expect(parseDpr("99")).toBe(8);
  });
});
