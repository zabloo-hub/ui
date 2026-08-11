import { describe, expect, it } from "vitest";
import { fractionOf, quantize, resolveRange, sliderGeometry, stepBy, valueAt } from "./slider.js";

const UNIT = resolveRange(undefined, undefined, undefined);
const PERCENT = resolveRange(0, 100, 10);

describe("resolveRange", () => {
  it("defaults to the unit interval, continuous", () => {
    expect(UNIT).toEqual({ min: 0, max: 1, step: 0 });
  });

  it("keeps a declared range and step", () => {
    expect(PERCENT).toEqual({ min: 0, max: 100, step: 10 });
  });

  it("collapses a backwards or degenerate range instead of dividing by zero", () => {
    expect(resolveRange(10, 2, 1)).toEqual({ min: 10, max: 10, step: 1 });
    expect(resolveRange(Number.NaN, "x", -5)).toEqual({ min: 0, max: 1, step: 0 });
  });
});

describe("quantize", () => {
  it("clamps into the range", () => {
    expect(quantize(-3, UNIT)).toBe(0);
    expect(quantize(9, UNIT)).toBe(1);
    expect(quantize(0.25, UNIT)).toBe(0.25);
  });

  it("snaps to min + k * step", () => {
    expect(quantize(43, PERCENT)).toBe(40);
    expect(quantize(46, PERCENT)).toBe(50);
    expect(quantize(7, resolveRange(5, 25, 5))).toBe(5);
  });

  it("keeps the end of the track reachable when the range is not whole steps", () => {
    const range = resolveRange(0, 1, 0.3);
    expect(quantize(1, range)).toBe(1);
    expect(quantize(0.97, range)).toBe(1);
    expect(quantize(0.8, range)).toBe(0.9); // still the nearest grid stop
  });

  it("drops binary-float noise from a stepped value", () => {
    expect(quantize(0.31, resolveRange(0, 1, 0.1))).toBe(0.3);
    expect(quantize(0.7, resolveRange(0, 1, 0.05))).toBe(0.7);
  });

  it("falls back to the minimum for a non-numeric value", () => {
    expect(quantize(Number.NaN, PERCENT)).toBe(0);
  });
});

describe("fractionOf", () => {
  it("maps the range onto 0..1", () => {
    expect(fractionOf(0, UNIT)).toBe(0);
    expect(fractionOf(0.5, UNIT)).toBe(0.5);
    expect(fractionOf(75, PERCENT)).toBe(0.75);
  });

  it("clamps out-of-range values", () => {
    expect(fractionOf(-1, UNIT)).toBe(0);
    expect(fractionOf(500, PERCENT)).toBe(1);
  });

  it("pins a degenerate range to its start", () => {
    expect(fractionOf(10, resolveRange(10, 10, 0))).toBe(0);
  });
});

describe("valueAt", () => {
  // A 100px track with a 20px thumb: the travel is the middle 80px, and the
  // ends are reachable from anywhere beyond the thumb's own half.
  const track = { start: 0, length: 100, thumb: 20 };
  const at = (position: number, up = false) =>
    valueAt(position, track.start, track.length, track.thumb, UNIT, up);

  it("puts the value under the thumb's center", () => {
    expect(at(10)).toBe(0);
    expect(at(50)).toBe(0.5);
    expect(at(90)).toBe(1);
  });

  it("clamps beyond the inset travel", () => {
    expect(at(0)).toBe(0);
    expect(at(-40)).toBe(0);
    expect(at(100)).toBe(1);
    expect(at(999)).toBe(1);
  });

  it("honours the track's own offset", () => {
    expect(valueAt(210, 200, 100, 20, UNIT)).toBe(0);
    expect(valueAt(250, 200, 100, 20, UNIT)).toBe(0.5);
  });

  it("grows upward on a vertical track (min at the bottom)", () => {
    expect(at(10, true)).toBe(1);
    expect(at(50, true)).toBe(0.5);
    expect(at(90, true)).toBe(0);
  });

  it("quantizes what the pointer picks", () => {
    expect(valueAt(50, 0, 100, 20, PERCENT)).toBe(50);
    expect(valueAt(56, 0, 100, 20, PERCENT)).toBe(60);
  });

  it("survives a track with no room to travel", () => {
    expect(valueAt(5, 0, 10, 40, UNIT)).toBe(0);
  });
});

describe("stepBy", () => {
  it("moves by the declared step", () => {
    expect(stepBy(40, 1, PERCENT)).toBe(50);
    expect(stepBy(40, -1, PERCENT)).toBe(30);
  });

  it("borrows 5% of the range when the slider is continuous", () => {
    expect(stepBy(0.5, 1, UNIT)).toBeCloseTo(0.55, 10);
    expect(stepBy(0.5, -1, UNIT)).toBeCloseTo(0.45, 10);
  });

  it("stops at the ends", () => {
    expect(stepBy(1, 1, UNIT)).toBe(1);
    expect(stepBy(0, -1, UNIT)).toBe(0);
    expect(stepBy(95, 1, PERCENT)).toBe(100);
  });

  it("snaps an off-step value onto the grid as it moves", () => {
    expect(stepBy(43, 1, PERCENT)).toBe(50);
    expect(stepBy(43, -1, PERCENT)).toBe(30);
  });
});

describe("sliderGeometry", () => {
  it("fills the fraction of the whole track and insets the thumb", () => {
    expect(sliderGeometry(0, 100, 20)).toEqual({ fillLength: 0, thumbStart: 0 });
    expect(sliderGeometry(0.5, 100, 20)).toEqual({ fillLength: 50, thumbStart: 40 });
    expect(sliderGeometry(1, 100, 20)).toEqual({ fillLength: 100, thumbStart: 80 });
  });

  it("keeps the thumb inside the track", () => {
    const { thumbStart } = sliderGeometry(1, 100, 20);
    expect(thumbStart + 20).toBeLessThanOrEqual(100);
  });

  it("does not travel with a thumb wider than its track", () => {
    expect(sliderGeometry(1, 30, 50)).toEqual({ fillLength: 30, thumbStart: 0 });
  });

  it("clamps a fraction outside 0..1", () => {
    expect(sliderGeometry(-1, 100, 20).fillLength).toBe(0);
    expect(sliderGeometry(2, 100, 20).fillLength).toBe(100);
  });
});
