// The text engine: the rules the corpus does not pin down, and the ones it
// would pin down only by accident.
//
// `text-wrap` records what the reference produces for one screen of prose, which
// is the real contract — but a recorded case cannot say "a limit narrower than
// the ellipsis still keeps the mark", because no sane envelope contains one.
// Those live here, over a fake font whose advances are round numbers, so a
// failure names the rule instead of a decimal.
//
// The other half is the rasterizer, which needs the real embedded TTF: that the
// font is there at all, that its metrics are the ones the corpus was recorded
// against, and that the atlas grows, packs and evicts the way ZAB-55 decided.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "glyphs.h"
#include "layout.h"
#include "testing.h"
#include "text.h"
#include "ttf.h"
#include "utf8.h"

using namespace zabloo;

namespace {

constexpr double EPSILON = 0.001;

/**
 * A font with no font in it: every glyph is 10 wide, a line is 20 tall, and one
 * pair kerns. Round numbers mean a test can say `40` and mean four glyphs.
 */
class FakeFont : public TextMetrics {
 public:
  double advance(char32_t code_point) override {
    // A space is narrower, so "does a trailing space count" is a visible question.
    return code_point == ' ' ? 5.0 : 10.0;
  }
  double kern(char32_t previous, char32_t code_point) override {
    return previous == 'A' && code_point == 'V' ? -4.0 : 0.0;
  }
  double font_line_height() const override { return 20.0; }
  double ascent() const override { return 16.0; }
};

TextLayoutOptions wrapping(double max_width) {
  TextLayoutOptions options;
  options.wrap = true;
  options.max_width = max_width;
  options.line_height = 20.0;
  return options;
}

std::vector<std::string> texts(const TextBlock &block) {
  std::vector<std::string> out;
  for (const TextLine &line : block.lines) out.push_back(line.text);
  return out;
}

std::string joined(const TextBlock &block) {
  std::string out;
  for (const TextLine &line : block.lines) {
    if (!out.empty()) out += "|";
    out += line.text;
  }
  return out;
}

}  // namespace

// --- the wrap -------------------------------------------------------------

TEST(text, a_run_that_fits_is_one_line_as_wide_as_its_glyphs) {
  FakeFont font;
  const TextBlock block = layout_text("abc", font, wrapping(100.0));
  CHECK_EQ(block.lines.size(), 1u);
  CHECK_NEAR(block.width, 30.0, EPSILON);
  CHECK_NEAR(block.height, 20.0, EPSILON);
  CHECK(!block.truncated);
}

TEST(text, the_kerning_a_line_is_measured_with_is_the_one_it_is_painted_with) {
  // Every width the wrap produces includes kerning, because the tessellator's
  // paint loop applies it too: a line measured without it would not be the line
  // that gets painted, and the box the layout reserved would be the wrong size.
  FakeFont font;
  CHECK_NEAR(layout_text("AV", font, wrapping(100.0)).width, 16.0, EPSILON);
  CHECK_NEAR(layout_text("VA", font, wrapping(100.0)).width, 20.0, EPSILON);
}

TEST(text, a_break_ends_the_kerning_chain_on_both_sides) {
  // The pair that straddles a break never applies: the two glyphs are no longer
  // next to each other, so neither the measurement nor the paint may use it.
  FakeFont font;
  const TextBlock block = layout_text("A V", font, wrapping(15.0));
  CHECK_EQ(joined(block), std::string("A|V"));
  CHECK_NEAR(block.lines[0].width, 10.0, EPSILON);
  CHECK_NEAR(block.lines[1].width, 10.0, EPSILON);
}

TEST(text, trailing_spaces_do_not_paint_and_leading_ones_do) {
  FakeFont font;
  // A line ends at its last word: the space that broke it is gone with the break.
  const TextBlock broken = layout_text("aa bb", font, wrapping(25.0));
  CHECK_EQ(joined(broken), std::string("aa|bb"));
  CHECK_NEAR(broken.lines[0].width, 20.0, EPSILON);
  // Spaces that START a line are indentation: they are painted, so they count.
  const TextBlock indented = layout_text(" aa", font, wrapping(100.0));
  CHECK_EQ(joined(indented), std::string(" aa"));
  CHECK_NEAR(indented.lines[0].width, 25.0, EPSILON);
}

TEST(text, a_word_wider_than_the_line_breaks_between_glyphs) {
  FakeFont font;
  const TextBlock block = layout_text("abcdef", font, wrapping(25.0));
  CHECK_EQ(joined(block), std::string("ab|cd|ef"));
}

