// The pure `Repeat` rules, ported case for case from `repeat.test.ts`.
//
// The identities in here are what per-item state travels on across a `SetData`,
// and the spans are what decides which rows exist at all. If the two targets
// disagree on either, the same envelope with the same data stops producing the
// same screen — so these are checked against the reference's numbers, not
// against what this implementation happens to do.

#include <string>
#include <unordered_map>
#include <vector>

#include "repeat.h"
#include "testing.h"

using namespace zabloo;

namespace {

/** An array of `{id: …}` objects — the shape a keyed list arrives in. */
DataValue rows(const std::vector<std::string> &ids) {
  DataValue out = DataValue::array();
  for (const std::string &id : ids) {
    DataValue row = DataValue::object();
    row.insert("id", DataValue::of_text(id));
    out.push(std::move(row));
  }
  return out;
}

/** Joined so a mismatch prints both lists, which is what makes it readable. */
std::string join(const std::vector<std::string> &parts) {
  std::string out;
  for (const std::string &part : parts) {
    if (!out.empty()) out += "|";
    out += part;
  }
  return out;
}

std::string identities(const std::vector<ItemSlot> &slots) {
  std::vector<std::string> out;
  for (const ItemSlot &slot : slots) out.push_back(slot.identity);
  return join(out);
}

std::string indices(const std::vector<ItemSlot> &slots) {
  std::vector<std::string> out;
  for (const ItemSlot &slot : slots) out.push_back(std::to_string(slot.index));
  return join(out);
}

ItemSlot at(int index, const char *identity) {
  ItemSlot slot;
  slot.index = index;
  slot.identity = identity;
  return slot;
}

}  // namespace

TEST(repeat, children_0_is_the_template_and_there_is_none_without_children) {
  Node ir;
  ir.type = NodeType::Repeat;
  CHECK(item_template(ir) == nullptr);

  Node row;
  row.type = NodeType::Button;
  ir.children.push_back(std::move(row));
  CHECK(item_template(ir) != nullptr);
  CHECK(item_template(ir)->type == NodeType::Button);
}

TEST(repeat, anything_that_is_not_an_array_is_the_empty_case) {
  const DataValue array = DataValue::array();
  CHECK(items_of(&array) == &array);

  const DataValue text = DataValue::of_text("items");
  const DataValue object = DataValue::object();
  CHECK(items_of(nullptr) == nullptr);
  CHECK(items_of(&text) == nullptr);
  CHECK(items_of(&object) == nullptr);
}

TEST(repeat, an_instance_is_keyed_by_the_declared_key_path) {
  const DataValue items = rows({"a", "b", "c"});
  std::vector<ItemSlot> slots;
  window_slots(&items, "id", 0, 3, slots);
  CHECK_EQ(identities(slots), std::string("k:a|k:b|k:c"));
  CHECK_EQ(indices(slots), std::string("0|1|2"));

  // Without one, identity is the position — and the row stays clamped to it.
  window_slots(&items, "", 0, 3, slots);
  CHECK_EQ(identities(slots), std::string("0|1|2"));
}

TEST(repeat, the_window_covers_only_itself_clamped_to_the_array) {
  const DataValue items = rows({"a", "b", "c"});
  std::vector<ItemSlot> slots;
  window_slots(&items, "id", 1, 10, slots);
  CHECK_EQ(indices(slots), std::string("1|2"));
  CHECK_EQ(identities(slots), std::string("k:b|k:c"));

  // `[first, first + count)` intersected with the array: it never walks off
  // either end, whatever the geometry hands it.
  window_slots(&items, "id", -1, 3, slots);
  CHECK_EQ(indices(slots), std::string("0|1"));
}

TEST(repeat, a_duplicated_key_gets_its_positional_identity) {
  const DataValue items = rows({"a", "a"});
  std::vector<ItemSlot> slots;
  window_slots(&items, "id", 0, 2, slots);
  // One identity is one instance: the second element cannot claim the first's,
  // so it falls back to the space the `k:` prefix keeps disjoint.
  CHECK_EQ(identities(slots), std::string("k:a|1"));
}

TEST(repeat, reconcile_moves_an_instance_with_its_item_when_the_array_reorders) {
  std::unordered_map<std::string, std::string> previous{{"k:a", "A"}, {"k:b", "B"}};
  std::vector<WindowEntry<std::string>> entries;
  std::vector<std::string> dropped;
  reconcile_window(previous, {at(0, "k:b"), at(1, "k:a")}, entries, dropped);

  CHECK_EQ(entries.size(), size_t(2));
  CHECK_EQ(*entries[0].instance, std::string("B"));
  CHECK_EQ(*entries[1].instance, std::string("A"));
  CHECK(dropped.empty());
}

TEST(repeat, reconcile_builds_what_is_new_and_drops_what_left_the_window) {
  std::unordered_map<std::string, std::string> previous{{"k:a", "A"}, {"k:gone", "G"}};
  std::vector<WindowEntry<std::string>> entries;
  std::vector<std::string> dropped;
  reconcile_window(previous, {at(0, "k:a"), at(1, "k:new")}, entries, dropped);

  CHECK_EQ(*entries[0].instance, std::string("A"));
  CHECK(entries[1].instance == nullptr);
  CHECK_EQ(join(dropped), std::string("G"));
}

