import { describe, expect, it } from "vitest";
import { beadOpacity, DEFAULT_MIN } from "./spinner.js";
import { loopPhase } from "./transition.js";

describe("beadOpacity", () => {
  it("spreads the crest over the beads: each one peaks at its own phase", () => {
    // Bead i peaks when the cycle phase is i/n + 0.5 — the crest travels.
    for (const i of Array(3).keys()) {
      expect(beadOpacity(i, 3, i / 3 + 0.5)).toBe(1);
    }
  });

  it("sits at the floor when a bead's own phase is at the trough", () => {
    expect(beadOpacity(0, 3, 0)).toBe(DEFAULT_MIN);
    expect(beadOpacity(1, 3, 1 / 3)).toBeCloseTo(DEFAULT_MIN, 10);
  });

  it("never leaves the floor..1 band, whatever the phase", () => {
    for (const step of Array(41).keys()) {
      const value = beadOpacity(1, 3, step / 40);
      expect(value).toBeGreaterThanOrEqual(DEFAULT_MIN - 1e-12);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("takes the floor from `min`, clamped", () => {
    expect(beadOpacity(0, 3, 0, 0)).toBe(0);
    expect(beadOpacity(0, 3, 0, 0.8)).toBeCloseTo(0.8, 10);
    // A bead is never brighter than its own opacity: min > 1 flattens to a steady 1.
    expect(beadOpacity(0, 3, 0, 5)).toBe(1);
    expect(beadOpacity(0, 3, 0, Number.NaN)).toBe(0);
  });

  it("takes the ramp curve from `easing`", () => {
    // Halfway up the ramp, linear is at 0.5 of the band and ease-in well below it.
    const linear = beadOpacity(0, 1, 0.25, 0, "linear");
    const easeIn = beadOpacity(0, 1, 0.25, 0, "ease-in");
    expect(linear).toBeCloseTo(0.5, 10);
    expect(easeIn).toBeLessThan(linear);
  });

  it("holds a single bead steady at full brightness when it has no cycle", () => {
    expect(beadOpacity(0, 0, 0.5)).toBe(1);
  });

  it("is seamless across the cycle boundary", () => {
    const before = beadOpacity(1, 3, 0.999);
    const after = beadOpacity(1, 3, 1.001);
    expect(after).toBeCloseTo(before, 2);
  });

  it("reads a real phase straight from loopPhase", () => {
    // 900 ms cycle, 450 ms in: bead 0 is at its crest.
    expect(beadOpacity(0, 3, loopPhase(0, 450, 900))).toBe(1);
    // A frozen period (a "reduce motion" theme) leaves the wave at its first frame.
    expect(loopPhase(0, 450, 0)).toBe(0);
  });
});
