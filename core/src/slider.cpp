#include <algorithm>
#include <cmath>

#include "slider.h"

namespace zabloo {
namespace {

/** Fallback arrow-key step when the slider is continuous: 5% of the range. */
constexpr double CONTINUOUS_STEPS = 20.0;

/**
 * Above this magnitude `tidy` leaves the number alone.
 *
 * Two reasons, and they meet: past ~1e5 a double's own spacing is wider than the
 * tenth decimal, so rounding there is already the identity map; and the `* 1e10`
 * the rounding is done with would leave the exactly-representable integers below
 * 2^53 and start rounding twice.
 */
constexpr double TIDY_LIMIT = 1e5;

/**
 * Drops binary-float noise from a stepped value (`0.1 * 3` is
 * `0.30000000000000004`): the number travels to the game through the data
 * channel and may be shown as text, so a step of `0.1` must produce `0.3`. It
 * rounds far past any precision an author declares — it cleans up, it does not
 * quantize.
 *
 * The reference spells this `Number(value.toFixed(10))`, which rounds halves
 * UP (toward +infinity) and not away from zero: hence `floor(v + 0.5)` and not
 * `std::round`, the same parity note the glyph snap carries (G4).
 */
double tidy(double value) {
  if (!std::isfinite(value)) return value;
  if (value == std::floor(value)) return value;  // `Number.isInteger`
  if (std::abs(value) >= TIDY_LIMIT) return value;
  return std::floor(value * 1e10 + 0.5) / 1e10;
}

double clamp_to(double value, const SliderRange &range) {
  return std::min(range.max, std::max(range.min, value));
}

}  // namespace

SliderRange resolve_range(const std::optional<double> &min, const std::optional<double> &max,
                          const std::optional<double> &step) {
  const double low = min.value_or(0.0);
  const double high = max.value_or(1.0);
  const double declared = step.value_or(0.0);
  SliderRange range;
  range.min = low;
  range.max = std::max(low, high);
  range.step = declared > 0.0 ? declared : 0.0;
  return range;
}

double quantize(double value, const SliderRange &range) {
  const double clamped = clamp_to(std::isfinite(value) ? value : range.min, range);
  if (range.step <= 0.0) return clamped;
  const double steps = std::floor((clamped - range.min) / range.step + 0.5);
  const double snapped = std::min(range.max, tidy(range.min + steps * range.step));
  return range.max - clamped <= clamped - snapped ? range.max : snapped;
}

double fraction_of(double value, const SliderRange &range) {
  const double span = range.max - range.min;
  if (!(span > 0.0)) return 0.0;
  const double clamped = clamp_to(std::isfinite(value) ? value : range.min, range);
  return (clamped - range.min) / span;
}

double value_at(double position, double start, double length, double thumb_size,
                const SliderRange &range, bool up) {
  const double travel = std::max(0.0, length - thumb_size);
  const double from = start + thumb_size / 2.0;
  const double raw = travel > 0.0 ? (position - from) / travel : 0.0;
  const double fraction = std::min(1.0, std::max(0.0, up ? 1.0 - raw : raw));
  return quantize(range.min + fraction * (range.max - range.min), range);
}

double step_by(double value, double direction, const SliderRange &range) {
  const double span = range.max - range.min;
  if (!(span > 0.0)) return range.min;
  const double step = range.step > 0.0 ? range.step : span / CONTINUOUS_STEPS;
  return quantize(quantize(value, range) + direction * step, range);
}

double thumb_start(double fraction, double length, double thumb_size) {
  return std::max(0.0, length - thumb_size) * fraction;
}

SliderGeometry slider_geometry(double fraction, double length, double thumb_size) {
  const double clamped = std::min(1.0, std::max(0.0, fraction));
  SliderGeometry out;
  out.fill_length = length * clamped;
  out.thumb_start = thumb_start(clamped, length, std::min(thumb_size, length));
  return out;
}

bool grows_upward(SliderAxis axis) { return axis == SliderAxis::Vertical; }

}  // namespace zabloo
