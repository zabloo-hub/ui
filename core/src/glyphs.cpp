#include "glyphs.h"

#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <utility>

namespace zabloo {
namespace {

constexpr int INITIAL_ATLAS_SIZE = 1024;
/**
 * Where growth stops (device px per side). Past this the atlas caches misses as
 * blank — the pre-ZAB-55 behavior, now 16× the area away instead of the floor.
 */
constexpr int MAX_ATLAS_SIZE = 4096;
constexpr int PADDING = 2;

/**
 * Live atlases the library keeps. Each is a surface plus a GPU texture, so an
 * unbounded map would grow one per distinct size and never let go.
 */
constexpr size_t MAX_ATLASES = 8;

/** A glyph that paints nothing — whitespace, or one the atlas had no room for. */
GlyphInfo blank(double advance) {
  GlyphInfo out;
  out.advance = advance;
  return out;
}

uint64_t pair_key(char32_t previous, char32_t code_point) {
  return (static_cast<uint64_t>(previous) << 32) | static_cast<uint64_t>(code_point);
}

}  // namespace

GlyphAtlas::GlyphAtlas(double point_size, double scale, const StbFont *font)
    : point_size_(point_size),
      scale_(std::max(1.0, scale)),
      device_point_size_(point_size * std::max(1.0, scale)),
      font_(font),
      size_(INITIAL_ATLAS_SIZE) {
  prepare();
  if (font_ != nullptr) {
    const FontMetrics metrics = font_->metrics(device_point_size_);
    ascent_ = metrics.ascent / scale_;
    line_height_ = metrics.line_height / scale_;
  }
  version_++;
}

void GlyphAtlas::prepare() {
  pixels_.assign(static_cast<size_t>(size_) * static_cast<size_t>(size_) * 2, 0);
  // The white block solids sample, so shapes and text share one texture.
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      const size_t at = (static_cast<size_t>(y) * static_cast<size_t>(size_) +
                         static_cast<size_t>(x)) * 2;
      pixels_[at] = 255;
      pixels_[at + 1] = 255;
    }
  }
  pen_x_ = 8;
  pen_y_ = PADDING;
  row_height_ = 0;
}

double GlyphAtlas::advance(char32_t code_point) { return get(code_point).advance; }

double GlyphAtlas::kern(char32_t previous, char32_t code_point) {
  if (font_ == nullptr) return 0.0;
  const uint64_t key = pair_key(previous, code_point);
  const auto cached = kerns_.find(key);
  if (cached != kerns_.end()) return cached->second;

  const double value = font_->kern(previous, code_point, device_point_size_) / scale_;
  kerns_.emplace(key, value);
  return value;
}

GlyphInfo GlyphAtlas::get(char32_t code_point) {
  // BY VALUE, unlike the reference's object: rasterizing the next glyph can grow
  // the atlas, and growing re-rasterizes everything cached so far — so a
  // reference handed out here could not be held across the following call.
  const auto cached = glyphs_.find(code_point);
  if (cached != glyphs_.end()) return cached->second;

  GlyphInfo glyph;
  if (font_ != nullptr) {
    const double advance_px = font_->advance(code_point, device_point_size_) / scale_;
    const GlyphBitmap bitmap = font_->render(code_point, device_point_size_);
    int x = 0;
    int y = 0;
    if (bitmap.width <= 0 || bitmap.height <= 0 ||
        !reserve(bitmap.width, bitmap.height, code_point, x, y)) {
      glyph = blank(advance_px);
    } else {
      // Coverage lands as the alpha of a white pixel: the same shape every
      // target uploads, and what makes a tint a plain vertex-color multiply.
      for (int row = 0; row < bitmap.height; row++) {
        for (int column = 0; column < bitmap.width; column++) {
          const size_t at = (static_cast<size_t>(y + row) * static_cast<size_t>(size_) +
                             static_cast<size_t>(x + column)) * 2;
          pixels_[at] = 255;
          pixels_[at + 1] =
              bitmap.coverage[static_cast<size_t>(row) * static_cast<size_t>(bitmap.width) +
                              static_cast<size_t>(column)];
        }
      }
      version_++;

      const double side = static_cast<double>(size_);
      glyph.advance = advance_px;
      // stb's box is Y-down from the baseline; our quads are Y-up.
      glyph.min_x = bitmap.x0 / scale_;
      glyph.max_x = bitmap.x1 / scale_;
      glyph.max_y = -bitmap.y0 / scale_;
      glyph.min_y = -bitmap.y1 / scale_;
      glyph.u0 = x / side;
      glyph.v0 = y / side;
      glyph.u1 = (x + bitmap.width) / side;
      glyph.v1 = (y + bitmap.height) / side;
      glyph.has_quad = true;
    }
  }

  glyphs_.emplace(code_point, glyph);
  order_.push_back(code_point);
  return glyph;
}

