/**
 * Self-owned glyph atlas for the web renderer.
 *
 * Since ZAB-43 the glyphs come from OUR rasterizer — stb_truetype compiled to
 * WASM (`ttf.ts`) over the TTF we ship — which is what makes text converge with
 * the other targets: same algorithm, same font, same metrics, same bitmaps.
 * Canvas2D (`fillText`/`measureText`) survives only as the fallback for the
 * frames before the WASM lands, and for the (unlikely) case it fails to load.
 *
 * Either way WE own the atlas and the metrics table — the pattern validated in
 * the Unity text spike (2026-08-02) — so everything downstream (packing, quads,
 * measurement) is identical whoever rasterized.
 *
 * The atlas also reserves a WHITE pixel region so solid geometry (rounded
 * rects) samples the same texture as text — the whole UI renders in one
 * draw call.
 */

import type { StbFont } from "./ttf.js";

interface GlyphInfo {
  advance: number;
  /** Quad extents in px: X from the pen, Y from the baseline (maxY = top, up+). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** UV rect in the atlas (0..1, v=0 at the TOP — WebGL texImage row order). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  hasQuad: boolean;
}

const INITIAL_ATLAS_SIZE = 1024;
/**
 * Where growth stops (device px per side). Past this the atlas caches misses as
 * blank — the pre-ZAB-55 behavior, now 16× the area away instead of the floor.
 */
const MAX_ATLAS_SIZE = 4096;
const PADDING = 2;

/** Arial ≈ Unity's LegacyRuntime metrics, and what the shipped TTF matches. */
const FALLBACK_FONT_FAMILY = "Arial, Helvetica, sans-serif";

class GlyphAtlas {
  readonly lineHeight: number;
  readonly ascent: number;

  private _canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** Current side in device px — doubles as the atlas fills (see `grow`). */
  private size = INITIAL_ATLAS_SIZE;
  private readonly glyphs = new Map<string, GlyphInfo>();
  private readonly scale: number; // rasterization scale (devicePixelRatio)
  /** Rasterization size in device px — what the font is asked to scale to. */
  private readonly devicePointSize: number;
  private penX = PADDING;
  private penY = PADDING;
  private rowHeight = 0;
  private _version = 0;
  /** The full-at-max warning fires once per atlas, not once per glyph. */
  private warnedFull = false;
  /** Same for the rasterizer-failed warning (ZAB-69). */
  private warnedRaster = false;
  /**
   * Kerning by pair (ZAB-69). Advances are cached with the glyph, but kerning
   * was crossing into the WASM once per pair PER FRAME, twice over — the wrap
   * measures the run and the tessellator paints it — which made it the hottest
   * path left in a text-heavy scene. Sized like `glyphs`: the pairs a scene
   * actually uses, and the point size it is keyed by never changes.
   */
  private readonly kerns = new Map<string, number>();

  /** Bumped every time the atlas bitmap changes (the GL layer re-uploads). */
  get version(): number {
    return this._version;
  }

  get canvas(): HTMLCanvasElement | OffscreenCanvas {
    return this._canvas;
  }

  /** The `TextureSource` side of the atlas — what the GL layer uploads. */
  get bitmap(): TexImageSource {
    return this._canvas;
  }

  /** UV of the reserved white pixel (center of a 4×4 white block). */
  get whiteU(): number {
    return 2 / this.size;
  }

  get whiteV(): number {
    return 2 / this.size;
  }

  constructor(
    readonly pointSize: number,
    scale: number,
    /** Our rasterizer. Null until the WASM lands — Canvas2D covers those frames. */
    private readonly font: StbFont | null = null,
  ) {
    this.scale = Math.max(1, scale);
    this.devicePointSize = pointSize * this.scale;
    this._canvas = createCanvas(this.size, this.size);
    this.ctx = this.prepare(this._canvas);

    // Font-wide metrics at the logical point size.
    if (font) {
      const metrics = font.metrics(this.devicePointSize);
      this.ascent = metrics.ascent / this.scale;
      this.lineHeight = metrics.lineHeight / this.scale;
    } else {
      this.ctx.font = this.cssFont();
      const m = this.ctx.measureText("Mg");
      const fontAscent = m.fontBoundingBoxAscent ?? pointSize * this.scale * 0.8;
      const fontDescent = m.fontBoundingBoxDescent ?? pointSize * this.scale * 0.25;
      this.ascent = fontAscent / this.scale;
      this.lineHeight = (fontAscent + fontDescent) / this.scale;
    }
    this._version++;
  }

