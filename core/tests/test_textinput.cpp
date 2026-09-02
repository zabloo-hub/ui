// The TextInput's editing model — a port of `renderer-web/src/textinput.test.ts`.
//
// The reference's last block ("the bridge to the browser's own field") has no
// port on purpose: `codePointIndex`/`utf16Offset` exist only to talk to a
// `<textarea>` that counts UTF-16 units, and nothing on this side counts them.
// What survives of it is `sanitize_line`, which is a rule of the field and not of
// the browser, and the emoji cases scattered through the rest — those are the
// ones that would catch an index that had drifted to bytes.

#include "textinput.h"

#include <string>
#include <vector>

#include "testing.h"
#include "utf8.h"

using namespace zabloo;

namespace {

/** Monospace stand-in: every glyph advances 10px, so an expected x stays readable. */
class Font : public TextMetrics {
 public:
  double advance(char32_t) override { return 10.0; }
  double kern(char32_t, char32_t) override { return 0.0; }
  double font_line_height() const override { return 20.0; }
  double ascent() const override { return 16.0; }
};

/** Kerns "AV" tight, like a real font — the caret must sit on the painted seam. */
class KernedFont : public TextMetrics {
 public:
  double advance(char32_t) override { return 10.0; }
  double kern(char32_t previous, char32_t code_point) override {
    return previous == U'A' && code_point == U'V' ? -6.0 : 0.0;
  }
  double font_line_height() const override { return 20.0; }
  double ascent() const override { return 16.0; }
};

std::vector<char32_t> glyphs(std::string_view text) { return utf8_decode(text); }

Selection sel(size_t anchor, size_t focus) { return Selection{anchor, focus}; }

/** `insert` over a literal, the shape the reference's cases are written in. */
Edit insert_into(std::string_view text, const Selection &selection, std::string_view input,
                 double max_length = 0.0) {
  return insert(glyphs(text), selection, input, max_length);
}

Edit remove_from(std::string_view text, const Selection &selection, bool forward) {
  return remove(glyphs(text), selection, forward);
}

}  // namespace

// --- insert ---------------------------------------------------------------

TEST(textinput, insert_lands_at_the_caret) {
  const Edit at_end = insert_into("hola", caret_at(4), "!");
  CHECK_EQ(at_end.text, std::string("hola!"));
  CHECK(at_end.selection == caret_at(5));

  const Edit inside = insert_into("hla", caret_at(1), "o");
  CHECK_EQ(inside.text, std::string("hola"));
  CHECK(inside.selection == caret_at(2));
}

TEST(textinput, insert_replaces_the_selection_and_leaves_the_caret_after_it) {
  const Edit forwards = insert_into("hola mundo", sel(5, 10), "tú");
  CHECK_EQ(forwards.text, std::string("hola tú"));
  CHECK(forwards.selection == caret_at(7));

  // A backwards selection is the same span: the order of the ends is the
  // gesture's, not the text's.
  const Edit backwards = insert_into("hola mundo", sel(10, 5), "tú");
  CHECK_EQ(backwards.text, std::string("hola tú"));
  CHECK(backwards.selection == caret_at(7));
}

TEST(textinput, max_length_counts_the_whole_field_and_keeps_the_prefix_that_fits) {
  const Edit truncated = insert_into("abc", caret_at(3), "defg", 5);
  CHECK_EQ(truncated.text, std::string("abcde"));
  CHECK(truncated.selection == caret_at(5));

  // The selection it replaces frees its own room.
  const Edit over_selection = insert_into("abc", sel(0, 2), "XYZ", 4);
  CHECK_EQ(over_selection.text, std::string("XYZc"));
  CHECK(over_selection.selection == caret_at(3));
}

TEST(textinput, a_full_field_takes_nothing_at_all) {
  const Edit blocked = insert_into("abcde", caret_at(5), "f", 5);
  CHECK_EQ(blocked.text, std::string("abcde"));
  CHECK(blocked.selection == caret_at(5));
}

TEST(textinput, a_non_positive_max_length_is_no_limit) {
  CHECK_EQ(insert_into("abc", caret_at(3), "d", 0).text, std::string("abcd"));
  CHECK_EQ(insert_into("abc", caret_at(3), "d", -1).text, std::string("abcd"));
}

TEST(textinput, pasted_newlines_and_tabs_become_spaces_because_v1_is_one_line) {
  CHECK_EQ(insert_into("", caret_at(0), "calle 1\nmadrid").text, std::string("calle 1 madrid"));
  // A run folds to ONE space, so a pasted CRLF does not become two.
  CHECK_EQ(insert_into("", caret_at(0), "a\r\nb").text, std::string("a b"));
}

