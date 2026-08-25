// UTF-8, walked by code point.
//
// The reference iterates strings with `for (const char of text)` and slices them
// with `Array.from(text)`, both of which are code points — so a wrap that walked
// BYTES would break "marrón" between the two halves of an `ó` and measure a run
// that no font has. Everything the text pass indexes is a code point, and
// everything it stores is UTF-8 (what the IR carries and what the snapshot
// writes back out).
//
// Code points, not grapheme clusters: a combining mark or an emoji sequence is
// several of them here. That is the same unit ZAB-26 chose for the caret, and it
// costs a segmentation table to change — deferred with the shaping.

#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace zabloo {

/** What an ill-formed byte decodes to — U+FFFD, as every decoder answers. */
inline constexpr char32_t REPLACEMENT = 0xfffd;

/**
 * The code point at `index`, with `index` advanced past it.
 *
 * Malformed input never stalls the walk: a bad byte yields U+FFFD and consumes
 * exactly one byte, so a loop over any string terminates.
 */
char32_t utf8_next(std::string_view text, size_t &index);

/** Appends one code point. */
void utf8_append(std::string &out, char32_t code_point);

/** The whole string, decoded — the port of `Array.from(text)`. */
std::vector<char32_t> utf8_decode(std::string_view text);

/** `[from, to)` of a decoded string, back as UTF-8 — the port of `slice().join("")`. */
std::string utf8_encode(const std::vector<char32_t> &code_points, size_t from, size_t to);

}  // namespace zabloo
