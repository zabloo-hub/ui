#include "tessellator.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

#include "utf8.h"

namespace zabloo {
namespace {

/**
 * Points per corner arc. Six is what the web renderer uses, and matching it is
 * not cosmetic: the corpus counts vertices, so a different tessellation is a
 * different answer to the same envelope.
 */
constexpr int CORNER_SEGMENTS = 6;
constexpr uint32_t PERIMETER_POINTS = 4 * (CORNER_SEGMENTS + 1);
constexpr double PI = 3.14159265358979323846;

/**
 * The perimeter walk, into a scratch shared by both users. Corners are filled in
 * order and each contributes the same number of points, so the fill and the ring
 * agree point for point.
 */
void fill_perimeter(const Rect &rect, double r, double *xs, double *ys) {
  for (int corner = 0; corner < 4; corner++) {
    // TL: 180 → 270, TR: 270 → 360, BR: 0 → 90, BL: 90 → 180.
    const double cx = (corner == 0 || corner == 3) ? rect.x + r : rect.x + rect.width - r;
    const double cy = corner < 2 ? rect.y + r : rect.y + rect.height - r;
    const double start = (180.0 + corner * 90.0) * (PI / 180.0);
    for (int s = 0; s <= CORNER_SEGMENTS; s++) {
      const double angle = start + (PI / 2.0) * (static_cast<double>(s) / CORNER_SEGMENTS);
      const int at = corner * (CORNER_SEGMENTS + 1) + s;
      xs[at] = cx + r * std::cos(angle);
      ys[at] = cy + r * std::sin(angle);
    }
  }
}

void push_vertex(Batch &batch, double x, double y, float u, float v, Color color) {
  batch.positions.push_back(static_cast<float>(x));
  batch.positions.push_back(static_cast<float>(y));
  batch.uvs.push_back(u);
  batch.uvs.push_back(v);
  batch.colors.push_back(color.r);
  batch.colors.push_back(color.g);
  batch.colors.push_back(color.b);
  batch.colors.push_back(color.a);
}

void push_triangle(Batch &batch, uint32_t a, uint32_t b, uint32_t c) {
  batch.indices.push_back(a);
  batch.indices.push_back(b);
  batch.indices.push_back(c);
}

/**
 * `Math.round`, which rounds a half UP and not away from zero. The difference
 * only shows on a negative coordinate — a glyph scrolled off the left edge — and
 * it is a half pixel, but the reference is what the two targets are compared
 * against, so it is the one that decides.
 */
double round_half_up(double value) { return std::floor(value + 0.5); }

}  // namespace

void GeometryBuilder::reset() {
  // Batch 0 is the solids', always. It is claimed here rather than by the first
  // `solid()` because a frame whose first paint is a `Text` would otherwise open
  // the atlas batch first and hand `solid()` — which is `front()` — geometry
  // sampling the glyphs.
  if (batches_.empty()) batches_.emplace_back();
  for (Batch &batch : batches_) {
    batch.positions.clear();
    batch.uvs.clear();
    batch.colors.clear();
    batch.indices.clear();
  }
}

Batch &GeometryBuilder::solid() {
  if (batches_.empty()) batches_.emplace_back();
  return batches_.front();
}

Batch &GeometryBuilder::textured(const void *texture) {
  // Batches survive `reset` with their capacity and their texture, so a scene
  // that paints the same sizes every frame reuses the very same buffers.
  for (Batch &batch : batches_) {
    if (batch.texture == texture) return batch;
  }
  batches_.emplace_back();
  batches_.back().texture = texture;
  return batches_.back();
}

uint32_t GeometryBuilder::vertex_count() const {
  uint32_t total = 0;
  for (const Batch &batch : batches_) total += batch.vertex_count();
  return total;
}

void GeometryBuilder::rounded_rect(const Rect &rect, double radius, Color color) {
  if (!(rect.width > 0.0) || !(rect.height > 0.0)) return;
  const double r = std::min({radius, rect.width * 0.5, rect.height * 0.5});
  Batch &batch = solid();
  const uint32_t base = batch.vertex_count();

  if (r <= 0.01) {
    push_vertex(batch, rect.x, rect.y, 0, 0, color);
    push_vertex(batch, rect.x + rect.width, rect.y, 0, 0, color);
    push_vertex(batch, rect.x + rect.width, rect.y + rect.height, 0, 0, color);
    push_vertex(batch, rect.x, rect.y + rect.height, 0, 0, color);
    push_triangle(batch, base, base + 1, base + 2);
    push_triangle(batch, base, base + 2, base + 3);
    return;
  }

  double xs[PERIMETER_POINTS];
  double ys[PERIMETER_POINTS];
  push_vertex(batch, rect.x + rect.width / 2, rect.y + rect.height / 2, 0, 0, color);
  fill_perimeter(rect, r, xs, ys);
  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) push_vertex(batch, xs[i], ys[i], 0, 0, color);
  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) {
    push_triangle(batch, base, base + 1 + i, base + 1 + ((i + 1) % PERIMETER_POINTS));
  }
}