  /** Fresh drawing surface: context state, the white block, the pens after it. */
  private prepare(
    canvas: HTMLCanvasElement | OffscreenCanvas,
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    // White block for solid geometry.
    ctx.fillRect(0, 0, 4, 4);
    this.penX = 8;
    this.penY = PADDING;
    this.rowHeight = 0;
    return ctx;
  }

  private cssFont(): string {
    return `${this.devicePointSize}px ${FALLBACK_FONT_FAMILY}`;
  }

  get(char: string): GlyphInfo | undefined {
    const cached = this.glyphs.get(char);
    if (cached !== undefined) return cached;

    const glyph = this.font ? this.rasterizeStb(char, this.font) : this.rasterizeCanvas(char);
    this.glyphs.set(char, glyph);
    return glyph;
  }

  /**
   * Horizontal advance of one character in logical px. With `kern` and the two
   * font-wide metrics it makes an atlas a `TextMetrics`: an atlas IS the font as
   * far as `text.ts` is concerned, which is what measures and wraps a run since
   * ZAB-17 (the old single-line `measure` lived here).
   */
  advance(char: string): number {
    return this.get(char)?.advance ?? 0;
  }

  /**
   * Kerning adjustment between two characters, in logical px. Read from the
   * font's own tables, so it must be applied by everyone who walks a run — both
   * the wrapping in `text.ts` and the tessellator's paint loop, or the two would
   * disagree. Zero on the Canvas2D fallback, which exposes no kerning at all.
   */
  kern(previous: string, char: string): number {
    if (!this.font) return 0;
    const key = previous + char;
    const cached = this.kerns.get(key);
    if (cached !== undefined) return cached;

    const value = this.font.kern(previous, char, this.devicePointSize) / this.scale;
    this.kerns.set(key, value);
    return value;
  }

  /**
   * Our rasterizer: stb hands us 8-bit coverage, we own where it lands.
   *
   * Everything past the advance runs under a `try` (ZAB-69): rasterizing asks
   * the WASM heap for `width * height` bytes and `createImageData` for four
   * times that, and either can fail on a glyph big enough. This is reached from
   * the measure pass, inside `render()`, from event handlers and from RAF —
   * nobody up there catches — so a failure degrades to a blank glyph (cached
   * like any other, so it is not retried every frame) instead of killing the view.
   */
  private rasterizeStb(char: string, font: StbFont): GlyphInfo {
    const advance = font.advance(char, this.devicePointSize) / this.scale;
    try {
      return this.rasterizeStbInto(char, font, advance);
    } catch (error) {
      if (!this.warnedRaster) {
        this.warnedRaster = true;
        console.warn(
          `[zabloo] Glyph rasterization failed at ${this.pointSize}px — glyph "${char}" and later failures paint blank.`,
          error,
        );
      }
      return blank(advance);
    }
  }

  private rasterizeStbInto(char: string, font: StbFont, advance: number): GlyphInfo {
    const bitmap = font.render(char, this.devicePointSize);
    if (bitmap.width <= 0 || bitmap.height <= 0) return blank(advance);

    const spot = this.reserve(bitmap.width, bitmap.height, char);
    if (!spot) return blank(advance);

    // Coverage → white pixels with the coverage as alpha, the same shape
    // `fillText` produced. `createImageData` (not the `ImageData` global) keeps
    // this working on an OffscreenCanvas too.
    const image = this.ctx.createImageData(bitmap.width, bitmap.height);
    const pixels = image.data;
    for (const [i, coverage] of bitmap.coverage.entries()) {
      const p = i * 4;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = coverage;
    }
    this.ctx.putImageData(image, spot.x, spot.y);
    this._version++;

    return {
      advance,
      // stb's box is Y-down from the baseline; our quads are Y-up.
      minX: bitmap.x0 / this.scale,
      maxX: bitmap.x1 / this.scale,
      maxY: -bitmap.y0 / this.scale,
      minY: -bitmap.y1 / this.scale,
      u0: spot.x / this.size,
      v0: spot.y / this.size,
      u1: (spot.x + bitmap.width) / this.size,
      v1: (spot.y + bitmap.height) / this.size,
      hasQuad: true,
    };
  }

