// The Collapse's endpoints — a port of `renderer-web/src/collapse.test.ts`.
//
// Small arithmetic, and the whole of the frontier case of ZAB-33 §5: what animates
// is the node's own height, so these two numbers are what a Collapse tweens between.

#include "collapse.h"
#include "testing.h"

using namespace zabloo;

TEST(collapse, a_closed_box_is_the_header_inside_the_nodes_own_padding) {
  CHECK_EQ(closed_height(24.0, 8.0), 40.0);
  CHECK_EQ(closed_height(0.0, 8.0), 16.0);  // no header to show
  // Nonsense in never comes out negative — a box has no negative height.
  CHECK_EQ(closed_height(-10.0, 0.0), 0.0);
  CHECK_EQ(closed_height(20.0, -4.0), 20.0);
}

TEST(collapse, the_target_is_the_header_while_closing_and_the_measured_box_while_opening) {
  CHECK_EQ(collapse_target(false, 200.0, 40.0), 40.0);
  CHECK_EQ(collapse_target(true, 200.0, 40.0), 200.0);
}

TEST(collapse, it_holds_shut_the_frame_the_content_enters_layout) {
  // That frame the natural height is still the closed box, so opening lands on it:
  // the Collapse stays closed for one frame instead of popping open, and the tween
  // starts on the next one with the height this frame measured. The alternative is
  // the measure→animate→re-measure loop ZAB-33 §4 rules out, so this frame is the
  // price of one layout pass per frame — and it is only ever the FIRST opening.
  CHECK_EQ(collapse_target(true, 40.0, 40.0), 40.0);
}

TEST(collapse, it_never_opens_smaller_than_its_own_header) {
  CHECK_EQ(collapse_target(true, 10.0, 40.0), 40.0);
}
