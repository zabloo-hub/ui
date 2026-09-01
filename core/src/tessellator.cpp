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
  // Groups and their batches survive the frame with their capacities, their
  // textures and their positions, so a scene that paints the same regions with
  // the same sizes reuses the very same buffers. Only the contents go.
  for (ClipGroup &group : groups_) {
    for (Batch &batch : group.batches) {
      batch.positions.clear();
      batch.uvs.clear();
      batch.colors.clear();
      batch.indices.clear();
    }
  }
  used_ = 0;
  // The frame opens unclipped, so a paint that never mentions a region behaves
  // exactly as it did before regions existed.
  open_group(nullptr);
}

void GeometryBuilder::open_group(const Clip *clip) {
  if (used_ == groups_.size()) groups_.emplace_back();
  current_ = used_++;
  ClipGroup &group = groups_[current_];
  group.clip = clip;
  // Batch 0 is the solids', always. It is claimed here rather than by the first
  // `solid()` because a group whose first paint is a `Text` would otherwise open
  // the atlas batch first and hand `solid()` — which is `front()` — geometry
  // sampling the glyphs.
  if (group.batches.empty()) group.batches.emplace_back();
  for (Batch &batch : group.batches) batch.clip = clip;
}

void GeometryBuilder::set_clip(const Clip *clip) {
  if (clip == groups_[current_].clip) return;
  open_group(clip);
}

void GeometryBuilder::start_root(const Clip *clip) { open_group(clip); }

Batch &GeometryBuilder::solid() { return groups_[current_].batches.front(); }

Batch &GeometryBuilder::textured(const void *texture, TextureKind kind) {
  ClipGroup &group = groups_[current_];
  for (Batch &batch : group.batches) {
    if (batch.texture == texture) return batch;
  }
  // Images go before the atlases, so a group stays [solids, images…, texts…]
  // whatever order the tree paints in. Splicing moves a handful of Batches —
  // vectors, so a move each — and only on a texture's first frame in this group.
  const size_t at = kind == TextureKind::Image ? 1 + group.images : group.batches.size();
  if (kind == TextureKind::Image) group.images++;
  Batch &batch = *group.batches.emplace(group.batches.begin() + static_cast<ptrdiff_t>(at));
  batch.texture = texture;
  batch.kind = kind;
  batch.clip = group.clip;
  return batch;
}

const std::vector<const Batch *> &GeometryBuilder::batches() const {
  // Rebuilt rather than cached: it is a list of pointers over a vector that keeps
  // its capacity, so it costs nothing worth a dirty flag to get wrong.
  order_.clear();
  for (size_t i = 0; i < used_; i++) {
    for (const Batch &batch : groups_[i].batches) order_.push_back(&batch);
  }
  return order_;
}

uint32_t GeometryBuilder::vertex_count() const {
  uint32_t total = 0;
  for (const Batch *batch : batches()) total += batch->vertex_count();
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

std::optional<ImageQuad> fit_image(const Rect &rect, double width, double height, ImageFit fit) {
  if (!(rect.width > 0.0) || !(rect.height > 0.0) || !(width > 0.0) || !(height > 0.0)) {
    return std::nullopt;
  }
  const Rect full{0.0, 0.0, 1.0, 1.0};
  if (fit == ImageFit::Stretch) return ImageQuad{rect, full};
  if (fit == ImageFit::Cover) {
    const double scale = std::max(rect.width / width, rect.height / height);
    // The visible slice of the source, in source px → UV fractions, centred.
    const double u = std::min(1.0, rect.width / scale / width);
    const double v = std::min(1.0, rect.height / scale / height);
    return ImageQuad{rect, Rect{(1.0 - u) / 2.0, (1.0 - v) / 2.0, u, v}};
  }
  // `contain`: the largest box with the source's aspect ratio, centred.
  const double scale = std::min(rect.width / width, rect.height / height);
  const double fitted_width = width * scale;
  const double fitted_height = height * scale;
  return ImageQuad{Rect{rect.x + (rect.width - fitted_width) / 2.0,
                        rect.y + (rect.height - fitted_height) / 2.0, fitted_width, fitted_height},
                   full};
}

void GeometryBuilder::image(const Rect &rect, const ImageAsset &asset, ImageFit fit, Color color,
                            double radius) {
  const std::optional<ImageQuad> quad = fit_image(rect, asset.width, asset.height, fit);
  if (!quad.has_value()) return;

  const Rect &box = quad->rect;
  const Rect &uv = quad->uv;
  Batch &batch = textured(&asset, TextureKind::Image);
  const uint32_t base = batch.vertex_count();
  const double r = std::min({radius, box.width * 0.5, box.height * 0.5});

  if (r <= 0.01) {
    const float u1 = static_cast<float>(uv.x + uv.width);
    const float v1 = static_cast<float>(uv.y + uv.height);
    const float u0 = static_cast<float>(uv.x);
    const float v0 = static_cast<float>(uv.y);
    // v grows downward, like the atlas: a texture uploads its rows top-first.
    push_vertex(batch, box.x, box.y, u0, v0, color);
    push_vertex(batch, box.x + box.width, box.y, u1, v0, color);
    push_vertex(batch, box.x + box.width, box.y + box.height, u1, v1, color);
    push_vertex(batch, box.x, box.y + box.height, u0, v1, color);
    push_triangle(batch, base, base + 1, base + 2);
    push_triangle(batch, base, base + 2, base + 3);
    return;
  }

  // Rounded: the same fan a background is, sampling the texture at each vertex's
  // relative position inside the painted box.
  const auto u_at = [&](double x) {
    return static_cast<float>(uv.x + ((x - box.x) / box.width) * uv.width);
  };
  const auto v_at = [&](double y) {
    return static_cast<float>(uv.y + ((y - box.y) / box.height) * uv.height);
  };
  const double cx = box.x + box.width / 2.0;
  const double cy = box.y + box.height / 2.0;
  double xs[PERIMETER_POINTS];
  double ys[PERIMETER_POINTS];
  push_vertex(batch, cx, cy, u_at(cx), v_at(cy), color);
  fill_perimeter(box, r, xs, ys);
  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) {
    push_vertex(batch, xs[i], ys[i], u_at(xs[i]), v_at(ys[i]), color);
  }
  for (uint32_t i = 0; i < PERIMETER_POINTS; i++) {
    push_triangle(batch, base, base + 1 + i, base + 1 + ((i + 1) % PERIMETER_POINTS));
  }
}

void GeometryBuilder::text(double origin_x, double origin_y, std::string_view content,
                           GlyphAtlas &atlas, Color color) {
  Batch &batch = textured(&atlas, TextureKind::Glyphs);
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
