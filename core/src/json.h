// A JSON reader built for one job: feeding the envelope validator.
//
// The core parses the payload itself instead of asking the engine, because the
// golden rule cuts here too — `readEnvelope`'s policy (ZAB-37) has to produce the
// same diagnostics on a bare CPU as it does inside Godot, and a parser that lives
// in the engine could not be tested without one.
//
// Three properties the validator depends on, and why they are not the obvious
// choices:
//
// 1. **No exceptions.** A malformed payload is an ordinary answer here, not an
//    exceptional one: it becomes `invalid-json`, level fatal, and the loader keeps
//    whatever was already on screen. Parsing reports failure by return value.
// 2. **Insertion order is preserved** for object members. `views` is a map in the
//    envelope, and the order views load in has to be the order they were written
//    in, or two runs of the same file could disagree about which view is first.
// 3. **A depth cap that answers instead of crashing.** JSON nesting is unbounded
//    in the format and the stack is not, so the parser refuses past `MAX_NESTING`
//    — comfortably above what the IR's own 256-node depth limit can produce, so a
//    legal document never meets it.
//
// The layout is flat on purpose: nodes, array elements, object members and the
// decoded string bytes each live in one contiguous vector, addressed by index.
// Parsing a 15 MB envelope full of base64 assets allocates a handful of buffers
// rather than one object per value.

#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace zabloo {

enum class JsonType : uint8_t {
  Null,
  Bool,
  Number,
  String,
  Array,
  Object,
};

class JsonDoc;
struct JsonParse;

/**
 * A cursor into a parsed document — a (document, index) pair, cheap to copy.
 *
 * Every accessor is total: asking a number for its string, or an object for an
 * index it does not have, gives back a default or an absent ref rather than
 * failing. That is what lets the validator read a hostile payload as a straight
 * line of questions instead of a tree of guards.
 */
class JsonRef {
 public:
  JsonRef() = default;
  JsonRef(const JsonDoc *doc, uint32_t index) : doc_(doc), index_(index) {}

  /** False for a ref that names nothing — a missing key, an out-of-range index. */
  bool exists() const { return doc_ != nullptr; }
  JsonType type() const;

  bool is_null() const { return exists() && type() == JsonType::Null; }
  bool is_bool() const { return exists() && type() == JsonType::Bool; }
  bool is_number() const { return exists() && type() == JsonType::Number; }
  bool is_string() const { return exists() && type() == JsonType::String; }
  bool is_array() const { return exists() && type() == JsonType::Array; }
  bool is_object() const { return exists() && type() == JsonType::Object; }

  bool as_bool(bool fallback = false) const;
  double as_number(double fallback = 0.0) const;
  /** The decoded bytes, valid as long as the document is. Empty for a non-string. */
  std::string_view as_string() const;

  /** Elements of an array, or members of an object. Zero for anything else. */
  uint32_t size() const;
  /** Element `i` of an array, or the value of member `i` of an object. */
  JsonRef at(uint32_t i) const;
  /** The key of member `i`. Empty unless this is an object. */
  std::string_view key_at(uint32_t i) const;
  /** Value for `key`, or an absent ref. Linear: envelope objects are small. */
  JsonRef get(std::string_view key) const;
  bool has(std::string_view key) const { return get(key).exists(); }

 private:
  const JsonDoc *doc_ = nullptr;
  uint32_t index_ = 0;
};

class JsonDoc {
  friend class JsonRef;

 public:
  /**
   * How deep the parser will follow nesting before refusing. The IR's own limit
   * is 256 NODES (`MAX_DEPTH` in validate.h), and one node level costs three JSON
   * levels (object → "children" array → object), so a document the validator
   * could accept tops out around 780. The margin above that is for the props
   * hanging off each node; past it, a payload is a stack overflow looking for a
   * place to happen and gets `invalid-json` instead.
   */
  static constexpr int MAX_NESTING = 1024;

  static JsonParse parse(std::string_view text);

  JsonRef root() const { return nodes_.empty() ? JsonRef() : JsonRef(this, 0); }

 private:
  struct Node {
    JsonType type = JsonType::Null;
    bool boolean = false;
    double number = 0.0;
    // Strings: offset into `strings_`. Arrays: into `elems_`. Objects: `members_`.
    uint32_t begin = 0;
    // Strings: byte length. Arrays and objects: how many children.
    uint32_t count = 0;
  };

  struct Member {
    uint32_t key_begin = 0;
    uint32_t key_len = 0;
    uint32_t value = 0;
  };

  std::vector<Node> nodes_;
  std::vector<uint32_t> elems_;
  std::vector<Member> members_;
  std::string strings_;

  friend class JsonParser;
};

/** What `JsonDoc::parse` gives back. Outside the class: it holds one by value. */
struct JsonParse {
  JsonDoc doc;
  bool ok = false;
  /** Legible and self-contained; it becomes the `invalid-json` message. */
  std::string error;
};

}  // namespace zabloo