TEST(text, a_line_always_keeps_one_glyph_however_narrow_it_is) {
  // Or the text would vanish: at least one glyph per line is what makes the
  // long-word break terminate on a limit narrower than a single glyph.
  FakeFont font;
  const TextBlock block = layout_text("abc", font, wrapping(1.0));
  CHECK_EQ(joined(block), std::string("a|b|c"));
}

TEST(text, hard_breaks_are_honored_whatever_the_width_is) {
  FakeFont font;
  // CRLF and a lone CR both read as a newline before anything is split, and an
  // empty paragraph still owns a line — a blank line takes vertical space.
  const TextBlock block = layout_text("a\r\n\rb", font, wrapping(100.0));
  CHECK_EQ(joined(block), std::string("a||b"));
  CHECK_NEAR(block.height, 60.0, EPSILON);
}

TEST(text, an_empty_text_measures_one_line_tall_and_nothing_wide) {
  // ZAB-65: `""` is a label with nothing to say today, not a node nobody wrote.
  // It keeps its slot and its surrounding gaps, so a row does not re-space
  // itself when a binding empties — the width is what goes to zero.
  FakeFont font;
  const TextBlock block = layout_text("", font, wrapping(100.0));
  CHECK_EQ(block.lines.size(), 1u);
  CHECK_NEAR(block.width, 0.0, EPSILON);
  CHECK_NEAR(block.height, 20.0, EPSILON);
}

TEST(text, without_wrap_a_long_line_is_cut_and_not_broken) {
  FakeFont font;
  TextLayoutOptions options = wrapping(25.0);
  options.wrap = false;
  const TextBlock block = layout_text("abcdef", font, options);
  CHECK_EQ(joined(block), std::string("ab"));
  CHECK(block.truncated);
}

TEST(text, an_ellipsis_replaces_the_glyphs_it_needs_room_for) {
  FakeFont font;
  TextLayoutOptions options = wrapping(35.0);
  options.wrap = false;
  options.overflow = TextOverflow::Ellipsis;
  const TextBlock block = layout_text("abcdef", font, options);
  CHECK_EQ(joined(block), std::string("ab…"));
  CHECK(block.truncated);
}

TEST(text, the_mark_survives_a_limit_too_narrow_for_it) {
  // It is the whole signal: a line that dropped the ellipsis too would say
  // nothing about what was left out.
  FakeFont font;
  TextLayoutOptions options = wrapping(3.0);
  options.wrap = false;
  options.overflow = TextOverflow::Ellipsis;
  CHECK_EQ(joined(layout_text("abcdef", font, options)), std::string("…"));
}

TEST(text, max_lines_cuts_the_block_and_marks_the_last_line) {
  FakeFont font;
  TextLayoutOptions options = wrapping(25.0);
  options.max_lines = 2;
  const TextBlock clipped = layout_text("abcdefgh", font, options);
  CHECK_EQ(joined(clipped), std::string("ab|cd"));
  CHECK(clipped.truncated);

  options.overflow = TextOverflow::Ellipsis;
  const TextBlock marked = layout_text("abcdefgh", font, options);
  CHECK_EQ(joined(marked), std::string("ab|c…"));
}

TEST(text, a_block_that_fits_under_the_cap_is_not_truncated) {
  FakeFont font;
  TextLayoutOptions options = wrapping(25.0);
  options.max_lines = 4;
  options.overflow = TextOverflow::Ellipsis;
  const TextBlock block = layout_text("abcd", font, options);
  CHECK_EQ(joined(block), std::string("ab|cd"));
  CHECK(!block.truncated);
}

TEST(text, the_wrap_walks_code_points_and_never_bytes) {
  // A byte-wise break would cut "ó" in half and measure a run no font has. The
  // lines that come out are valid UTF-8, because that is what the snapshot
  // writes and what the tessellator hands back to the atlas.
  FakeFont font;
  const TextBlock block = layout_text("ñá éí", font, wrapping(25.0));
  CHECK_EQ(joined(block), std::string("ñá|éí"));
  CHECK_NEAR(block.lines[0].width, 20.0, EPSILON);
  for (const std::string &line : texts(block)) {
    CHECK_EQ(utf8_decode(line).size(), 2u);
  }
}

// --- placement ------------------------------------------------------------