  /** The fallback: the browser rasterizes, we snapshot into our atlas. */
  private rasterizeCanvas(char: string): GlyphInfo {
    const ctx = this.ctx;
    ctx.font = this.cssFont();
    const m = ctx.measureText(char);
    const advance = m.width / this.scale;

    // Ink extents relative to the pen/baseline (device px).
    const left = Math.ceil(m.actualBoundingBoxLeft ?? 0);
    const right = Math.ceil(m.actualBoundingBoxRight ?? m.width);
    const up = Math.ceil(m.actualBoundingBoxAscent ?? 0);
    const down = Math.ceil(m.actualBoundingBoxDescent ?? 0);
    const w = left + right;
    const h = up + down;

    if (w <= 0 || h <= 0 || /\s/.test(char)) return blank(advance);

    const spot = this.reserve(w, h, char);
    if (!spot) return blank(advance);

    ctx.fillText(char, spot.x + left, spot.y + up);
    this._version++;

    return {
      advance,
      minX: -left / this.scale,
      maxX: right / this.scale,
      maxY: up / this.scale,
      minY: -down / this.scale,
      u0: spot.x / this.size,
      v0: spot.y / this.size,
      u1: (spot.x + w) / this.size,
      v1: (spot.y + h) / this.size,
      hasQuad: true,
    };
  }

  /**
   * Shelf packing. A full atlas GROWS (ZAB-55) — the pre-growth behavior cached
   * the glyph as blank forever — and only at `MAX_ATLAS_SIZE` does it give up:
   * null then, and the caller caches the blank.
   */
  private reserve(w: number, h: number, char: string): { x: number; y: number } | null {
    // A glyph bigger than the whole atlas fits on no shelf of it, in EITHER
    // axis (ZAB-69). Growing for height alone left a too-wide glyph placed
    // anyway, off the right edge, with UVs past 1 — the sampler then read
    // whatever the texture wraps to instead of the blank the caller believed
    // it got. Checked before the shelf, since growing resets the pens.
    while (w + PADDING * 2 > this.size || h + PADDING * 2 > this.size) {
      if (!this.grow()) return this.giveUp(char);
    }
    if (this.penX + w + PADDING > this.size) {
      this.penX = PADDING;
      this.penY += this.rowHeight + PADDING;
      this.rowHeight = 0;
    }
    while (this.penY + h + PADDING > this.size) {
      if (!this.grow()) return this.giveUp(char);
    }
    const spot = { x: this.penX, y: this.penY };
    this.penX += w + PADDING;
    this.rowHeight = Math.max(this.rowHeight, h);
    return spot;
  }

  /** No room at `MAX_ATLAS_SIZE`: warn once per atlas, and the caller blanks the glyph. */
  private giveUp(char: string): null {
    if (!this.warnedFull) {
      this.warnedFull = true;
      console.warn(
        `[zabloo] Glyph atlas (${this.pointSize}px) is full at ${this.size}px — glyph "${char}" and later ones skipped.`,
      );
    }
    return null;
  }

  /**
   * Doubles the surface and re-rasterizes everything cached so far through the
   * normal path — same mechanics as `FontLibrary.adopt`, but in place: the atlas
   * keeps its identity, so the GL layer just re-uploads on the version bump and
   * every glyph already handed out is re-created before the caller's own lands.
   * Blanks that were only blank for lack of room become real glyphs here.
   */
  private grow(): boolean {
    // A disposed atlas has no surface to double (`dispose` leaves the side at 0,
    // and doubling zero never reaches anything): it grows no more, so the callers
    // that loop until a glyph fits blank it instead of spinning forever.
    if (this.size === 0 || this.size >= MAX_ATLAS_SIZE) return false;
    this.size *= 2;
    this._canvas = createCanvas(this.size, this.size);
    this.ctx = this.prepare(this._canvas);
    const cached = [...this.glyphs.keys()];
    this.glyphs.clear();
    for (const char of cached) this.get(char);
    this._version++;
    return true;
  }

