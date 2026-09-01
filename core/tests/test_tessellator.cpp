#include <cstddef>
#include <cstdint>
#include <optional>

#include "assets.h"
#include "glyphs.h"
#include "clip.h"
#include "tessellator.h"
#include "testing.h"
#include "ttf.h"

using namespace zabloo;

namespace {

constexpr Color RED{1.0f, 0.0f, 0.0f, 1.0f};
/** 4 corner arcs × (6 segments + 1) points — the web's parametrization. */
constexpr uint32_t PERIMETER = 28;

const Batch &only(const GeometryBuilder &builder) { return *builder.batches().front(); }

}  // namespace

TEST(tessellator, a_square_corner_is_two_triangles) {
  GeometryBuilder builder;
  builder.rounded_rect(Rect{10, 20, 30, 40}, 0, RED);
  const Batch &batch = only(builder);
  CHECK_EQ(batch.vertex_count(), 4u);
  CHECK_EQ(batch.indices.size(), 6u);
  CHECK_EQ(batch.positions[0], 10.0f);
  CHECK_EQ(batch.positions[1], 20.0f);
  CHECK_EQ(batch.positions[4], 40.0f);
  CHECK_EQ(batch.positions[5], 60.0f);
  // The color rides on every vertex: that is where the inherited opacity lands.
  CHECK_EQ(batch.colors.size(), 16u);
}

TEST(tessellator, a_rounded_corner_is_a_fan_around_the_centroid) {
  GeometryBuilder builder;
  builder.rounded_rect(Rect{0, 0, 100, 50}, 8, RED);
  const Batch &batch = only(builder);
  CHECK_EQ(batch.vertex_count(), PERIMETER + 1);
  CHECK_EQ(batch.indices.size(), PERIMETER * 3);
  CHECK_EQ(batch.positions[0], 50.0f);
  CHECK_EQ(batch.positions[1], 25.0f);
}

TEST(tessellator, a_radius_never_exceeds_half_the_shorter_side) {
  // `radius: 999` is how a pill is authored, so it has to clamp rather than
  // fold the geometry inside out.
  GeometryBuilder builder;
  builder.rounded_rect(Rect{0, 0, 40, 20}, 999, RED);
  const Batch &batch = only(builder);
  for (size_t i = 0; i < batch.positions.size(); i += 2) {
    CHECK(batch.positions[i] >= 0.0f && batch.positions[i] <= 40.0f);
    CHECK(batch.positions[i + 1] >= 0.0f && batch.positions[i + 1] <= 20.0f);
  }
}

TEST(tessellator, an_empty_rect_paints_nothing) {
  GeometryBuilder builder;
  builder.rounded_rect(Rect{0, 0, 0, 30}, 4, RED);
  builder.rounded_rect(Rect{0, 0, 30, 0}, 4, RED);
  builder.rounded_rect_border(Rect{0, 0, 30, 30}, 4, 0, RED);
  CHECK(builder.batches().empty() || only(builder).empty());
}

TEST(tessellator, the_border_is_a_ring_INSIDE_the_rect) {
  // The inset model (2026-08-06): nothing paints outside the layout rect, which
  // is what keeps hit-testing on layout rects honest and stops a clip from ever
  // cutting a border in half.
  GeometryBuilder builder;
  const Rect rect{10, 10, 100, 60};
  builder.rounded_rect_border(rect, 0, 4, RED);
  const Batch &batch = only(builder);
  CHECK_EQ(batch.vertex_count(), PERIMETER * 2);
  CHECK_EQ(batch.indices.size(), PERIMETER * 6);
  for (size_t i = 0; i < batch.positions.size(); i += 2) {
    CHECK(batch.positions[i] >= 10.0f && batch.positions[i] <= 110.0f);
    CHECK(batch.positions[i + 1] >= 10.0f && batch.positions[i + 1] <= 70.0f);
  }
}