TEST(text, alignment_places_a_line_inside_the_box_and_never_outside_it) {
  FakeFont font;
  const TextBlock block = layout_text("abc", font, wrapping(0.0));
  const Rect box{10.0, 100.0, 100.0, 60.0};
  std::vector<PlacedLine> placed;

  place_lines(block, box, font.font_line_height(), TextAlign::Start, TextAlign::Start, placed);
  CHECK_NEAR(placed[0].x, 10.0, EPSILON);
  CHECK_NEAR(placed[0].y, 100.0, EPSILON);

  place_lines(block, box, font.font_line_height(), TextAlign::Center, TextAlign::Center, placed);
  CHECK_NEAR(placed[0].x, 45.0, EPSILON);
  CHECK_NEAR(placed[0].y, 120.0, EPSILON);

  place_lines(block, box, font.font_line_height(), TextAlign::End, TextAlign::End, placed);
  CHECK_NEAR(placed[0].x, 80.0, EPSILON);
  CHECK_NEAR(placed[0].y, 140.0, EPSILON);

  // Overflow starts at the edge: a run wider than its box is never pushed left.
  const Rect narrow{10.0, 100.0, 5.0, 60.0};
  place_lines(block, narrow, font.font_line_height(), TextAlign::Center, TextAlign::Start, placed);
  CHECK_NEAR(placed[0].x, 10.0, EPSILON);
}

TEST(text, a_taller_line_box_centers_the_glyphs_with_half_leading) {
  // `lineHeight` is the distance between the tops of two lines; the extra space
  // over the font's own advance is split above and below, so a loose paragraph
  // is not a paragraph glued to the top of its box.
  FakeFont font;
  TextLayoutOptions options = wrapping(0.0);
  options.line_height = 30.0;
  const TextBlock block = layout_text("a\nb", font, options);
  std::vector<PlacedLine> placed;
  place_lines(block, Rect{0.0, 0.0, 100.0, 100.0}, font.font_line_height(), TextAlign::Start,
              TextAlign::Start, placed);
  CHECK_NEAR(placed[0].y, 5.0, EPSILON);
  CHECK_NEAR(placed[1].y, 35.0, EPSILON);
}

// --- the rasterizer -------------------------------------------------------

TEST(text, the_embedded_font_is_the_one_the_corpus_was_recorded_against) {
  // Liberation Sans at 16px. These three numbers are why `text-wrap` compares:
  // the whole corpus is measured through them, so a font swapped by accident —
  // or a scale computed the other way round — shows up here first.
  const StbFont *font = default_font();
  CHECK(font != nullptr);
  if (font == nullptr) return;

  const FontMetrics metrics = font->metrics(16.0);
  // The two the corpus pins: `text-wrap` records this line height, and every
  // baseline in it is a placed top plus this ascent.
  CHECK_NEAR(metrics.line_height, 18.398, 0.001);
  CHECK_NEAR(metrics.ascent, 14.484, 0.001);
  // The descent is a DEPTH here and negative in stb's own tables, which is the
  // one place a sign could quietly flip and leave every baseline a few pixels
  // out. The line height is the sum of the three, so checking it that way says
  // the flip did not happen without pinning a number nothing else reads.
  CHECK(metrics.descent > 0.0);
  CHECK(metrics.line_gap >= 0.0);
  CHECK_NEAR(metrics.ascent + metrics.descent + metrics.line_gap, metrics.line_height, EPSILON);
  // Fractional on purpose: rounding lives at quad time, never in a metric, or a
  // run's width would drift glyph by glyph (the unit contract of `ttf.h`).
  CHECK_NEAR(font->advance('a', 16.0), 8.898, 0.001);
  CHECK(font->has(U'ñ'));
}

TEST(text, an_atlas_answers_the_wrap_in_logical_pixels) {
  GlyphAtlas atlas(16.0, 1.0, default_font());
  CHECK_NEAR(atlas.font_line_height(), 18.398, 0.001);
  CHECK_NEAR(atlas.advance('a'), 8.898, 0.001);

  // A space advances the pen and paints nothing, so it needs no room in the
  // atlas — the same shape a glyph the font lacks comes back as.
  const GlyphInfo space = atlas.get(' ');
  CHECK(!space.has_quad);
  CHECK(space.advance > 0.0);
  const GlyphInfo letter = atlas.get('a');
  CHECK(letter.has_quad);
  CHECK(letter.u1 > letter.u0);
  CHECK(letter.max_y > letter.min_y);
  // UVs are inside the surface, always: one past it samples whatever the
  // texture wraps to (ZAB-69).
  CHECK(letter.u1 <= 1.0);
  CHECK(letter.v1 <= 1.0);
}

TEST(text, rasterizing_a_glyph_changes_the_pixels_and_says_so) {
  // The version is the adapter's whole cue to re-upload: a glyph that landed in
  // the surface without bumping it would never reach the screen.
  GlyphAtlas atlas(16.0, 1.0, default_font());
  const uint32_t before = atlas.version();
  atlas.get('a');
  CHECK(atlas.version() > before);

  const uint32_t after = atlas.version();
  atlas.get('a');
  // Cached: the second ask rasterizes nothing, so it uploads nothing either.
  CHECK_EQ(atlas.version(), after);
}

