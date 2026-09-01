// The Spinner's wave — pure, so the loop's arithmetic is testable without a clock.
//
// The loop itself is behavior the core owns, keyed by node identity like the scroll
// offset (decision 2026-08-11 §5): the view samples `loop_phase` once per frame and
// this module turns that phase into each bead's opacity multiplier. The shape of
// the wave comes from `spinner_pulse` — the normative reference implementation,
// which is what keeps every target on the same number.
//
// It does not spin: v1 has no transform, so there is no arc to rotate. What IS
// expressible, and portable to the last decimal, is modulating opacity.

#pragma once

#include <cstddef>

#include "envelope.h"

namespace zabloo {

/** Defaults for the `Spinner`'s knobs — the IR leaves them to the SDK. */
inline constexpr double SPINNER_DEFAULT_PERIOD = 900.0;
inline constexpr double SPINNER_DEFAULT_MIN = 0.25;
inline constexpr Easing SPINNER_DEFAULT_EASING = Easing::EaseInOut;

/**
 * The opacity multiplier of bead `index` of `count` at cycle phase `phase` (0..1).
 *
 * Beads are spread evenly over the cycle (`index / count` behind the head), so the
 * crest travels along them: with three dots, one is bright while the next two are
 * on their way up and down. The result is MULTIPLIED onto the bead's own resolved
 * opacity by the caller — a dot authored at `opacity: 0.5` pulses just as much,
 * dimmer, which is how every other opacity in the system composes (2026-08-06).
 */
double bead_opacity(size_t index, size_t count, double phase, double min = SPINNER_DEFAULT_MIN,
                    Easing easing = SPINNER_DEFAULT_EASING);

}  // namespace zabloo
