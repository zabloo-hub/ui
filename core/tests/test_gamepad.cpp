// The pad's pure rules — a port of the first half of
// `renderer-web/src/gamepad.test.ts`.
//
// The corpus records ONE frame at the end of a `pad` script, so what a golden
// file can pin down is where the player ended up. The dead zone's hysteresis,
// the repeat clock's spacing and the stick's quadratic response happen BETWEEN
// those frames, and this is the only place they are checked — which matters
// because these numbers are normative (`docs/format/input.md`): a target that
// repeats at its own rate navigates a menu differently from every other one.

#include <cmath>

#include "gamepad.h"
#include "testing.h"

using namespace zabloo;

namespace {

const PadDirection UP{0.0, -1.0};
const PadDirection DOWN{0.0, 1.0};
const PadDirection LEFT{-1.0, 0.0};
const PadDirection RIGHT{1.0, 0.0};

/** A pad at rest, with the buttons and axes the standard mapping declares. */
PadSnapshot at_rest() {
  PadSnapshot pad;
  pad.buttons.assign(16, false);
  pad.axes.assign(4, 0.0);
  return pad;
}

PadSnapshot with_buttons(std::initializer_list<size_t> down) {
  PadSnapshot pad = at_rest();
  for (size_t index : down) pad.buttons[index] = true;
  return pad;
}

PadSnapshot with_axes(double x0, double y0, double x1 = 0.0, double y1 = 0.0) {
  PadSnapshot pad = at_rest();
  pad.axes = {x0, y0, x1, y1};
  return pad;
}

/** A direction rendered for a failure message: "right", "none". */
std::string show(const std::optional<PadDirection> &direction) {
  if (!direction.has_value()) return "none";
  if (*direction == UP) return "up";
  if (*direction == DOWN) return "down";
  if (*direction == LEFT) return "left";
  if (*direction == RIGHT) return "right";
  return "(" + zabloo::testing::show(direction->dx) + ", " +
         zabloo::testing::show(direction->dy) + ")";
}

}  // namespace

// --- read_pad: buttons ----------------------------------------------------

TEST(gamepad, a_is_press_and_b_is_back) {
  const PadIntent a = read_pad(with_buttons({PAD_BUTTON_A}));
  CHECK_EQ(a.press, true);
  CHECK_EQ(a.back, false);
  const PadIntent b = read_pad(with_buttons({PAD_BUTTON_B}));
  CHECK_EQ(b.press, false);
  CHECK_EQ(b.back, true);
}

TEST(gamepad, the_four_dpad_directions_read_as_unit_axes) {
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_UP})).direction), "up");
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_DOWN})).direction), "down");
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_LEFT})).direction), "left");
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_RIGHT})).direction), "right");
}

TEST(gamepad, a_dpad_diagonal_resolves_to_its_horizontal_component) {
  // Spatial navigation moves on ONE axis, and a stable tie-break beats
  // alternating between two on the same input.
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_UP, PAD_DPAD_RIGHT})).direction), "right");
}

TEST(gamepad, opposite_dpad_buttons_cancel_instead_of_one_winning) {
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_LEFT, PAD_DPAD_RIGHT})).direction), "none");
  CHECK_EQ(show(read_pad(with_buttons({PAD_DPAD_UP, PAD_DPAD_DOWN})).direction), "none");
}

TEST(gamepad, a_pad_at_rest_asks_for_nothing) {
  const PadIntent intent = read_pad(at_rest());
  CHECK_EQ(show(intent.direction), "none");
  CHECK_EQ(intent.press, false);
  CHECK_EQ(intent.back, false);
  CHECK_EQ(intent.scroll.x, 0.0);
  CHECK_EQ(intent.scroll.y, 0.0);
}

TEST(gamepad, a_pad_reporting_fewer_buttons_and_axes_than_the_mapping_survives) {
  // A device is not obliged to have every control the standard mapping names,
  // and one it lacks is simply one it has not pressed.
  PadSnapshot pad;
  pad.buttons.assign(1, true);
  const PadIntent intent = read_pad(pad);
  CHECK_EQ(intent.press, true);
  CHECK_EQ(intent.back, false);
  CHECK_EQ(show(intent.direction), "none");
  CHECK_EQ(intent.scroll.y, 0.0);
}

