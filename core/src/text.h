// Multiline text layout — the normative algorithm of the `Text` spec (decision
// 2026-08-11, ZAB-17): word wrap to the available width, hard breaks, long-word
// breaking, `maxLines` truncation with `clip`/`ellipsis`, and the placement of
// the resulting lines inside a rect (`textAlign`/`textAlignY`/`lineHeight`).
//
// A port of `packages/renderer-web/src/text.ts`, and the file the `text-wrap`
// case of the corpus is a record of. Like its reference it is free of both the
// atlas and the IR: it takes what it needs from a font through `TextMetrics`,
// so the break points are a pure function of (text, advances, width) — which is
// the whole point, because the same envelope has to break in the same places on
// every target.

#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "envelope.h"

namespace zabloo {

/** From `layout.h`, which includes THIS header for the block it caches per node. */
struct Rect;

/** The truncation mark (U+2026), a single glyph rather than three dots. */
inline constexpr char32_t ELLIPSIS = 0x2026;

/** Everything the algorithm needs from a font, in logical px. */
class TextMetrics {
 public:
  virtual ~TextMetrics() = default;

  /** Horizontal advance of one code point. */
  virtual double advance(char32_t code_point) = 0;
  /**
   * Kerning between two consecutive code points (0 when the font has none).
   * Every width here includes it, exactly as the tessellator's paint loop does —
   * a line measured without kerning would not be the line that gets painted.
   */
  virtual double kern(char32_t previous, char32_t code_point) = 0;
  /** The font's natural line advance (ascent + descent + line gap). */
  virtual double font_line_height() const = 0;
  /** Distance from the top of a line box to its baseline. */
  virtual double ascent() const = 0;
};

struct TextLayoutOptions {
  /** Word wrap to `max_width`. */
  bool wrap = true;
  /** Width to wrap and cut to. Absent (or <= 0) means unconstrained. */
  std::optional<double> max_width;
  /** Resolved line advance: `style.lineHeight` or the font's own. */
  double line_height = 0.0;
  /** Line cap, or absent for unbounded. */
  std::optional<int> max_lines;
  TextOverflow overflow = TextOverflow::Clip;

  bool operator==(const TextLayoutOptions &other) const {
    return wrap == other.wrap && max_width == other.max_width &&
           line_height == other.line_height && max_lines == other.max_lines &&
           overflow == other.overflow;
  }
  bool operator!=(const TextLayoutOptions &other) const { return !(*this == other); }
};

struct TextLine {
  std::string text;
  /** Painted width — trailing spaces excluded. */
  double width = 0.0;
};

struct TextBlock {
  std::vector<TextLine> lines;
  /** The widest line. */
  double width = 0.0;
  /** `lines.size() * line_height`. */
  double height = 0.0;
  /** The `line_height` used, so placement does not have to resolve it again. */
  double line_height = 0.0;
  /** True when something was dropped (lines past `maxLines`, or glyphs past the width). */
  bool truncated = false;
};

/**
 * Where a line was placed: the run's top-left, half-leading already applied.
 *
 * Positions only — the text is `TextBlock::lines[i].text`, at the same index.
 * Placement never changes what a line SAYS, so copying the strings a second time
 * per frame would be a copy for nothing.
 */
struct PlacedLine {
  double x = 0.0;
  double y = 0.0;
};

/**
 * Lays `content` out into lines. The result is the node's intrinsic size
 * (`width` × `height`) as far as the flexbox is concerned, and the input of
 * `place_lines`.
 */
TextBlock layout_text(std::string_view content, TextMetrics &metrics,
                      const TextLayoutOptions &options);

/**
 * Places a laid-out block inside `rect` (the node's rect minus its padding).
 * Each `y` is the top-left of the run as the tessellator wants it — it adds the
 * ascent itself — so the half-leading that centers the glyphs in a taller line
 * box is already folded in.
 *
 * `font_line_height` is the font's own advance, the only thing about the font
 * this needs: placing a block asks nothing of the glyphs, so it takes a number
 * rather than a `TextMetrics` and the view can place a frame's text without
 * looking an atlas up again.
 */
void place_lines(const TextBlock &block, const Rect &rect, double font_line_height,
                 TextAlign align, TextAlign align_y, std::vector<PlacedLine> &out);

}  // namespace zabloo
