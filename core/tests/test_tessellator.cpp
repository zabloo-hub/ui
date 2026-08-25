#include <cstddef>
#include <cstdint>

#include "glyphs.h"
#include "tessellator.h"
#include "testing.h"
#include "ttf.h"

using namespace zabloo;

namespace {

constexpr Color RED{1.0f, 0.0f, 0.0f, 1.0f};
/** 4 corner arcs × (6 segments + 1) points — the web's parametrization. */
constexpr uint32_t PERIMETER = 28;

const Batch &only(const GeometryBuilder &builder) { return builder.batches().front(); }

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
  CHECK(builder.batches()[0].texture == nullptr);
  CHECK(builder.batches()[1].texture == &atlas);
  // Two glyphs, two quads. A space would add none, since it has no ink.
  CHECK_EQ(builder.batches()[1].vertex_count(), 8u);
  CHECK_EQ(builder.batches()[1].indices.size(), 12u);
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

  CHECK(builder.batches()[0].texture == nullptr);
  CHECK_EQ(builder.batches()[0].vertex_count(), 4u);
}

TEST(tessellator, whitespace_advances_the_pen_and_paints_nothing) {
  GlyphAtlas atlas(16.0, 1.0, default_font());
  GeometryBuilder builder;
  builder.reset();
  builder.text(0.0, 0.0, "a a", atlas, RED);
  const Batch &text = builder.batches()[1];
  CHECK_EQ(text.vertex_count(), 8u);
  // The second glyph sits a space to the right of the first, so the pen moved
  // through the whitespace even though nothing was emitted for it.
  CHECK(text.positions[8] > text.positions[0] + atlas.advance('a'));
}
