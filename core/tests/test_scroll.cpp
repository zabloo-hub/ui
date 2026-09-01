// Scroll math: how far the content reaches, and where the indicator sits.
//
// The reach is what the corpus records as `scroll.maxX`/`maxY`, so the mapping
// from main/cross overflow onto physical axes is contract and not convenience.
// The thumb is not recorded anywhere — a snapshot has no geometry in it — which
// is precisely why it is pinned here instead.

#include "scroll.h"
#include "testing.h"

using namespace zabloo;

TEST(scroll, an_inverted_range_answers_its_maximum_rather_than_misbehaving) {
  CHECK_NEAR(clamp_scroll(5, 0, 10), 5.0, 0.001);
  CHECK_NEAR(clamp_scroll(-5, 0, 10), 0.0, 0.001);
  CHECK_NEAR(clamp_scroll(15, 0, 10), 10.0, 0.001);
  // Nothing to scroll: the only offset there is, is zero.
  CHECK_NEAR(clamp_scroll(15, 0, 0), 0.0, 0.001);
}

TEST(scroll, the_thumb_is_as_long_as_the_content_is_visible) {
  // A 200 px track over a 200 px viewport with 200 px of overflow: 400 px of
  // content, so the thumb is half the track and travels the other half.
  const ScrollbarThumb at_rest = scrollbar_thumb(200, 200, 200, 0, 16);
  CHECK(at_rest.visible);
  CHECK_NEAR(at_rest.length, 100.0, 0.001);
  CHECK_NEAR(at_rest.start, 0.0, 0.001);

  CHECK_NEAR(scrollbar_thumb(200, 200, 200, 100, 16).start, 50.0, 0.001);
  // At the end it sits flush with the track.
  CHECK_NEAR(scrollbar_thumb(200, 200, 200, 200, 16).start, 100.0, 0.001);
}

TEST(scroll, very_long_content_keeps_a_thumb_you_can_still_see) {
  CHECK_NEAR(scrollbar_thumb(200, 200, 100000, 0, 16).length, 16.0, 0.001);
  // A track shorter than the minimum takes the whole track rather than overflow it.
  CHECK_NEAR(scrollbar_thumb(10, 200, 100000, 0, 16).length, 10.0, 0.001);
}

TEST(scroll, an_out_of_range_offset_clamps_instead_of_running_off_the_track) {
  CHECK_NEAR(scrollbar_thumb(200, 200, 200, 999, 16).start, 100.0, 0.001);
  CHECK_NEAR(scrollbar_thumb(200, 200, 200, -50, 16).start, 0.0, 0.001);
}

TEST(scroll, nothing_to_indicate_draws_no_thumb_at_all) {
  CHECK(!scrollbar_thumb(200, 200, 0, 0, 16).visible);   // the content fits
  CHECK(!scrollbar_thumb(0, 200, 200, 0, 16).visible);   // no room for the bar
  CHECK(!scrollbar_thumb(200, 0, 200, 0, 16).visible);   // a collapsed viewport
}

TEST(scroll, the_reach_maps_main_and_cross_overflow_onto_the_axis_that_is_enabled) {
  const auto max = [](Direction direction, ScrollAxis axis) {
    return resolve_scroll_max(direction, axis, 100, 40);
  };

  // A column's main axis is y, so its own overflow scrolls vertically.
  CHECK_NEAR(max(Direction::Column, ScrollAxis::Vertical).x, 0.0, 0.001);
  CHECK_NEAR(max(Direction::Column, ScrollAxis::Vertical).y, 100.0, 0.001);
  CHECK_NEAR(max(Direction::Column, ScrollAxis::Horizontal).x, 40.0, 0.001);
  CHECK_NEAR(max(Direction::Column, ScrollAxis::Horizontal).y, 0.0, 0.001);
  CHECK_NEAR(max(Direction::Column, ScrollAxis::Both).x, 40.0, 0.001);
  CHECK_NEAR(max(Direction::Column, ScrollAxis::Both).y, 100.0, 0.001);

  // A row's is x, and the pair swaps with it.
  CHECK_NEAR(max(Direction::Row, ScrollAxis::Vertical).x, 0.0, 0.001);
  CHECK_NEAR(max(Direction::Row, ScrollAxis::Vertical).y, 40.0, 0.001);
  CHECK_NEAR(max(Direction::Row, ScrollAxis::Horizontal).x, 100.0, 0.001);
  CHECK_NEAR(max(Direction::Row, ScrollAxis::Horizontal).y, 0.0, 0.001);
  CHECK_NEAR(max(Direction::Row, ScrollAxis::Both).x, 100.0, 0.001);
  CHECK_NEAR(max(Direction::Row, ScrollAxis::Both).y, 40.0, 0.001);
}

TEST(scroll, content_smaller_than_its_viewport_reaches_nowhere_and_never_backwards) {
  const Size max = resolve_scroll_max(Direction::Column, ScrollAxis::Both, -20, -10);
  CHECK_NEAR(max.x, 0.0, 0.001);
  CHECK_NEAR(max.y, 0.0, 0.001);
}
