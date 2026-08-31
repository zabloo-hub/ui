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
// The asset manifest is generic by MIME and would carry a `font/ttf` without a
// format change (2026-08-11, ZAB-10), but NOTHING loads one: `zabloo export`
// does not accept `.ttf` and the web renderer embeds this same font too. A
// custom font is a capability for both targets at once or for neither — one that
// only Godot had would answer the same envelope with different metrics, which is
// the whole thing the shared rasterizer exists to prevent.

#pragma once

#include <cstdint>
#include <vector>

namespace zabloo {

/** Liberation Sans Regular, decoded on first use and kept for the process. */
const std::vector<uint8_t> &default_font_bytes();

}  // namespace zabloo
