#include "json.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace zabloo {

JsonType JsonRef::type() const {
  return exists() ? doc_->nodes_[index_].type : JsonType::Null;
}

bool JsonRef::as_bool(bool fallback) const {
  if (!is_bool()) return fallback;
  return doc_->nodes_[index_].boolean;
}

double JsonRef::as_number(double fallback) const {
  if (!is_number()) return fallback;
  return doc_->nodes_[index_].number;
}

std::string_view JsonRef::as_string() const {
  if (!is_string()) return {};
  const JsonDoc::Node &node = doc_->nodes_[index_];
  return std::string_view(doc_->strings_).substr(node.begin, node.count);
}

uint32_t JsonRef::size() const {
  if (!exists()) return 0;
  const JsonDoc::Node &node = doc_->nodes_[index_];
  if (node.type != JsonType::Array && node.type != JsonType::Object) return 0;
  return node.count;
}

JsonRef JsonRef::at(uint32_t i) const {
  if (i >= size()) return {};
  const JsonDoc::Node &node = doc_->nodes_[index_];
  if (node.type == JsonType::Array) return JsonRef(doc_, doc_->elems_[node.begin + i]);
  return JsonRef(doc_, doc_->members_[node.begin + i].value);
}

std::string_view JsonRef::key_at(uint32_t i) const {
  if (!is_object() || i >= size()) return {};
  const JsonDoc::Member &member = doc_->members_[doc_->nodes_[index_].begin + i];
  return std::string_view(doc_->strings_).substr(member.key_begin, member.key_len);
}

JsonRef JsonRef::get(std::string_view key) const {
  const uint32_t n = is_object() ? size() : 0;
  for (uint32_t i = 0; i < n; i++) {
    if (key_at(i) == key) return at(i);
  }
  return {};
}

namespace {

bool is_ws(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

/** Writes `cp` as UTF-8. The only place the parser produces bytes of its own. */
void push_utf8(std::string &out, uint32_t cp) {
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
}

}  // namespace

/**
 * Recursive descent, with the recursion bounded by `MAX_NESTING` so the refusal
 * is a diagnostic rather than a crash. Every failure carries the byte offset:
 * "unexpected character at 1423" is the difference between a fixable export and
 * a shrug.
 */
class JsonParser {
 public:
  JsonParser(std::string_view text, JsonDoc &doc) : text_(text), doc_(doc) {}

  bool run(std::string &error) {
    skip_ws();
    uint32_t root = 0;
    if (!parse_value(0, root)) {
      error = std::move(error_);
      return false;
    }
    skip_ws();
    if (pos_ != text_.size()) {
      error = "unexpected trailing content at byte " + std::to_string(pos_);
      return false;
    }
    return true;
  }

 private:
  std::string_view text_;
  JsonDoc &doc_;
  size_t pos_ = 0;
  std::string error_;

  bool fail(const char *what) {
    error_ = std::string(what) + " at byte " + std::to_string(pos_);
    return false;
  }

  void skip_ws() {
    while (pos_ < text_.size() && is_ws(text_[pos_])) pos_++;
  }

  char peek() const { return pos_ < text_.size() ? text_[pos_] : '\0'; }

  bool literal(std::string_view word) {
    if (text_.compare(pos_, word.size(), word) != 0) return false;
    pos_ += word.size();
    return true;
  }

  uint32_t emit(JsonDoc::Node node) {
    doc_.nodes_.push_back(node);
    return static_cast<uint32_t>(doc_.nodes_.size() - 1);
  }

  bool parse_value(int depth, uint32_t &out) {
    if (depth >= JsonDoc::MAX_NESTING) {
      error_ = "nesting deeper than " + std::to_string(JsonDoc::MAX_NESTING) +
               " levels at byte " + std::to_string(pos_);
      return false;
    }
    if (pos_ >= text_.size()) return fail("unexpected end of input");
    switch (peek()) {
      case '{':
        return parse_object(depth, out);
      case '[':
        return parse_array(depth, out);
      case '"': {
        uint32_t begin = 0;
        uint32_t len = 0;
        if (!parse_string(begin, len)) return false;
        JsonDoc::Node node;
        node.type = JsonType::String;
        node.begin = begin;
        node.count = len;
        out = emit(node);
        return true;
      }
      case 't': {
        if (!literal("true")) return fail("unexpected character");
        JsonDoc::Node node;
        node.type = JsonType::Bool;
        node.boolean = true;
        out = emit(node);
        return true;
      }
      case 'f': {
        if (!literal("false")) return fail("unexpected character");
        JsonDoc::Node node;
        node.type = JsonType::Bool;
        node.boolean = false;
        out = emit(node);
        return true;
      }
      case 'n': {
        if (!literal("null")) return fail("unexpected character");
        out = emit(JsonDoc::Node{});
        return true;
      }
      default:
        return parse_number(out);
    }
  }