TEST(textinput, an_emoji_is_one_character_to_both_the_caret_and_max_length) {
  const Edit typed = insert_into("", caret_at(0), "🎮", 1);
  CHECK_EQ(typed.text, std::string("🎮"));
  CHECK(typed.selection == caret_at(1));
  // One character, so a field of one is full — a byte count would have said four.
  CHECK_EQ(insert_into("🎮", caret_at(1), "x", 1).text, std::string("🎮"));
}

// --- remove ---------------------------------------------------------------

TEST(textinput, backspace_eats_behind_the_caret_and_delete_ahead_of_it) {
  const Edit back = remove_from("hola", caret_at(4), false);
  CHECK_EQ(back.text, std::string("hol"));
  CHECK(back.selection == caret_at(3));

  const Edit forward = remove_from("hola", caret_at(0), true);
  CHECK_EQ(forward.text, std::string("ola"));
  CHECK(forward.selection == caret_at(0));
}

TEST(textinput, either_key_deletes_a_selection_and_nothing_else) {
  const Selection selection = sel(1, 3);
  const Edit back = remove_from("hola", selection, false);
  CHECK_EQ(back.text, std::string("ha"));
  CHECK(back.selection == caret_at(1));

  const Edit forward = remove_from("hola", selection, true);
  CHECK_EQ(forward.text, std::string("ha"));
  CHECK(forward.selection == caret_at(1));
}

TEST(textinput, deleting_at_the_edges_does_nothing) {
  const Edit back = remove_from("hola", caret_at(0), false);
  CHECK_EQ(back.text, std::string("hola"));
  CHECK(back.selection == caret_at(0));

  const Edit forward = remove_from("hola", caret_at(4), true);
  CHECK_EQ(forward.text, std::string("hola"));
  CHECK(forward.selection == caret_at(4));
}

TEST(textinput, a_backspace_removes_a_whole_emoji_never_half_of_one) {
  const Edit edit = remove_from("a🎮", caret_at(2), false);
  CHECK_EQ(edit.text, std::string("a"));
  CHECK(edit.selection == caret_at(1));
}

// --- caret movement -------------------------------------------------------

TEST(textinput, an_arrow_steps_one_character) {
  CHECK(move_caret(4, caret_at(2), 1, false).selection == caret_at(3));
  CHECK(move_caret(4, caret_at(2), -1, false).selection == caret_at(1));
}

TEST(textinput, an_arrow_collapses_a_selection_to_its_edge_without_also_stepping) {
  const Selection selection = sel(1, 3);
  CHECK(move_caret(4, selection, -1, false).selection == caret_at(1));
  CHECK(move_caret(4, selection, 1, false).selection == caret_at(3));
}

TEST(textinput, extending_drags_the_focus_alone_so_shift_arrow_also_shrinks) {
  const Selection grown = move_caret(4, caret_at(1), 1, true).selection;
  CHECK(grown == sel(1, 2));
  CHECK(move_caret(4, grown, 1, true).selection == sel(1, 3));
  CHECK(move_caret(4, grown, -1, true).selection == sel(1, 1));
}

TEST(textinput, the_boundary_is_reported_only_when_a_bare_caret_had_nowhere_to_go) {
  // This flag is the whole reason the arrows can leave the field instead of
  // trapping the player in it (ZAB-26).
  CHECK(move_caret(4, caret_at(0), -1, false).at_boundary);
  CHECK(move_caret(4, caret_at(4), 1, false).at_boundary);
  CHECK(!move_caret(4, caret_at(1), -1, false).at_boundary);
  // A selection to collapse is something to do, so it is not a boundary.
  CHECK(!move_caret(4, sel(0, 2), -1, false).at_boundary);
  CHECK(move_caret(0, caret_at(0), 1, false).at_boundary);
}

TEST(textinput, home_and_end_jump_to_an_edge) {
  CHECK(move_to_edge(4, caret_at(2), true, false).selection == caret_at(4));
  CHECK(move_to_edge(4, caret_at(2), false, false).selection == caret_at(0));
  CHECK(move_to_edge(4, caret_at(2), true, true).selection == sel(2, 4));
}

TEST(textinput, an_edge_is_a_boundary_only_with_the_caret_there_and_nothing_selected) {
  CHECK(move_to_edge(4, caret_at(4), true, false).at_boundary);
  CHECK(!move_to_edge(4, sel(0, 4), true, false).at_boundary);
}

// --- selection helpers ----------------------------------------------------

TEST(textinput, a_span_is_ordered_and_clamped) {
  const Span ordered = span_of(sel(3, 1), 4);
  CHECK_EQ(ordered.start, size_t(1));
  CHECK_EQ(ordered.end, size_t(3));

  const Span clamped = span_of(sel(0, 99), 4);
  CHECK_EQ(clamped.start, size_t(0));
  CHECK_EQ(clamped.end, size_t(4));
}

