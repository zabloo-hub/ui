// Pure Slider math (2026-08-11, ZAB-24), a port of `renderer-web/src/slider.ts`.
// Shared by the build pass, the arrange pass, the input handlers and the host
// channel — one set of rules, so a value tapped on the track, nudged with an
// arrow or pushed by the game all land on the same number.
//
// The geometric model, in one place: the thumb's travel is the track minus the
// thumb's own size, so the thumb never paints outside the node's rect; the fill
// spans the whole fraction of the track, so it reaches the end at `max`.

#pragma once

#include <optional>

#include "envelope.h"

namespace zabloo {

/** A slider's resolved range. `min`/`max` are author input, so they can be nonsense. */
struct SliderRange {
  double min = 0.0;
  double max = 1.0;
  /** Quantization step, or 0 for a continuous value. */
  double step = 0.0;
};

/**
 * Resolves the declared range, defaulting to the unit interval. A degenerate
 * range (`max <= min`, a negative step) collapses to a FIXED slider rather than
 * dividing by zero further down: it paints at its minimum and ignores input,
 * which is a visible authoring bug instead of a crash or a NaN rect.
 */
SliderRange resolve_range(const std::optional<double> &min, const std::optional<double> &max,
                          const std::optional<double> &step);

/**
 * Clamps into the range and snaps to `min + k * step` (no step = continuous).
 *
 * `max` is always a valid stop, even when the range is not a whole number of
 * steps (0..1 by 0.3 stops at 0.9): the player can SEE the end of the track, so
 * leaving it unreachable reads as a stuck control. The price is a short last
 * step, which is the smaller surprise.
 */
double quantize(double value, const SliderRange &range);

/** Position of a value along the track, as a 0..1 fraction. */
double fraction_of(double value, const SliderRange &range);

/**
 * The value a pointer at `position` selects, given the track's own start and
 * length along its axis and the thumb's size. The travel is inset by half a
 * thumb at each end — the same inset `thumb_start` paints with — so the point
 * under the finger stays under the thumb's center through the whole drag
 * instead of drifting near the ends.
 *
 * On a vertical track the value grows upward (`min` at the bottom), like a
 * physical fader: `up` flips the axis mapping for that.
 */
double value_at(double position, double start, double length, double thumb_size,
                const SliderRange &range, bool up = false);

/**
 * The value one arrow-key press away, `direction` being +1 or -1 along the
 * slider's axis. A continuous slider borrows a step of 5% of its range, so the
 * keyboard is usable without forcing authors to declare a `step` they only
 * wanted for quantization.
 */
double step_by(double value, double direction, const SliderRange &range);

/** Distance from the track's start to the thumb's near edge, at that fraction. */
double thumb_start(double fraction, double length, double thumb_size);

/**
 * How the fill and the thumb sit along the track, in track-relative px. The
 * fill spans the fraction of the FULL length (so `max` fills the rail to its
 * end) while the thumb moves inside the inset travel — the half-thumb gap at
 * the ends is what keeps every pixel inside the node's rect.
 *
 * On a vertical track both are measured from the bottom, so `start` is a
 * distance from the track's END; the caller flips it into view space.
 */
struct SliderGeometry {
  double fill_length = 0.0;
  double thumb_start = 0.0;
};

SliderGeometry slider_geometry(double fraction, double length, double thumb_size);

/** True when this axis grows upward — the vertical fader's bottom-to-top mapping. */
bool grows_upward(SliderAxis axis);

}  // namespace zabloo
