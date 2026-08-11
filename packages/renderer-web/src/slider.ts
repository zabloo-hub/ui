/**
 * Pure Slider math (ZAB-24) shared by the build pass, the arrange pass, the
 * input handlers and `setData`. No DOM — kept separate so it's unit testable
 * without a canvas, and so the Unity SDK has an unambiguous reference for the
 * same rules (the same role `toggle.ts` plays for the two-state control).
 *
 * The geometric model, in one place: the thumb's travel is the track minus the
 * thumb's own size, so the thumb never paints outside the node's rect; the fill
 * spans the whole fraction of the track, so it reaches the end at `max`.
 */

import type { SliderAxis } from "@zabloo/format";

/** Fallback arrow-key step when the slider is continuous: 5% of the range. */
const CONTINUOUS_STEPS = 20;

/** A slider's resolved range. `min`/`max` are author input, so they can be nonsense. */
export interface SliderRange {
  min: number;
  max: number;
  /** Quantization step, or 0 for a continuous value. */
  step: number;
}

/**
 * Resolves the declared range, defaulting to the unit interval. A degenerate
 * range (`max <= min`, NaN, a negative step) collapses to a fixed slider rather
 * than dividing by zero further down: it paints at its minimum and ignores
 * input, which is a visible authoring bug instead of a crash or a NaN rect.
 */
export function resolveRange(min: unknown, max: unknown, step: unknown): SliderRange {
  const lo = finite(min, 0);
  const hi = finite(max, 1);
  const declared = finite(step, 0);
  return {
    min: lo,
    max: Math.max(lo, hi),
    step: declared > 0 ? declared : 0,
  };
}

/**
 * Clamps into the range and snaps to `min + k * step` (no step = continuous).
 *
 * `max` is always a valid stop, even when the range is not a whole number of
 * steps (0..1 by 0.3 stops at 0.9): the player can SEE the end of the track, so
 * leaving it unreachable reads as a stuck control. The price is a short last
 * step, which is the smaller surprise.
 */
export function quantize(value: number, range: SliderRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, finite(value, range.min)));
  if (range.step <= 0) return clamped;
  const steps = Math.round((clamped - range.min) / range.step);
  const snapped = Math.min(range.max, tidy(range.min + steps * range.step));
  return range.max - clamped <= clamped - snapped ? range.max : snapped;
}

/** Position of a value along the track, as a 0..1 fraction. */
export function fractionOf(value: number, range: SliderRange): number {
  const span = range.max - range.min;
  if (!(span > 0)) return 0;
  const clamped = Math.min(range.max, Math.max(range.min, finite(value, range.min)));
  return (clamped - range.min) / span;
}

/**
 * The value a pointer at `position` selects, given the track's own start and
 * length along its axis and the thumb's size. The travel is inset by half a
 * thumb at each end — the same inset `thumbStart` paints with — so the point
 * under the finger stays under the thumb's center through the whole drag
 * instead of drifting near the ends.
 *
 * On a vertical track the value grows upward (`min` at the bottom), like a
 * physical fader: `up` flips the axis mapping for that.
 */
export function valueAt(
  position: number,
  start: number,
  length: number,
  thumbSize: number,
  range: SliderRange,
  up = false,
): number {
  const travel = Math.max(0, length - thumbSize);
  const from = start + thumbSize / 2;
  const raw = travel > 0 ? (position - from) / travel : 0;
  const fraction = Math.min(1, Math.max(0, up ? 1 - raw : raw));
  return quantize(range.min + fraction * (range.max - range.min), range);
}

/**
 * The value one arrow-key press away, `direction` being +1 or -1 along the
 * slider's axis. A continuous slider borrows a step of 5% of its range, so the
 * keyboard is usable without forcing authors to declare a `step` they only
 * wanted for quantization.
 */
export function stepBy(value: number, direction: number, range: SliderRange): number {
  const span = range.max - range.min;
  if (!(span > 0)) return range.min;
  const step = range.step > 0 ? range.step : span / CONTINUOUS_STEPS;
  return quantize(quantize(value, range) + direction * step, range);
}

/** Distance from the track's start to the thumb's near edge, at that fraction. */
export function thumbStart(fraction: number, length: number, thumbSize: number): number {
  return Math.max(0, length - thumbSize) * fraction;
}

/**
 * How the fill and the thumb sit along the track, in track-relative px. The
 * fill spans the fraction of the FULL length (so `max` fills the rail to its
 * end) while the thumb moves inside the inset travel — the half-thumb gap at
 * the ends is what keeps every pixel inside the node's rect.
 *
 * On a vertical track both are measured from the bottom, so `start` is a
 * distance from the track's END; the caller flips it into view space.
 */
export interface SliderGeometry {
  fillLength: number;
  thumbStart: number;
}

export function sliderGeometry(
  fraction: number,
  length: number,
  thumbSize: number,
): SliderGeometry {
  const clamped = Math.min(1, Math.max(0, fraction));
  return {
    fillLength: length * clamped,
    thumbStart: thumbStart(clamped, length, Math.min(thumbSize, length)),
  };
}

/** True when this axis grows upward — the vertical fader's bottom-to-top mapping. */
export function growsUpward(axis: SliderAxis | undefined): boolean {
  return axis === "vertical";
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Drops binary-float noise from a stepped value (`0.1 * 3` is
 * `0.30000000000000004`): the number travels to the game through the data
 * channel and may be shown as text, so a step of `0.1` must produce `0.3`. It
 * rounds far past any precision an author declares — it cleans up, it does not
 * quantize.
 */
function tidy(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(10));
}
