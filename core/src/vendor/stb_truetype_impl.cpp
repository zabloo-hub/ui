// The one translation unit that compiles stb_truetype's implementation.
//
// It is alone in here for two reasons. The implementation is ~5000 lines that
// only ever need building once, and it is not our code: both SConstructs compile
// this file with the project's warnings turned OFF, because `-Werror` over a
// vendored public-domain header is a rule that can only ever be satisfied by
// editing someone else's file.
//
// They also compile it with `-fvisibility=hidden`. The extension is a shared
// library loaded into a process that may already have its own copy of stb — an
// engine's fallback text server — and two copies of `stbtt_InitFont` resolving
// to one another is exactly the kind of divergence core-owned rasterization
// (ZAB-15) exists to prevent. Nothing outside the core ever calls these.
//
// `STBTT_STATIC` is deliberately NOT set, unlike in
// `packages/renderer-web/native/stbtt.c`: that build is a single TU, this one is
// a library, so the symbols have to reach `ttf.cpp`. The rest of the
// configuration matches it exactly — same algorithm, same options, same bitmaps.
// No stdio (a font arrives as bytes, never as a path) and no assert (an abort
// inside the rasterizer helps nobody at runtime; `ttf.cpp` checks what it can
// before calling in).

#define STBTT_NO_STDIO
#define STBTT_assert(x) ((void)0)
#define STB_TRUETYPE_IMPLEMENTATION
#include "stb_truetype.h"