TEST(gamepad, a_nan_axis_is_ignored_rather_than_propagated_into_the_math) {
  const double nan = std::nan("");
  const PadIntent intent = read_pad(with_axes(nan, nan, nan, nan));
  CHECK_EQ(show(intent.direction), "none");
  CHECK_EQ(intent.scroll.x, 0.0);
  CHECK_EQ(intent.scroll.y, 0.0);
}

// --- read_pad: the left stick ---------------------------------------------

TEST(gamepad, the_left_stick_inside_the_dead_zone_is_not_a_direction) {
  CHECK_EQ(show(read_pad(with_axes(0.4, 0.0)).direction), "none");
  CHECK_EQ(show(read_pad(with_axes(0.0, -0.49)).direction), "none");
}

TEST(gamepad, the_left_stick_registers_once_it_clears_the_dead_zone) {
  CHECK_EQ(show(read_pad(with_axes(0.8, 0.0)).direction), "right");
  CHECK_EQ(show(read_pad(with_axes(0.0, -0.8)).direction), "up");
}

TEST(gamepad, a_diagonal_push_resolves_to_its_dominant_axis) {
  CHECK_EQ(show(read_pad(with_axes(0.9, 0.6)).direction), "right");
  CHECK_EQ(show(read_pad(with_axes(0.6, 0.9)).direction), "down");
}

TEST(gamepad, a_held_direction_survives_down_to_the_release_threshold) {
  // Between the two thresholds: released while nothing is held, still held once
  // it is. Without the gap, a stick resting on the threshold would fire and
  // release with no movement at all — which reads as a stuck list.
  CHECK_EQ(show(read_pad(with_axes(0.4, 0.0)).direction), "none");
  CHECK_EQ(show(read_pad(with_axes(0.4, 0.0), RIGHT).direction), "right");
  CHECK_EQ(show(read_pad(with_axes(0.3, 0.0), RIGHT).direction), "none");
}

TEST(gamepad, the_release_threshold_is_not_lent_to_a_different_direction) {
  CHECK_EQ(show(read_pad(with_axes(0.0, 0.4), RIGHT).direction), "none");
}

TEST(gamepad, the_dpad_wins_over_a_stick_resting_off_center) {
  PadSnapshot pad = with_buttons({PAD_DPAD_UP});
  pad.axes[PAD_AXIS_LEFT_X] = 0.9;
  CHECK_EQ(show(read_pad(pad).direction), "up");
}

// --- read_pad: the right stick --------------------------------------------

TEST(gamepad, the_right_stick_inside_its_own_dead_zone_does_not_scroll) {
  const PadIntent intent = read_pad(with_axes(0.0, 0.0, 0.1, -0.15));
  CHECK_EQ(intent.scroll.x, 0.0);
  CHECK_EQ(intent.scroll.y, 0.0);
}

TEST(gamepad, the_right_stick_rescales_what_is_left_so_it_starts_from_zero) {
  const PadIntent intent = read_pad(with_axes(0.0, 0.0, PAD_SCROLL_DEADZONE + 1e-9, 1.0));
  CHECK_NEAR(intent.scroll.x, 0.0, 1e-6);
  CHECK_EQ(intent.scroll.y, 1.0);
}

TEST(gamepad, the_right_stick_keeps_the_sign_of_each_axis) {
  const PadIntent intent = read_pad(with_axes(0.0, 0.0, -1.0, 0.575));
  CHECK_EQ(intent.scroll.x, -1.0);
  CHECK_NEAR(intent.scroll.y, 0.5, 1e-6);
}

TEST(gamepad, an_over_range_axis_clamps_to_full_deflection) {
  const PadIntent intent = read_pad(with_axes(0.0, 0.0, 2.0, -2.0));
  CHECK_EQ(intent.scroll.x, 1.0);
  CHECK_EQ(intent.scroll.y, -1.0);
}

// --- scroll_delta ---------------------------------------------------------

TEST(gamepad, a_full_stick_covers_the_whole_speed_in_one_second) {
  const PadScroll delta = scroll_delta({0.0, 1.0}, 1000.0);
  CHECK_EQ(delta.x, 0.0);
  CHECK_EQ(delta.y, PAD_SCROLL_SPEED);
}

TEST(gamepad, the_scroll_scales_with_the_frames_own_duration) {
  CHECK_NEAR(scroll_delta({1.0, 0.0}, 16.0).x, PAD_SCROLL_SPEED * 16.0 / 1000.0, 1e-6);
}

