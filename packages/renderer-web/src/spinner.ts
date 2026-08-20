/**
 * Spinner wave — pure, so the loop's arithmetic is unit-testable without a clock.
 *
 * The loop itself is behavior the renderer owns, keyed by node identity like the
 * scroll offset (decision 2026-08-11 §5): the view samples `loopPhase` once per
 * frame and this module turns that phase into each bead's opacity multiplier. The
 * shape of the wave comes from `spinnerPulse` in `@zabloo/format` — the normative
 * reference implementation, which is what will keep Unity on the same number.
 */

import { type Easing, spinnerPulse } from "@zabloo/format";

/** Defaults for the `Spinner`'s knobs — the IR leaves them to the SDK. */
const DEFAULT_PERIOD = 900;
const DEFAULT_MIN = 0.25;
const DEFAULT_EASING: Easing = "ease-in-out";

/**
 * The opacity multiplier of bead `index` of `count` at cycle phase `phase` (0..1).
 *
 * Beads are spread evenly over the cycle (`index / count` behind the head), so the
 * crest travels along them: with three dots, one is bright while the next two are on
 * their way up and down. The result is MULTIPLIED onto the bead's own resolved
 * opacity by the caller — a dot authored at `opacity: 0.5` pulses just as much,
 * dimmer, which is how every other opacity in the system composes (2026-08-06).
 */
function beadOpacity(
  index: number,
  count: number,
  phase: number,
  min = DEFAULT_MIN,
  easing: Easing = DEFAULT_EASING,
): number {
  if (!(count > 0)) return 1;
  const floor = clamp01(min);
  return floor + (1 - floor) * spinnerPulse(phase - index / count, easing);
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0; // also catches NaN
  return value > 1 ? 1 : value;
}

export { beadOpacity, DEFAULT_EASING, DEFAULT_MIN, DEFAULT_PERIOD };
