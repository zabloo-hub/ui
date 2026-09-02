// Binding resolution inside templates — the normative helpers of
// `@zabloo/format`, ported verbatim.
//
// They live apart from `data.h` because of what they ARE: `data.h` is this
// target's store, while these four functions are part of the format itself. All
// three targets must compute the SAME path and the SAME identity from the same
// input, or the same envelope with the same `SetData` stops producing the same
// screen — which is the criterion the corpus enforces. The same role
// `ease_progress` plays for motion.
//
// Outside a template a node has no scope at all and `resolve_binding` hands
// paths straight through, which is exactly what it is supposed to do there.

#pragma once

#include <cstdint>
#include <string>
#include <string_view>

#include "data.h"

namespace zabloo {

/**
 * One item scope open while a template is instantiated — a chain of these grows
 * one link per enclosing `Repeat`, innermost first.
 *
 * A CHAIN and not a stack copied per instance, because a scope is shared: when a
 * `SetData` reorders a list, pointing one row at another element has to be one
 * mutation that its whole subtree sees, nested lists included. A nested instance
 * holding its own copy of the outer scope would keep reading the row the outer
 * one used to be — which is precisely the case ZAB-29 went out of its way to make
 * reachable, a product row binding its category's alias.
 *
 * The links are owned by the instance root each one was opened for, so a chain
 * outlives every node that points into it and dies when its row does.
 */
struct ItemScope {
  /** The enclosing Repeat's `as` (default `"item"`). */
  std::string alias;
  /** Absolute data path of this element, e.g. `"shop.items.3"`. */
  std::string path;
  /** Position in the array — what `"<alias>.$index"` resolves to. */
  int index = 0;
  /** The scope this one is nested in, or null at the outermost `Repeat`. */
  const ItemScope *outer = nullptr;
};

/**
 * What a binding points at: an absolute data path, or the element's position,
 * which is a number the data does not contain.
 */
struct ResolvedBind {
  enum class Kind : uint8_t { Path, Index };

  Kind kind = Kind::Path;
  std::string path;
  int index = 0;
};

/**
 * Innermost scope wins, so nesting shadows. A path under no known alias is
 * absolute and passes through untouched, which is how an item row still binds
 * `player.gold`. Only the exact leaf `"<alias>.$index"` is reserved; anything
 * deeper (`"item.a.$index"`) is an ordinary segment that will simply read no
 * value.
 */
ResolvedBind resolve_binding(std::string_view bind, const ItemScope *innermost);

/** Absolute path of element `index` of the array at `array_path`. */
std::string item_path(std::string_view array_path, int index);

/**
 * The item's raw key — the one that travels to the game in the action context.
 * Only a non-empty string or a finite number identifies an item; anything else
 * means "this element has no key" and identity falls back to its position.
 */
struct ItemKey {
  bool present = false;
  bool is_number = false;
  double number = 0.0;
  std::string text;
};

/** The key at `key_path` inside `item`, or an absent one. */
ItemKey item_key(const DataValue *item, std::string_view key_path);

/**
 * Reconciliation identity: what an SDK keys per-item state by across a `SetData`
 * that reorders, inserts or removes elements.
 *
 * Keyed identities are PREFIXED so the two spaces stay disjoint — without it, a
 * list where only some elements resolve a key would let item `{id: "0"}` collide
 * with the unkeyed element at position 0 and inherit its state.
 */
std::string item_identity(const ItemKey &key, int index);

}  // namespace zabloo
