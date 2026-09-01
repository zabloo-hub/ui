// Pure scroll math, shared by the arrange pass (which clamps) and the pointer
// (which moves). A port of `renderer-web/src/scroll.ts`, minus its
// `revealDelta`: that one already lives in `focus.h`, where it was ported with
// the rest of the navigation it belongs to (2026-08-12, ZAB-47).

#pragma once

#include "color.h"
#include "envelope.h"
#include "layout.h"

namespace zabloo {

/**
 * The overlay scrollbar's look. Not authored and not in the IR — `scrollbar` is
 * a boolean, and a styleable one (boolean → object) is the deferred, compatible
 * extension the spec names (2026-08-11, ZAB-9).
 *
 * The numbers are the reference renderer's to the pixel. Nothing in the corpus
 * records them — a snapshot has no geometry in it — so this is the one place
 * where the two targets agree only because they were written to.
 */
inline constexpr double SCROLLBAR_THICKNESS = 4.0;
inline constexpr double SCROLLBAR_MARGIN = 2.0;
inline constexpr double SCROLLBAR_MIN_LENGTH = 16.0;
inline constexpr Color SCROLLBAR_COLOR{1.0f, 1.0f, 1.0f, 0.35f};

/** `min(max, max(min, value))`, so an inverted range answers `max` and not UB. */
double clamp_scroll(double value, double low, double high);

/** Overlay scrollbar geometry along one axis, in track-relative px. */
struct ScrollbarThumb {
  /** Distance from the track's start to the thumb. */
  double start = 0.0;
  double length = 0.0;
  /** False when there is nothing to indicate: no overflow, or no room to draw. */
  bool visible = false;
};

/**
 * The thumb that indicates the position on one axis: its length proportional to
 * the visible fraction of the content, its position to the offset.
 *
 * `track` is the drawable run — the viewport minus the bar's own margins — which
 * is why it is separate from `viewport`: the proportion comes from the content,
 * the pixels from the track.
 */
ScrollbarThumb scrollbar_thumb(double track, double viewport, double max, double offset,
                               double min_length);

/**
 * Maps main/cross-axis content overflow to physical x/y bounds, per the flex
 * `direction` (main axis = x for a row, y for a column), then zeroes whichever
 * axis the `ScrollView`'s own `axis` does not enable.
 */
Size resolve_scroll_max(Direction direction, ScrollAxis axis, double main_overflow,
                        double cross_overflow);

}  // namespace zabloo
