// The data channel's half that lives in the core: what the game pushed, and how
// a bound prop reads it.
//
// A port of `renderer-web/src/data.ts` plus the readers that sit around it in
// `view.ts` (`isTruthy`, `formatValue`, `toNumber`). It is a port and not a
// re-design because the corpus compares the two targets to the byte: if the same
// `SetData` produced a different string here, every metric downstream of a bound
// `Text` would move.
//
// Two properties are the whole reason this is a module of its own:
//
// 1. **A path is an ADDRESS, not a key** (decision 2026-08-11, ZAB-29). Until
//    F6 a bound path WAS the key the game wrote under; now a template resolves
//    `{bind: "item.name"}` into `"shop.items.3.name"`, which nobody will ever
//    write under its own name. So a read walks down from the longest prefix that
//    was actually written, and `read_path` finishes the job.
// 2. **Nothing is locale-dependent.** Numbers arrive from the game and leave as
//    glyphs, and `printf`/`strtod` read the decimal separator from the C locale
//    — a game running under a Spanish locale would draw `0,5` where the corpus
//    recorded `0.5`, silently. `number_to_text` and `text_to_number` do the
//    conversion by hand for the same reason `json.cpp` and `snapshot.cpp` do.

#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace zabloo {

/**
 * A value the game pushed down the data channel: whatever JSON can hold.
 *
 * It has to carry arrays and objects, not just scalars, because a path addresses
 * INTO what was written — `shop.items.1.name` is one push of `"shop.items"` and
 * two segments of walking. The runtime never mutates one; a control writing its
 * own value writes a DEEPER path instead, which is what keeps the game's own
 * object the game's (see `DataStore`).
 */
struct DataValue {
  enum class Kind : uint8_t { Null, Bool, Number, Text, Array, Object };

  Kind kind = Kind::Null;
  bool boolean = false;
  double number = 0.0;
  std::string text;
  /** Array elements, or an object's member VALUES in insertion order. */
  std::vector<DataValue> items;
  /**
   * Member names, parallel to `items`, and empty for every other kind.
   *
   * Two vectors rather than a vector of pairs: a `std::pair<std::string,
   * DataValue>` would need `DataValue` complete inside its own definition, which
   * it is not. `std::vector<DataValue>` of an incomplete type is the one shape
   * the standard guarantees here.
   */
  std::vector<std::string> keys;

  static DataValue of_bool(bool value);
  static DataValue of_number(double value);
  static DataValue of_text(std::string value);
  static DataValue array();
  static DataValue object();

  /** Appends to an array. */
  void push(DataValue value);
  /** Appends to an object, keeping insertion order. */
  void insert(std::string key, DataValue value);

  /** The member named `key`, or null. Linear: pushed objects are small. */
  const DataValue *member(std::string_view key) const;
};

/**
 * Reads a dot-separated path out of a value. Normative: a numeric segment
 * indexes an array (nothing else does — `"length"` is not a field), and anything
 * missing, or walked through a scalar, gives null rather than failing. Bound UI
 * degrades to "no value"; it never breaks the frame.
 */
const DataValue *read_path(const DataValue &root, std::string_view path);

/**
 * The store: what the game pushed, addressed by path.
 *
 * **A deeper write shadows the value it was made into.** A Toggle inside a row
 * writes `"shop.items.3.enabled"`, and the array under `"shop.items"` is the
 * game's own object — the core does not mutate it. Reading the deep path finds
 * the deep key first, so the control keeps the value it wrote; reading the whole
 * array still gives the game's data. That is the honest split: the write already
 * travelled out through `data_changed`, and the game owns the truth. Which is
 * also why writing a path DROPS everything under it — a fresh array arriving on
 * `"shop.items"` must not keep the old row 3 alive underneath.
 */
class DataStore {
 public:
  void set(std::string_view path, DataValue value);
  /** The value at `path`, or null for one nothing was ever written under. */
  const DataValue *get(std::string_view path) const;
  void clear();

 private:
  std::unordered_map<std::string, DataValue> values_;
  /**
   * Keys written UNDER each ancestor path — the index that makes dropping
   * descendants a lookup instead of a scan (ZAB-73). Without it every write
   * walked every key in the store, so a game pushing a value per frame paid for
   * the whole store on each push.
   */
  std::unordered_map<std::string, std::unordered_set<std::string>> descendants_;

  void index(const std::string &key);
  void forget(const std::string &key);
};

/**
 * Whether writing `written` changes what a binding on `bound` reads. Both
 * directions count: a new `"shop.items"` moves every `"shop.items.3.name"` in the
 * tree, and a write to `"shop.items.3.enabled"` moves a binding watching the
 * whole array. Unrelated siblings (`"shop.itemsCount"`) never match — the
 * separator is part of the comparison.
 */
bool affects(std::string_view written, std::string_view bound);

/** JavaScript truthiness, because that is what the reference implementation is. */
bool is_truthy(const DataValue *value);

/** A number off the data channel, accepting the numeric strings a channel blurs. */
double to_number(const DataValue *value, double fallback);

/** What a bound `Text` paints. Absent data is the empty string (2026-08-03). */
std::string format_value(const DataValue *value);

/**
 * `String(number)` as ECMA-262 defines it: the shortest decimal that reads back
 * as the same double. Locale-free, and public because it is what makes a number
 * pushed by the game land on the same glyphs in both targets.
 */
std::string number_to_text(double value);

/** `Number(text)` for the numeric grammar. False for anything else, NaN included. */
bool text_to_number(std::string_view text, double &out);

}  // namespace zabloo
