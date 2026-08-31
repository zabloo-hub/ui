// Focus: who can take it, where it starts, and where an arrow sends it.
//
// The scoring is arithmetic over rects and the corpus compares it, so a target
// that picked a different winner from the same screen would disagree about which
// node wears `focused` — a difference the metrics record.

#include <vector>

#include "focus.h"
#include "testing.h"

using namespace zabloo;

namespace {

Rect box(double x, double y, double w = 10.0, double h = 10.0) { return Rect{x, y, w, h}; }

}  // namespace

TEST(focus, a_candidate_must_lie_in_the_direction_of_travel) {
  const Rect from = box(100, 100);
  // Straight right, travelling right.
  CHECK(navigation_score(from, box(200, 100), 1, 0) > 0.0);
  // Straight left is behind: not a candidate at all.
  CHECK(navigation_score(from, box(0, 100), 1, 0) < 0.0);
  // Level with the focus, travelling down: beside it, not ahead of it.
  CHECK(navigation_score(from, box(200, 100), 0, 1) < 0.0);
  // Its own rect never scores.
  CHECK(navigation_score(from, from, 1, 0) < 0.0);
}

TEST(focus, the_score_weighs_going_sideways_twice) {
  const Rect from = box(100, 100);
  // Two candidates the same distance ahead; the one that drifts loses.
  const double straight = navigation_score(from, box(200, 100), 1, 0);
  const double drifting = navigation_score(from, box(200, 160), 1, 0);
  CHECK(straight < drifting);
  // The orthogonal offset counts double: 100 ahead + 2 × 60 aside.
  CHECK_NEAR(drifting, 220.0, 0.001);
  // And a nearer candidate that drifts a long way loses to a farther straight one.
  CHECK(navigation_score(from, box(400, 100), 1, 0) <
        navigation_score(from, box(160, 300), 1, 0));
}

TEST(focus, a_target_that_already_fits_is_not_scrolled_to) {
  // The auto-scroll rule (ZAB-47). Nothing drives it until G6 (ZAB-139) gives a
  // ScrollView an offset to move; the rule itself is the format's either way.
  CHECK_NEAR(reveal_delta(20, 10, 0, 100), 0.0, 0.001);
  // Above the fold: the minimum that brings its leading edge in.
  CHECK_NEAR(reveal_delta(-30, 10, 0, 100), -30.0, 0.001);
  // Below it: the minimum that brings its trailing edge in.
  CHECK_NEAR(reveal_delta(120, 10, 0, 100), 30.0, 0.001);
  // Taller than the viewport and already covering it: left alone rather than
  // oscillating between its two edges.
  CHECK_NEAR(reveal_delta(-20, 200, 0, 100), 0.0, 0.001);
}
