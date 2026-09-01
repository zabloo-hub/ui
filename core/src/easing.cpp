#include <cmath>

#include "easing.h"

namespace zabloo {

double ease_progress(Easing easing, double t) {
  // `!(t > 0)` rather than `t <= 0`, here and below, so a NaN takes this branch
  // instead of falling through to the polynomial — the reference's guard, and
  // the reason a broken duration shows the start of the curve, not garbage.
  if (!(t > 0.0)) return 0.0;
  if (t >= 1.0) return 1.0;
  switch (easing) {
    case Easing::EaseIn:
      return t * t * t;
    case Easing::EaseOut: {
      const double u = 1.0 - t;
      return 1.0 - u * u * u;
    }
    case Easing::EaseInOut: {
      if (t < 0.5) return 4.0 * t * t * t;
      const double u = -2.0 * t + 2.0;
      return 1.0 - u * u * u / 2.0;
    }
    case Easing::Linear:
      break;
  }
  return t;
}

double spinner_pulse(double phase, Easing easing) {
  if (!std::isfinite(phase)) return 0.0;
  const double p = phase - std::floor(phase);
  return p < 0.5 ? ease_progress(easing, p * 2.0) : ease_progress(easing, (1.0 - p) * 2.0);
}

double clamp_progress(double value) {
  if (!std::isfinite(value) || !(value > 0.0)) return 0.0;  // NaN too
  return value > 1.0 ? 1.0 : value;
}

}  // namespace zabloo
