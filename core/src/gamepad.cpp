#include "gamepad.h"

#include <algorithm>
#include <cmath>

namespace zabloo {
namespace {

/** -1, 0 or +1, with either zero reading as zero — the reference's `Math.sign`. */
double sign_of(double value) {
  if (value > 0.0) return 1.0;
  if (value < 0.0) return -1.0;
  return 0.0;
}

/**
 * Removes the dead zone and rescales what is left over the full 0..1 range, so
 * the stick starts moving the content from zero instead of jumping to the value
 * the threshold cut off.
 */
double taper(double value) {
  const double magnitude = std::fabs(value);
  if (magnitude <= PAD_SCROLL_DEADZONE) return 0.0;
  const double scaled = (magnitude - PAD_SCROLL_DEADZONE) / (1.0 - PAD_SCROLL_DEADZONE);
  return sign_of(value) * std::min(1.0, scaled);
}

std::optional<PadDirection> dpad_direction(const PadSnapshot &pad) {
  const double x = (pad.pressed(PAD_DPAD_RIGHT) ? 1.0 : 0.0) -
                   (pad.pressed(PAD_DPAD_LEFT) ? 1.0 : 0.0);
  if (x != 0.0) return PadDirection{x, 0.0};
  const double y = (pad.pressed(PAD_DPAD_DOWN) ? 1.0 : 0.0) -
                   (pad.pressed(PAD_DPAD_UP) ? 1.0 : 0.0);
  if (y != 0.0) return PadDirection{0.0, y};
  return std::nullopt;
}

std::optional<PadDirection> stick_direction(const PadSnapshot &pad,
                                            const std::optional<PadDirection> &held) {
  const double x = pad.axis(PAD_AXIS_LEFT_X);
  const double y = pad.axis(PAD_AXIS_LEFT_Y);
  const PadDirection dominant = std::fabs(x) >= std::fabs(y) ? PadDirection{sign_of(x), 0.0}
                                                             : PadDirection{0.0, sign_of(y)};
  if (dominant.dx == 0.0 && dominant.dy == 0.0) return std::nullopt;
  // The release threshold only applies to the direction already being held: any
  // OTHER direction is a new intention and has to clear the full dead zone.
  const double reach = std::fabs(dominant.dx == 0.0 ? y : x);
  const double threshold =
      held.has_value() && *held == dominant ? PAD_NAV_RELEASE : PAD_NAV_DEADZONE;
  if (reach < threshold) return std::nullopt;
  return dominant;
}

}  // namespace

double PadSnapshot::axis(size_t index) const {
  if (index >= axes.size()) return 0.0;
  const double value = axes[index];
  return std::isfinite(value) ? value : 0.0;
}

bool operator==(const PadDirection &a, const PadDirection &b) {
  return a.dx == b.dx && a.dy == b.dy;
}

PadIntent read_pad(const PadSnapshot &pad, const std::optional<PadDirection> &held) {
  PadIntent intent;
  intent.direction = dpad_direction(pad);
  if (!intent.direction.has_value()) intent.direction = stick_direction(pad, held);
  intent.press = pad.pressed(PAD_BUTTON_A);
  intent.back = pad.pressed(PAD_BUTTON_B);
  intent.scroll = PadScroll{taper(pad.axis(PAD_AXIS_RIGHT_X)), taper(pad.axis(PAD_AXIS_RIGHT_Y))};
  return intent;
}

PadScroll scroll_delta(const PadScroll &scroll, double dt_ms) {
  const double seconds = std::max(0.0, dt_ms) / 1000.0;
  // Squared response: the same stick gives fine control near the center and full
  // speed at the rim, which is how a game scrolls a long list.
  return PadScroll{scroll.x * std::fabs(scroll.x) * PAD_SCROLL_SPEED * seconds,
                   scroll.y * std::fabs(scroll.y) * PAD_SCROLL_SPEED * seconds};
}

PadRepeatStep step_repeat(const std::optional<PadRepeat> &previous,
                          const std::optional<PadDirection> &direction, double now) {
  if (!direction.has_value()) return PadRepeatStep{std::nullopt, false};
  if (!previous.has_value() || !(previous->direction == *direction)) {
    return PadRepeatStep{PadRepeat{*direction, now, 1}, true};
  }
  const double due =
      previous->since + PAD_REPEAT_DELAY_MS + (previous->fired - 1) * PAD_REPEAT_RATE_MS;
  if (now < due) return PadRepeatStep{previous, false};
  PadRepeat next = *previous;
  next.fired++;
  return PadRepeatStep{next, true};
}

}  // namespace zabloo
