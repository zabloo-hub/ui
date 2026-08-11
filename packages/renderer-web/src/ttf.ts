/**
 * The TTF rasterizer: a thin TypeScript face over stb_truetype compiled to WASM
 * (`native/stbtt.c`). This is the web form of the core-owned rasterization
 * decided in ZAB-15 — the same algorithm over the same font on every target, so
 * metrics and bitmaps converge instead of drifting per engine.
 *
 * It knows nothing about atlases, packing or textures: it answers "how wide is
 * this glyph" and "give me its coverage bitmap". `glyphs.ts` owns the rest, and
 * keeps the Canvas2D path as a fallback for the frames before the WASM lands.
 *
 * The unit contract, which Unity's port (ZAB-16) must match exactly:
 * - `pixelSize` is the EM size (what CSS `font-size` and Unity's point size
 *   mean), mapped through `stbtt_ScaleForMappingEmToPixels`.
 * - Advances and kerning stay fractional — rounding happens at quad time, not
 *   in the metrics, so a run's width does not drift glyph by glyph.
 * - Ink boxes are in px with Y DOWN from the baseline (stb's convention);
 *   `glyphs.ts` flips them into the renderer's Y-up quads.
 */

import { STBTT_WASM_BASE64 } from "./generated/stbtt-wasm.js";

/** Font-wide metrics at a given em size, in px. */
export interface FontMetrics {
  /** Above the baseline, positive. */
  ascent: number;
  /** Below the baseline, positive (stb reports it negative; we flip it). */
  descent: number;
  /** Recommended extra leading between lines. */
  lineGap: number;
  /** `ascent + descent + lineGap` — the baseline-to-baseline distance. */
  lineHeight: number;
}

/** A rasterized glyph: its ink box plus 8-bit coverage, row-major, top row first. */
export interface GlyphBitmap {
  width: number;
  height: number;
  /** Ink box relative to the pen/baseline, in px, Y DOWN. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** `width * height` coverage samples. Empty when the glyph has no ink. */
  coverage: Uint8Array;
}

interface StbExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  zb_malloc(size: number): number;
  zb_free(ptr: number): void;
  zb_font_new(data: number, len: number): number;
  zb_font_free(font: number): void;
  zb_scale_for_em(font: number, pixels: number): number;
  zb_font_vmetrics(font: number, out: number): void;
  zb_find_glyph(font: number, codepoint: number): number;
  zb_glyph_hmetrics(font: number, glyph: number, out: number): void;
  zb_kern_advance(font: number, g1: number, g2: number): number;
  zb_glyph_box(font: number, glyph: number, scale: number, out: number): void;
  zb_render_glyph(
    font: number,
    glyph: number,
    scale: number,
    out: number,
    w: number,
    h: number,
    stride: number,
  ): void;
}

/** Compiled once per process — the module is pure code, fonts hold the state. */
let modulePromise: Promise<WebAssembly.Module> | null = null;

function compile(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    // Async on purpose: browsers refuse synchronous compilation of anything
    // over 4 KB on the main thread, and this module is ~18 KB.
    modulePromise = WebAssembly.compile(decodeBase64(STBTT_WASM_BASE64) as BufferSource);
  }
  return modulePromise;
}

/**
 * Parses a TTF and returns the rasterizer bound to it. Rejects if stb cannot
 * make sense of the bytes.
 */
export async function loadFont(ttf: Uint8Array): Promise<StbFont> {
  const module = await compile();
  const runtime = new StbRuntime();
  const instance = await WebAssembly.instantiate(module, runtime.imports());
  return runtime.adopt(instance, ttf);
}

/**
 * Holds the instance and the memory views. Views are re-read after every growth
 * (`ALLOW_MEMORY_GROWTH` detaches the old `ArrayBuffer`, which would leave any
 * cached view pointing at nothing).
 */
class StbRuntime {
  private exports!: StbExports;
  private u8!: Uint8Array;
  private view!: DataView;

  imports(): WebAssembly.Imports {
    return {
      env: {
        emscripten_notify_memory_growth: () => this.refresh(),
      },
    };
  }

  adopt(instance: WebAssembly.Instance, ttf: Uint8Array): StbFont {
    this.exports = instance.exports as unknown as StbExports;
    this.exports._initialize();
    this.refresh();
    return new StbFont(this.exports, this, ttf);
  }

  refresh(): void {
    const buffer = this.exports.memory.buffer;
    this.u8 = new Uint8Array(buffer);
    this.view = new DataView(buffer);
  }

  /** The heap, re-read if a growth detached the cached view. */
  bytes(): Uint8Array {
    if (this.u8.buffer !== this.exports.memory.buffer) this.refresh();
    return this.u8;
  }

  int(ptr: number, index: number): number {
    if (this.view.buffer !== this.exports.memory.buffer) this.refresh();
    return this.view.getInt32(ptr + index * 4, true);
  }
}

