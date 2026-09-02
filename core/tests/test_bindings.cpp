// The normative helpers of `@zabloo/format`, checked against the rules the
// format writes down.
//
// The scopes are built by hand here rather than by expanding a `Repeat`, which
// is the point: if the three targets do not compute the same path and the same
// identity from the same chain, the same envelope with the same `SetData` stops
// producing the same screen.

#include <string>

#include "bindings.h"
#include "testing.h"

using namespace zabloo;

namespace {

ItemScope scope(const char *alias, const char *path, int index,
                const ItemScope *outer = nullptr) {
  ItemScope out;
  out.alias = alias;
  out.path = path;
  out.index = index;
  out.outer = outer;
  return out;
}

std::string path_of(const char *bind, const ItemScope *innermost) {
  const ResolvedBind resolved = resolve_binding(bind, innermost);
  return resolved.kind == ResolvedBind::Kind::Path ? resolved.path : std::string("(index)");
}

}  // namespace

TEST(bindings, outside_a_template_a_path_passes_through_untouched) {
  CHECK_EQ(path_of("player.gold", nullptr), std::string("player.gold"));
  CHECK_EQ(path_of("item.name", nullptr), std::string("item.name"));
}

TEST(bindings, the_innermost_alias_wins_so_nesting_shadows) {
  const ItemScope outer = scope("cat", "shop.cats.2", 2);
  const ItemScope inner = scope("item", "shop.cats.2.items.5", 5, &outer);
  const ItemScope *scopes = &inner;
  CHECK_EQ(path_of("item.name", scopes), std::string("shop.cats.2.items.5.name"));
  // A nested list can still reach the element OUTSIDE it, which is why the alias
  // is declared and not reserved.
  CHECK_EQ(path_of("cat.id", scopes), std::string("shop.cats.2.id"));
  // The alias alone is the element itself.
  CHECK_EQ(path_of("item", scopes), std::string("shop.cats.2.items.5"));
  // A path under no known alias stays absolute: a row still binds player data.
  CHECK_EQ(path_of("player.gold", scopes), std::string("player.gold"));
}

TEST(bindings, only_the_exact_index_leaf_is_reserved) {
  const ItemScope only = scope("item", "shop.items.3", 3);
  const ItemScope *scopes = &only;
  const ResolvedBind position = resolve_binding("item.$index", scopes);
  CHECK(position.kind == ResolvedBind::Kind::Index);
  CHECK_EQ(position.index, 3);
  // Anything deeper is an ordinary segment that will simply read no value.
  CHECK_EQ(path_of("item.a.$index", scopes), std::string("shop.items.3.a.$index"));
}

TEST(bindings, an_item_is_addressed_by_its_position_in_the_array) {
  CHECK_EQ(item_path("shop.items", 3), std::string("shop.items.3"));
}

TEST(bindings, only_a_string_or_a_finite_number_identifies_an_item) {
  DataValue row = DataValue::object();
  row.insert("id", DataValue::of_text("a"));
  row.insert("blank", DataValue::of_text(""));
  row.insert("n", DataValue::of_number(7));
  row.insert("nested", DataValue::object());

  CHECK(item_key(&row, "id").present);
  CHECK_EQ(item_key(&row, "id").text, std::string("a"));
  CHECK(item_key(&row, "n").is_number);
  // An empty string, an object and a field that is not there all mean "this
  // element has no key", and identity falls back to its position.
  CHECK(!item_key(&row, "blank").present);
  CHECK(!item_key(&row, "nested").present);
  CHECK(!item_key(&row, "missing").present);
  CHECK(!item_key(&row, "").present);
  CHECK(!item_key(nullptr, "id").present);
}

TEST(bindings, the_keyed_and_positional_identity_spaces_are_disjoint) {
  ItemKey key;
  key.present = true;
  key.text = "0";
  // Without the prefix, item `{id: "0"}` and the unkeyed element at position 0
  // would share an identity and inherit each other's state.
  CHECK_EQ(item_identity(key, 3), std::string("k:0"));
  CHECK_EQ(item_identity(ItemKey(), 0), std::string("0"));
  ItemKey numeric;
  numeric.present = true;
  numeric.is_number = true;
  numeric.number = 12;
  CHECK_EQ(item_identity(numeric, 0), std::string("k:12"));
}
