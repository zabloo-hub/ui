// ProgressBar geometry — pure, so "how big is the fill" is testable without an
// engine.
//
// The whole primitive is this one rule: the fill takes a FRACTION of the track's
// content box along the main axis and the whole cross axis. The fraction itself is
// tweened upstream, on the VALUE (decision 2026-08-11 §4: interpolate declared
// inputs, never computed rects) — by the time it reaches here it is just a number,
// which is what keeps a single layout pass per frame.

#pragma once

#include "envelope.h"
#include "layout.h"

namespace zabloo {

/** Main-axis size of the fill: the fraction of the content box, never negative. */
double fill_main(double content_main, double value);

/**
 * The fill's rect inside the track's content box. `justify` anchors it — `start`
 * (the default) grows from the left/top, `end` from the right/bottom, and `center`
 * from the middle out. There is no `space-between` for a single child, so it lands
 * on the start exactly where the flex pass would have left it.
 */
Rect fill_rect(const Rect &content, bool row, double value, Justify justify);

}  // namespace zabloo