TEST(text, the_white_block_is_reserved_and_no_glyph_lands_on_it) {
  // Solid geometry samples it, so the packing has to keep off it — the pens
  // start past it, and a fresh atlas has it filled before anything else.
  GlyphAtlas atlas(16.0, 1.0, default_font());
  CHECK_NEAR(atlas.white_u() * atlas.size(), 2.0, EPSILON);
  const std::vector<uint8_t> &pixels = atlas.pixels();
  CHECK_EQ(pixels.size(), static_cast<size_t>(atlas.size()) * atlas.size() * 2);
  CHECK_EQ(static_cast<int>(pixels[0]), 255);
  CHECK_EQ(static_cast<int>(pixels[1]), 255);

  const GlyphInfo glyph = atlas.get('M');
  CHECK(glyph.u0 * atlas.size() >= 4.0);
}

TEST(text, an_atlas_that_fills_up_grows_and_keeps_every_glyph_it_had) {
  // Before ZAB-55 a full atlas cached the glyph as blank FOREVER. Now it doubles
  // and re-rasterizes what it held, so a blank that was only blank for lack of
  // room becomes a real glyph.
  GlyphAtlas atlas(400.0, 1.0, default_font());
  const int initial = atlas.size();
  const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (const char letter : alphabet) atlas.get(static_cast<char32_t>(letter));

  CHECK(atlas.size() > initial);
  CHECK_EQ(atlas.pixels().size(), static_cast<size_t>(atlas.size()) * atlas.size() * 2);
  for (const char letter : alphabet) {
    const GlyphInfo glyph = atlas.get(static_cast<char32_t>(letter));
    CHECK(glyph.has_quad);
    CHECK(glyph.u1 <= 1.0);
    CHECK(glyph.v1 <= 1.0);
  }
}

TEST(text, the_library_keeps_one_atlas_per_size_and_drops_the_stalest) {
  // Each one is a surface plus a GPU texture, so an animated `fontSize` must
  // thrash rather than grow without a bound (ZAB-55).
  FontLibrary fonts(1.0, default_font());
  GlyphAtlas &first = fonts.get(16.0);
  CHECK(&fonts.get(16.0) == &first);
  CHECK_EQ(fonts.all().size(), 1u);

  for (int size = 17; size <= 24; size++) fonts.get(static_cast<double>(size));
  CHECK_EQ(fonts.all().size(), 8u);
  // 16 was the least recently used, so 16 is the one that went.
  for (const auto &atlas : fonts.all()) CHECK(atlas->point_size() != 16.0);

  // Asking again marks an atlas as used, which is what saves it from the next
  // eviction — the recency order IS the list order.
  GlyphAtlas &kept = fonts.get(17.0);
  fonts.get(25.0);
  bool alive = false;
  for (const auto &atlas : fonts.all()) alive = alive || atlas.get() == &kept;
  CHECK(alive);
}

TEST(text, a_library_with_no_font_measures_nothing_instead_of_crashing) {
  // There is no second rasterizer to fall back to — that is what core-owned
  // means — so a font that failed to parse is a UI with no glyphs, never a
  // crash inside a game.
  GlyphAtlas atlas(16.0, 1.0, nullptr);
  CHECK_NEAR(atlas.advance('a'), 0.0, EPSILON);
  CHECK_NEAR(atlas.kern('A', 'V'), 0.0, EPSILON);
  CHECK_NEAR(atlas.font_line_height(), 0.0, EPSILON);
  CHECK(!atlas.get('a').has_quad);
}

// --- utf-8 ----------------------------------------------------------------

TEST(text, utf8_round_trips_and_a_bad_byte_never_stalls_the_walk) {
  const std::string source = "añ€𝄞";
  const std::vector<char32_t> decoded = utf8_decode(source);
  CHECK_EQ(decoded.size(), 4u);
  CHECK_EQ(static_cast<unsigned long>(decoded[3]), 0x1d11eul);
  CHECK_EQ(utf8_encode(decoded, 0, decoded.size()), source);

  // A truncated sequence consumes only its lead, so the bytes behind it are
  // decoded on their own turn and any loop over any string terminates.
  const std::vector<char32_t> broken = utf8_decode("\xc3");
  CHECK_EQ(broken.size(), 1u);
  CHECK_EQ(static_cast<unsigned long>(broken[0]), static_cast<unsigned long>(REPLACEMENT));
  CHECK_EQ(utf8_decode("\xc3z").size(), 2u);
}