TEST(gamepad, the_scroll_responds_quadratically_so_half_a_stick_is_a_quarter_of_the_speed) {
  const PadScroll delta = scroll_delta({0.5, -0.5}, 1000.0);
  CHECK_EQ(delta.x, PAD_SCROLL_SPEED * 0.25);
  CHECK_EQ(delta.y, -PAD_SCROLL_SPEED * 0.25);
}

TEST(gamepad, a_negative_frame_time_never_scrolls_backwards) {
  const PadScroll delta = scroll_delta({1.0, 1.0}, -16.0);
  CHECK_EQ(delta.x, 0.0);
  CHECK_EQ(delta.y, 0.0);
}

// --- step_repeat ----------------------------------------------------------

TEST(gamepad, a_direction_fires_the_instant_it_is_pressed) {
  const PadRepeatStep step = step_repeat(std::nullopt, DOWN, 1000.0);
  CHECK_EQ(step.fire, true);
  CHECK(step.state.has_value());
  CHECK_EQ(show(step.state->direction), "down");
  CHECK_EQ(step.state->since, 1000.0);
  CHECK_EQ(step.state->fired, 1);
}

TEST(gamepad, a_held_direction_holds_still_through_the_repeat_delay) {
  const std::optional<PadRepeat> held = PadRepeat{DOWN, 1000.0, 1};
  CHECK_EQ(step_repeat(held, DOWN, 1000.0 + PAD_REPEAT_DELAY_MS - 1.0).fire, false);
  CHECK_EQ(step_repeat(held, DOWN, 1000.0 + PAD_REPEAT_DELAY_MS).fire, true);
}

TEST(gamepad, a_held_direction_repeats_at_the_repeat_rate_once_the_delay_is_spent) {
  // A millisecond at a time, so the spacing is read off the clock rather than
  // asserted a step at a time: one press, then a beat every 90 ms after 400.
  std::vector<double> fired{0.0};
  std::optional<PadRepeat> state = step_repeat(std::nullopt, DOWN, 0.0).state;
  const double span = PAD_REPEAT_DELAY_MS + PAD_REPEAT_RATE_MS * 3.0;
  for (double time = 1.0; time <= span; time += 1.0) {
    const PadRepeatStep step = step_repeat(state, DOWN, time);
    state = step.state;
    if (step.fire) fired.push_back(time);
  }
  CHECK_EQ(fired.size(), static_cast<size_t>(5));
  CHECK_EQ(fired[1], PAD_REPEAT_DELAY_MS);
  CHECK_EQ(fired[2], PAD_REPEAT_DELAY_MS + PAD_REPEAT_RATE_MS);
  CHECK_EQ(fired[3], PAD_REPEAT_DELAY_MS + PAD_REPEAT_RATE_MS * 2.0);
  CHECK_EQ(fired[4], PAD_REPEAT_DELAY_MS + PAD_REPEAT_RATE_MS * 3.0);
}

TEST(gamepad, changing_direction_restarts_the_whole_cycle) {
  // It is a new intention, not the continuation of the previous one.
  const PadRepeatStep step = step_repeat(PadRepeat{DOWN, 0.0, 6}, LEFT, 900.0);
  CHECK_EQ(step.fire, true);
  CHECK(step.state.has_value());
  CHECK_EQ(show(step.state->direction), "left");
  CHECK_EQ(step.state->since, 900.0);
  CHECK_EQ(step.state->fired, 1);
}

TEST(gamepad, releasing_the_direction_forgets_the_hold) {
  const PadRepeatStep step = step_repeat(PadRepeat{DOWN, 0.0, 3}, std::nullopt, 900.0);
  CHECK_EQ(step.fire, false);
  CHECK_EQ(step.state.has_value(), false);
}

TEST(gamepad, a_stall_fires_once_instead_of_catching_up_on_the_backlog) {
  // The pad is a source of intentions, not a queue of work to make up for: ten
  // seconds behind is still one move.
  const PadRepeatStep step = step_repeat(PadRepeat{DOWN, 0.0, 1}, DOWN, 10000.0);
  CHECK_EQ(step.fire, true);
  CHECK(step.state.has_value());
  CHECK_EQ(step.state->fired, 2);
}
