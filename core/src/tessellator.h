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
#include <string_view>
#include <vector>

#include "color.h"
#include "glyphs.h"
#include "layout.h"

namespace zabloo {

/** One draw call: a run of triangles sharing a texture. */
struct Batch {
  /**
   * The `GlyphAtlas` this run of triangles samples, as an opaque handle the
   * adapter maps to its own texture object. Null is untextured geometry, which
   * every solid is.
   *
   * Solids deliberately do NOT join the atlas through its white pixel, even
   * though the pixel is reserved for exactly that: the reference renderer binds
   * a built-in 1×1 white texture for them instead, and a second target that
   * merged the two batches would be answering the same envelope with a
   * different number of draw calls. The pixel stays reserved because that is
   * what an engine with no untextured path (or a future atlas of images) will
   * need.
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

  /**
   * A run of text, its baseline at `origin_y + atlas.ascent()` — the placed top
   * of a line, as `place_lines` hands it over.
   *
   * The kerning `text.h` measured with is applied here too: a run painted
   * without it would not fit the box the layout pass reserved for it.
   */
  void text(double origin_x, double origin_y, std::string_view content, GlyphAtlas &atlas,
            Color color);

  /**
   * Solids first, then one batch per atlas in the order the atlases were first
   * painted with — backgrounds under glyphs, which is the same order the
   * reference emits and therefore the same result on both.
   */
  const std::vector<Batch> &batches() const { return batches_; }
  /** Vertices across every batch — what the perf budgets of G15 will read. */
  uint32_t vertex_count() const;

 private:
  std::vector<Batch> batches_;

  Batch &solid();
  /** The batch for one atlas, appended after the solids the first time it paints. */
  Batch &textured(const void *texture);
};

}  // namespace zabloo