  bool parse_object(int depth, uint32_t &out) {
    pos_++;  // '{'
    // The node is emitted BEFORE its members so it keeps the lower index, but its
    // member span is only known at the end: children are staged in a local vector
    // and appended to the document's flat member list in one go.
    JsonDoc::Node node;
    node.type = JsonType::Object;
    const uint32_t self = emit(node);
    std::vector<JsonDoc::Member> members;
    skip_ws();
    if (peek() == '}') {
      pos_++;
    } else {
      while (true) {
        skip_ws();
        if (peek() != '"') return fail("expected a key");
        JsonDoc::Member member;
        if (!parse_string(member.key_begin, member.key_len)) return false;
        skip_ws();
        if (peek() != ':') return fail("expected ':'");
        pos_++;
        skip_ws();
        if (!parse_value(depth + 1, member.value)) return false;
        members.push_back(member);
        skip_ws();
        if (peek() == ',') {
          pos_++;
          continue;
        }
        if (peek() == '}') {
          pos_++;
          break;
        }
        return fail("expected ',' or '}'");
      }
    }
    doc_.nodes_[self].begin = static_cast<uint32_t>(doc_.members_.size());
    doc_.nodes_[self].count = static_cast<uint32_t>(members.size());
    doc_.members_.insert(doc_.members_.end(), members.begin(), members.end());
    out = self;
    return true;
  }

  bool parse_array(int depth, uint32_t &out) {
    pos_++;  // '['
    JsonDoc::Node node;
    node.type = JsonType::Array;
    const uint32_t self = emit(node);
    std::vector<uint32_t> elems;
    skip_ws();
    if (peek() == ']') {
      pos_++;
    } else {
      while (true) {
        skip_ws();
        uint32_t value = 0;
        if (!parse_value(depth + 1, value)) return false;
        elems.push_back(value);
        skip_ws();
        if (peek() == ',') {
          pos_++;
          continue;
        }
        if (peek() == ']') {
          pos_++;
          break;
        }
        return fail("expected ',' or ']'");
      }
    }
    doc_.nodes_[self].begin = static_cast<uint32_t>(doc_.elems_.size());
    doc_.nodes_[self].count = static_cast<uint32_t>(elems.size());
    doc_.elems_.insert(doc_.elems_.end(), elems.begin(), elems.end());
    out = self;
    return true;
  }

  bool parse_string(uint32_t &begin, uint32_t &len) {
    pos_++;  // '"'
    const size_t start = doc_.strings_.size();
    while (true) {
      if (pos_ >= text_.size()) return fail("unterminated string");
      const char c = text_[pos_];
      if (c == '"') {
        pos_++;
        break;
      }
      if (static_cast<unsigned char>(c) < 0x20) return fail("control character in a string");
      if (c != '\\') {
        doc_.strings_.push_back(c);
        pos_++;
        continue;
      }
      pos_++;
      if (pos_ >= text_.size()) return fail("unterminated escape");
      const char esc = text_[pos_++];
      switch (esc) {
        case '"': doc_.strings_.push_back('"'); break;
        case '\\': doc_.strings_.push_back('\\'); break;
        case '/': doc_.strings_.push_back('/'); break;
        case 'b': doc_.strings_.push_back('\b'); break;
        case 'f': doc_.strings_.push_back('\f'); break;
        case 'n': doc_.strings_.push_back('\n'); break;
        case 'r': doc_.strings_.push_back('\r'); break;
        case 't': doc_.strings_.push_back('\t'); break;
        case 'u': {
          uint32_t cp = 0;
          if (!parse_hex4(cp)) return false;
          // A lead surrogate only means something paired with its trail; an
          // unpaired one is written as U+FFFD rather than refused, because the
          // payload is still renderable and a mangled character is a smaller
          // loss than a screen that does not load.
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            if (pos_ + 1 < text_.size() && text_[pos_] == '\\' && text_[pos_ + 1] == 'u') {
              const size_t save = pos_;
              pos_ += 2;
              uint32_t low = 0;
              if (!parse_hex4(low)) return false;
              if (low >= 0xDC00 && low <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
              } else {
                pos_ = save;
                cp = 0xFFFD;
              }
            } else {
              cp = 0xFFFD;
            }
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            cp = 0xFFFD;
          }
          push_utf8(doc_.strings_, cp);
          break;
        }
        default:
          return fail("unknown escape");
      }
    }
    begin = static_cast<uint32_t>(start);
    len = static_cast<uint32_t>(doc_.strings_.size() - start);
    return true;
  }

