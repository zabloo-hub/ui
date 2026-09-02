// The TextInput's editing model and caret geometry — pure, no engine and no IR.
//
// A port of `renderer-web/src/textinput.ts`, kept apart for the same reason it is
// kept apart there: these are the rules a field obeys, and they are testable
// without a surface to draw on. Two invariants run through the whole file.
//
// **Positions are counted in CODE POINTS.** A caret that can land between the two
// halves of an emoji is a caret that can cut it in half, so every index here
// counts code points. The reference has to say so out loud because JavaScript
// strings are UTF-16 and it splits with `Array.from`; here it falls out of the
// types — `TextMetrics` already speaks `char32_t`, and a buffer is decoded once
// into a `std::vector<char32_t>` that the whole frame reads. For the same reason
// the reference's two UTF-16 conversions (`codePointIndex`, `utf16Offset`) have
// no port: they exist only to talk to a browser `<textarea>` that counts the
// other unit. (Grapheme clusters — a flag, a family, a combining accent — are a
// finer step still and stay deferred: they need a segmentation table, the same
// reason shaping is v2.)
//
// **The x of a character is measured exactly as it is painted**, advance plus the
// kerning against the glyph before it, so the caret sits on the seam the player
// sees rather than near it.

#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

#include "text.h"

namespace zabloo {

/**
 * What a focused field paints on top of its text (ZAB-26).
 *
 * All three derive from the field's own `style.color` — the "color of this
 * node's content" that already tints glyphs and images — so nothing new enters
 * `Style`. The blink is runtime behavior, like the Spinner's loop: it is not
 * authored, and styling either the caret or the highlight is a compatible
 * extension, exactly as it is for the ScrollView's scrollbar.
 */
struct CaretStyle {
  double width = 2.0;
  double blink_ms = 1060.0;
  double selection_alpha = 0.3;
};
inline constexpr CaretStyle CARET{};

/**
 * A caret and, when the two ends differ, a selection. `anchor` is where the
 * gesture started and `focus` where it is now — the order between them is what
 * makes shift+arrow grow AND shrink a selection instead of always growing it.
 */
struct Selection {
  size_t anchor = 0;
  size_t focus = 0;

  bool operator==(const Selection &other) const {
    return anchor == other.anchor && focus == other.focus;
  }
};

/** The selection as an ordered span. `start == end` means "just a caret". */
struct Span {
  size_t start = 0;
  size_t end = 0;
};

/** The result of an edit: the new text and where the caret ended up. */
struct Edit {
  std::string text;
  Selection selection;
};

/** Where a caret movement lands. `extend` is the shift key: it drags `focus` alone. */
struct Move {
  Selection selection;
  /**
   * True when the movement had nowhere to go — the caret was already against
   * that end with nothing selected. It is what lets the arrow keys fall through
   * to spatial navigation at the edges instead of trapping the player inside the
   * field (decision 2026-08-11, ZAB-26).
   */
  bool at_boundary = false;
};

/** A caret with no selection at `index`. */
Selection caret_at(size_t index);

/** The selection as an ordered, clamped span. */
Span span_of(const Selection &selection, size_t max);

bool has_selection(const Selection &selection);

/** Keeps a selection inside a text that changed under it (a `SetData` from the game). */
Selection clamp_selection(const Selection &selection, size_t max);

/** The selected substring — what a copy or a cut puts on the clipboard. */
std::string selected_text(const std::vector<char32_t> &glyphs, const Selection &selection);

/**
 * Replaces the selection (or inserts at the caret) with `input`, honoring
 * `max_length` — which counts the WHOLE field, not the insertion: a paste into a
 * full field lands the prefix that fits and drops the rest, which is what every
 * text field does and what keeps a limit meaningful when the text also arrives
 * whole.
 *
 * Newlines are folded rather than rejected: v1 is a single line (the multiline
 * field is deferred), and pasting a two-line address should leave the first line
 * in the box instead of failing silently.
 *
 * `max_length <= 0` is no limit, which is also what an absent one means.
 */
Edit insert(const std::vector<char32_t> &glyphs, const Selection &selection,
            std::string_view input, double max_length);

/**
 * Backspace / Delete. With a selection, either key deletes it and nothing else —
 * the direction only decides which side a bare caret eats.
 */
Edit remove(const std::vector<char32_t> &glyphs, const Selection &selection, bool forward);

/**
 * One arrow-key step, `direction` being -1 (left) or +1 (right).
 *
 * Without shift, a collapsed selection moves one character and a non-empty one
 * COLLAPSES to the edge it was pushed against — it does not also step, which is
 * what makes "select a word, press left, keep typing" behave.
 */
Move move_caret(size_t max, const Selection &selection, int direction, bool extend);

/** Home / End: jump to an edge. */
Move move_to_edge(size_t max, const Selection &selection, bool end, bool extend);

/** Select everything (Ctrl/Cmd+A), anchored at the start so shift+left shrinks it. */
Selection select_all(size_t max);

/**
 * Distance from the start of the run to the seam BEFORE character `index`,
 * kerning included — the same width the paint loop accumulates, so the caret
 * lands on the boundary the player sees.
 */
double caret_x(const std::vector<char32_t> &glyphs, size_t index, TextMetrics &metrics);

/**
 * The caret position a pointer at `x` (relative to the start of the run)
 * selects: the nearest seam, so clicking on the left half of a character puts
 * the caret before it and on the right half after it — the behavior every text
 * field has, and the one that makes a drag select what it looks like it selects.
 */
size_t index_at_x(const std::vector<char32_t> &glyphs, double x, TextMetrics &metrics);

/**
 * The horizontal scroll of the content after a change: the smallest move that
 * brings the caret back inside the viewport, and never more than the content
 * overflows.
 *
 * Minimal on purpose — the field must not re-centre on every keystroke — and it
 * always keeps the run anchored to the left when it fits, so a short text does
 * not float in a wide box.
 *
 * `caret_width` is the caret's own: it has to fit at the very end of a full
 * field. The default is one logical pixel and the runtime passes `CARET.width`
 * instead — the same split the reference has, and the reason its own tests read
 * `21` where the field on screen would scroll to `22`.
 */
double scroll_for(double scroll, double caret, double view_width, double content_width,
                  double caret_width = 1.0);

/**
 * The caret's on/off phase of the blink. A closed-form function of the time since
 * the last edit, like `spinner_pulse`, so the caret is not a timer the runtime
 * has to keep: it is on for the first half of every period, and every edit
 * restarts the cycle from ON — a caret that blinks off exactly as you type reads
 * as a dropped keystroke.
 */
bool caret_visible(double elapsed, double period = CARET.blink_ms);

/**
 * A newline is not a character this field can hold; a tab is not one it can
 * insert. A run of either folds to ONE space, which is what keeps a pasted
 * "\r\n" from becoming two.
 */
std::string sanitize_line(std::string_view input);

}  // namespace zabloo
