#include "ttf.h"

#include <utility>

#include "generated/default_font.h"
#include "vendor/stb_truetype.h"

namespace zabloo {

struct StbFont::Impl {
  stbtt_fontinfo info{};
};

StbFont::StbFont() : impl_(new Impl()) {}
StbFont::~StbFont() = default;

std::unique_ptr<StbFont> load_font(std::vector<uint8_t> ttf) {
  if (ttf.empty()) return nullptr;
  // The bytes move into the font BEFORE stb is pointed at them: stb keeps the
  // pointer rather than a copy, so parsing a buffer that is about to be moved
  // would leave the font reading freed memory.
  std::unique_ptr<StbFont> font(new StbFont());
  font->data_ = std::move(ttf);

  const int offset = stbtt_GetFontOffsetForIndex(font->data_.data(), 0);
  if (offset < 0) return nullptr;
  if (!stbtt_InitFont(&font->impl_->info, font->data_.data(), offset)) return nullptr;

  stbtt_GetFontVMetrics(&font->impl_->info, &font->units_ascent_, &font->units_descent_,
                        &font->units_line_gap_);
  return font;
}

const StbFont *default_font() {
  static const std::unique_ptr<StbFont> font = load_font(default_font_bytes());
  return font.get();
}

float StbFont::scale_for(double pixel_size) const {
  const auto cached = scales_.find(pixel_size);
  if (cached != scales_.end()) return cached->second;

  const float scale =
      stbtt_ScaleForMappingEmToPixels(&impl_->info, static_cast<float>(pixel_size));
  scales_.emplace(pixel_size, scale);
  return scale;
}

FontMetrics StbFont::metrics(double pixel_size) const {
  // Widened on purpose: the reference multiplies an integer by a float-valued
  // number in double arithmetic, and so does this (see the header).
  const double scale = static_cast<double>(scale_for(pixel_size));
  FontMetrics out;
  out.ascent = static_cast<double>(units_ascent_) * scale;
  // stb reports the descent below the baseline as negative; ours is a depth.
  out.descent = -static_cast<double>(units_descent_) * scale;
  out.line_gap = static_cast<double>(units_line_gap_) * scale;
  out.line_height = out.ascent + out.descent + out.line_gap;
  return out;
}

int StbFont::glyph_index(char32_t code_point) const {
  const auto cached = glyph_indices_.find(code_point);
  if (cached != glyph_indices_.end()) return cached->second;

  const int glyph = stbtt_FindGlyphIndex(&impl_->info, static_cast<int>(code_point));
  glyph_indices_.emplace(code_point, glyph);
  return glyph;
}

double StbFont::advance(char32_t code_point, double pixel_size) const {
  int units = 0;
  int bearing = 0;
  stbtt_GetGlyphHMetrics(&impl_->info, glyph_index(code_point), &units, &bearing);
  return static_cast<double>(units) * static_cast<double>(scale_for(pixel_size));
}

double StbFont::kern(char32_t previous, char32_t code_point, double pixel_size) const {
  const int units =
      stbtt_GetGlyphKernAdvance(&impl_->info, glyph_index(previous), glyph_index(code_point));
  // Short-circuited exactly as the reference does: the overwhelming majority of
  // pairs have no kerning at all, and a zero must not depend on a scale lookup.
  if (units == 0) return 0.0;
  return static_cast<double>(units) * static_cast<double>(scale_for(pixel_size));
}

GlyphBitmap StbFont::render(char32_t code_point, double pixel_size) const {
  const int glyph = glyph_index(code_point);
  const float scale = scale_for(pixel_size);

  GlyphBitmap out;
  stbtt_GetGlyphBitmapBoxSubpixel(&impl_->info, glyph, scale, scale, 0.0f, 0.0f, &out.x0, &out.y0,
                                  &out.x1, &out.y1);
  const int width = out.x1 - out.x0;
  const int height = out.y1 - out.y0;
  if (width <= 0 || height <= 0) return GlyphBitmap{};

  out.width = width;
  out.height = height;
  // Zeroed, not just sized: stb writes only the rows a glyph covers, so anything
  // left behind would show up as ink.
  out.coverage.assign(static_cast<size_t>(width) * static_cast<size_t>(height), 0);
  stbtt_MakeGlyphBitmapSubpixel(&impl_->info, out.coverage.data(), width, height, width, scale,
                                scale, 0.0f, 0.0f, glyph);
  return out;
}

}  // namespace zabloo
