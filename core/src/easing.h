// The closed-form curve arithmetic — the normative half of motion.
//
// A port of `easeProgress`, `spinnerPulse` and `clampProgress` from
// `@zabloo/format`, which are reference implementations rather than helpers: the
// curves are four closed polynomials precisely so that parity between targets is
// ARITHMETIC and does not depend on two bezier solvers converging the same way
// (decision 2026-08-11, ZAB-33). If this file and its TypeScript original ever
// disagree in the third decimal, the same envelope paints two different frames.
//
// They live together here, and not one per behavior, because all three are that
// same promise: `spinnerPulse` is built on `easeProgress`, and `clampProgress` is
// the one answer to "what does a broken binding show" that every target owes.

#pragma once

#include "envelope.h"

namespace zabloo {

/**
 * Linear progress `t` (0..1) mapped through a curve. `t` outside 0..1 clamps, and
 * an unknown curve — newer content on an older reader — falls back to linear
 * rather than refusing to animate. NaN reads as 0.
 */
double ease_progress(Easing easing, double t);

/**
 * The `Spinner`'s wave: a bead's phase mapped to its 0..1 pulse (2026-08-11,
 * ZAB-35). A symmetric ramp — up over the first half of the cycle and back down
 * over the second — so the loop is seamless: `f(0) = 0`, `f(0.5) = 1`, and `f`
 * approaches 0 again as the phase completes. Phases outside 0..1 wrap, negative
 * ones included, which is exactly how a bead's offset arrives.
 */
double spinner_pulse(double phase, Easing easing = Easing::EaseInOut);

/**
 * Normative reading of a `ProgressBar`'s `value`: clamped to 0..1, with anything
 * that is not a finite number — missing data, a string, NaN — read as 0. An empty
 * bar, never a full one.
 */
double clamp_progress(double value);

}  // namespace zabloo
