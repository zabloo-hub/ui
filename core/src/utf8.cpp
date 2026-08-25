#include "utf8.h"

#include <cstdint>

namespace zabloo {
namespace {

bool is_continuation(unsigned char byte) { return (byte & 0xc0) == 0x80; }

}  // namespace

char32_t utf8_next(std::string_view text, size_t &index) {
  if (index >= text.size()) return 0;
  const unsigned char lead = static_cast<unsigned char>(text[index]);
  index++;
  if (lead < 0x80) return lead;

  // How many continuation bytes the lead promises, and the bits it contributes.
  int extra = 0;
  char32_t code_point = 0;
  if ((lead & 0xe0) == 0xc0) {
    extra = 1;
    code_point = lead & 0x1f;
  } else if ((lead & 0xf0) == 0xe0) {
    extra = 2;
    code_point = lead & 0x0f;
  } else if ((lead & 0xf8) == 0xf0) {
    extra = 3;
    code_point = lead & 0x07;
  } else {
    return REPLACEMENT;  // a continuation byte on its own, or an invalid lead
  }

  for (int i = 0; i < extra; i++) {
    if (index >= text.size() || !is_continuation(static_cast<unsigned char>(text[index]))) {
      // A truncated sequence consumes only its lead: the bytes that follow are
      // decoded on their own turn, so no walk can lose its place.
      return REPLACEMENT;
    }
    code_point = (code_point << 6) | (static_cast<unsigned char>(text[index]) & 0x3f);
    index++;
  }
  // Surrogates and anything past the last plane are not code points; an
  // over-long encoding is a different byte sequence for one that is.
  if (code_point > 0x10ffff || (code_point >= 0xd800 && code_point <= 0xdfff)) return REPLACEMENT;
  return code_point;
}

void utf8_append(std::string &out, char32_t code_point) {
  if (code_point > 0x10ffff || (code_point >= 0xd800 && code_point <= 0xdfff)) {
    code_point = REPLACEMENT;
  }
  if (code_point < 0x80) {
    out += static_cast<char>(code_point);
  } else if (code_point < 0x800) {
    out += static_cast<char>(0xc0 | (code_point >> 6));
    out += static_cast<char>(0x80 | (code_point & 0x3f));
  } else if (code_point < 0x10000) {
    out += static_cast<char>(0xe0 | (code_point >> 12));
    out += static_cast<char>(0x80 | ((code_point >> 6) & 0x3f));
    out += static_cast<char>(0x80 | (code_point & 0x3f));
  } else {
    out += static_cast<char>(0xf0 | (code_point >> 18));
    out += static_cast<char>(0x80 | ((code_point >> 12) & 0x3f));
    out += static_cast<char>(0x80 | ((code_point >> 6) & 0x3f));
    out += static_cast<char>(0x80 | (code_point & 0x3f));
  }
}

std::vector<char32_t> utf8_decode(std::string_view text) {
  std::vector<char32_t> out;
  out.reserve(text.size());
  size_t index = 0;
  while (index < text.size()) out.push_back(utf8_next(text, index));
  return out;
}

std::string utf8_encode(const std::vector<char32_t> &code_points, size_t from, size_t to) {
  std::string out;
  if (to > code_points.size()) to = code_points.size();
  for (size_t i = from; i < to; i++) utf8_append(out, code_points[i]);
  return out;
}

}  // namespace zabloo
