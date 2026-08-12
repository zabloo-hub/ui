import { describe, expect, it } from "vitest";
import { clamp, resolveScrollMax, revealDelta, scrollbarThumb } from "./scroll.js";

describe("clamp", () => {
  it("passes values already in range through unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("clamps to 0 when min === max", () => {
    expect(clamp(15, 0, 0)).toBe(0);
  });
});

describe("scrollbarThumb", () => {
  // 200 px track over a 200 px viewport with 200 px of overflow: content = 400,
  // so the thumb is half the track and travels the other half.
  it("length is the visible fraction of the content", () => {
    expect(scrollbarThumb(200, 200, 200, 0, 16)).toEqual({ start: 0, length: 100 });
  });

  it("start is proportional to the offset, ending flush with the track", () => {
    expect(scrollbarThumb(200, 200, 200, 100, 16)).toEqual({ start: 50, length: 100 });
    expect(scrollbarThumb(200, 200, 200, 200, 16)).toEqual({ start: 100, length: 100 });
  });

  it("stays visible on very long content, down to the minimum length", () => {
    expect(scrollbarThumb(200, 200, 100_000, 0, 16)).toMatchObject({ length: 16 });
    // A track shorter than the minimum takes the whole track rather than overflow.
    expect(scrollbarThumb(10, 200, 100_000, 0, 16)).toMatchObject({ length: 10 });
  });

  it("clamps an out-of-range offset instead of running off the track", () => {
    expect(scrollbarThumb(200, 200, 200, 999, 16)).toEqual({ start: 100, length: 100 });
    expect(scrollbarThumb(200, 200, 200, -50, 16)).toEqual({ start: 0, length: 100 });
  });

  it("is null when there is nothing to indicate", () => {
    expect(scrollbarThumb(200, 200, 0, 0, 16)).toBeNull(); // content fits
    expect(scrollbarThumb(0, 200, 200, 0, 16)).toBeNull(); // no room for the bar
    expect(scrollbarThumb(200, 0, 200, 0, 16)).toBeNull(); // collapsed viewport
  });
});

describe("resolveScrollMax", () => {
  it("column direction + vertical axis: main overflow becomes y, x is zeroed", () => {
    expect(resolveScrollMax("column", "vertical", 100, 40)).toEqual({ x: 0, y: 100 });
  });

  it("column direction + horizontal axis: cross overflow becomes x, y is zeroed", () => {
    expect(resolveScrollMax("column", "horizontal", 100, 40)).toEqual({ x: 40, y: 0 });
  });

  it("column direction + both axes: main -> y, cross -> x, nothing zeroed", () => {
    expect(resolveScrollMax("column", "both", 100, 40)).toEqual({ x: 40, y: 100 });
  });

  it("row direction + vertical axis: cross overflow becomes y, x is zeroed", () => {
    expect(resolveScrollMax("row", "vertical", 100, 40)).toEqual({ x: 0, y: 40 });
  });

  it("row direction + horizontal axis: main overflow becomes x, y is zeroed", () => {
    expect(resolveScrollMax("row", "horizontal", 100, 40)).toEqual({ x: 100, y: 0 });
  });

  it("row direction + both axes: main -> x, cross -> y, nothing zeroed", () => {
    expect(resolveScrollMax("row", "both", 100, 40)).toEqual({ x: 100, y: 40 });
  });

  it("defaults to vertical when axis is undefined", () => {
    expect(resolveScrollMax("column", undefined, 100, 40)).toEqual({ x: 0, y: 100 });
  });

  it("negative overflow (content smaller than viewport) clamps to zero, not negative", () => {
    expect(resolveScrollMax("column", "both", -20, -10)).toEqual({ x: 0, y: 0 });
  });
});

// A 100 px viewport starting at 0, and a 20 px target somewhere along the axis.
describe("revealDelta", () => {
  it("does not move a target that already fits", () => {
    expect(revealDelta(0, 20, 0, 100)).toBe(0);
    expect(revealDelta(40, 20, 0, 100)).toBe(0);
    expect(revealDelta(80, 20, 0, 100)).toBe(0); // flush with the far edge
  });

  it("scrolls back just enough to reach a target above the viewport", () => {
    expect(revealDelta(-30, 20, 0, 100)).toBe(-30);
  });

  it("scrolls forward just enough to reach a target below the viewport", () => {
    expect(revealDelta(110, 20, 0, 100)).toBe(30);
  });

  it("aligns the leading edge of a target bigger than the viewport", () => {
    expect(revealDelta(40, 300, 0, 100)).toBe(40);
  });

  it("leaves a target that already covers the whole viewport alone", () => {
    expect(revealDelta(-40, 300, 0, 100)).toBe(0);
  });

  it("works on a viewport that does not start at the origin", () => {
    expect(revealDelta(500, 20, 520, 100)).toBe(-20);
    expect(revealDelta(650, 20, 520, 100)).toBe(50);
  });
});
