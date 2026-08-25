#include "text.h"

#include <algorithm>
#include <tuple>
#include <utility>

#include "layout.h"
#include "utf8.h"

namespace zabloo {
namespace {

/**
 * "No previous code point" — the sentinel the reference spells as an empty
 * string. A literal NUL in the content lands here too, and answers the same
 * thing a kerning lookup against it would: nothing.
 */
constexpr char32_t NONE = 0;

/**
 * Break opportunities are SPACE and TAB only — never U+00A0 (a non-breaking
 * space has to hold) nor the whole whitespace class, which would also break on
 * the newlines that hard-break handling already consumed.
 */
bool is_break_space(char32_t code_point) { return code_point == ' ' || code_point == '\t'; }

/** What `code_point` adds after `previous`: kern + advance. */
double step_of(char32_t previous, char32_t code_point, TextMetrics &metrics) {
  const double kern = previous == NONE ? 0.0 : metrics.kern(previous, code_point);
  return kern + metrics.advance(code_point);
}

/**
 * Width of a run, kerning included — the pairs of a run that is painted as ONE
 * line, which is why a break has to end the chain: the pair straddling it never
 * applies, on either side of the measurement.
 */
double width_of(std::string_view text, TextMetrics &metrics) {
  double width = 0.0;
  char32_t previous = NONE;
  size_t index = 0;
  while (index < text.size()) {
    const char32_t code_point = utf8_next(text, index);
    width += step_of(previous, code_point, metrics);
    previous = code_point;
  }
  return width;
}

/**
 * `width_of`, abandoned as soon as the run passes `limit` — absent then. Same
 * sum, in the same order, whenever it does return a number, so a segment that
 * fits is measured exactly as it always was; a segment that does not is not
 * measured to the end, because the only thing anyone asks of it is whether it
 * fits (ZAB-69).
 */
std::optional<double> width_up_to(const std::vector<char32_t> &chars, size_t from, size_t to,
                                  TextMetrics &metrics, double limit) {
  double width = 0.0;
  char32_t previous = NONE;
  for (size_t i = from; i < to; i++) {
    width += step_of(previous, chars[i], metrics);
    previous = chars[i];
    if (width > limit) return std::nullopt;
  }
  return width;
}

/** Last code point of a string — the left half of the kerning pair at a junction. */
char32_t last_char(std::string_view text) {
  char32_t last = NONE;
  size_t index = 0;
  while (index < text.size()) last = utf8_next(text, index);
  return last;
}

/** Trailing spaces do not paint and do not count — a line ends at its last word. */
std::string_view trim_end(std::string_view text) {
  size_t cut = text.size();
  while (cut > 0 && (text[cut - 1] == ' ' || text[cut - 1] == '\t')) cut--;
  return text.substr(0, cut);
}

TextLine line_of(std::string_view text, TextMetrics &metrics) {
  const std::string_view trimmed = trim_end(text);
  return TextLine{std::string(trimmed), width_of(trimmed, metrics)};
}

/**
 * Splits a word too long for a line of its own between code points, emitting the
 * full lines and returning the remainder as the caller's current line. At least
 * one glyph per line, so a `limit` narrower than a single glyph still terminates.
 *
 * ONE pass over the word (ZAB-69): each glyph is measured exactly once, in the
 * same order and from the same starting point as before — every emitted width is
 * still a fresh left-to-right sum from its own first glyph, never a subtraction.
 */
std::pair<std::string, double> break_word(const std::vector<char32_t> &chars, size_t word_from,
                                          size_t word_to, TextMetrics &metrics, double limit,
                                          std::vector<TextLine> &out, std::optional<size_t> budget) {
  size_t from = word_from;
  while (from < word_to) {
    double width = 0.0;
    char32_t previous = NONE;
    size_t end = from;
    while (end < word_to) {
      const double step = step_of(previous, chars[end], metrics);
      // At least one glyph per line, or the text would vanish.
      if (end > from && width + step > limit) break;
      width += step;
      previous = chars[end];
      end++;
    }
    // Everything left fits: it is the caller's line, not another full one.
    if (end == word_to) return {utf8_encode(chars, from, word_to), width};
    out.push_back(TextLine{utf8_encode(chars, from, end), width});
    from = end;
    // Out of budget: the rest is unpaintable, so it is never measured. The
    // caller drops the line it gets back rather than pushing it.
    if (budget.has_value() && out.size() >= *budget) break;
  }
  return {utf8_encode(chars, from, word_to), 0.0};
}

/**
 * Greedy first-fit wrap of one hard-break-free paragraph, appended to `out`.
 * `budget`, when set, is the total number of lines `out` is allowed to reach:
 * past it nothing is measured, since nothing past it can be painted.
 */
void wrap_paragraph(std::string_view paragraph, TextMetrics &metrics, double limit,
                    std::vector<TextLine> &out, std::optional<size_t> budget) {
  const std::vector<char32_t> chars = utf8_decode(paragraph);
  const size_t start = out.size();
  // The line being built, and where the scan has got to: a greedy wrap IS a fold
  // whose state is three values wide, and `last` is the left half of the kerning
  // pair at the next junction.
  std::string line;
  double line_width = 0.0;
  char32_t last = NONE;
  size_t at = 0;

  while (at < chars.size()) {
    if (budget.has_value() && out.size() >= *budget) return;
    // A segment is a run of spaces plus the word that follows it, scanned by
    // index rather than sliced: a paragraph is walked once, start to end.
    const size_t spaces_from = at;
    while (at < chars.size() && is_break_space(chars[at])) at++;
    const size_t word_from = at;
    while (at < chars.size() && !is_break_space(chars[at])) at++;
    const size_t word_to = at;
    if (word_from == word_to) break;  // trailing spaces: they neither paint nor break

    // Measured only as far as it takes to know it does NOT fit (ZAB-69): a token
    // wider than the whole column is about to be broken glyph by glyph anyway.
    const std::optional<double> segment_width =
        width_up_to(chars, spaces_from, word_to, metrics, limit);

    if (line.empty()) {
      if (!segment_width.has_value()) {
        std::tie(line, line_width) =
            break_word(chars, spaces_from, word_to, metrics, limit, out, budget);
      } else {
        // Spaces that START a line are indentation: they paint, so they count.
        line = utf8_encode(chars, spaces_from, word_to);
        line_width = *segment_width;
      }
    } else {
      const double junction = metrics.kern(last, chars[spaces_from]);
      if (segment_width.has_value() && line_width + junction + *segment_width <= limit) {
        line_width += junction + *segment_width;
        line += utf8_encode(chars, spaces_from, word_to);
      } else {
        // Break here: the line ends, and with it go the spaces at the break and
        // the kerning pair that straddled it.
        out.push_back(TextLine{line, line_width});
        const std::optional<double> word_width =
            width_up_to(chars, word_from, word_to, metrics, limit);
        if (!word_width.has_value()) {
          std::tie(line, line_width) =
              break_word(chars, word_from, word_to, metrics, limit, out, budget);
        } else {
          line = utf8_encode(chars, word_from, word_to);
          line_width = *word_width;
        }
      }
    }
    last = last_char(line);
  }

  // Past the budget the line in hand is one nobody will paint — and, when a long
  // word ran out of budget mid-break, one whose width was never measured.
  if (budget.has_value() && out.size() >= *budget) return;
  // An empty paragraph still owns a line, so a blank line takes vertical space.
  if (!line.empty() || out.size() == start) out.push_back(TextLine{line, line_width});
}

/** Longest prefix that fits: the glyph that would cross the boundary is dropped. */
TextLine clip_line(std::string_view text, TextMetrics &metrics, double limit) {
  std::string kept;
  double width = 0.0;
  char32_t previous = NONE;
  size_t index = 0;
  while (index < text.size()) {
    const char32_t code_point = utf8_next(text, index);
    const double step = step_of(previous, code_point, metrics);
    if (width + step > limit) break;
    utf8_append(kept, code_point);
    width += step;
    previous = code_point;
  }
  return line_of(kept, metrics);
}

/**
 * Ends the line with `…`, dropping glyphs (and the trailing spaces they uncover)
 * until the mark fits. The mark always survives — it is the whole signal — even
 * on a limit too narrow for it.
 */
TextLine ellipsize(std::string_view text, TextMetrics &metrics, std::optional<double> limit) {
  const auto marked = [&](std::string_view kept) {
    std::string out(trim_end(kept));
    utf8_append(out, ELLIPSIS);
    return line_of(out, metrics);
  };
  if (!limit.has_value()) return marked(text);

  const double mark_advance = metrics.advance(ELLIPSIS);
  std::string kept;
  double width = 0.0;
  char32_t previous = NONE;
  size_t index = 0;
  while (index < text.size()) {
    const char32_t code_point = utf8_next(text, index);
    const double step = step_of(previous, code_point, metrics);
    // The mark kerns against whatever ends up in front of it, so the room it
    // needs is measured against THIS glyph, not against the one before it.
    if (width + step + metrics.kern(code_point, ELLIPSIS) + mark_advance > *limit) break;
    utf8_append(kept, code_point);
    width += step;
    previous = code_point;
  }
  // Trimming can only shorten it, so the marked line still fits — and measuring
  // the final string once is what guarantees it is exactly the run the
  // tessellator paints.
  return marked(kept);
}

/** Hard breaks: CRLF and a lone CR both read as LF before anything is split. */
std::vector<std::string_view> paragraphs_of(std::string_view content, std::string &normalized) {
  normalized.clear();
  normalized.reserve(content.size());
  for (size_t i = 0; i < content.size(); i++) {
    if (content[i] == '\r') {
      normalized += '\n';
      if (i + 1 < content.size() && content[i + 1] == '\n') i++;
    } else {
      normalized += content[i];
    }
  }

  std::vector<std::string_view> out;
  const std::string_view text(normalized);
  size_t from = 0;
  while (true) {
    const size_t at = text.find('\n', from);
    if (at == std::string_view::npos) {
      out.push_back(text.substr(from));
      return out;
    }
    out.push_back(text.substr(from, at - from));
    from = at + 1;
  }
}

/** Offset of an inner extent inside an outer one. Never negative: overflow starts at the edge. */
double align_offset(TextAlign align, double outer, double inner) {
  const double leftover = std::max(0.0, outer - inner);
  if (align == TextAlign::Center) return leftover * 0.5;
  if (align == TextAlign::End) return leftover;
  return 0.0;
}

}  // namespace

TextBlock layout_text(std::string_view content, TextMetrics &metrics,
                      const TextLayoutOptions &options) {
  const std::optional<double> limit =
      options.max_width.has_value() && *options.max_width > 0.0 ? options.max_width : std::nullopt;
  std::vector<TextLine> lines;
  // Where laying out stops (ZAB-69). ONE line past the cap, not the cap itself:
  // that extra line is what tells `dropped` something was left behind, and it is
  // the only thing beyond the cap anyone needs to know. Without it a capped
  // `Text` still wrapped its whole content — every line of a 50k-char paragraph
  // measured — only to throw all but the first `maxLines` away.
  const std::optional<size_t> budget =
      options.max_lines.has_value()
          ? std::optional<size_t>(static_cast<size_t>(std::max(1, *options.max_lines)) + 1)
          : std::nullopt;

  std::string normalized;
  for (const std::string_view paragraph : paragraphs_of(content, normalized)) {
    if (budget.has_value() && lines.size() >= *budget) break;
    if (options.wrap && limit.has_value()) {
      wrap_paragraph(paragraph, metrics, *limit, lines, budget);
    } else {
      lines.push_back(line_of(paragraph, metrics));
    }
  }

  // Compared against the cap AS DECLARED, and resized to at least one: a cap of
  // zero is not a cap — it would leave nothing to paint — but it does mean
  // something was left behind, and `truncated` has to say so.
  const bool dropped = options.max_lines.has_value() &&
                       static_cast<long long>(lines.size()) > static_cast<long long>(*options.max_lines);
  if (dropped) lines.resize(static_cast<size_t>(std::max(1, *options.max_lines)));

  // Then the horizontal cut — `wrap: false` only, plus the ellipsis that marks
  // the dropped lines. A wrapped line that is still too wide is a single glyph
  // wider than the line: the minimum-one-glyph rule wins, or the text would
  // vanish.
  const bool can_cut = !options.wrap && limit.has_value();
  const size_t last = lines.empty() ? 0 : lines.size() - 1;
  bool any_wide = false;
  for (size_t i = 0; i < lines.size(); i++) {
    const bool too_wide = can_cut && lines[i].width > *limit;
    any_wide = any_wide || too_wide;
    if (options.overflow == TextOverflow::Ellipsis && (too_wide || (dropped && i == last))) {
      lines[i] = ellipsize(lines[i].text, metrics, limit);
    } else if (too_wide) {
      lines[i] = clip_line(lines[i].text, metrics, *limit);
    }
  }

  TextBlock block;
  block.width = 0.0;
  for (const TextLine &line : lines) block.width = std::max(block.width, line.width);
  block.height = static_cast<double>(lines.size()) * options.line_height;
  block.line_height = options.line_height;
  block.truncated = dropped || any_wide;
  block.lines = std::move(lines);
  return block;
}

void place_lines(const TextBlock &block, const Rect &rect, double font_line_height,
                 TextAlign align, TextAlign align_y, std::vector<PlacedLine> &out) {
  out.clear();
  out.reserve(block.lines.size());
  const double half_leading = (block.line_height - font_line_height) * 0.5;
  const double top = rect.y + align_offset(align_y, rect.height, block.height);
  for (size_t i = 0; i < block.lines.size(); i++) {
    out.push_back(PlacedLine{rect.x + align_offset(align, rect.width, block.lines[i].width),
                             top + static_cast<double>(i) * block.line_height + half_leading});
  }
}

}  // namespace zabloo
