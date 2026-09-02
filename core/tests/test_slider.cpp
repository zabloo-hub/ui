// The Slider's math — a port of `renderer-web/src/slider.test.ts`.
//
// Every rule here is one the two targets have to agree on to the bit: the corpus
// records a thumb's rect and a `value`, so a range resolved differently, a snap
// that lands one stop away or a float left un-tidied all read as a moved control.

#include <cmath>
#include <optional>

#include "slider.h"
#include "testing.h"

using namespace zabloo;

namespace {

std::optional<double> some(double value) { return std::optional<double>(value); }
const std::optional<double> NONE;

/** The default: 0..1, continuous. */
const SliderRange UNIT = resolve_range(NONE, NONE, NONE);
/** 0..100 in tens — the range a settings screen actually declares. */
const SliderRange PERCENT = resolve_range(some(0.0), some(100.0), some(10.0));

void check_range(const SliderRange &actual, double min, double max, double step) {
  CHECK_EQ(actual.min, min);
  CHECK_EQ(actual.max, max);
  CHECK_EQ(actual.step, step);
}

/** A 100px track with a 20px thumb: the travel is the middle 80px. */
double at(double position, bool up = false) {
  return value_at(position, 0.0, 100.0, 20.0, UNIT, up);
}

}  // namespace

TEST(slider, the_range_defaults_to_the_unit_interval_and_keeps_what_is_declared) {
  check_range(UNIT, 0.0, 1.0, 0.0);
  check_range(PERCENT, 0.0, 100.0, 10.0);
}

TEST(slider, a_backwards_or_degenerate_range_collapses_instead_of_dividing_by_zero) {
  // The validator drops crossing bounds before they get here, but a fixed
  // slider that paints at its minimum is a visible authoring bug — a NaN rect
  // is not.
  check_range(resolve_range(some(10.0), some(2.0), some(1.0)), 10.0, 10.0, 1.0);
  check_range(resolve_range(NONE, NONE, some(-5.0)), 0.0, 1.0, 0.0);
}

TEST(slider, quantize_clamps_into_the_range) {
  CHECK_EQ(quantize(-3.0, UNIT), 0.0);
  CHECK_EQ(quantize(9.0, UNIT), 1.0);
  CHECK_EQ(quantize(0.25, UNIT), 0.25);
}

TEST(slider, quantize_snaps_to_min_plus_k_steps) {
  CHECK_EQ(quantize(43.0, PERCENT), 40.0);
  CHECK_EQ(quantize(46.0, PERCENT), 50.0);
  CHECK_EQ(quantize(7.0, resolve_range(some(5.0), some(25.0), some(5.0))), 5.0);
}

TEST(slider, the_end_of_the_track_stays_reachable_when_the_range_is_not_whole_steps) {
  // 0..1 by 0.3 stops at 0.9, and the player can SEE the end of the rail: an
  // unreachable `max` reads as a stuck control, so the last step is short.
  const SliderRange thirds = resolve_range(some(0.0), some(1.0), some(0.3));
  CHECK_EQ(quantize(1.0, thirds), 1.0);
  CHECK_EQ(quantize(0.97, thirds), 1.0);
  CHECK_EQ(quantize(0.8, thirds), 0.9);  // still the nearest grid stop
}

TEST(slider, a_stepped_value_comes_out_without_its_binary_noise) {
  // `0.1 * 3` is `0.30000000000000004`, and this number is shown as text and
  // handed to the game.
  CHECK_EQ(quantize(0.31, resolve_range(some(0.0), some(1.0), some(0.1))), 0.3);
  CHECK_EQ(quantize(0.7, resolve_range(some(0.0), some(1.0), some(0.05))), 0.7);
}

TEST(slider, a_value_that_is_not_a_number_falls_back_to_the_minimum) {
  CHECK_EQ(quantize(std::nan(""), PERCENT), 0.0);
  CHECK_EQ(fraction_of(std::nan(""), PERCENT), 0.0);
}

TEST(slider, the_fraction_maps_the_range_onto_zero_to_one_and_clamps) {
  CHECK_EQ(fraction_of(0.0, UNIT), 0.0);
  CHECK_EQ(fraction_of(0.5, UNIT), 0.5);
  CHECK_EQ(fraction_of(75.0, PERCENT), 0.75);
  CHECK_EQ(fraction_of(-1.0, UNIT), 0.0);
  CHECK_EQ(fraction_of(500.0, PERCENT), 1.0);
  // A range with no span pins to its start rather than dividing by zero.
  CHECK_EQ(fraction_of(10.0, resolve_range(some(10.0), some(10.0), NONE)), 0.0);
}

