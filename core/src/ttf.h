// The rasterizer: a thin face over stb_truetype, and the C++ form of the
// core-owned rasterization decided in ZAB-15 — the same algorithm over the same
// font on every target, so metrics and bitmaps converge instead of drifting per
// engine. The engine's own text stack is never asked anything, not even for a
// measurement: that is the condition for the corpus to compare.
//
// A port of `packages/renderer-web/src/ttf.ts`, whose comment holds the unit
// contract this file has to match to the last bit:
//
// - `pixel_size` is the EM size (what CSS `font-size` and an engine's point size
//   both mean), mapped through `stbtt_ScaleForMappingEmToPixels`.
// - Advances and kerning stay FRACTIONAL — rounding happens at quad time, not in
//   the metrics, so a run's width does not drift glyph by glyph.
// - Ink boxes are in px with Y DOWN from the baseline (stb's convention);
//   `glyphs.cpp` flips them into the renderer's Y-up quads.
//
// It knows nothing about atlases, packing or textures: it answers "how wide is
// this glyph" and "give me its coverage bitmap". `glyphs.h` owns the rest.
//
// One rule that is not obvious and is load-bearing for the corpus: every product
// of a design-unit integer and a scale is computed in `double`, with the `float`
// scale widened explicitly. The reference does that by construction (JavaScript
// has one number type), so doing the multiply in `float` here would round
// differently and a long run would part from its record in the third decimal.

#pragma once

#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

namespace zabloo {

/** Font-wide metrics at a given em size, in px. */
struct FontMetrics {
  /** Above the baseline, positive. */
  double ascent = 0.0;
  /** Below the baseline, positive (stb reports it negative; we flip it). */
  double descent = 0.0;
  /** Recommended extra leading between lines. */
  double line_gap = 0.0;
  /** `ascent + descent + line_gap` — the baseline-to-baseline distance. */
  double line_height = 0.0;
};

/** A rasterized glyph: its ink box plus 8-bit coverage, row-major, top row first. */
struct GlyphBitmap {
  int width = 0;
  int height = 0;
  /** Ink box relative to the pen/baseline, in px, Y DOWN. */
  int x0 = 0;
  int y0 = 0;
  int x1 = 0;
  int y1 = 0;
  /** `width * height` coverage samples. Empty when the glyph has no ink. */
  std::vector<uint8_t> coverage;
};

/**
 * A parsed font. Built by `load_font`, which is the only thing that can fail —
 * every query below answers something for any input, because a missing glyph is
 * an ordinary event (a charset the font does not cover) and not an error.
 */
class StbFont {
 public:
  ~StbFont();
  StbFont(const StbFont &) = delete;
  StbFont &operator=(const StbFont &) = delete;

  FontMetrics metrics(double pixel_size) const;

  /** The glyph for a code point, or 0 when the font has none (stb's "notdef"). */
  int glyph_index(char32_t code_point) const;
  /** True if the font actually covers this code point. */
  bool has(char32_t code_point) const { return glyph_index(code_point) != 0; }

  /** Pen advance in px — fractional on purpose (see the unit contract above). */
  double advance(char32_t code_point, double pixel_size) const;

  /**
   * Kerning adjustment in px to apply between two code points (usually negative,
   * e.g. "AV"). Read from the font's own tables — GPOS if present, else `kern`.
   */
  double kern(char32_t previous, char32_t code_point, double pixel_size) const;

  /**
   * Rasterizes a code point. Returns a bitmap with `width == 0` for anything
   * without ink (spaces, control characters, glyphs the font lacks).
   */
  GlyphBitmap render(char32_t code_point, double pixel_size) const;

 private:
  friend std::unique_ptr<StbFont> load_font(std::vector<uint8_t>);

  StbFont();

  /** Design units → px at an em size of `pixel_size`, cached per size. */
  float scale_for(double pixel_size) const;

  struct Impl;
  /** stb's parsed font lives behind this, so the vendored header stays private. */
  std::unique_ptr<Impl> impl_;
  /** stb does NOT copy the file: these bytes have to outlive the font info. */
  std::vector<uint8_t> data_;
  int units_ascent_ = 0;
  int units_descent_ = 0;
  int units_line_gap_ = 0;
  /** Cursors into the font's tables — a cmap walk is worth not repeating. */
  mutable std::unordered_map<char32_t, int> glyph_indices_;
  mutable std::unordered_map<double, float> scales_;
};

/**
 * Parses a TTF. Null when stb cannot make sense of the bytes — the caller keeps
 * whatever font it already had, which is the same shape as every other refusal
 * in the core: a bad payload costs the update, never the frame.
 */
std::unique_ptr<StbFont> load_font(std::vector<uint8_t> ttf);

/**
 * The embedded Liberation Sans, parsed once for the process.
 *
 * Null only if those committed bytes ever stopped being a TTF, which is a build
 * that is broken rather than a payload that is. There is no second rasterizer to
 * fall back to — that is what core-owned means — so a null font measures every
 * run at zero and paints nothing, the same shape the runtime had before this
 * file existed. It is a degradation with no way to reach it, kept because the
 * alternative is a crash in a game.
 */
const StbFont *default_font();

}  // namespace zabloo
