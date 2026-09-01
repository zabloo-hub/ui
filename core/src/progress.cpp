#include <algorithm>

#include "easing.h"
#include "progress.h"

namespace zabloo {

double fill_main(double content_main, double value) {
  return std::max(0.0, content_main) * clamp_progress(value);
}

Rect fill_rect(const Rect &content, bool row, double value, Justify justify) {
  const double content_main = row ? content.width : content.height;
  const double main = fill_main(content_main, value);
  const double leftover = std::max(0.0, content_main - main);
  const double lead = justify == Justify::End      ? leftover
                      : justify == Justify::Center ? leftover * 0.5
                                                   : 0.0;
  return row ? Rect{content.x + lead, content.y, main, content.height}
             : Rect{content.x, content.y + lead, content.width, main};
}

}  // namespace zabloo
