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
#include <optional>
#include <string_view>
#include <vector>

#include "assets.h"
#include "clip.h"
#include "color.h"
#include "envelope.h"
#include "glyphs.h"
#include "layout.h"

namespace zabloo {

/**
 * What a batch's texture handle points at.
 *
 * The tessellator does not care — it names a handle and moves on — but the
 * adapter does: a glyph atlas is LA8 pixels it owns, an image is bytes it has to
 * hand to its engine's decoder, and without a discriminator the `const void *`
 * could not be cast back to either.
 */
enum class TextureKind : uint8_t { None, Glyphs, Image };

/** One draw call: a run of triangles sharing a texture. */
struct Batch {
  /**
   * The `GlyphAtlas` or `ImageAsset` this run of triangles samples, as an opaque
   * handle the adapter maps to its own texture object; `kind` says which. Null
   * is untextured geometry, which every solid is.
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
  TextureKind kind = TextureKind::None;
  /**
   * The region this run is cut to, or null for none — the adapter's scissor box
   * and, where the radius is not zero, the corners its shader has to discard.
   *
   * It is a pointer and not a value because identity is what groups the geometry
   * (see `ClipArena`): every batch of one group names the very same region.
   */
  const Clip *clip = nullptr;
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
  /**
   * A builder is born with its first group open, so painting into a fresh one
   * needs no ceremony — the frame loop calls `reset()` anyway, and that is the
   * same thing.
   */
  GeometryBuilder() { reset(); }

  void reset();

  /**
   * Enters a clipping region (null = unclipped). Consecutive calls with the same
   * region keep filling the current group; anything else opens a new one, which
   * is what keeps painter's order ACROSS regions: a group draws as a whole, so
   * re-entering an earlier one would sneak geometry under what is already on top
   * of it.
   */
  void set_clip(const Clip *clip);

  /**
   * Opens a group unconditionally — what a PAINT ROOT needs, and the one thing
   * `set_clip` cannot express: two roots may share a region (both unclipped,
   * typically) and still have to be ordered one after the other.
   *
   * Without it an overlay entry would keep filling the tree's group, and since a
   * group draws its solids before its text, the tree's glyphs would come out ON
   * TOP of the panel floating over them (2026-08-12, ZAB-25). The layer that
   * needs it arrives with G9 (ZAB-142).
   */
  void start_root(const Clip *clip = nullptr);

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
   * Textured geometry for an `Image`.
   *
   * Every `fit` paints INSIDE the layout rect — `cover` crops through the UVs
   * rather than overflowing — which keeps the invariant the inset border bought
   * (2026-08-06): nothing paints outside the rect, so hit-testing on rects stays
   * honest and no clip is needed to keep an image off its siblings.
   *
   * `color` tints the pixels exactly as it colours a `Text`'s glyphs: white
   * means the image as it is, and the inherited opacity has already landed in
   * the alpha. A radius rounds the painted image the same way it rounds a
   * background — sharing the perimeter walk, so an image inside a rounded panel
   * cannot poke out at the corners — and clamps to the PAINTED box, not to the
   * rect, since a `contain` box is smaller than the rect it sits in.
   */
  void image(const Rect &rect, const ImageAsset &asset, ImageFit fit, Color color, double radius);

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
   * Every batch of the frame, in draw order: the clip groups in the order they
   * were entered, and inside each one the solids, then one batch per IMAGE, then
   * one per glyph atlas. Some are `empty()` — a group that painted no text still
   * owns its solids batch — and the caller skips those, as it always has.
   *
   * Neither order is the order things happen to be painted in. Within a group an
   * image declared after a label still draws under it; across groups the earlier
   * region always draws first, which is why a group is never re-entered. Both
   * are the reference's, and painter's order is visible — a target that emitted
   * them in a different sequence would answer the same envelope with a different
   * picture.
   *
   * Grouping by region costs the old invariant that every solid on screen shared
   * one batch: a region is engine state, so geometry cut differently cannot share
   * a draw call.
   */
  const std::vector<const Batch *> &batches() const;
  /** Vertices across every batch — what the perf budgets of G15 will read. */
  uint32_t vertex_count() const;

 private:
  /** Everything painted under one region, in one contiguous run of the pass. */
  struct ClipGroup {
    const Clip *clip = nullptr;
    /** Batch 0 is the solids'. Then the images, then the glyph atlases. */
    std::vector<Batch> batches;
    /** How many image batches sit after the solids — where a new one splices in. */
    uint32_t images = 0;
  };

  std::vector<ClipGroup> groups_;
  /** Groups claimed this frame; the rest are last frame's, kept for their buffers. */
  size_t used_ = 0;
  /** The open group: the only one that ever grows. */
  size_t current_ = 0;
  /** Rebuilt by `batches()`, which keeps its capacity across frames. */
  mutable std::vector<const Batch *> order_;

  /** Claims the next slot, reusing the batches (and textures) it already holds. */
  void open_group(const Clip *clip);
  Batch &solid();
  /**
   * The batch for one texture WITHIN the open group, opened after that group's
   * solids the first time it paints and kept across frames with its buffers. A
   * new image batch is INSERTED at the boundary rather than appended, which is
   * what keeps the three kinds in order however the tree happens to be walked;
   * it only ever happens on a texture's first sight in that group, so no frame
   * pays for it twice.
   */
  Batch &textured(const void *texture, TextureKind kind);
};

/** The box an `Image` paints into, and the slice of its texture it samples. */
struct ImageQuad {
  Rect rect;
  /** In 0..1. `cover` shrinks this window; every other mode takes the whole thing. */
  Rect uv;
};

/**
 * Resolves a `fit` into the box to paint and the UV window to sample.
 *
 * `contain` shrinks the box (letterbox) and `cover` shrinks the UV window
 * (crop): both keep the aspect ratio, and neither ever paints outside `rect`.
 * `stretch` takes the whole box and the whole texture, distorting on purpose.
 *
 * Absent when either side has no usable size — a collapsed rect, or a manifest
 * that carried no dimensions and an adapter that has not reported any.
 */
std::optional<ImageQuad> fit_image(const Rect &rect, double width, double height, ImageFit fit);

}  // namespace zabloo
