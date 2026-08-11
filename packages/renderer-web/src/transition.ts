/**
 * The transition engine — the browser half of F7's interpolation pass (decision
 * 2026-08-11, ZAB-33). Pure and clock-injected: the view hands it a node's freshly
 * resolved target values plus `now`, and gets back the values to render this frame.
 *
 * It interpolates DECLARED INPUTS, never computed rects: the view writes the result
 * onto the node and then runs its normal measure/arrange pass with those numbers, so
 * there is one layout pass per frame and the layout never feeds back into its own
 * input. Curves come from `easeProgress` in `@zabloo/format` (the normative reference
 * implementation) — that shared arithmetic is what keeps web and Unity on the same
 * number every frame.
 */

import { type Easing, easeProgress } from "@zabloo/format";
import type { Color } from "./tessellator.js";

/** Animatable colors — lerped componentwise in straight sRGB with straight alpha. */
export type ColorProp = "background" | "borderColor" | "color";
/** Animatable scalars: paint values plus the layout dims, all lerped after token resolution. */
export type ScalarProp =
  | "opacity"
  | "radius"
  | "borderWidth"
  | "width"
  | "height"
  | "gap"
  | "padding";
export type AnimatableProp = ColorProp | ScalarProp;
export type AnimValue = number | Color;

/**
 * Scalars a COMPONENT'S BEHAVIOR tweens with endpoints it computes itself, rather
 * than values of the animatable set (decision 2026-08-11 §5): `progress` is the
 * ProgressBar's fraction, which is why the bar interpolates its value and never its
 * fill rect. They ride the same tracks as the declared props — one interruption rule,
 * one clock, one set of curves — under keys the animatable set cannot collide with.
 */
export type BehaviorKey = "progress";
export type TrackKey = AnimatableProp | BehaviorKey;

/** Iteration order of the animatable set — the normative list, nothing else animates. */
export const ANIMATABLE_PROPS: readonly AnimatableProp[] = [
  "background",
  "borderColor",
  "color",
  "opacity",
  "radius",
  "borderWidth",
  "width",
  "height",
  "gap",
  "padding",
];

/**
 * A node's animatable values for one frame: the targets the view resolves, and the
 * interpolated result `stepNode` hands back. Everything else (`fontSize`, `grow`, the
 * layout enums, every structural prop) snaps and never passes through here.
 */
export interface ResolvedValues {
  /** Absent = not declared: nothing is painted, so there is no honest endpoint — it snaps. */
  background?: Color;
  borderColor?: Color;
  color?: Color;
  /**
   * The renderer has a default for these (opacity 1, the rest 0), so both endpoints
   * always resolve to a number and they never snap for lack of a declared value.
   */
  opacity?: number;
  radius?: number;
  borderWidth?: number;
  gap?: number;
  padding?: number;
  /** Absent = auto (the measure pass decides): an auto endpoint snaps (decision §3). */
  width?: number;
  height?: number;
}

/** A tween in flight for one property. */
interface Track {
  from: AnimValue;
  to: AnimValue;
  startedAt: number;
  duration: number;
  easing: Easing;
}

/**
 * Per-node animation state. It lives on the layout node, so rebuilding the tree —
 * an envelope reload — drops it and everything snaps, which is exactly the rule:
 * transitions live INSIDE the life of one loaded document.
 */
export interface NodeAnim {
  tracks: Map<TrackKey, Track>;
  /** Last value handed to the renderer, per key — what an interruption tweens from. */
  current: Map<TrackKey, AnimValue>;
}

/** A node's `transition` with its `Dim` duration already resolved to milliseconds. */
export interface ResolvedTransition {
  duration: number;
  easing: Easing;
}

export function createNodeAnim(): NodeAnim {
  return { tracks: new Map(), current: new Map() };
}

/** Forgets everything: the next step snaps, like a mount. */
export function clearNodeAnim(anim: NodeAnim): void {
  anim.tracks.clear();
  anim.current.clear();
}

/**
 * Advances one node by one frame and returns the values to render with.
 *
 * A tween starts whenever a resolved value CHANGES, whatever caused the change —
 * there is no trigger list. It snaps when either endpoint is `undefined`, on the
 * first step (mount: no previous value), and when the node declares no usable
 * `transition`. An interruption retargets from the value on screen over a FULL
 * duration (the CSS model), so releasing a button mid-press leaves from the color
 * actually visible instead of snapping back or exiting unnaturally fast.
 */
