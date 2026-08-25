#include <cstddef>
#include <string_view>

#include "color.h"

namespace zabloo {
namespace {

bool hex_digit(char c, int &out) {
  if (c >= '0' && c <= '9') {
    out = c - '0';
    return true;
  }
  if (c >= 'a' && c <= 'f') {
    out = c - 'a' + 10;
    return true;
  }
  if (c >= 'A' && c <= 'F') {
    out = c - 'A' + 10;
    return true;
  }
  return false;
}

}  // namespace

bool parse_color_literal(std::string_view text, Color &out) {
  // Trimmed like the reference does: an authored `" #fff "` is a color with
  // whitespace, not a different color.
  while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
  while (!text.empty() && (text.back() == ' ' || text.back() == '\t')) text.remove_suffix(1);
  if (text.size() != 7 && text.size() != 9) return false;
  if (text.front() != '#') return false;

  int channels[4] = {0, 0, 0, 255};
  const size_t count = (text.size() - 1) / 2;
  for (size_t i = 0; i < count; i++) {
    int high = 0;
    int low = 0;
    if (!hex_digit(text[1 + i * 2], high) || !hex_digit(text[2 + i * 2], low)) return false;
    channels[i] = high * 16 + low;
  }
  out.r = static_cast<float>(channels[0]) / 255.0f;
  out.g = static_cast<float>(channels[1]) / 255.0f;
  out.b = static_cast<float>(channels[2]) / 255.0f;
  out.a = static_cast<float>(channels[3]) / 255.0f;
  return true;
}

}  // namespace zabloo
