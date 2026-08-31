#include "data.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace zabloo {
namespace {

/**
 * Mantissa × 10^exponent, correctly rounded on the path that matters — the same
 * composition `json.cpp` uses, and for the same reason: both operands are exact
 * doubles while the mantissa fits in 53 bits and the power of ten is one of the
 * 22 that are exactly representable, so a single multiply lands on the nearest
 * double.
 */
double compose(uint64_t mantissa, int exponent, bool negative) {
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

/**
 * The significant digits of `value` at `precision`, and the decimal exponent `n`
 * of `0.D1D2… × 10^n`.
 *
 * `snprintf("%.*e")` is the only formatter available here, and it writes the
 * decimal separator of the C LOCALE. That is fine as long as nobody reads it as
 * a character: the digits are picked out by class, and the one non-digit inside
 * the mantissa — whatever a Turkish or German locale calls it — is skipped.
 */
void significant_digits(double value, int precision, std::string &digits, int &n) {
  char buffer[64];
  std::snprintf(buffer, sizeof(buffer), "%.*e", precision - 1, value);
  digits.clear();
  const char *cursor = buffer;
  if (*cursor == '-' || *cursor == '+') cursor++;
  for (; *cursor != '\0' && *cursor != 'e' && *cursor != 'E'; cursor++) {
    if (*cursor >= '0' && *cursor <= '9') digits += *cursor;
  }
  int exponent = 0;
  bool negative_exponent = false;
  if (*cursor == 'e' || *cursor == 'E') {
    cursor++;
    if (*cursor == '+' || *cursor == '-') negative_exponent = *cursor++ == '-';
    for (; *cursor >= '0' && *cursor <= '9'; cursor++) exponent = exponent * 10 + (*cursor - '0');
  }
  if (negative_exponent) exponent = -exponent;
  // `%e` writes `d.ddd × 10^exponent`; the spec's `n` is for `0.dddd × 10^n`.
  n = exponent + 1;
}

/** Trailing zeros carry no information for the spec's formatting rules. */
void trim_zeros(std::string &digits) {
  while (digits.size() > 1 && digits.back() == '0') digits.pop_back();
}

double from_digits(const std::string &digits, int n) {
  uint64_t mantissa = 0;
  for (const char digit : digits) mantissa = mantissa * 10 + static_cast<uint64_t>(digit - '0');
  return compose(mantissa, n - static_cast<int>(digits.size()), false);
}

}  // namespace

// --- values ---------------------------------------------------------------

DataValue DataValue::of_bool(bool value) {
  DataValue out;
  out.kind = Kind::Bool;
  out.boolean = value;
  return out;
}

DataValue DataValue::of_number(double value) {
  DataValue out;
  out.kind = Kind::Number;
  out.number = value;
  return out;
}

DataValue DataValue::of_text(std::string value) {
  DataValue out;
  out.kind = Kind::Text;
  out.text = std::move(value);
  return out;
}

DataValue DataValue::array() {
  DataValue out;
  out.kind = Kind::Array;
  return out;
}

DataValue DataValue::object() {
  DataValue out;
  out.kind = Kind::Object;
  return out;
}

void DataValue::push(DataValue value) { items.push_back(std::move(value)); }

void DataValue::insert(std::string key, DataValue value) {
  keys.push_back(std::move(key));
  items.push_back(std::move(value));
}

const DataValue *DataValue::member(std::string_view key) const {
  for (size_t i = 0; i < keys.size() && i < items.size(); i++) {
    if (keys[i] == key) return &items[i];
  }
  return nullptr;
}

// --- paths ----------------------------------------------------------------

namespace {

/** True for a segment that is nothing but digits — the only thing that indexes. */
bool is_index(std::string_view segment) {
  if (segment.empty()) return false;
  for (const char c : segment) {
    if (c < '0' || c > '9') return false;
  }
  return true;
}

/** An all-digit segment as a position. False when it is longer than any array. */
bool to_index(std::string_view segment, size_t &out) {
  out = 0;
  for (const char c : segment) {
    if (out > (static_cast<size_t>(-1) - 9) / 10) return false;
    out = out * 10 + static_cast<size_t>(c - '0');
  }
  return true;
}

/** The dotted ancestors of a key, longest first: `a.b.c` → `a.b`, `a`. */
std::vector<std::string_view> ancestors_of(std::string_view key) {
  std::vector<std::string_view> out;
  for (size_t i = key.size(); i > 0; i--) {
    // A leading dot never yields the empty prefix.
    if (key[i - 1] == '.' && i - 1 > 0) out.push_back(key.substr(0, i - 1));
  }
  return out;
}

}  // namespace

const DataValue *read_path(const DataValue &root, std::string_view path) {
  if (path.empty()) return nullptr;
  const DataValue *current = &root;
  size_t start = 0;
  while (start <= path.size()) {
    const size_t dot = path.find('.', start);
    const std::string_view segment =
        path.substr(start, dot == std::string_view::npos ? std::string_view::npos : dot - start);
    if (segment.empty() || current == nullptr) return nullptr;
    if (current->kind == DataValue::Kind::Array) {
      size_t index = 0;
      if (!is_index(segment) || !to_index(segment, index)) return nullptr;
      current = index < current->items.size() ? &current->items[index] : nullptr;
    } else if (current->kind == DataValue::Kind::Object) {
      current = current->member(segment);
    } else {
      // A scalar has nothing under it, and neither has `null`.
      return nullptr;
    }
    if (dot == std::string_view::npos) break;
    start = dot + 1;
  }
  return current;
}

// --- store ----------------------------------------------------------------

void DataStore::set(std::string_view path, DataValue value) {
  const std::string key(path);
  const auto under = descendants_.find(key);
  if (under != descendants_.end()) {
    // Copied: `forget` edits the very set being walked.
    const std::vector<std::string> dropped(under->second.begin(), under->second.end());
    for (const std::string &descendant : dropped) forget(descendant);
    descendants_.erase(key);
  }
  if (values_.find(key) == values_.end()) index(key);
  values_[key] = std::move(value);
}

void DataStore::index(const std::string &key) {
  for (const std::string_view ancestor : ancestors_of(key)) {
    descendants_[std::string(ancestor)].insert(key);
  }
}

void DataStore::forget(const std::string &key) {
  values_.erase(key);
  descendants_.erase(key);
  for (const std::string_view ancestor : ancestors_of(key)) {
    const auto found = descendants_.find(std::string(ancestor));
    if (found == descendants_.end()) continue;
    found->second.erase(key);
    if (found->second.empty()) descendants_.erase(found);
  }
}

const DataValue *DataStore::get(std::string_view path) const {
  if (path.empty()) return nullptr;
  // Longest written prefix first: `a.b.c`, then `a.b`, then `a`.
  const auto exact = values_.find(std::string(path));
  if (exact != values_.end()) return &exact->second;
  for (const std::string_view head : ancestors_of(path)) {
    const auto found = values_.find(std::string(head));
    if (found == values_.end()) continue;
    return read_path(found->second, path.substr(head.size() + 1));
  }
  return nullptr;
}

void DataStore::clear() {
  values_.clear();
  descendants_.clear();
}

bool affects(std::string_view written, std::string_view bound) {
  if (written == bound) return true;
  if (bound.size() > written.size()) {
    return bound.compare(0, written.size(), written) == 0 && bound[written.size()] == '.';
  }
  if (written.size() > bound.size()) {
    return written.compare(0, bound.size(), bound) == 0 && written[bound.size()] == '.';
  }
  return false;
}

// --- readers --------------------------------------------------------------

bool is_truthy(const DataValue *value) {
  if (value == nullptr) return false;
  switch (value->kind) {
    case DataValue::Kind::Null: return false;
    case DataValue::Kind::Bool: return value->boolean;
    // `NaN` is falsy in JavaScript, and a comparison with itself is how you ask.
    case DataValue::Kind::Number: return value->number != 0.0 && value->number == value->number;
    case DataValue::Kind::Text: return !value->text.empty();
    // An array or an object is an object, and every object is truthy — the empty
    // ones included, which is where this parts ways with a "is there anything in
    // it" reading.
    case DataValue::Kind::Array:
    case DataValue::Kind::Object: return true;
  }
  return false;
}

double to_number(const DataValue *value, double fallback) {
  if (value == nullptr) return fallback;
  if (value->kind == DataValue::Kind::Number) {
    return std::isfinite(value->number) ? value->number : fallback;
  }
  // Numeric strings are accepted for the same reason selection tolerates them:
  // the game may have pushed a value that crossed a text field or a JSON payload,
  // and a control bound to live data must not hinge on which side did the parsing.
  double parsed = 0.0;
  if (value->kind == DataValue::Kind::Text && text_to_number(value->text, parsed) &&
      std::isfinite(parsed)) {
    return parsed;
  }
  return fallback;
}

std::string format_value(const DataValue *value) {
  if (value == nullptr) return std::string();
  switch (value->kind) {
    case DataValue::Kind::Null: return std::string();
    case DataValue::Kind::Bool: return value->boolean ? "true" : "false";
    case DataValue::Kind::Text: return value->text;
    case DataValue::Kind::Number: {
      // A whole number prints its digits; anything else is rounded to two
      // decimals with the trailing zeros trimmed, so a bound float does not
      // paint seventeen digits of binary noise.
      if (std::isfinite(value->number) &&
          value->number == std::floor(value->number)) {
        return number_to_text(value->number);
      }
      if (!std::isfinite(value->number)) return number_to_text(value->number);
      char buffer[64];
      std::snprintf(buffer, sizeof(buffer), "%.2f", value->number);
      std::string out;
      for (const char *cursor = buffer; *cursor != '\0'; cursor++) {
        // The locale's separator again: whatever it calls it, it is the point.
        out += (*cursor >= '0' && *cursor <= '9') || *cursor == '-' ? *cursor : '.';
      }
      while (!out.empty() && out.back() == '0') out.pop_back();
      if (!out.empty() && out.back() == '.') out.pop_back();
      return out;
    }
    // `String([1, 2])` is `"1,2"` and `String({})` is `"[object Object]"`. Not
    // useful output, but a bound `Text` pointed at the wrong path has to paint
    // what the reference paints — the corpus compares the glyphs.
    case DataValue::Kind::Array: {
      std::string out;
      for (size_t i = 0; i < value->items.size(); i++) {
        if (i > 0) out += ",";
        const DataValue &item = value->items[i];
        // Nested arrays flatten and objects stringify, as `Array#toString` does.
        out += item.kind == DataValue::Kind::Object ? "[object Object]" : format_value(&item);
      }
      return out;
    }
    case DataValue::Kind::Object: return "[object Object]";
  }
  return std::string();
}

// --- numbers, locale-free -------------------------------------------------

std::string number_to_text(double value) {
  if (std::isnan(value)) return "NaN";
  if (std::isinf(value)) return value > 0 ? "Infinity" : "-Infinity";
  // `-0` prints as `0`, as `String(-0)` does.
  if (value == 0.0) return "0";
  if (value < 0) return "-" + number_to_text(-value);

  // The shortest representation that reads back as the same double — which is
  // what ECMA-262 asks for, and what makes `String(0.1)` be `"0.1"` and not
  // `"0.10000000000000001"`.
  std::string digits;
  int n = 0;
  for (int precision = 1; precision <= 17; precision++) {
    significant_digits(value, precision, digits, n);
    trim_zeros(digits);
    if (from_digits(digits, n) == value) break;
  }

  const int k = static_cast<int>(digits.size());
  if (k <= n && n <= 21) return digits + std::string(static_cast<size_t>(n - k), '0');
  if (0 < n && n <= 21) return digits.substr(0, static_cast<size_t>(n)) + "." + digits.substr(static_cast<size_t>(n));
  if (-6 < n && n <= 0) return "0." + std::string(static_cast<size_t>(-n), '0') + digits;

  // Exponential form, with the exponent written as `e+21` / `e-7`.
  std::string out(1, digits[0]);
  if (k > 1) out += "." + digits.substr(1);
  const int exponent = n - 1;
  out += "e";
  out += exponent < 0 ? "-" : "+";
  out += std::to_string(exponent < 0 ? -exponent : exponent);
  return out;
}

bool text_to_number(std::string_view text, double &out) {
  const auto is_space = [](char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
  };
  size_t begin = 0;
  size_t end = text.size();
  while (begin < end && is_space(text[begin])) begin++;
  while (end > begin && is_space(text[end - 1])) end--;
  const std::string_view body = text.substr(begin, end - begin);
  if (body.empty()) return false;

  size_t i = 0;
  bool negative = false;
  if (body[i] == '+' || body[i] == '-') negative = body[i++] == '-';

  uint64_t mantissa = 0;
  int exponent = 0;
  int significant = 0;
  bool any_digit = false;
  const auto take_digits = [&](bool fractional) {
    while (i < body.size() && body[i] >= '0' && body[i] <= '9') {
      any_digit = true;
      // Past 19 digits the mantissa would wrap; the rest only moves the point,
      // and it is already below the precision of a double.
      if (significant < 19) {
        mantissa = mantissa * 10 + static_cast<uint64_t>(body[i] - '0');
        if (mantissa != 0) significant++;
        if (fractional) exponent--;
      } else if (!fractional) {
        exponent++;
      }
      i++;
    }
  };
  // Leading zeros are fine here, unlike in JSON: this is a value a game pushed,
  // not a document being validated.
  take_digits(false);
  if (i < body.size() && body[i] == '.') {
    i++;
    take_digits(true);
  }
  if (!any_digit) return false;

  if (i < body.size() && (body[i] == 'e' || body[i] == 'E')) {
    i++;
    bool negative_exponent = false;
    if (i < body.size() && (body[i] == '+' || body[i] == '-')) {
      negative_exponent = body[i++] == '-';
    }
    const size_t exponent_start = i;
    int written = 0;
    while (i < body.size() && body[i] >= '0' && body[i] <= '9') {
      if (written < 9999) written = written * 10 + (body[i] - '0');
      i++;
    }
    if (i == exponent_start) return false;
    exponent += negative_exponent ? -written : written;
  }
  // Anything left over is not a number: `Number("1px")` is `NaN`.
  if (i != body.size()) return false;

  out = compose(mantissa, exponent, negative);
  return true;
}

}  // namespace zabloo
