/*
 * zabloo's WASM surface over stb_truetype — the web form of the core-owned
 * rasterizer decided in ZAB-15: every target runs the SAME algorithm (stb) over
 * the SAME TTF, so metrics and bitmaps converge instead of drifting per engine.
 *
 * Deliberately thin: no atlas, no packing, no caching. Those already live in
 * TypeScript (`glyphs.ts`) and are shared with Unity's port in shape. All this
 * layer does is expose stb's glyph queries and its rasterizer.
 *
 * Calling convention: everything is scalars and pointers into the module's
 * linear memory. Multi-value results are written into an `int*` the caller
 * allocated (`out[]`), which the TS side reads through a DataView.
 *
 * Units: everything stb returns "unscaled" is in font design units. We keep it
 * that way and let the caller apply the scale, so rounding happens in exactly
 * one place across targets.
 *
 * Build: see build.sh (emscripten, standalone WASM).
 */

#include <emscripten.h>
#include <stdlib.h>

/* No stdio (we never load from a file) and no assert: both drag in libc weight
   we do not need, and an abort inside the rasterizer is useless in a browser. */
#define STBTT_STATIC
#define STBTT_NO_STDIO
#define STBTT_assert(x) ((void)0)
#define STB_TRUETYPE_IMPLEMENTATION
#include "vendor/stb_truetype.h"

/* The font handle the TS side holds: the stb info struct plus the bytes it
   points into. stb does not copy the file, so the buffer must outlive it. */
typedef struct {
  stbtt_fontinfo info;
  unsigned char *data;
} zb_font;

EMSCRIPTEN_KEEPALIVE void *zb_malloc(int size) { return malloc((size_t)size); }

EMSCRIPTEN_KEEPALIVE void zb_free(void *ptr) { free(ptr); }

/*
 * Takes ownership of `data` (a buffer the caller allocated with `zb_malloc` and
 * filled with the TTF): freed by `zb_font_free`. Returns 0 if stb cannot parse
 * the font, in which case the caller still owns the buffer.
 */
EMSCRIPTEN_KEEPALIVE zb_font *zb_font_new(unsigned char *data, int len) {
  int offset = stbtt_GetFontOffsetForIndex(data, 0);
  if (offset < 0) return 0;
  zb_font *font = (zb_font *)malloc(sizeof(zb_font));
  if (!font) return 0;
  if (!stbtt_InitFont(&font->info, data, offset)) {
    free(font);
    return 0;
  }
  font->data = data;
  (void)len;
  return font;
}

EMSCRIPTEN_KEEPALIVE void zb_font_free(zb_font *font) {
  if (!font) return;
  free(font->data);
  free(font);
}

/*
 * Design units → pixels for a given em size. `ScaleForMappingEmToPixels` (not
 * `ScaleForPixelHeight`) is what CSS `font-size` and Unity's point size both
 * mean: the em square maps to N px.
 */
EMSCRIPTEN_KEEPALIVE float zb_scale_for_em(zb_font *font, float pixels) {
  return stbtt_ScaleForMappingEmToPixels(&font->info, pixels);
}

/* out[0] = ascent, out[1] = descent (negative), out[2] = lineGap — unscaled. */
EMSCRIPTEN_KEEPALIVE void zb_font_vmetrics(zb_font *font, int *out) {
  stbtt_GetFontVMetrics(&font->info, &out[0], &out[1], &out[2]);
}

/* 0 when the font has no glyph for the codepoint (the caller falls back). */
EMSCRIPTEN_KEEPALIVE int zb_find_glyph(zb_font *font, int codepoint) {
  return stbtt_FindGlyphIndex(&font->info, codepoint);
}

/* out[0] = advance width, out[1] = left side bearing — unscaled. */
EMSCRIPTEN_KEEPALIVE void zb_glyph_hmetrics(zb_font *font, int glyph, int *out) {
  stbtt_GetGlyphHMetrics(&font->info, glyph, &out[0], &out[1]);
}

/* Unscaled kern advance between two glyphs (GPOS if present, else `kern`). */
EMSCRIPTEN_KEEPALIVE int zb_kern_advance(zb_font *font, int g1, int g2) {
  return stbtt_GetGlyphKernAdvance(&font->info, g1, g2);
}

/*
 * Ink box in pixels for a scaled glyph: out = x0, y0, x1, y1, with Y DOWN and
 * the origin at the baseline (so y0 is usually negative — above the baseline).
 * An empty box (x1 <= x0 or y1 <= y0) means the glyph has no ink, e.g. a space.
 */
EMSCRIPTEN_KEEPALIVE void zb_glyph_box(zb_font *font, int glyph, float scale, int *out) {
  stbtt_GetGlyphBitmapBoxSubpixel(&font->info, glyph, scale, scale, 0.0f, 0.0f, &out[0], &out[1],
                                  &out[2], &out[3]);
}

/*
 * Rasterizes into an 8-bit coverage bitmap the caller allocated and must clear:
 * stb writes only the covered rows, so leftover bytes would show up as ink.
 */
EMSCRIPTEN_KEEPALIVE void zb_render_glyph(zb_font *font, int glyph, float scale,
                                          unsigned char *out, int w, int h, int stride) {
  stbtt_MakeGlyphBitmapSubpixel(&font->info, out, w, h, stride, scale, scale, 0.0f, 0.0f, glyph);
}
