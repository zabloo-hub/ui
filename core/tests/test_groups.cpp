// The `group` vocabulary and the Toggle's slots — the rules a composite leans on
// once it has flattened to primitives.

#include <optional>
#include <vector>

#include "groups.h"
#include "testing.h"

using namespace zabloo;

namespace {

std::vector<NodeType> bar(std::initializer_list<NodeType> types) { return std::vector<NodeType>(types); }

}  // namespace

TEST(groups, a_tab_bar_pairs_its_buttons_with_the_panels_after_it) {
  const TabsGroup tabs =
      resolve_tabs_group(bar({NodeType::Button, NodeType::Button}), 3);
  CHECK_EQ(tabs.buttons.size(), 2u);
  CHECK_EQ(tabs.panels.size(), 2u);
  // Panels are indices into the GROUP's children, so they start after the bar.
  CHECK_EQ(tabs.panels[0], 1u);
  CHECK_EQ(tabs.panels[1], 2u);
  CHECK(tabs.warning.empty());
}

TEST(groups, decoration_in_the_bar_does_not_shift_the_tab_indices) {
  // Anything that is not a Button is decoration — a title, a separator — which
  // is the one place the positional convention would otherwise be fragile.
  const TabsGroup tabs =
      resolve_tabs_group(bar({NodeType::Text, NodeType::Button, NodeType::Button}), 3);
  CHECK_EQ(tabs.buttons.size(), 2u);
  CHECK_EQ(tabs.buttons[0], 1u);
  CHECK_EQ(tabs.buttons[1], 2u);
}

TEST(groups, a_malformed_group_says_so_and_pairs_what_it_can) {
  CHECK(!resolve_tabs_group(bar({}), 0).warning.empty());
  CHECK(!resolve_tabs_group(bar({NodeType::Text}), 2).warning.empty());
  const TabsGroup uneven =
      resolve_tabs_group(bar({NodeType::Button, NodeType::Button, NodeType::Button}), 3);
  CHECK_EQ(uneven.buttons.size(), 2u);
  CHECK(!uneven.warning.empty());
}

TEST(groups, the_initial_selection_is_clamped_and_defaults_to_the_first_tab) {
  CHECK_EQ(clamp_selected(std::optional<double>(1.0), 3), 1);
  CHECK_EQ(clamp_selected(std::optional<double>(9.0), 3), 2);
  CHECK_EQ(clamp_selected(std::optional<double>(-2.0), 3), 0);
  CHECK_EQ(clamp_selected(std::nullopt, 3), 0);
  // Not an integer is not an index: it lands on the first tab rather than being
  // rounded into one the author never named.
  CHECK_EQ(clamp_selected(std::optional<double>(1.5), 3), 0);
  CHECK_EQ(clamp_selected(std::optional<double>(1.0), 0), 0);
}

TEST(groups, a_radio_group_selects_by_value_and_absent_never_matches_absent) {
  const DataValue high = DataValue::of_text("high");
  const DataValue low = DataValue::of_text("low");
  const DataValue two = DataValue::of_number(2);
  const DataValue two_text = DataValue::of_text("2");
  const DataValue nothing;

  CHECK(is_selected(&high, &high));
  CHECK(!is_selected(&high, &low));
  // A game pushing `2` selects the option authored as `"2"`: content bound to
  // live data must not hinge on which side did the parsing.
  CHECK(is_selected(&two, &two_text));
  // "No selection yet" and "an option without a value" must never match each
  // other, however equal two missing values look.
  CHECK(!is_selected(&nothing, &nothing));
  CHECK(!is_selected(nullptr, &high));
  CHECK(!is_selected(&high, nullptr));
}

TEST(groups, a_radio_only_ever_turns_on) {
  CHECK(next_checked(false, false));
  CHECK(!next_checked(true, false));
  // A group is never left empty: tapping the selected option keeps it selected.
  CHECK(next_checked(true, true));
  CHECK(next_checked(false, true));
}

TEST(groups, the_two_indicator_slots_cross_fade_and_the_label_never_does) {
  CHECK_NEAR(slot_opacity(0, 1.0), 1.0, 0.0001);
  CHECK_NEAR(slot_opacity(1, 1.0), 0.0, 0.0001);
  CHECK_NEAR(slot_opacity(0, 0.0), 0.0, 0.0001);
  CHECK_NEAR(slot_opacity(1, 0.0), 1.0, 0.0001);
  CHECK_NEAR(slot_opacity(0, 0.25), 0.25, 0.0001);
  CHECK_NEAR(slot_opacity(1, 0.25), 0.75, 0.0001);
  // `children[2..]` is the label, and it is always fully shown.
  CHECK_NEAR(slot_opacity(2, 0.5), 1.0, 0.0001);
}
