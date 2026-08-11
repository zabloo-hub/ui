import { describe, expect, it } from "vitest";
import type { Color } from "./tessellator.js";
import {
  clearNodeAnim,
  createNodeAnim,
  lerpColor,
  loopPhase,
  type ResolvedTransition,
  type ResolvedValues,
  stepNode,
} from "./transition.js";

const LINEAR: ResolvedTransition = { duration: 100, easing: "linear" };

describe("lerpColor", () => {
  it("lerps every channel in straight sRGB, alpha included", () => {
    const from: Color = [0, 0, 0, 1];
    const to: Color = [1, 0.5, 0.25, 0];
    expect(lerpColor(from, to, 0.5)).toEqual([0.5, 0.25, 0.125, 0.5]);
  });

  it("returns the endpoints exactly at 0 and 1", () => {
    const from: Color = [0.2, 0.4, 0.6, 0.8];
    const to: Color = [1, 1, 1, 1];
    expect(lerpColor(from, to, 0)).toEqual(from);
    expect(lerpColor(from, to, 1)).toEqual(to);
  });
});

describe("stepNode", () => {
  it("snaps on the first step — a mount has no previous value to tween from", () => {
    const anim = createNodeAnim();
    const { values, animating } = stepNode(anim, { opacity: 0.5 }, LINEAR, 0);
    expect(values.opacity).toBe(0.5);
    expect(animating).toBe(false);
  });

  it("keeps returning the settled value while nothing changes", () => {
    const anim = createNodeAnim();
    stepNode(anim, { opacity: 1 }, LINEAR, 0);
    const { values, animating } = stepNode(anim, { opacity: 1 }, LINEAR, 16);
    expect(values.opacity).toBe(1);
    expect(animating).toBe(false);
  });

  it("tweens a change over the declared duration and settles on the target", () => {
    const anim = createNodeAnim();
    stepNode(anim, { radius: 0 }, LINEAR, 0);

    // The frame the target moves still paints the old value: the tween starts here.
    expect(stepNode(anim, { radius: 10 }, LINEAR, 0)).toEqual({
      values: { radius: 0 },
      animating: true,
    });
    expect(stepNode(anim, { radius: 10 }, LINEAR, 50).values.radius).toBe(5);
    expect(stepNode(anim, { radius: 10 }, LINEAR, 100)).toEqual({
      values: { radius: 10 },
      animating: false,
    });
  });

  it("holds the target after the duration elapses (a late frame does not overshoot)", () => {
    const anim = createNodeAnim();
    stepNode(anim, { radius: 0 }, LINEAR, 0);
    stepNode(anim, { radius: 10 }, LINEAR, 0);
    expect(stepNode(anim, { radius: 10 }, LINEAR, 5000).values.radius).toBe(10);
  });

  it("applies the node's easing curve, not linear progress", () => {
    const anim = createNodeAnim();
    const easeIn: ResolvedTransition = { duration: 100, easing: "ease-in" };
    stepNode(anim, { radius: 0 }, easeIn, 0);
    stepNode(anim, { radius: 100 }, easeIn, 0);
    // ease-in is t³ — the normative table's f(0.25).
    expect(stepNode(anim, { radius: 100 }, easeIn, 25).values.radius).toBe(1.5625);
  });

  it("tweens colors componentwise, alpha included", () => {
    const anim = createNodeAnim();
    stepNode(anim, { background: [0, 0, 0, 1] }, LINEAR, 0);
    stepNode(anim, { background: [1, 0.5, 0.25, 0] }, LINEAR, 0);
    expect(stepNode(anim, { background: [1, 0.5, 0.25, 0] }, LINEAR, 50).values.background).toEqual(
      [0.5, 0.25, 0.125, 0.5],
    );
  });

  it("tweens layout dims like any other scalar — they are declared inputs", () => {
    const anim = createNodeAnim();
    stepNode(anim, { height: 40, gap: 0, padding: 8 }, LINEAR, 0);
    stepNode(anim, { height: 140, gap: 0, padding: 8 }, LINEAR, 0);
    const { values } = stepNode(anim, { height: 140, gap: 0, padding: 8 }, LINEAR, 50);
    expect(values.height).toBe(90);
    expect(values.padding).toBe(8); // untouched props stay put
  });

  it("animates several properties at once and reports itself busy until the last one lands", () => {
    const anim = createNodeAnim();
    const slow: ResolvedTransition = { duration: 200, easing: "linear" };
    stepNode(anim, { opacity: 0, background: [0, 0, 0, 1] }, slow, 0);
    stepNode(anim, { opacity: 1, background: [1, 1, 1, 1] }, slow, 0);
    const { values, animating } = stepNode(
      anim,
      { opacity: 1, background: [1, 1, 1, 1] },
      slow,
      100,
    );
    expect(values.opacity).toBe(0.5);
    expect(values.background).toEqual([0.5, 0.5, 0.5, 1]);
    expect(animating).toBe(true);
  });

  describe("snapping (the pre-F7 behavior)", () => {
    it("snaps with no transition declared", () => {
      const anim = createNodeAnim();
      stepNode(anim, { opacity: 0 }, null, 0);
      expect(stepNode(anim, { opacity: 1 }, null, 0)).toEqual({
        values: { opacity: 1 },
        animating: false,
      });
    });

    it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
      "snaps when the duration resolves to %p",
      (duration) => {
        const anim = createNodeAnim();
        const transition: ResolvedTransition = { duration, easing: "linear" };
        stepNode(anim, { opacity: 0 }, transition, 0);
        expect(stepNode(anim, { opacity: 1 }, transition, 0).values.opacity).toBe(1);
      },
    );

    it("snaps when the incoming endpoint is undefined — auto has no number to tween to", () => {
      const anim = createNodeAnim();
      stepNode(anim, { width: 100 }, LINEAR, 0);
      const { values, animating } = stepNode(anim, {}, LINEAR, 0);
      expect(values.width).toBeUndefined();
      expect(animating).toBe(false);
    });

    it("snaps when the outgoing endpoint is undefined — auto has no number to tween from", () => {
      const anim = createNodeAnim();
      stepNode(anim, {}, LINEAR, 0);
      expect(stepNode(anim, { width: 100 }, LINEAR, 0).values.width).toBe(100);
    });

    it("drops a tween in flight when its target disappears", () => {
      const anim = createNodeAnim();
      stepNode(anim, { width: 0 }, LINEAR, 0);
      stepNode(anim, { width: 100 }, LINEAR, 0);
      expect(stepNode(anim, {}, LINEAR, 50).animating).toBe(false);
      // And the property starts over: coming back is a mount, not a resume.
      expect(stepNode(anim, { width: 100 }, LINEAR, 50).values.width).toBe(100);
    });

    it("snaps after clearNodeAnim — the state a node loses when it leaves layout", () => {
      const anim = createNodeAnim();
      stepNode(anim, { opacity: 0 }, LINEAR, 0);
      clearNodeAnim(anim);
      expect(stepNode(anim, { opacity: 1 }, LINEAR, 0)).toEqual({
        values: { opacity: 1 },
        animating: false,
      });
    });
  });

  describe("interruption", () => {
    it("retargets from the value on screen over a FULL duration (the CSS model)", () => {
      const anim = createNodeAnim();
      stepNode(anim, { radius: 0 }, LINEAR, 0);
      stepNode(anim, { radius: 10 }, LINEAR, 0);
      expect(stepNode(anim, { radius: 10 }, LINEAR, 50).values.radius).toBe(5);

      // Halfway there, the state flips back: it leaves from 5, not from 10 or 0…
      expect(stepNode(anim, { radius: 0 }, LINEAR, 50).values.radius).toBe(5);
      // …and takes the whole duration to get home, not the 50ms that were left.
      expect(stepNode(anim, { radius: 0 }, LINEAR, 100).values.radius).toBe(2.5);
      expect(stepNode(anim, { radius: 0 }, LINEAR, 150)).toEqual({
        values: { radius: 0 },
        animating: false,
      });
    });

    it("re-aims at a third target mid-flight without ever jumping", () => {
      const anim = createNodeAnim();
      stepNode(anim, { opacity: 0 }, LINEAR, 0);
      stepNode(anim, { opacity: 1 }, LINEAR, 0);
      expect(stepNode(anim, { opacity: 1 }, LINEAR, 20).values.opacity).toBeCloseTo(0.2, 10);
      expect(stepNode(anim, { opacity: 0.5 }, LINEAR, 20).values.opacity).toBeCloseTo(0.2, 10);
      expect(stepNode(anim, { opacity: 0.5 }, LINEAR, 70).values.opacity).toBeCloseTo(0.35, 10);
    });

    it("snaps mid-flight when the transition is removed", () => {
      const anim = createNodeAnim();
      stepNode(anim, { radius: 0 }, LINEAR, 0);
      stepNode(anim, { radius: 10 }, LINEAR, 0);
      expect(stepNode(anim, { radius: 20 }, null, 50)).toEqual({
        values: { radius: 20 },
        animating: false,
      });
    });
  });

  it("ignores props that are not in the animatable set", () => {
    const anim = createNodeAnim();
    const targets = { opacity: 1, fontSize: 24 } as ResolvedValues;
    expect(stepNode(anim, targets, LINEAR, 0).values).toEqual({ opacity: 1 });
  });
});

describe("loopPhase", () => {
  it("starts at 0 and reaches the middle of the cycle at half a period", () => {
    expect(loopPhase(0, 0, 1000)).toBe(0);
    expect(loopPhase(0, 500, 1000)).toBe(0.5);
  });

  it("wraps: a whole period is back at the start", () => {
    expect(loopPhase(0, 1000, 1000)).toBe(0);
    expect(loopPhase(0, 2500, 1000)).toBe(0.5);
  });

  it("counts from its own start, not from the clock's origin", () => {
    expect(loopPhase(400, 700, 1000)).toBeCloseTo(0.3, 10);
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    "holds at 0 for a period of %p",
    (period) => {
      expect(loopPhase(0, 500, period)).toBe(0);
    },
  );

  it("holds at 0 before it starts", () => {
    expect(loopPhase(100, 50, 1000)).toBe(0);
  });
});
