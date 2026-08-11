import { describe, expect, it } from "vitest";
import { clamp, resolveScrollMax } from "./scroll.js";

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
