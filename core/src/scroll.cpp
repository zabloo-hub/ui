#include "scroll.h"

#include <algorithm>

namespace zabloo {

double clamp_scroll(double value, double low, double high) {
  return std::min(high, std::max(low, value));
}

ScrollbarThumb scrollbar_thumb(double track, double viewport, double max, double offset,
                               double min_length) {
  if (!(max > 0.0) || !(track > 0.0) || !(viewport > 0.0)) return ScrollbarThumb{};
  const double visible_fraction = viewport / (viewport + max);
  const double length =
      clamp_scroll(track * visible_fraction, std::min(min_length, track), track);
  ScrollbarThumb thumb;
  thumb.start = clamp_scroll(offset / max, 0.0, 1.0) * (track - length);
  thumb.length = length;
  thumb.visible = true;
  return thumb;
}

Size resolve_scroll_max(Direction direction, ScrollAxis axis, double main_overflow,
                        double cross_overflow) {
  const double main = std::max(0.0, main_overflow);
  const double cross = std::max(0.0, cross_overflow);
  Size max = direction == Direction::Row ? Size{main, cross} : Size{cross, main};
  if (axis == ScrollAxis::Vertical) max.x = 0.0;
  else if (axis == ScrollAxis::Horizontal) max.y = 0.0;
  return max;
}

}  // namespace zabloo