TEST(tessellator, a_border_thick_enough_to_close_up_is_a_fill) {
  GeometryBuilder builder;
  builder.rounded_rect_border(Rect{0, 0, 20, 20}, 0, 10, RED);
  // The degenerate case is not a hairline ring around nothing: it is the rect.
  CHECK_EQ(only(builder).vertex_count(), 4u);
}

TEST(tessellator, reset_keeps_the_buffers_and_drops_the_frame) {
  GeometryBuilder builder;
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);
  const size_t capacity = only(builder).positions.capacity();
  builder.reset();
  CHECK_EQ(only(builder).vertex_count(), 0u);
  // The point of resetting rather than rebuilding: a steady-state frame does not
  // allocate (the property ZAB-55 bought the web renderer).
  CHECK_EQ(only(builder).positions.capacity(), capacity);
}

TEST(tessellator, a_run_of_text_is_a_batch_of_its_own_naming_its_atlas) {
  // One draw call per texture, and the atlas pointer IS the name: the adapter
  // maps it to whatever it uploaded for that atlas.
  GlyphAtlas atlas(16.0, 1.0, default_font());
  GeometryBuilder builder;
  builder.reset();
  builder.rounded_rect(Rect{0, 0, 100, 30}, 0, RED);
  builder.text(4.0, 4.0, "Hi", atlas, RED);

  CHECK_EQ(builder.batches().size(), 2u);
  CHECK(builder.batches()[0]->texture == nullptr);
  CHECK(builder.batches()[1]->texture == &atlas);
  // Two glyphs, two quads. A space would add none, since it has no ink.
  CHECK_EQ(builder.batches()[1]->vertex_count(), 8u);
  CHECK_EQ(builder.batches()[1]->indices.size(), 12u);
}

TEST(tessellator, the_solids_keep_batch_zero_even_when_text_paints_first) {
  // `solid()` is the FIRST batch, so a frame whose first paint is a `Text` must
  // not let the atlas claim it — the rects of the whole screen would sample the
  // glyphs instead of nothing.
  GlyphAtlas atlas(16.0, 1.0, default_font());
  GeometryBuilder builder;
  builder.reset();
  builder.text(4.0, 4.0, "Hi", atlas, RED);
  builder.rounded_rect(Rect{0, 0, 100, 30}, 0, RED);

  CHECK(builder.batches()[0]->texture == nullptr);
  CHECK_EQ(builder.batches()[0]->vertex_count(), 4u);
}

TEST(tessellator, whitespace_advances_the_pen_and_paints_nothing) {
  GlyphAtlas atlas(16.0, 1.0, default_font());
  GeometryBuilder builder;
  builder.reset();
  builder.text(0.0, 0.0, "a a", atlas, RED);
  const Batch &text = *builder.batches()[1];
  CHECK_EQ(text.vertex_count(), 8u);
  // The second glyph sits a space to the right of the first, so the pen moved
  // through the whitespace even though nothing was emitted for it.
  CHECK(text.positions[8] > text.positions[0] + atlas.advance('a'));
}

// --- images ---------------------------------------------------------------

namespace {

/** A 2:1 source, so `contain` has to letterbox it and `cover` has to crop. */
ImageAsset source(double width = 64, double height = 32) {
  ImageAsset asset;
  asset.hash = "aaa";
  asset.mime = "image/png";
  asset.width = width;
  asset.height = height;
  return asset;
}

/** True when no vertex of a batch lies outside `rect` — the standing invariant. */
bool inside(const Batch &batch, const Rect &rect) {
  const double slack = 1e-6;
  for (uint32_t i = 0; i < batch.vertex_count(); i++) {
    const double x = batch.positions[i * 2];
    const double y = batch.positions[i * 2 + 1];
    if (x < rect.x - slack || x > rect.x + rect.width + slack) return false;
    if (y < rect.y - slack || y > rect.y + rect.height + slack) return false;
  }
  return true;
}

}  // namespace

