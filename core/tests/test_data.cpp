// The data channel's readers: what a path addresses, and what a bound prop makes
// of what it finds.
//
// The rules here are the format's, not this target's, so what these cases pin
// down is agreement with the reference — the string a bound `Text` paints, the
// truthiness a bound `visible` reads, the prefix a write drops. A disagreement
// in any of them moves every metric downstream of a binding.

#include <string>

#include "data.h"
#include "testing.h"

using namespace zabloo;

namespace {

DataValue item(const std::string &name) {
  DataValue out = DataValue::object();
  out.insert("name", DataValue::of_text(name));
  return out;
}

/** `{"shop": …}` is never written whole: the game pushes `shop.items`. */
DataValue two_items() {
  DataValue items = DataValue::array();
  items.push(item("Poción"));
  items.push(item("Espada"));
  return items;
}

}  // namespace

TEST(data, a_path_addresses_into_the_value_that_was_pushed) {
  DataStore store;
  store.set("shop.items", two_items());
  const DataValue *deep = store.get("shop.items.1.name");
  CHECK(deep != nullptr);
  if (deep != nullptr) CHECK_EQ(deep->text, std::string("Espada"));
  // A numeric segment indexes an array and NOTHING else does: `length` is not a
  // field, and neither is any other name.
  CHECK(store.get("shop.items.length") == nullptr);
  CHECK(store.get("shop.items.9.name") == nullptr);
  // Walking through a scalar stops rather than throwing: bound UI degrades to
  // "no value", it never breaks the frame.
  store.set("player.gold", DataValue::of_number(1200));
  CHECK(store.get("player.gold.cents") == nullptr);
  CHECK(store.get("player.nothing.here") == nullptr);
}

TEST(data, a_write_drops_what_was_written_underneath_it) {
  DataStore store;
  store.set("shop.items", two_items());
  // A control inside a row writes a DEEPER path; the array under it is still the
  // game's own object, so reading the deep key finds the write first.
  store.set("shop.items.1.enabled", DataValue::of_bool(true));
  CHECK(is_truthy(store.get("shop.items.1.enabled")));
  const DataValue *name = store.get("shop.items.1.name");
  CHECK(name != nullptr);
  if (name != nullptr) CHECK_EQ(name->text, std::string("Espada"));

  // A fresh array arriving on the prefix must not keep the old row alive.
  store.set("shop.items", two_items());
  CHECK(store.get("shop.items.1.enabled") == nullptr);
  // An unrelated sibling is untouched — the separator is part of the comparison.
  store.set("shop.itemsCount", DataValue::of_number(2));
  store.set("shop.items", two_items());
  CHECK(store.get("shop.itemsCount") != nullptr);
}

TEST(data, a_write_moves_the_bindings_above_and_below_it) {
  CHECK(affects("shop.items", "shop.items.3.name"));
  CHECK(affects("shop.items.3.enabled", "shop.items"));
  CHECK(affects("player.gold", "player.gold"));
  CHECK(!affects("shop.items", "shop.itemsCount"));
  CHECK(!affects("shop.itemsCount", "shop.items"));
  CHECK(!affects("player", "shopping"));
}

TEST(data, truthiness_is_javascripts_because_the_reference_is) {
  const DataValue zero = DataValue::of_number(0.0);
  const DataValue empty = DataValue::of_text("");
  const DataValue text = DataValue::of_text("no");
  const DataValue no = DataValue::of_bool(false);
  const DataValue nothing;
  CHECK(!is_truthy(nullptr));
  CHECK(!is_truthy(&nothing));
  CHECK(!is_truthy(&zero));
  CHECK(!is_truthy(&empty));
  CHECK(!is_truthy(&no));
  // A non-empty string is truthy whatever it says — including `"false"`.
  CHECK(is_truthy(&text));
  const DataValue empty_array = DataValue::array();
  // Every object is truthy, the empty ones included.
  CHECK(is_truthy(&empty_array));
}

TEST(data, a_bound_text_paints_what_the_reference_paints) {
  const DataValue gold = DataValue::of_number(1200);
  const DataValue level = DataValue::of_number(7);
  const DataValue ratio = DataValue::of_number(0.5);
  const DataValue noisy = DataValue::of_number(1.0 / 3.0);
  const DataValue flag = DataValue::of_bool(true);
  CHECK_EQ(format_value(&gold), std::string("1200"));
  CHECK_EQ(format_value(&level), std::string("7"));
  CHECK_EQ(format_value(&ratio), std::string("0.5"));
  // Two decimals with the trailing zeros trimmed: a bound float must not paint
  // seventeen digits of binary noise.
  CHECK_EQ(format_value(&noisy), std::string("0.33"));
  CHECK_EQ(format_value(&flag), std::string("true"));
  // No value is the empty string, which measures one line tall (ZAB-65).
  CHECK_EQ(format_value(nullptr), std::string(""));
}

TEST(data, a_number_prints_the_shortest_decimal_that_reads_back) {
  // `String(number)`, which is what the reference's `formatValue` falls through
  // to. Locale-free: `printf` would write `0,5` under a Spanish locale and every
  // metric downstream of a bound Text would silently stop comparing.
  CHECK_EQ(number_to_text(0.0), std::string("0"));
  CHECK_EQ(number_to_text(-0.0), std::string("0"));
  CHECK_EQ(number_to_text(1200.0), std::string("1200"));
  CHECK_EQ(number_to_text(-7.0), std::string("-7"));
  CHECK_EQ(number_to_text(0.1), std::string("0.1"));
  CHECK_EQ(number_to_text(0.1 + 0.2), std::string("0.30000000000000004"));
  CHECK_EQ(number_to_text(1e21), std::string("1e+21"));
  CHECK_EQ(number_to_text(1e20), std::string("100000000000000000000"));
  CHECK_EQ(number_to_text(1e-7), std::string("1e-7"));
  CHECK_EQ(number_to_text(0.000001), std::string("0.000001"));
}

TEST(data, a_numeric_string_off_the_channel_reads_as_a_number) {
  // The game may have pushed a value that crossed a text field or a JSON
  // payload, and a control bound to live data must not hinge on which side did
  // the parsing.
  const DataValue text = DataValue::of_text(" 2.5 ");
  const DataValue words = DataValue::of_text("2px");
  const DataValue nothing = DataValue::of_text("");
  CHECK_NEAR(to_number(&text, -1.0), 2.5, 0.0001);
  CHECK_NEAR(to_number(&words, -1.0), -1.0, 0.0001);
  CHECK_NEAR(to_number(&nothing, -1.0), -1.0, 0.0001);
  CHECK_NEAR(to_number(nullptr, -1.0), -1.0, 0.0001);
  double parsed = 0.0;
  CHECK(text_to_number("-3e2", parsed));
  CHECK_NEAR(parsed, -300.0, 0.0001);
  CHECK(!text_to_number("1e", parsed));
  CHECK(!text_to_number("", parsed));
}