  /**
   * Releases the bitmap NOW instead of when the GC gets to it (ZAB-72): an atlas
   * that grew to the cap is 4096² RGBA — 64 MB of backing store — and resizing a
   * canvas to zero is what frees it in every browser. Only the library's own
   * `dispose` calls this: an atlas whose canvas is gone can no longer rasterize,
   * so it must already be unreachable. Its GPU texture belongs to the GL layer.
   */
  dispose(): void {
    this.glyphs.clear();
    this.kerns.clear();
    this._canvas.width = 0;
    this._canvas.height = 0;
    this.size = 0;
  }
}

/** A glyph that paints nothing — whitespace, or one the atlas had no room for. */
function blank(advance: number): GlyphInfo {
  return {
    advance,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    u0: 0,
    v0: 0,
    u1: 0,
    v1: 0,
    hasQuad: false,
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Live atlases the library keeps, LRU (ZAB-55). Each one is a canvas plus a GPU
 * texture, so an unbounded map — an animated `fontSize`, a token per size —
 * would grow a 1024²+ surface per distinct size and never let go. Eight covers
 * a real UI's type scale; a scene cycling through more thrashes gracefully
 * (evict + re-rasterize) instead of exhausting memory.
 */
const MAX_ATLASES = 8;

/** One atlas per requested point size (same shape as the SDK's FontLibrary). */
class FontLibrary {
  private readonly atlases = new Map<number, GlyphAtlas>();
  /** Point size at the newest end of the LRU — the fast path of `get` (ZAB-73). */
  private newest: number | null = null;

  constructor(
    private readonly scale: number,
    private font: StbFont | null = null,
    /** Fires with each atlas the LRU drops, so the caller frees its GPU texture. */
    private readonly onEvict?: (atlas: GlyphAtlas) => void,
  ) {}

  get(pointSize: number): GlyphAtlas {
    // Already the newest: map order IS the recency order, so re-inserting the
    // last entry would move nothing and churn the map. A frame asks for the same
    // size once per text node — the whole scene at one point size is the normal
    // case — so this is the answer almost every time (ZAB-73).
    if (pointSize === this.newest) {
      const current = this.atlases.get(pointSize);
      if (current) return current;
    }
    const cached = this.atlases.get(pointSize);
    if (cached) {
      // Map order is the recency order: re-inserting marks it just used.
      this.atlases.delete(pointSize);
      this.atlases.set(pointSize, cached);
      this.newest = pointSize;
      return cached;
    }
    const atlas = new GlyphAtlas(pointSize, this.scale, this.font);
    this.atlases.set(pointSize, atlas);
    this.newest = pointSize;
    if (this.atlases.size > MAX_ATLASES) {
      const [oldestSize, oldest] = this.atlases.entries().next().value as [number, GlyphAtlas];
      this.atlases.delete(oldestSize);
      this.onEvict?.(oldest);
    }
    return atlas;
  }

  /**
   * Swaps in our rasterizer once its WASM has loaded, rebuilding every atlas
   * handed out so far — their bitmaps and metrics came from the fallback.
   * Returns the replaced atlases so the caller can release their GPU textures;
   * dropping them silently would leak one texture per point size.
   */
  adopt(font: StbFont): GlyphAtlas[] {
    this.font = font;
    const replaced: GlyphAtlas[] = [];
    for (const [pointSize, atlas] of this.atlases) {
      replaced.push(atlas);
      this.atlases.set(pointSize, new GlyphAtlas(pointSize, this.scale, font));
    }
    return replaced;
  }

  all(): Iterable<GlyphAtlas> {
    return this.atlases.values();
  }

  /**
   * Drops every atlas and its bitmap — the view's `dispose` (ZAB-72). Up to
   * `MAX_ATLASES` canvases of up to 4096² RGBA hang off this map, so leaving them
   * to the GC is how a page that mounts and drops views (a preview switching
   * documents, an editor opening tabs) keeps hundreds of MB alive. The GPU
   * textures are released by the GL layer's own `dispose`.
   */
  dispose(): void {
    for (const atlas of this.atlases.values()) atlas.dispose();
    this.atlases.clear();
    this.newest = null;
  }
}

export type { GlyphInfo };
export { FontLibrary, GlyphAtlas };