TEST(textinput, the_selected_substring_is_what_a_copy_puts_on_the_clipboard) {
  CHECK_EQ(selected_text(glyphs("hola mundo"), sel(5, 10)), std::string("mundo"));
  CHECK_EQ(selected_text(glyphs("hola"), caret_at(2)), std::string(""));
}

TEST(textinput, a_selection_stays_inside_a_text_the_game_shortened_under_it) {
  CHECK(clamp_selection(sel(2, 8), 3) == sel(2, 3));
}

TEST(textinput, select_all_anchors_at_the_start_so_shift_left_shrinks_it) {
  CHECK(select_all(4) == sel(0, 4));
}

// --- caret geometry -------------------------------------------------------

TEST(textinput, caret_x_measures_up_to_the_seam_before_the_index) {
  Font font;
  const std::vector<char32_t> run = glyphs("hola");
  CHECK_EQ(caret_x(run, 0, font), 0.0);
  CHECK_EQ(caret_x(run, 2, font), 20.0);
  CHECK_EQ(caret_x(run, 4, font), 40.0);
  CHECK_EQ(caret_x(run, 99, font), 40.0);  // clamped past the end
}

TEST(textinput, caret_x_includes_kerning_so_it_lands_where_the_glyphs_are_painted) {
  KernedFont font;
  CHECK_EQ(caret_x(glyphs("AV"), 2, font), 14.0);
}

TEST(textinput, a_pointer_snaps_to_the_nearest_seam) {
  Font font;
  const std::vector<char32_t> run = glyphs("hola");
  CHECK_EQ(index_at_x(run, 0.0, font), size_t(0));
  CHECK_EQ(index_at_x(run, 4.0, font), size_t(0));  // left half of the first glyph
  CHECK_EQ(index_at_x(run, 6.0, font), size_t(1));  // right half
  CHECK_EQ(index_at_x(run, 25.0, font), size_t(3));
  CHECK_EQ(index_at_x(run, 999.0, font), size_t(4));
}

TEST(textinput, a_pointer_round_trips_against_the_painted_positions_kerning_included) {
  KernedFont font;
  const std::vector<char32_t> run = glyphs("AV");
  CHECK_EQ(index_at_x(run, caret_x(run, 1, font), font), size_t(1));
}

TEST(textinput, an_emoji_is_one_indivisible_step_for_the_pointer_too) {
  Font font;
  const std::vector<char32_t> run = glyphs("a🎮");
  CHECK_EQ(index_at_x(run, 25.0, font), size_t(2));
  CHECK_EQ(caret_x(run, 1, font), 10.0);
}

// --- the field's own horizontal scroll ------------------------------------

TEST(textinput, the_scroll_stays_put_while_the_caret_is_inside_the_viewport) {
  CHECK_EQ(scroll_for(0.0, 30.0, 100.0, 40.0), 0.0);
}

TEST(textinput, the_scroll_follows_the_caret_out_of_either_edge_by_the_smallest_step) {
  CHECK_EQ(scroll_for(0.0, 120.0, 100.0, 200.0), 21.0);  // caret width included
  CHECK_EQ(scroll_for(50.0, 20.0, 100.0, 200.0), 20.0);
}

TEST(textinput, the_scroll_never_passes_the_content_and_snaps_back_when_the_text_fits) {
  CHECK_EQ(scroll_for(500.0, 40.0, 100.0, 40.0), 0.0);
  CHECK_EQ(scroll_for(80.0, 200.0, 100.0, 200.0), 101.0);
}

// --- the blink ------------------------------------------------------------

TEST(textinput, the_caret_is_on_for_the_first_half_of_every_period) {
  CHECK(caret_visible(0.0, 1000.0));
  CHECK(caret_visible(499.0, 1000.0));
  CHECK(!caret_visible(500.0, 1000.0));
  CHECK(caret_visible(1200.0, 1000.0));
}

TEST(textinput, the_caret_stays_on_when_the_blink_is_off_or_the_clock_is_broken) {
  CHECK(caret_visible(700.0, 0.0));
  CHECK(caret_visible(std::nan(""), 1000.0));
}

// --- the single-line rule -------------------------------------------------

TEST(textinput, a_line_folds_newlines_and_tabs_into_one_space_each_run) {
  CHECK_EQ(sanitize_line("a\n\tb"), std::string("a b"));
  CHECK_EQ(sanitize_line("plano"), std::string("plano"));
  // Bytes are walked, not code points — and a continuation byte can never
  // collide with an ASCII control, so a multi-byte character survives whole.
  CHECK_EQ(sanitize_line("marrón\tcafé"), std::string("marrón café"));
}
