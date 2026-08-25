// The self-owned glyph atlas.
//
// A port of `packages/renderer-web/src/glyphs.ts`, minus its Canvas2D fallback:
// there is no platform rasterizer to fall back TO here, which is what
// core-owned means (ZAB-15). The glyphs come from `ttf.h` — stb over the shipped
// TTF — and this file owns everything downstream: where a bitmap lands, what its
// UVs are, and the metrics table the wrap pass reads.
//
// The atlas also reserves a WHITE block, so solid geometry (rounded rects)
// samples the same texture as text and a whole screen becomes one draw call.
//
// The pixels are LA8 — luminance 255, alpha = coverage — which is what an
// engine's texture wants and half the memory of RGBA. The adapter uploads them
// on a `version()` bump and never looks inside.

#pragma once

#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

#include "text.h"
#include "ttf.h"

namespace zabloo {

/** One glyph as the atlas holds it. Extents in logical px, UVs in 0..1. */
struct GlyphInfo {
  double advance = 0.0;
  /** Quad extents: X from the pen, Y from the baseline (max_y = top, up+). */
  double min_x = 0.0;
  double max_x = 0.0;
  double min_y = 0.0;
  double max_y = 0.0;
  /** UV rect in the atlas, v = 0 at the TOP (the row order textures upload in). */
  double u0 = 0.0;
  double v0 = 0.0;
  double u1 = 0.0;
  double v1 = 0.0;
  /** False for whitespace, and for a glyph the atlas had no room for. */
  bool has_quad = false;
};

/**
 * One point size's worth of glyphs. It IS the font as far as `text.h` is
 * concerned — that is what `TextMetrics` is for, and why the wrap pass never
 * sees a `StbFont`.
 */
class GlyphAtlas : public TextMetrics {
 public:
  /**
   * `scale` is device pixels per logical one: the atlas rasterizes at
   * `point_size * scale` and reports every metric back in logical px, so a HiDPI
   * surface gets sharper glyphs at the same layout. The corpus measures at 1.
   *
   * `font` may be null — see `default_font()`. Every glyph is then blank and
   * every advance zero, which is the only honest answer with no rasterizer.
   */
  GlyphAtlas(double point_size, double scale, const StbFont *font);

  // --- TextMetrics ---
  double advance(char32_t code_point) override;
  double kern(char32_t previous, char32_t code_point) override;
  double font_line_height() const override { return line_height_; }
  double ascent() const override { return ascent_; }

  /**
   * The glyph, rasterizing and packing it on first use.
   *
   * By value, unlike the reference's object: rasterizing can GROW the atlas, and
   * growing re-rasterizes everything cached so far, so a reference handed out
   * here could not survive the next call.
   */
  GlyphInfo get(char32_t code_point);

  double point_size() const { return point_size_; }

  // --- the texture side ---
  /** Bumped every time the pixels change; the adapter re-uploads on a change. */
  uint32_t version() const { return version_; }
  /** Side in device px. The surface is square and always a power of two. */
  int size() const { return size_; }
  /** `size() * size() * 2` bytes, LA8, row-major. */
  const std::vector<uint8_t> &pixels() const { return pixels_; }
  /** UV of the reserved white pixel (the center of a 4×4 white block). */
  double white_u() const { return 2.0 / static_cast<double>(size_); }
  double white_v() const { return 2.0 / static_cast<double>(size_); }

 private:
  /** Fresh surface: cleared, with the white block and the pens after it. */
  void prepare();
  /** Shelf packing. Null when the atlas is full at its maximum size. */
  bool reserve(int w, int h, char32_t code_point, int &x, int &y);
  /** Doubles the surface and re-rasterizes everything cached so far. */
  bool grow();

  double point_size_;
  double scale_;
  /** Rasterization size in device px — what the font is asked to scale to. */
  double device_point_size_;
  const StbFont *font_;
  double ascent_ = 0.0;
  double line_height_ = 0.0;

  int size_;
  std::vector<uint8_t> pixels_;
  std::unordered_map<char32_t, GlyphInfo> glyphs_;
  /** Insertion order, so a grown atlas repacks exactly as the first one did. */
  std::vector<char32_t> order_;
  /**
   * Kerning by pair. Advances ride with the glyph, but kerning was crossing into
   * the rasterizer once per pair PER FRAME, twice over — the wrap measures the
   * run and the tessellator paints it (ZAB-69).
   */
  std::unordered_map<uint64_t, double> kerns_;
  int pen_x_ = 0;
  int pen_y_ = 0;
  int row_height_ = 0;
  uint32_t version_ = 0;
  /** The full-at-maximum warning fires once per atlas, not once per glyph. */
  bool warned_full_ = false;
};

/**
 * One atlas per requested point size, LRU-bounded (ZAB-55).
 *
 * Each atlas is up to 4096² of pixels plus a GPU texture, so an unbounded map —
 * an animated `fontSize`, a token per size — would grow one per distinct size
 * and never let go. Eight covers a real UI's type scale; a scene cycling through
 * more thrashes gracefully (evict + re-rasterize) instead of exhausting memory.
 */
class FontLibrary {
 public:
  FontLibrary(double scale, const StbFont *font);

  GlyphAtlas &get(double point_size);

  /**
   * Live atlases, least recently used first — the list the adapter reconciles
   * its textures against.
   *
   * No eviction callback, unlike the reference (whose GL layer is handed the
   * dropped atlas): a list of at most eight is cheaper to sweep once a frame
   * than a callback is to wire, and sweeping answers "was it evicted?" and "did
   * it grow?" with one mechanism instead of two.
   */
  const std::vector<std::unique_ptr<GlyphAtlas>> &all() const { return atlases_; }

 private:
  double scale_;
  const StbFont *font_;
  /** Recency order: the last entry is the most recently used. */
  std::vector<std::unique_ptr<GlyphAtlas>> atlases_;
};

}  // namespace zabloo