TEST(repeat, reconcile_never_hands_the_same_instance_to_two_slots) {
  std::unordered_map<std::string, std::string> previous{{"k:a", "A"}};
  std::vector<WindowEntry<std::string>> entries;
  std::vector<std::string> dropped;
  reconcile_window(previous, {at(0, "k:a"), at(1, "k:a")}, entries, dropped);

  CHECK_EQ(*entries[0].instance, std::string("A"));
  CHECK(entries[1].instance == nullptr);
}

TEST(repeat, a_line_fits_as_many_as_it_takes_counting_the_gaps_between_them) {
  // 4 × 72 + 3 × 8 = 312 — the width <Grid> resolves for 4 columns.
  CHECK_EQ(items_per_line(312, 72, 8), 4);
  CHECK_EQ(items_per_line(311, 72, 8), 3);
  // Always one line at least, however wide the item is.
  CHECK_EQ(items_per_line(100, 400, 0), 1);
  CHECK_EQ(items_per_line(0, 72, 8), 1);

  CHECK_EQ(line_count(9, 4), 3);
  CHECK_EQ(line_count(0, 4), 0);
}

TEST(repeat, every_line_is_reserved_realized_or_not) {
  const ItemMetrics metrics{40, 10, 1};
  // The scroll bounds must not depend on how much of the array exists.
  CHECK_NEAR(visible_span(100, metrics, 0, 200, 0).reserved, 100 * 40 + 99 * 10, 1e-9);
}

TEST(repeat, the_span_realizes_the_lines_the_viewport_crosses_and_nothing_else) {
  const ItemMetrics metrics{40, 10, 1};
  // stride 50: the viewport [500, 700) covers lines 10..14.
  const ItemSpan span = visible_span(100, metrics, 500, 200, 0);
  CHECK_EQ(span.first, 10);
  CHECK_EQ(span.count, 5);
  CHECK_NEAR(span.lead, 500.0, 1e-9);
  CHECK_NEAR(span.reserved, 4990.0, 1e-9);
  CHECK_EQ(span.per_line, 1);
}

TEST(repeat, the_span_keeps_a_buffer_of_lines_on_both_sides) {
  const ItemMetrics metrics{40, 10, 1};
  // What makes the one-frame lag of a fast scroll invisible.
  const ItemSpan span = visible_span(100, metrics, 500, 200, 2);
  CHECK_EQ(span.first, 8);
  CHECK_EQ(span.count, 9);
  CHECK_NEAR(span.lead, 400.0, 1e-9);
}

TEST(repeat, the_span_clamps_at_both_ends_of_the_array) {
  const ItemMetrics metrics{40, 10, 1};
  const ItemSpan top = visible_span(100, metrics, 0, 200, 2);
  CHECK_EQ(top.first, 0);
  CHECK_NEAR(top.lead, 0.0, 1e-9);

  const ItemSpan bottom = visible_span(10, metrics, 10000, 200, 2);
  CHECK_EQ(bottom.first, 9);
  CHECK_EQ(bottom.count, 1);
}

TEST(repeat, an_array_smaller_than_the_viewport_is_realized_whole) {
  const ItemMetrics metrics{40, 10, 1};
  const ItemSpan span = visible_span(3, metrics, 0, 600, 2);
  CHECK_EQ(span.first, 0);
  CHECK_EQ(span.count, 3);
  CHECK_NEAR(span.lead, 0.0, 1e-9);
  CHECK_NEAR(span.reserved, 140.0, 1e-9);
}

TEST(repeat, a_wrapping_node_counts_LINES_and_not_items) {
  const ItemMetrics grid{60, 8, 4};
  // stride 68: the viewport [136, 340) covers lines 2..5 → items 8..23.
  const ItemSpan span = visible_span(100, grid, 136, 204, 0);
  CHECK_EQ(span.first, 8);
  CHECK_EQ(span.count, 16);
  CHECK_NEAR(span.lead, 136.0, 1e-9);
  CHECK_NEAR(span.reserved, 25 * 60 + 24 * 8, 1e-9);
  CHECK_EQ(span.per_line, 4);
}

TEST(repeat, everything_is_realized_while_the_extent_is_unknown) {
  const ItemSpan span = visible_span(50, ItemMetrics{0, 0, 1}, 0, 200);
  CHECK_EQ(span.first, 0);
  CHECK_EQ(span.count, 50);
}

TEST(repeat, an_empty_array_has_nothing_to_reserve) {
  const ItemSpan span = visible_span(0, ItemMetrics{40, 10, 1}, 0, 200);
  CHECK_EQ(span.first, 0);
  CHECK_EQ(span.count, 0);
  CHECK_NEAR(span.lead, 0.0, 1e-9);
  CHECK_NEAR(span.reserved, 0.0, 1e-9);
  CHECK_EQ(span.per_line, 1);
}
