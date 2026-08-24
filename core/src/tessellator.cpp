#include "tessellator.h"

#include <algorithm>
#include <cmath>

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

}  // namespace

void GeometryBuilder::reset() {
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

}  // namespace zabloo
