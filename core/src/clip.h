// Clip math: the region a subtree is cut to, and nothing else.
//
// A port of `renderer-web/src/clip.ts`, minus its `scissorBox` — that one
// translates a region into GL's y-up device pixels, which is the one thing here
// that belongs to a target rather than to the contract. Godot takes the region
// as it stands.
//
// Pure on purpose: the paint pass, the hit test and the snapshot all resolve
// clipping through these three functions, so paint and input can never disagree
// about what is visible (decision 2026-08-11: `clip` cuts BOTH).

#pragma once

#include <cstddef>
#include <memory>
#include <vector>

#include "layout.h"

namespace zabloo {

/**
 * A clipping region: the intersection rect of every ancestor clip, plus the
 * corner radius of the INNERMOST rounded clip in that chain.
 *
 * The rect is always exact (rect ∩ rect is a rect); the radius is what rounds
 * the cut. Exact for the real case — one rounded viewport with plain clips
 * around it. With two rounded clips whose corners actually overlap, only the
 * innermost one's corners are cut, so an outer corner may bleed by at most its
 * radius. A second rounded region per draw would be the fix if that shows up.
 */
struct Clip {
  double x = 0.0;
  double y = 0.0;
  double width = 0.0;
  double height = 0.0;
  /** 0 = square corners: the rect alone is the whole clip. */
  double radius = 0.0;
};

/** Nothing is visible through this region (fully collapsed by an intersection). */
bool is_empty_clip(const Clip *clip);

/**
 * Adds a node's rect to the inherited region. The radius is capped to the rect's
 * own half-extents — the same rule the tessellator's rounded rect follows — so a
 * radius larger than the box cannot invert the cut.
 */
Clip intersect_clip(const Clip *inherited, const Rect &rect, double radius);

/**
 * Is the point visible through the region? The rounded corners are honored,
 * which is what keeps hit-testing consistent with what is drawn: a pointer in
 * the cut corner of a rounded `ScrollView` must not reach the content under it.
 *
 * The radius belongs to the innermost rounded clip, whose rect the intersection
 * may have shrunk; testing the corners against the intersection rect is exact
 * whenever that rect still IS the rounded one (the common case) and errs toward
 * clipping slightly more otherwise — never toward accepting hidden content.
 */
bool clip_contains(const Clip *clip, double x, double y);

/**
 * Frame-lived storage that gives every region a stable ADDRESS.
 *
 * Identity is not tidiness here: the tessellator groups geometry by region, and
 * it decides "same region?" by comparing pointers, exactly as the reference
 * compares object identity. Two sibling scrollers that happen to share a rect
 * are still two regions, and so still two groups painted one after the other —
 * merging them by value would quietly reorder what draws over what.
 *
 * Slots are reused across frames, so a steady-state frame allocates nothing.
 */
class ClipArena {
 public:
  /** Hands every slot back. The addresses handed out before it are now stale. */
  void reset() { used_ = 0; }
  /** A stable address for this region, valid until the next `reset`. */
  const Clip *intern(const Clip &clip);

 private:
  std::vector<std::unique_ptr<Clip>> pool_;
  size_t used_ = 0;
};

}  // namespace zabloo