  bool parse_hex4(uint32_t &out) {
    if (pos_ + 4 > text_.size()) return fail("truncated \\u escape");
    uint32_t value = 0;
    for (int i = 0; i < 4; i++) {
      const char c = text_[pos_ + i];
      value <<= 4;
      if (c >= '0' && c <= '9') {
        value |= static_cast<uint32_t>(c - '0');
      } else if (c >= 'a' && c <= 'f') {
        value |= static_cast<uint32_t>(c - 'a' + 10);
      } else if (c >= 'A' && c <= 'F') {
        value |= static_cast<uint32_t>(c - 'A' + 10);
      } else {
        return fail("bad \\u escape");
      }
    }
    pos_ += 4;
    out = value;
    return true;
  }

  bool parse_number(uint32_t &out) {
    const bool negative = peek() == '-';
    if (negative) pos_++;

    // Digits are accumulated by hand rather than handed to a library, and both
    // obvious libraries are the reason:
    //   * `std::from_chars` for `double` is marked unavailable below macOS 26 in
    //     Apple's libc++, so using it would cap the deployment target of every
    //     macOS build on a detail of number parsing.
    //   * `strtod` reads the decimal separator from the C locale. A game that
    //     sets a Spanish or German locale would parse `"0.5"` as 0, silently,
    //     and every metric downstream would be wrong in a way no test here
    //     would catch.
    // JSON's grammar is fixed and locale-free, so the conversion should be too.
    uint64_t mantissa = 0;
    int exponent = 0;
    int significant = 0;
    bool any_digit = false;

    // JSON forbids a leading zero, and so do we. Being lenient here would mean
    // accepting a payload the web renderer rejects, which is the one thing the
    // two targets must never do differently.
    const size_t int_start = pos_;
    while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
      any_digit = true;
      // Past 19 digits the mantissa would wrap; the extra digits only move the
      // decimal point, and they are already below the precision of a double.
      if (significant < 19) {
        mantissa = mantissa * 10 + static_cast<uint64_t>(text_[pos_] - '0');
        if (mantissa != 0) significant++;
      } else {
        exponent++;
      }
      pos_++;
    }
    if (!any_digit) return fail("expected a number");
    if (text_[int_start] == '0' && pos_ - int_start > 1) {
      pos_ = int_start;
      return fail("a number may not have leading zeros");
    }

    if (peek() == '.') {
      pos_++;
      const size_t frac_start = pos_;
      while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
        if (significant < 19) {
          mantissa = mantissa * 10 + static_cast<uint64_t>(text_[pos_] - '0');
          if (mantissa != 0) significant++;
          exponent--;
        }
        pos_++;
      }
      if (pos_ == frac_start) return fail("expected digits after '.'");
    }

    if (peek() == 'e' || peek() == 'E') {
      pos_++;
      bool negative_exp = false;
      if (peek() == '+' || peek() == '-') {
        negative_exp = text_[pos_] == '-';
        pos_++;
      }
      const size_t exp_start = pos_;
      int written = 0;
      while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') {
        // Clamped, not wrapped: anything past this is already infinity or zero.
        if (written < 9999) written = written * 10 + (text_[pos_] - '0');
        pos_++;
      }
      if (pos_ == exp_start) return fail("expected digits after the exponent");
      exponent += negative_exp ? -written : written;
    }

    JsonDoc::Node node;
    node.type = JsonType::Number;
    node.number = compose(mantissa, exponent, negative);
    out = emit(node);
    return true;
  }

  /**
   * Mantissa × 10^exponent, correctly rounded on the path that matters. Both
   * operands are exact doubles when the mantissa fits in 53 bits and the power
   * of ten is one of the 23 that are exactly representable, so a single multiply
   * or divide lands on the nearest double — which is every number an envelope
   * actually carries (`16`, `0.35`, `1.5`, `999`). Outside that, precision
   * degrades gracefully instead of the parse failing.
   */
  static double compose(uint64_t mantissa, int exponent, bool negative) {
    static const double POW10[] = {
        1e0,  1e1,  1e2,  1e3,  1e4,  1e5,  1e6,  1e7,  1e8,  1e9,  1e10, 1e11,
        1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
    };
    constexpr int EXACT = 22;
    constexpr uint64_t EXACT_MANTISSA = 1ULL << 53;

    double value = static_cast<double>(mantissa);
    if (mantissa < EXACT_MANTISSA && exponent >= -EXACT && exponent <= EXACT) {
      value = exponent >= 0 ? value * POW10[exponent] : value / POW10[-exponent];
    } else if (exponent != 0) {
      value *= std::pow(10.0, static_cast<double>(exponent));
    }
    return negative ? -value : value;
  }
};

JsonParse JsonDoc::parse(std::string_view text) {
  JsonParse result;
  JsonParser parser(text, result.doc);
  result.ok = parser.run(result.error);
  if (!result.ok) result.doc = JsonDoc();
  return result;
}

}  // namespace zabloo