void GeometryBuilder::rounded_rect_border(const Rect &rect, double radius, double width,
                                          Color color) {
  if (!(rect.width > 0.0) || !(rect.height > 0.0) || !(width > 0.0)) return;
  const double r = std::min({radius, rect.width * 0.5, rect.height * 0.5});

  // A border thick enough to cover the whole rect is a fill.
  if (width * 2.0 >= std::min(rect.width, rect.height)) {
    rounded_rect(rect, r, color);
    return;
  }

  const Rect inner{rect.x + width, rect.y + width, rect.width - width * 2.0,
                   rect.height - width * 2.0};
  Batch &batch = solid();
  const uint32_t base = batch.vertex_count();

  // Outer then inner perimeter, same parametrization → stitch quads between them.
  // A radius of 0 degenerates the corner arcs into repeated points, which is
  // harmless: the quads there are zero-area.
  double xs[PERIMETER_POINTS];
  double ys[PERIMETER_POINTS];
  fill_perimeter(rect, r, xs, ys);
  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) push_vertex(batch, xs[i], ys[i], 0, 0, color);
  fill_perimeter(inner, std::max(0.0, r - width), xs, ys);
  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) push_vertex(batch, xs[i], ys[i], 0, 0, color);

  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) {
    const uint32_t next = (i + 1) % PERIMETER_POINTS;
    push_triangle(batch, base + i, base + next, base + PERIMETER_POINTS + next);
    push_triangle(batch, base + PERIMETER_POINTS + next, base + PERIMETER_POINTS + i, base + i);
  }
}

void GeometryBuilder::text(double origin_x, double origin_y, std::string_view content,
                           GlyphAtlas &atlas, Color color) {
  Batch &batch = textured(&atlas);
  const double baseline = origin_y + atlas.ascent();
  // One cursor per run, not per glyph: the pen and the previous code point are
  // all the loop carries forward.
  double pen = origin_x;
  char32_t previous = 0;
  size_t index = 0;

  while (index < content.size()) {
    const char32_t code_point = utf8_next(content, index);
    const GlyphInfo glyph = atlas.get(code_point);
    if (previous != 0) pen += atlas.kern(previous, code_point);
    previous = code_point;

    if (glyph.has_quad) {
      // Snap the glyph origin to the physical pixel grid: a fractional position
      // under linear filtering blurs the glyph by half a pixel. The extents are
      // whole device px already, since the atlas rasterized at this very scale.
      // One device pixel is one logical pixel until the adapter tells the view
      // about a HiDPI surface, which is G15's (ZAB-148) — the same scale the
      // atlas takes and nobody passes yet.
      const double x0 = round_half_up(pen + glyph.min_x);
      const double y0 = round_half_up(baseline - glyph.max_y);
      const double x1 = x0 + (glyph.max_x - glyph.min_x);
      const double y1 = y0 + (glyph.max_y - glyph.min_y);
      const uint32_t base = batch.vertex_count();
      // The atlas's v grows downward (the row order a texture uploads in), so
      // v0 is the glyph's top.
      push_vertex(batch, x0, y0, static_cast<float>(glyph.u0), static_cast<float>(glyph.v0), color);
      push_vertex(batch, x1, y0, static_cast<float>(glyph.u1), static_cast<float>(glyph.v0), color);
      push_vertex(batch, x1, y1, static_cast<float>(glyph.u1), static_cast<float>(glyph.v1), color);
      push_vertex(batch, x0, y1, static_cast<float>(glyph.u0), static_cast<float>(glyph.v1), color);
      push_triangle(batch, base, base + 1, base + 2);
      push_triangle(batch, base, base + 2, base + 3);
    }
    pen += glyph.advance;
  }
}

}  // namespace zabloo
