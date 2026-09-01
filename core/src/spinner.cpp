#include <cstddef>

#include "easing.h"
#include "spinner.h"

namespace zabloo {

namespace {

double clamp01(double value) {
  if (!(value > 0.0)) return 0.0;  // also catches NaN
  return value > 1.0 ? 1.0 : value;
}

}  // namespace

double bead_opacity(size_t index, size_t count, double phase, double min, Easing easing) {
  if (count == 0) return 1.0;
  const double floor_value = clamp01(min);
  const double offset = static_cast<double>(index) / static_cast<double>(count);
  return floor_value + (1.0 - floor_value) * spinner_pulse(phase - offset, easing);
}

}  // namespace zabloo