TEST(tessellator, contain_letterboxes_the_box_and_samples_the_whole_texture) {
  const Rect box{0, 0, 120, 120};
  const std::optional<ImageQuad> quad = fit_image(box, 64, 32, ImageFit::Contain);
  CHECK(quad.has_value());
  // 2:1 into a square: full width, half the height, centred vertically.
  CHECK_NEAR(quad->rect.width, 120.0, 1e-9);
  CHECK_NEAR(quad->rect.height, 60.0, 1e-9);
  CHECK_NEAR(quad->rect.y, 30.0, 1e-9);
  CHECK_NEAR(quad->uv.width, 1.0, 1e-9);
  CHECK_NEAR(quad->uv.height, 1.0, 1e-9);
}

TEST(tessellator, cover_fills_the_rect_and_crops_through_the_uvs) {
  const Rect box{0, 0, 120, 120};
  const std::optional<ImageQuad> quad = fit_image(box, 64, 32, ImageFit::Cover);
  CHECK(quad.has_value());
  // The geometry is the rect itself — nothing overflows, which is what keeps
  // hit-testing on layout rects honest (2026-08-06).
  CHECK_NEAR(quad->rect.width, 120.0, 1e-9);
  CHECK_NEAR(quad->rect.height, 120.0, 1e-9);
  // Half the source's width is visible, centred; its height is all of it.
  CHECK_NEAR(quad->uv.width, 0.5, 1e-9);
  CHECK_NEAR(quad->uv.x, 0.25, 1e-9);
  CHECK_NEAR(quad->uv.height, 1.0, 1e-9);
  CHECK_NEAR(quad->uv.y, 0.0, 1e-9);
}

TEST(tessellator, stretch_takes_the_whole_box_and_the_whole_texture) {
  const std::optional<ImageQuad> quad = fit_image(Rect{5, 7, 120, 120}, 64, 32, ImageFit::Stretch);
  CHECK(quad.has_value());
  CHECK_NEAR(quad->rect.x, 5.0, 1e-9);
  CHECK_NEAR(quad->rect.height, 120.0, 1e-9);
  CHECK_NEAR(quad->uv.width, 1.0, 1e-9);
}

TEST(tessellator, no_fit_paints_outside_the_rect_it_was_given) {
  const Rect box{10, 20, 90, 40};
  for (const ImageFit fit : {ImageFit::Contain, ImageFit::Cover, ImageFit::Stretch}) {
    for (const double aspect : {0.25, 1.0, 4.0}) {
      const std::optional<ImageQuad> quad = fit_image(box, 100 * aspect, 100, fit);
      CHECK(quad.has_value());
      CHECK(quad->rect.x >= box.x - 1e-9);
      CHECK(quad->rect.y >= box.y - 1e-9);
      CHECK(quad->rect.x + quad->rect.width <= box.x + box.width + 1e-9);
      CHECK(quad->rect.y + quad->rect.height <= box.y + box.height + 1e-9);
    }
  }
}

TEST(tessellator, a_side_with_no_usable_size_has_no_quad_at_all) {
  // A collapsed rect, and a manifest that carried no dimensions with nothing
  // decoded yet: neither can be fitted, and both mean "paint nothing".
  CHECK(!fit_image(Rect{0, 0, 0, 40}, 64, 32, ImageFit::Contain).has_value());
  CHECK(!fit_image(Rect{0, 0, 90, 40}, 0, 0, ImageFit::Contain).has_value());
  CHECK(!fit_image(Rect{0, 0, 90, 40}, 64, 0, ImageFit::Cover).has_value());

  GeometryBuilder builder;
  builder.reset();
  builder.image(Rect{0, 0, 90, 40}, source(0, 0), ImageFit::Contain, RED, 0);
  CHECK_EQ(builder.batches().size(), 1u);
  CHECK(builder.batches()[0]->empty());
}

