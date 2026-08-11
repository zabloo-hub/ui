import { describe, expect, it } from "vitest";
import { type Clip, clipContains, intersectClip, isEmptyClip, scissorBox } from "./clip.js";

const RECT = { x: 100, y: 100, width: 200, height: 200 };

describe("intersectClip", () => {
  it("takes the rect as-is when nothing is inherited", () => {
    expect(intersectClip(null, RECT, 8)).toEqual({ ...RECT, radius: 8 });
  });

  it("intersects with the inherited region", () => {
    const inherited: Clip = { x: 0, y: 150, width: 200, height: 200, radius: 0 };
    expect(intersectClip(inherited, RECT, 0)).toEqual({
      x: 100,
      y: 150,
      width: 100,
      height: 150,
      radius: 0,
    });
  });

  it("caps the radius to the node's half-extents, like the tessellator", () => {
    expect(intersectClip(null, { x: 0, y: 0, width: 40, height: 10 }, 999).radius).toBe(5);
    expect(intersectClip(null, RECT, -4).radius).toBe(0);
  });

  it("keeps the innermost rounded clip: a square child does not drop the ancestor's corners", () => {
    const rounded: Clip = { ...RECT, radius: 12 };
    expect(intersectClip(rounded, RECT, 0).radius).toBe(12);
    expect(intersectClip(rounded, RECT, 4).radius).toBe(4);
  });

  it("collapses to a non-positive extent when the regions are disjoint", () => {
    const elsewhere: Clip = { x: 0, y: 0, width: 50, height: 50, radius: 0 };
    expect(isEmptyClip(intersectClip(elsewhere, RECT, 0))).toBe(true);
    expect(isEmptyClip(intersectClip(null, RECT, 0))).toBe(false);
    expect(isEmptyClip(null)).toBe(false); // no clip at all — everything is visible
  });
});

describe("clipContains", () => {
  const square: Clip = { ...RECT, radius: 0 };

  it("accepts everything without a clip", () => {
    expect(clipContains(null, { x: -1000, y: 1000 })).toBe(true);
  });

  it("accepts inside the rect and rejects outside it, edges included", () => {
    expect(clipContains(square, { x: 200, y: 200 })).toBe(true);
    expect(clipContains(square, { x: 100, y: 300 })).toBe(true);
    expect(clipContains(square, { x: 99, y: 200 })).toBe(false);
    expect(clipContains(square, { x: 200, y: 301 })).toBe(false);
  });

  it("rejects the cut corner of a rounded clip but keeps the straight edges", () => {
    const rounded: Clip = { ...RECT, radius: 40 };
    // (105, 105) sits inside the rect but outside the corner arc: 40 - 5 = 35
    // on each axis, and hypot(35, 35) ≈ 49.5 > 40.
    expect(clipContains(rounded, { x: 105, y: 105 })).toBe(false);
    expect(clipContains(rounded, { x: 132, y: 132 })).toBe(true); // inside the arc
    expect(clipContains(rounded, { x: 100, y: 200 })).toBe(true); // mid straight edge
  });
});

describe("scissorBox", () => {
  // 800×600 logical at dpr 2 → a 1600×1200 canvas.
  const box = (clip: Clip, dpr = 2) => scissorBox(clip, 800 * dpr, 600 * dpr, dpr);

  it("flips y (GL's origin is bottom-left) and scales to device px", () => {
    expect(box({ x: 100, y: 100, width: 200, height: 200, radius: 0 })).toEqual({
      x: 200,
      y: 600, // 1200 - (100 + 200) * 2
      width: 400,
      height: 400,
    });
  });

  it("snaps outward, so the shader's antialiased edge is never cut by the scissor", () => {
    expect(box({ x: 10.4, y: 10.4, width: 100.2, height: 100.2, radius: 0 })).toEqual({
      x: 20,
      y: 978, // 1200 - ceil(110.6 * 2)
      width: 202,
      height: 202,
    });
  });

  it("clamps to the canvas instead of emitting a negative extent", () => {
    const offscreen = box({ x: -400, y: -400, width: 200, height: 200, radius: 0 });
    expect(offscreen).toEqual({ x: 0, y: 1200, width: 0, height: 0 });

    const overflowing = box({ x: 700, y: 500, width: 400, height: 400, radius: 0 });
    expect(overflowing).toEqual({ x: 1400, y: 0, width: 200, height: 200 });
  });
});
