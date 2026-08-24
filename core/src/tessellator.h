// Style in, triangles out.
//
// The engine's whole job downstream of this file is to hand the arrays to a draw
// call — `canvas_item_add_triangle_array` in Godot, a Slate custom widget in
// Unreal. Nothing here knows which.
//
// The arrays are kept SEPARATE (positions, uvs, colors, indices) rather than
// interleaved the way the web renderer packs them for a GL buffer, because that
// is the shape every engine's immediate API asks for: Godot takes four packed
// arrays. Interleaving here would only mean un-interleaving in the adapter.

#pragma once

#include <cstdint>
#include <vector>

#include "color.h"
#include "layout.h"

namespace zabloo {

/** One draw call: a run of triangles sharing a texture. */
struct Batch {
  /**
   * Opaque handle the adapter maps to its own texture object. Null is untextured
   * geometry. From G4 (ZAB-137) the glyph atlas arrives here, and solids join it
   * through the reserved white pixel so text and shapes share one draw call.
   */
  const void *texture = nullptr;
  /** `x, y` per vertex, in view space. */
  std::vector<float> positions;
  std::vector<float> uvs;
  /** `r, g, b, a` per vertex — where the inherited opacity has already landed. */
  std::vector<float> colors;
  std::vector<uint32_t> indices;

  uint32_t vertex_count() const { return static_cast<uint32_t>(positions.size() / 2); }
  bool empty() const { return indices.empty(); }
};

/**
 * Accumulates a frame's geometry. Lives with the view and is `reset()` per frame:
 * the vectors keep their capacity, so a steady-state frame allocates nothing
 * (the same property ZAB-55 bought the web renderer).
 */
class GeometryBuilder {
 public:
  void reset();

  /**
   * A filled rounded rect: a fan around the centroid over a perimeter of four
   * corner arcs. Same parametrization as the border below, which is what lets a
   * fill and its ring stitch together without a seam.
   */
  void rounded_rect(const Rect &rect, double radius, Color color);

  /**
   * INSET border: a ring between the rect's edge and the edge inset by `width`
   * (the CSS border-box model, 2026-08-06). Nothing paints outside the layout
   * rect, so hit-testing on layout rects stays honest and a clip can never cut
   * a border in half.
   */
  void rounded_rect_border(const Rect &rect, double radius, double width, Color color);

  const std::vector<Batch> &batches() const { return batches_; }
  /** Vertices across every batch — what the perf budgets of G15 will read. */
  uint32_t vertex_count() const;

 private:
  std::vector<Batch> batches_;

  Batch &solid();
};

}  // namespace zabloo
