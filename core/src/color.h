// Colors, as the tessellator wants them: four floats, premultiplied by nothing.
#pragma once

#include <string_view>

namespace zabloo {

struct Color {
  float r = 0.0f;
  float g = 0.0f;
  float b = 0.0f;
  float a = 1.0f;

  bool operator==(const Color &other) const {
    return r == other.r && g == other.g && b == other.b && a == other.a;
  }
};

/**
 * What a node paints when its color says `{token.that.does.not.exist}`. Magenta
 * on purpose: an undeclared color has to be visible from across the room, not
 * quietly black on a dark UI.
 */
inline constexpr Color MISSING_COLOR{1.0f, 0.0f, 1.0f, 1.0f};
/** Text with no `color` of its own. */
inline constexpr Color DEFAULT_TEXT_COLOR{1.0f, 1.0f, 1.0f, 1.0f};
/**
 * No tint: an `Image` with no `color` shows its own pixels (ZAB-13). White,
 * because the tint is a plain multiply of texture × vertex colour — the same
 * multiply that gives a glyph its colour, which is why one property means "the
 * colour of this node's content" for both.
 */
inline constexpr Color UNTINTED{1.0f, 1.0f, 1.0f, 1.0f};

/** `#rrggbb` or `#rrggbbaa`. False for anything else — the caller keeps its fallback. */
bool parse_color_literal(std::string_view text, Color &out);

/** Alpha scaled by the inherited opacity (multiplicative subtree, 2026-08-06). */
inline Color fade(Color color, double opacity) {
  color.a = static_cast<float>(color.a * opacity);
  return color;
}

}  // namespace zabloo