TEST(tessellator, a_square_cornered_image_is_a_quad_with_its_uv_window_on_it) {
  const ImageAsset asset = source();
  GeometryBuilder builder;
  builder.reset();
  builder.image(Rect{0, 0, 120, 120}, asset, ImageFit::Cover, RED, 0);

  CHECK_EQ(builder.batches().size(), 2u);
  const Batch &image = *builder.batches()[1];
  CHECK(image.texture == &asset);
  CHECK(image.kind == TextureKind::Image);
  CHECK_EQ(image.vertex_count(), 4u);
  CHECK_EQ(image.indices.size(), 6u);
  // The crop of `cover`, on the vertices: u runs 0.25 → 0.75, v runs 0 → 1.
  CHECK_NEAR(image.uvs[0], 0.25, 1e-6);
  CHECK_NEAR(image.uvs[1], 0.0, 1e-6);
  CHECK_NEAR(image.uvs[4], 0.75, 1e-6);
  CHECK_NEAR(image.uvs[5], 1.0, 1e-6);
  // The tint rides on every vertex, exactly as a glyph's colour does.
  CHECK_EQ(image.colors.size(), 16u);
  CHECK_EQ(image.colors[0], 1.0f);
  CHECK_EQ(image.colors[1], 0.0f);
}

TEST(tessellator, a_rounded_image_is_the_same_fan_a_background_is) {
  const ImageAsset asset = source();
  GeometryBuilder builder;
  builder.reset();
  builder.image(Rect{0, 0, 120, 60}, asset, ImageFit::Stretch, RED, 12);

  const Batch &image = *builder.batches()[1];
  CHECK_EQ(image.vertex_count(), PERIMETER + 1);
  CHECK_EQ(image.indices.size(), PERIMETER * 3);
  // Every UV stays inside the window it samples, and every vertex inside the box.
  for (size_t i = 0; i < image.uvs.size(); i++) {
    CHECK(image.uvs[i] >= -1e-6f);
    CHECK(image.uvs[i] <= 1.0f + 1e-6f);
  }
  CHECK(inside(image, Rect{0, 0, 120, 60}));
}

TEST(tessellator, a_radius_clamps_to_the_painted_box_and_not_to_the_rect) {
  // With `contain` the painted box is smaller than the rect, so a radius clamped
  // against the rect would leave visible square corners on the letterboxed image.
  const ImageAsset asset = source();
  const Rect rect{0, 0, 120, 120};
  GeometryBuilder builder;
  builder.reset();
  builder.image(rect, asset, ImageFit::Contain, RED, 1000);

  const Batch &image = *builder.batches()[1];
  // The box is 120×60; half its shorter side is 30, so the fan's leftmost point
  // sits at the vertical centre of the BOX (y = 60), not of the rect.
  CHECK(inside(image, Rect{0, 30, 120, 60}));
  double lowest_x = 1e9;
  double y_at_lowest = 0;
  for (uint32_t i = 0; i < image.vertex_count(); i++) {
    if (image.positions[i * 2] < lowest_x) {
      lowest_x = image.positions[i * 2];
      y_at_lowest = image.positions[i * 2 + 1];
    }
  }
  CHECK_NEAR(lowest_x, 0.0, 1e-6);
  CHECK_NEAR(y_at_lowest, 60.0, 1e-6);
}

TEST(tessellator, the_batches_come_out_solids_then_images_then_text) {
  // Painter's order is the reference's, not the tree's: an image declared after
  // a label still draws under it. A target that ordered these by first paint
  // would answer the same envelope with a different picture.
  const ImageAsset asset = source();
  GlyphAtlas atlas(16.0, 1.0, default_font());
  GeometryBuilder builder;
  builder.reset();
  builder.text(4.0, 4.0, "Hi", atlas, RED);
  builder.image(Rect{0, 0, 60, 30}, asset, ImageFit::Cover, RED, 0);
  builder.rounded_rect(Rect{0, 0, 100, 30}, 0, RED);

  CHECK_EQ(builder.batches().size(), 3u);
  CHECK(builder.batches()[0]->kind == TextureKind::None);
  CHECK(builder.batches()[1]->kind == TextureKind::Image);
  CHECK(builder.batches()[2]->kind == TextureKind::Glyphs);
}

