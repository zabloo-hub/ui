#include "clip.h"

#include <algorithm>

namespace zabloo {

bool is_empty_clip(const Clip *clip) {
  return clip != nullptr && (!(clip->width > 0.0) || !(clip->height > 0.0));
}

Clip intersect_clip(const Clip *inherited, const Rect &rect, double radius) {
  const double own = std::max(0.0, std::min({radius, rect.width * 0.5, rect.height * 0.5}));
  if (inherited == nullptr) return Clip{rect.x, rect.y, rect.width, rect.height, own};

  const double x = std::max(inherited->x, rect.x);
  const double y = std::max(inherited->y, rect.y);
  return Clip{
      x,
      y,
      std::min(inherited->x + inherited->width, rect.x + rect.width) - x,
      std::min(inherited->y + inherited->height, rect.y + rect.height) - y,
      // Innermost rounded clip wins; a square inner clip keeps the ancestor's.
      own > 0.0 ? own : inherited->radius,
  };
}

bool clip_contains(const Clip *clip, double x, double y) {
  if (clip == nullptr) return true;
  if (x < clip->x || x > clip->x + clip->width || y < clip->y || y > clip->y + clip->height) {
    return false;
  }
  const double r = std::min({clip->radius, clip->width * 0.5, clip->height * 0.5});
  if (r <= 0.0) return true;

  // Distance to the rounded box's inner "core" rect: positive on both axes only
  // in a corner region, which is the only place the radius has anything to say.
  const double dx = std::max({clip->x + r - x, x - (clip->x + clip->width - r), 0.0});
  const double dy = std::max({clip->y + r - y, y - (clip->y + clip->height - r), 0.0});
  return dx * dx + dy * dy <= r * r;
}

const Clip *ClipArena::intern(const Clip &clip) {
  if (used_ == pool_.size()) pool_.push_back(std::make_unique<Clip>());
  Clip *slot = pool_[used_++].get();
  *slot = clip;
  return slot;
}

}  // namespace zabloo