export class StbFont {
  /** Codepoint → glyph index. The lookup walks cmap, so it is worth caching. */
  private readonly glyphIndices = new Map<number, number>();
  private readonly scales = new Map<number, number>();
  private readonly font: number;
  /** Scratch for the `int*` out-params — four ints is the largest any needs. */
  private readonly out: number;
  private readonly unitsAscent: number;
  private readonly unitsDescent: number;
  private readonly unitsLineGap: number;
  private disposed = false;

  /** @internal — built by `loadFont`. */
  constructor(
    private readonly api: StbExports,
    private readonly runtime: StbRuntime,
    ttf: Uint8Array,
  ) {
    const data = api.zb_malloc(ttf.length);
    if (data === 0) throw new Error("zabloo renderer: out of WASM memory loading the font");
    runtime.bytes().set(ttf, data);

    this.font = api.zb_font_new(data, ttf.length);
    if (this.font === 0) {
      api.zb_free(data);
      throw new Error("zabloo renderer: the font could not be parsed as a TTF");
    }
    this.out = api.zb_malloc(16);

    api.zb_font_vmetrics(this.font, this.out);
    this.unitsAscent = runtime.int(this.out, 0);
    this.unitsDescent = runtime.int(this.out, 1);
    this.unitsLineGap = runtime.int(this.out, 2);
  }

  /** Design units → px at an em size of `pixelSize`. */
  private scaleFor(pixelSize: number): number {
    let scale = this.scales.get(pixelSize);
    if (scale === undefined) {
      scale = this.api.zb_scale_for_em(this.font, pixelSize);
      this.scales.set(pixelSize, scale);
    }
    return scale;
  }

  metrics(pixelSize: number): FontMetrics {
    const scale = this.scaleFor(pixelSize);
    const ascent = this.unitsAscent * scale;
    // stb reports the descent below the baseline as negative; ours is a depth.
    const descent = -this.unitsDescent * scale;
    const lineGap = this.unitsLineGap * scale;
    return { ascent, descent, lineGap, lineHeight: ascent + descent + lineGap };
  }

  /** The glyph for a codepoint, or 0 when the font has none (stb's "notdef"). */
  glyphIndex(char: string): number {
    const codepoint = char.codePointAt(0);
    if (codepoint === undefined) return 0;
    let glyph = this.glyphIndices.get(codepoint);
    if (glyph === undefined) {
      glyph = this.api.zb_find_glyph(this.font, codepoint);
      this.glyphIndices.set(codepoint, glyph);
    }
    return glyph;
  }

  /** True if the font actually covers this character. */
  has(char: string): boolean {
    return this.glyphIndex(char) !== 0;
  }

  /** Pen advance in px — fractional on purpose (see the unit contract above). */
  advance(char: string, pixelSize: number): number {
    this.api.zb_glyph_hmetrics(this.font, this.glyphIndex(char), this.out);
    return this.runtime.int(this.out, 0) * this.scaleFor(pixelSize);
  }

  /**
   * Kerning adjustment in px to apply between two characters (usually negative,
   * e.g. "AV"). Read from the font's own tables — GPOS if present, else `kern`.
   */
  kern(previous: string, char: string, pixelSize: number): number {
    const units = this.api.zb_kern_advance(
      this.font,
      this.glyphIndex(previous),
      this.glyphIndex(char),
    );
    return units === 0 ? 0 : units * this.scaleFor(pixelSize);
  }

  /**
   * Rasterizes a character. Returns a bitmap with `width === 0` for anything
   * without ink (spaces, control characters, glyphs the font lacks).
   */
  render(char: string, pixelSize: number): GlyphBitmap {
    const glyph = this.glyphIndex(char);
    const scale = this.scaleFor(pixelSize);
    this.api.zb_glyph_box(this.font, glyph, scale, this.out);
    const x0 = this.runtime.int(this.out, 0);
    const y0 = this.runtime.int(this.out, 1);
    const x1 = this.runtime.int(this.out, 2);
    const y1 = this.runtime.int(this.out, 3);
    const width = x1 - x0;
    const height = y1 - y0;
    if (width <= 0 || height <= 0) {
      return { width: 0, height: 0, x0: 0, y0: 0, x1: 0, y1: 0, coverage: EMPTY };
    }

    const buffer = this.api.zb_malloc(width * height);
    if (buffer === 0) throw new Error("zabloo renderer: out of WASM memory rasterizing a glyph");
    // emmalloc hands back dirty memory and stb only writes the rows it covers.
    this.runtime.bytes().fill(0, buffer, buffer + width * height);
    this.api.zb_render_glyph(this.font, glyph, scale, buffer, width, height, width);
    // Copied out before the free: the heap is reused, and may even move.
    const coverage = this.runtime.bytes().slice(buffer, buffer + width * height);
    this.api.zb_free(buffer);

    return { width, height, x0, y0, x1, y1, coverage };
  }

  /** Releases the font's WASM memory. The compiled module stays cached. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.api.zb_free(this.out);
    this.api.zb_font_free(this.font);
  }
}

const EMPTY = new Uint8Array(0);

/**
 * Base64 → bytes. Deliberately `atob`-based rather than `node:buffer`: this
 * module ships to the browser, and Node has had a global `atob` since 16.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