TEST(tessellator, one_asset_is_one_batch_however_many_nodes_name_it) {
  // The hash-keyed cache hands both nodes the same asset, so this is what "two
  // ids with the same bytes share a draw call" looks like downstream.
  const ImageAsset asset = source();
  const ImageAsset other = source(16, 16);
  GeometryBuilder builder;
  builder.reset();
  builder.image(Rect{0, 0, 60, 30}, asset, ImageFit::Cover, RED, 0);
  builder.image(Rect{0, 40, 60, 30}, asset, ImageFit::Cover, RED, 0);
  CHECK_EQ(builder.batches().size(), 2u);
  CHECK_EQ(builder.batches()[1]->vertex_count(), 8u);

  builder.image(Rect{0, 80, 20, 20}, other, ImageFit::Contain, RED, 0);
  CHECK_EQ(builder.batches().size(), 3u);
}

// --- clip groups ----------------------------------------------------------

TEST(tessellator, entering_a_region_opens_a_group_and_staying_in_it_does_not) {
  ClipArena arena;
  const Clip *inside = arena.intern(Clip{0, 0, 100, 100, 0});
  GeometryBuilder builder;
  builder.reset();

  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);  // group 0, unclipped
  builder.set_clip(inside);
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);  // group 1
  builder.set_clip(inside);                          // the same region: still 1
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);
  builder.set_clip(nullptr);
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);  // group 2

  const std::vector<const Batch *> &batches = builder.batches();
  CHECK_EQ(batches.size(), 3u);
  CHECK(batches[0]->clip == nullptr);
  CHECK(batches[1]->clip == inside);
  CHECK(batches[2]->clip == nullptr);
  CHECK_EQ(batches[0]->group, 0u);
  CHECK_EQ(batches[1]->group, 1u);
  CHECK_EQ(batches[2]->group, 2u);
  // Two rects went into the middle group, and one into each of the others.
  CHECK_EQ(batches[0]->vertex_count(), 4u);
  CHECK_EQ(batches[1]->vertex_count(), 8u);
  CHECK_EQ(batches[2]->vertex_count(), 4u);
}

TEST(tessellator, a_paint_root_opens_a_group_even_over_the_very_same_region) {
  // The one thing `set_clip` cannot express, and the reason a batch carries its
  // group ordinal at all: two roots may share a region — both unclipped, here —
  // and still have to be drawn one after the other.
  GeometryBuilder builder;
  builder.reset();
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);
  builder.start_root(nullptr);
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);

  const std::vector<const Batch *> &batches = builder.batches();
  CHECK_EQ(batches.size(), 2u);
  CHECK(batches[0]->clip == batches[1]->clip);
  CHECK_EQ(batches[0]->group, 0u);
  CHECK_EQ(batches[1]->group, 1u);
}

TEST(tessellator, a_group_keeps_solids_before_images_before_text) {
  // The order G5 fixed, now per group rather than per frame: an image declared
  // after a label still draws under it, inside whichever region they share.
  const ImageAsset asset = source();
  ClipArena arena;
  const Clip *inside = arena.intern(Clip{0, 0, 100, 100, 0});
  GeometryBuilder builder;
  builder.reset();
  builder.set_clip(inside);
  builder.image(Rect{0, 0, 40, 40}, asset, ImageFit::Stretch, RED, 0);
  builder.rounded_rect(Rect{0, 0, 10, 10}, 0, RED);

  // Three, because the frame opens unclipped and that group keeps its (empty)
  // solids batch — which is exactly why the caller skips `empty()` ones.
  const std::vector<const Batch *> &batches = builder.batches();
  CHECK_EQ(batches.size(), 3u);
  CHECK(batches[0]->empty());
  CHECK(batches[1]->kind == TextureKind::None);
  CHECK(batches[2]->kind == TextureKind::Image);
  // Both belong to the region that was entered, not to the frame's opening group.
  CHECK(batches[1]->clip == inside);
  CHECK(batches[2]->clip == inside);
  CHECK_EQ(batches[1]->group, batches[2]->group);
}
