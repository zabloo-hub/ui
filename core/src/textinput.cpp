#include "textinput.h"

#include <algorithm>
#include <cmath>

#include "utf8.h"

namespace zabloo {

namespace {

size_t clamp_index(size_t index, size_t max) { return std::min(index, max); }

/** `extend` is the shift key: it drags `focus` and leaves `anchor` where it was. */
Selection place(const Selection &selection, size_t index, bool extend) {
  if (!extend) return caret_at(index);
  return Selection{selection.anchor, index};
}

/**
 * The seam before character `count`: advances plus the kerning each glyph has
 * against the one before it.
 *
 * The reference builds the whole seam table in one pass and indexes it; here the
 * two callers walk instead, because a table would be a vector allocated per
 * question and the caret asks several times a frame (ZAB-55).
 */
double seam(const std::vector<char32_t> &glyphs, size_t count, TextMetrics &metrics) {
  double x = 0.0;
  for (size_t i = 0; i < count; i++) {
    if (i > 0) x += metrics.kern(glyphs[i - 1], glyphs[i]);
    x += metrics.advance(glyphs[i]);
  }
  return x;
}

}  // namespace

Selection caret_at(size_t index) { return Selection{index, index}; }

Span span_of(const Selection &selection, size_t max) {
  const size_t anchor = clamp_index(selection.anchor, max);
  const size_t focus = clamp_index(selection.focus, max);
  return anchor <= focus ? Span{anchor, focus} : Span{focus, anchor};
}

bool has_selection(const Selection &selection) { return selection.anchor != selection.focus; }

Selection clamp_selection(const Selection &selection, size_t max) {
  return Selection{clamp_index(selection.anchor, max), clamp_index(selection.focus, max)};
}

std::string selected_text(const std::vector<char32_t> &glyphs, const Selection &selection) {
  const Span ordered = span_of(selection, glyphs.size());
  return utf8_encode(glyphs, ordered.start, ordered.end);
}

Edit insert(const std::vector<char32_t> &glyphs, const Selection &selection,
            std::string_view input, double max_length) {
  const Span ordered = span_of(selection, glyphs.size());
  const std::vector<char32_t> inserted = utf8_decode(sanitize_line(input));
  // `max_length` counts the WHOLE field: what fits is the limit minus what
  // survives this edit, so a paste into a full field lands nothing rather than
  // the limit's worth of new text.
  size_t kept = inserted.size();
  if (max_length > 0.0) {
    const double surviving =
        static_cast<double>(glyphs.size()) - static_cast<double>(ordered.end - ordered.start);
    // Compared in `double` and only then narrowed: a `maxLength` out of a payload
    // is whatever number the author wrote, and casting 1e300 to a `size_t` is
    // undefined rather than merely large.
    const double room = max_length - surviving;
    if (room <= 0.0) kept = 0;
    else if (room < static_cast<double>(inserted.size())) kept = static_cast<size_t>(room);
  }

  std::string text = utf8_encode(glyphs, 0, ordered.start);
  for (size_t i = 0; i < kept; i++) utf8_append(text, inserted[i]);
  text += utf8_encode(glyphs, ordered.end, glyphs.size());
  return Edit{std::move(text), caret_at(ordered.start + kept)};
}

Edit remove(const std::vector<char32_t> &glyphs, const Selection &selection, bool forward) {
  const Span ordered = span_of(selection, glyphs.size());
  if (ordered.start != ordered.end) {
    return Edit{utf8_encode(glyphs, 0, ordered.start) +
                    utf8_encode(glyphs, ordered.end, glyphs.size()),
                caret_at(ordered.start)};
  }
  // A bare caret eats one character on the side the key names — and nothing at
  // all when there is none, which is a Backspace at the start or a Delete at the
  // end.
  if (forward) {
    if (ordered.start >= glyphs.size()) return Edit{utf8_encode(glyphs, 0, glyphs.size()),
                                                    caret_at(ordered.start)};
    return Edit{utf8_encode(glyphs, 0, ordered.start) +
                    utf8_encode(glyphs, ordered.start + 1, glyphs.size()),
                caret_at(ordered.start)};
  }
  if (ordered.start == 0) return Edit{utf8_encode(glyphs, 0, glyphs.size()), caret_at(0)};
  return Edit{utf8_encode(glyphs, 0, ordered.start - 1) +
                  utf8_encode(glyphs, ordered.start, glyphs.size()),
              caret_at(ordered.start - 1)};
}

Move move_caret(size_t max, const Selection &selection, int direction, bool extend) {
  const Span ordered = span_of(selection, max);
  if (!extend && ordered.start != ordered.end) {
    return Move{caret_at(direction < 0 ? ordered.start : ordered.end), false};
  }
  const size_t from = clamp_index(selection.focus, max);
  const size_t to = direction < 0 ? (from == 0 ? 0 : from - 1) : std::min(from + 1, max);
  const bool at_boundary = to == from && ordered.start == ordered.end;
  return Move{place(selection, to, extend), at_boundary};
}

Move move_to_edge(size_t max, const Selection &selection, bool end, bool extend) {
  const size_t to = end ? max : 0;
  const bool at_boundary = clamp_index(selection.focus, max) == to && !has_selection(selection);
  return Move{place(selection, to, extend), at_boundary};
}

Selection select_all(size_t max) { return Selection{0, max}; }

double caret_x(const std::vector<char32_t> &glyphs, size_t index, TextMetrics &metrics) {
  return seam(glyphs, clamp_index(index, glyphs.size()), metrics);
}

size_t index_at_x(const std::vector<char32_t> &glyphs, double x, TextMetrics &metrics) {
  // The nearest seam: the first glyph whose midpoint the pointer has not passed.
  // The kerning belongs BETWEEN the two seams, never to the left one — folding it
  // into both would move the midpoint by half a kern and put the caret on the
  // wrong side of a tight pair.
  double left = 0.0;
  for (size_t i = 0; i < glyphs.size(); i++) {
    const double kern = i > 0 ? metrics.kern(glyphs[i - 1], glyphs[i]) : 0.0;
    const double right = left + kern + metrics.advance(glyphs[i]);
    if (x < (left + right) / 2.0) return i;
    left = right;
  }
  return glyphs.size();
}

double scroll_for(double scroll, double caret, double view_width, double content_width,
                  double caret_width) {
  const double max = std::max(0.0, content_width + caret_width - view_width);
  const double clamped = std::min(scroll, max);
  // The smallest move that brings the caret back inside: push right when it fell
  // off the trailing edge, left when it fell off the leading one.
  const double pushed =
      caret - clamped > view_width - caret_width ? caret - view_width + caret_width : clamped;
  const double next = caret < pushed ? caret : pushed;
  return std::min(max, std::max(0.0, next));
}

bool caret_visible(double elapsed, double period) {
  if (!(period > 0.0) || !std::isfinite(period) || !std::isfinite(elapsed)) return true;
  const double phase = std::fmod(elapsed, period);
  return (phase < 0.0 ? phase + period : phase) < period / 2.0;
}

std::string sanitize_line(std::string_view input) {
  std::string out;
  out.reserve(input.size());
  bool folding = false;
  for (const char byte : input) {
    // Bytes, not code points: every one of the three is ASCII, and a UTF-8
    // continuation byte can never collide with one.
    if (byte == '\r' || byte == '\n' || byte == '\t') {
      if (!folding) out.push_back(' ');
      folding = true;
      continue;
    }
    folding = false;
    out.push_back(byte);
  }
  return out;
}

}  // namespace zabloo
