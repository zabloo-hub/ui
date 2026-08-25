// The shared TTF, embedded.
//
// Every zabloo target ships the SAME font and rasterizes it with the SAME
// algorithm (decision 2026-08-11, ZAB-15) — that is what makes a run measure the
// same width and a paragraph break in the same place on the web and in an
// engine. Here it is bytes in the binary rather than a file on disk, because the
// core has to lay text out with no engine and no asset pipeline around it, and
// because a font that arrives asynchronously would mean a first frame measured
// against something else.
//
// From G5 (ZAB-138) an envelope may carry its own TTF as an asset; this stays as
// the fallback, and as what the golden corpus measures against.

#pragma once

#include <cstdint>
#include <vector>

namespace zabloo {

/** Liberation Sans Regular, decoded on first use and kept for the process. */
const std::vector<uint8_t> &default_font_bytes();

}  // namespace zabloo