bool GlyphAtlas::reserve(int w, int h, char32_t code_point, int &x, int &y) {
  const auto give_up = [&]() {
    // Once per atlas, not once per glyph. It goes to stderr because the core has
    // no engine to log through — every host we have pipes it to its own console.
    if (!warned_full_) {
      warned_full_ = true;
      std::fprintf(stderr,
                   "[zabloo] Glyph atlas (%gpx) is full at %dpx — U+%04X and later ones are "
                   "skipped.\n",
                   point_size_, size_, static_cast<unsigned>(code_point));
    }
    return false;
  };

  // A glyph bigger than the whole atlas fits on no shelf of it, in EITHER axis
  // (ZAB-69). Growing for height alone left a too-wide glyph placed anyway, off
  // the right edge, with UVs past 1 — the sampler then read whatever the texture
  // wraps to instead of the blank the caller believed it got. Checked before the
  // shelf, since growing resets the pens.
  while (w + PADDING * 2 > size_ || h + PADDING * 2 > size_) {
    if (!grow()) return give_up();
  }
  if (pen_x_ + w + PADDING > size_) {
    pen_x_ = PADDING;
    pen_y_ += row_height_ + PADDING;
    row_height_ = 0;
  }
  while (pen_y_ + h + PADDING > size_) {
    if (!grow()) return give_up();
  }
  x = pen_x_;
  y = pen_y_;
  pen_x_ += w + PADDING;
  row_height_ = std::max(row_height_, h);
  return true;
}

bool GlyphAtlas::grow() {
  if (size_ >= MAX_ATLAS_SIZE) return false;
  size_ *= 2;
  prepare();
  // Re-rasterized through the normal path, in the order they first arrived, so
  // the packing is exactly the one a fresh atlas of this size would have
  // produced. The atlas keeps its identity — the adapter just re-uploads on the
  // version bump — and glyphs that were blank only for lack of room become real.
  const std::vector<char32_t> cached = std::move(order_);
  order_.clear();
  glyphs_.clear();
  for (const char32_t code_point : cached) get(code_point);
  version_++;
  return true;
}

// --- library --------------------------------------------------------------

FontLibrary::FontLibrary(double scale, const StbFont *font) : scale_(scale), font_(font) {}

GlyphAtlas &FontLibrary::get(double point_size) {
  // From the back: the most recently used is the answer almost every time — a
  // frame asks for the same size once per text node, and a whole screen at one
  // point size is the normal case (ZAB-73).
  for (size_t i = atlases_.size(); i > 0; i--) {
    if (atlases_[i - 1]->point_size() != point_size) continue;
    if (i != atlases_.size()) {
      // Order IS recency, so moving it to the back marks it just used.
      std::unique_ptr<GlyphAtlas> found = std::move(atlases_[i - 1]);
      atlases_.erase(atlases_.begin() + static_cast<ptrdiff_t>(i - 1));
      atlases_.push_back(std::move(found));
    }
    return *atlases_.back();
  }

  atlases_.push_back(std::unique_ptr<GlyphAtlas>(new GlyphAtlas(point_size, scale_, font_)));
  // The least recently used goes. The adapter notices on its next sweep, which
  // happens before it can draw anything with the texture that named it.
  if (atlases_.size() > MAX_ATLASES) atlases_.erase(atlases_.begin());
  return *atlases_.back();
}

}  // namespace zabloo
