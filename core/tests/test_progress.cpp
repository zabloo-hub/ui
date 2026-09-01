// The ProgressBar's fill — a port of `renderer-web/src/progress.test.ts`.
//
// The whole primitive is one rule: a fraction of the content box along the main
// axis, the whole of it across. The fraction arrives already tweened and clamped,
// which is what keeps this pure geometry with no clock in it.

#include <cmath>

#include "progress.h"
#include "testing.h"

using namespace zabloo;

namespace {

/** A 200×12 content box at the origin — the track minus its padding. */
const Rect CONTENT{0.0, 0.0, 200.0, 12.0};
/** The same, stood on end. */
const Rect VERTICAL{0.0, 0.0, 12.0, 200.0};

void check_rect(const Rect &actual, const Rect &expected) {
  CHECK_NEAR(actual.x, expected.x, 1e-9);
  CHECK_NEAR(actual.y, expected.y, 1e-9);
  CHECK_NEAR(actual.width, expected.width, 1e-9);
  CHECK_NEAR(actual.height, expected.height, 1e-9);
}

}  // namespace

TEST(progress, the_fill_is_the_fraction_of_the_content_box) {
  CHECK_EQ(fill_main(200.0, 0.25), 50.0);
  CHECK_EQ(fill_main(200.0, 1.0), 200.0);
  CHECK_EQ(fill_main(200.0, 0.0), 0.0);
}

TEST(progress, a_value_out_of_range_clamps_instead_of_overflowing_the_track) {
  CHECK_EQ(fill_main(200.0, 1.5), 200.0);
  CHECK_EQ(fill_main(200.0, -1.0), 0.0);
  // A binding pointing at nothing shows an empty bar, not a full one.
  CHECK_EQ(fill_main(200.0, std::nan("")), 0.0);
  // And a track smaller than its own padding never gives a negative size.
  CHECK_EQ(fill_main(-10.0, 0.5), 0.0);
}

TEST(progress, the_fill_grows_along_the_main_axis_and_spans_the_cross_one) {
  check_rect(fill_rect(CONTENT, true, 0.25, Justify::Start), Rect{0.0, 0.0, 50.0, 12.0});
  check_rect(fill_rect(VERTICAL, false, 0.25, Justify::Start), Rect{0.0, 0.0, 12.0, 50.0});
}

TEST(progress, justify_end_drains_the_bar_backwards) {
  check_rect(fill_rect(CONTENT, true, 0.25, Justify::End), Rect{150.0, 0.0, 50.0, 12.0});
  check_rect(fill_rect(VERTICAL, false, 0.25, Justify::End), Rect{0.0, 150.0, 12.0, 50.0});
}

TEST(progress, justify_center_grows_from_the_middle_out) {
  check_rect(fill_rect(CONTENT, true, 0.5, Justify::Center), Rect{50.0, 0.0, 100.0, 12.0});
}

TEST(progress, a_justify_with_no_meaning_on_one_child_lands_on_the_start) {
  // There is no space to put between a single child, so the flex pass would have
  // left it exactly here.
  check_rect(fill_rect(CONTENT, true, 0.5, Justify::SpaceBetween), Rect{0.0, 0.0, 100.0, 12.0});
}

TEST(progress, the_tracks_padding_insets_the_fill_because_it_starts_from_the_content_box) {
  // A 200×12 track with padding 2 leaves a 196×8 content box at (2, 2).
  const Rect padded{2.0, 2.0, 196.0, 8.0};
  check_rect(fill_rect(padded, true, 0.5, Justify::Start), Rect{2.0, 2.0, 98.0, 8.0});
}

TEST(progress, it_is_empty_at_zero_and_the_whole_box_at_one) {
  CHECK_EQ(fill_rect(CONTENT, true, 0.0, Justify::Start).width, 0.0);
  check_rect(fill_rect(CONTENT, true, 1.0, Justify::Start), CONTENT);
  // At full there is no leftover to lead with, so the anchor stops mattering.
  check_rect(fill_rect(CONTENT, true, 1.0, Justify::End), CONTENT);
}