TEST(slider, the_pointer_picks_the_value_under_the_thumbs_center) {
  CHECK_EQ(at(10.0), 0.0);
  CHECK_EQ(at(50.0), 0.5);
  CHECK_EQ(at(90.0), 1.0);
}

TEST(slider, a_pointer_beyond_the_inset_travel_clamps) {
  CHECK_EQ(at(0.0), 0.0);
  CHECK_EQ(at(-40.0), 0.0);
  CHECK_EQ(at(100.0), 1.0);
  CHECK_EQ(at(999.0), 1.0);
}

TEST(slider, the_tracks_own_offset_is_honoured) {
  CHECK_EQ(value_at(210.0, 200.0, 100.0, 20.0, UNIT), 0.0);
  CHECK_EQ(value_at(250.0, 200.0, 100.0, 20.0, UNIT), 0.5);
}

TEST(slider, a_vertical_track_grows_upward_with_its_minimum_at_the_bottom) {
  CHECK(grows_upward(SliderAxis::Vertical));
  CHECK(!grows_upward(SliderAxis::Horizontal));
  CHECK_EQ(at(10.0, true), 1.0);
  CHECK_EQ(at(50.0, true), 0.5);
  CHECK_EQ(at(90.0, true), 0.0);
}

TEST(slider, what_the_pointer_picks_is_quantized_like_everything_else) {
  CHECK_EQ(value_at(50.0, 0.0, 100.0, 20.0, PERCENT), 50.0);
  CHECK_EQ(value_at(56.0, 0.0, 100.0, 20.0, PERCENT), 60.0);
}

TEST(slider, a_track_with_no_room_to_travel_answers_its_minimum) {
  CHECK_EQ(value_at(5.0, 0.0, 10.0, 40.0, UNIT), 0.0);
}

TEST(slider, an_arrow_moves_by_the_declared_step) {
  CHECK_EQ(step_by(40.0, 1.0, PERCENT), 50.0);
  CHECK_EQ(step_by(40.0, -1.0, PERCENT), 30.0);
}

TEST(slider, a_continuous_slider_borrows_five_percent_of_its_range_for_the_keyboard) {
  CHECK_NEAR(step_by(0.5, 1.0, UNIT), 0.55, 1e-10);
  CHECK_NEAR(step_by(0.5, -1.0, UNIT), 0.45, 1e-10);
}

TEST(slider, an_arrow_stops_at_the_ends) {
  CHECK_EQ(step_by(1.0, 1.0, UNIT), 1.0);
  CHECK_EQ(step_by(0.0, -1.0, UNIT), 0.0);
  CHECK_EQ(step_by(95.0, 1.0, PERCENT), 100.0);
}

TEST(slider, an_off_step_value_snaps_onto_the_grid_as_the_arrow_moves_it) {
  CHECK_EQ(step_by(43.0, 1.0, PERCENT), 50.0);
  CHECK_EQ(step_by(43.0, -1.0, PERCENT), 30.0);
}

TEST(slider, the_fill_spans_the_whole_fraction_while_the_thumb_rides_the_inset_travel) {
  const SliderGeometry empty = slider_geometry(0.0, 100.0, 20.0);
  CHECK_EQ(empty.fill_length, 0.0);
  CHECK_EQ(empty.thumb_start, 0.0);
  const SliderGeometry half = slider_geometry(0.5, 100.0, 20.0);
  CHECK_EQ(half.fill_length, 50.0);
  CHECK_EQ(half.thumb_start, 40.0);
  const SliderGeometry full = slider_geometry(1.0, 100.0, 20.0);
  CHECK_EQ(full.fill_length, 100.0);
  // The rail is filled to its end AND the thumb is still inside the node's rect.
  CHECK_EQ(full.thumb_start, 80.0);
  CHECK(full.thumb_start + 20.0 <= 100.0);
}

TEST(slider, a_thumb_wider_than_its_track_does_not_travel) {
  const SliderGeometry geometry = slider_geometry(1.0, 30.0, 50.0);
  CHECK_EQ(geometry.fill_length, 30.0);
  CHECK_EQ(geometry.thumb_start, 0.0);
}

TEST(slider, a_fraction_outside_zero_to_one_clamps) {
  CHECK_EQ(slider_geometry(-1.0, 100.0, 20.0).fill_length, 0.0);
  CHECK_EQ(slider_geometry(2.0, 100.0, 20.0).fill_length, 100.0);
}