export function stepNode(
  anim: NodeAnim,
  targets: ResolvedValues,
  transition: ResolvedTransition | null,
  now: number,
): { values: ResolvedValues; animating: boolean } {
  const values: ResolvedValues = {};
  let animating = false;

  for (const prop of ANIMATABLE_PROPS) {
    const stepped = stepTrack(anim, prop, targets[prop], transition, now);
    if (stepped.value === undefined) continue;
    animating ||= stepped.animating;
    // One cast for the whole loop: the prop union and the value union are correlated
    // by construction (a ColorProp only ever carries a Color), but TS cannot see it.
    (values as Record<AnimatableProp, AnimValue>)[prop] = stepped.value;
  }

  return { values, animating };
}

/**
 * The same step for a scalar a component's behavior owns (the ProgressBar's
 * fraction). It takes the endpoints already computed, so the behavior decides WHAT
 * moves while this file keeps deciding HOW — one interruption rule and one curve set
 * for declared props and behavior-driven ones alike.
 */
export function stepValue(
  anim: NodeAnim,
  key: BehaviorKey,
  target: number,
  transition: ResolvedTransition | null,
  now: number,
): { value: number; animating: boolean } {
  const stepped = stepTrack(anim, key, target, transition, now);
  return {
    value: typeof stepped.value === "number" ? stepped.value : target,
    animating: stepped.animating,
  };
}

/** Advances one track by one frame. `undefined` in ⇒ the key snaps and is forgotten. */
function stepTrack(
  anim: NodeAnim,
  key: TrackKey,
  target: AnimValue | undefined,
  transition: ResolvedTransition | null,
  now: number,
): { value: AnimValue | undefined; animating: boolean } {
  // Sample the tween in flight FIRST, so `current` is the value on screen right
  // now — that is the point a retarget below has to leave from.
  const track = anim.tracks.get(key);
  if (track) {
    const progress = (now - track.startedAt) / track.duration;
    anim.current.set(key, lerp(track.from, track.to, easeProgress(track.easing, progress)));
    if (progress >= 1) anim.tracks.delete(key);
  }

  if (target === undefined) {
    // Not declared (or auto): no endpoint to tween towards, and nothing to paint.
    anim.tracks.delete(key);
    anim.current.delete(key);
    return { value: undefined, animating: false };
  }

  const live = anim.tracks.get(key);
  const current = anim.current.get(key);
  let value: AnimValue;
  let animating = false;

  if (current === undefined) {
    value = target; // mount, or a node coming back into layout
  } else if (live) {
    if (sameValue(live.to, target)) {
      value = current; // already heading there
      animating = true;
    } else {
      value = retarget(anim, key, current, target, transition, now);
      animating = anim.tracks.has(key);
    }
  } else if (sameValue(current, target)) {
    value = current; // settled
  } else {
    value = retarget(anim, key, current, target, transition, now);
    animating = anim.tracks.has(key);
  }

  anim.current.set(key, value);
  return { value, animating };
}

/**
 * Points the property at a new target from where it currently is. Without a usable
 * transition (absent, `duration <= 0`, not finite) the change is instant — the exact
 * pre-F7 behavior.
 */
function retarget(
  anim: NodeAnim,
  key: TrackKey,
  current: AnimValue,
  target: AnimValue,
  transition: ResolvedTransition | null,
  now: number,
): AnimValue {
  if (!transition || !(transition.duration > 0) || !Number.isFinite(transition.duration)) {
    anim.tracks.delete(key);
    return target;
  }
  anim.tracks.set(key, {
    from: current,
    to: target,
    startedAt: now,
    duration: transition.duration,
    easing: transition.easing,
  });
  return current;
}

/**
 * Repeating 0..1 phase for behavior-driven loops (the Spinner's spin). The other
 * half of the machinery is the view's frame loop, which keeps scheduling while
 * anything is animating; a behavior samples this to drive its own endpoints.
 */
export function loopPhase(startedAt: number, now: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(period)) return 0;
  const elapsed = now - startedAt;
  if (!(elapsed > 0)) return 0; // also catches NaN
  return (elapsed % period) / period;
}

/** Componentwise lerp in STRAIGHT sRGB with STRAIGHT alpha — no premultiply, no gamma. */
export function lerpColor(from: Color, to: Color, t: number): Color {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    from[3] + (to[3] - from[3]) * t,
  ];
}

function lerp(from: AnimValue, to: AnimValue, t: number): AnimValue {
  if (typeof from === "number") return typeof to === "number" ? from + (to - from) * t : to;
  return typeof to === "number" ? to : lerpColor(from, to, t);
}

function sameValue(a: AnimValue, b: AnimValue): boolean {
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
