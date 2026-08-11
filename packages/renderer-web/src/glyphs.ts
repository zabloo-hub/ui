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

export interface GlyphInfo {
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

const ATLAS_SIZE = 1024;
const PADDING = 2;

/** Arial ≈ Unity's LegacyRuntime metrics, and what the shipped TTF matches. */
const FALLBACK_FONT_FAMILY = "Arial, Helvetica, sans-serif";

export class GlyphAtlas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly lineHeight: number;
  readonly ascent: number;
  /** UV of the reserved white pixel (center of a 4×4 white block). */
  readonly whiteU: number;
  readonly whiteV: number;

  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly glyphs = new Map<string, GlyphInfo>();
  private readonly scale: number; // rasterization scale (devicePixelRatio)
  /** Rasterization size in device px — what the font is asked to scale to. */
  private readonly devicePointSize: number;
  private penX = PADDING;
  private penY = PADDING;
  private rowHeight = 0;
  private _version = 0;

  /** Bumped every time the atlas bitmap changes (the GL layer re-uploads). */
  get version(): number {
    return this._version;
  }

  /** The `TextureSource` side of the atlas — what the GL layer uploads. */
  get bitmap(): TexImageSource {
    return this.canvas;
  }

  constructor(
    readonly pointSize: number,
    scale: number,
    /** Our rasterizer. Null until the WASM lands — Canvas2D covers those frames. */
    private readonly font: StbFont | null = null,
  ) {
    this.scale = Math.max(1, scale);
    this.devicePointSize = pointSize * this.scale;
    this.canvas = createCanvas(ATLAS_SIZE, ATLAS_SIZE);
    const ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    this.ctx = ctx;

    // White block for solid geometry.
    ctx.fillRect(0, 0, 4, 4);
    this.whiteU = 2 / ATLAS_SIZE;
    this.whiteV = 2 / ATLAS_SIZE;
    this.penX = 8;

    // Font-wide metrics at the logical point size.
    if (font) {
      const metrics = font.metrics(this.devicePointSize);
      this.ascent = metrics.ascent / this.scale;
      this.lineHeight = metrics.lineHeight / this.scale;
    } else {
      ctx.font = this.cssFont();
      const m = ctx.measureText("Mg");
      const fontAscent = m.fontBoundingBoxAscent ?? pointSize * this.scale * 0.8;
      const fontDescent = m.fontBoundingBoxDescent ?? pointSize * this.scale * 0.25;
      this.ascent = fontAscent / this.scale;
      this.lineHeight = (fontAscent + fontDescent) / this.scale;
    }
    this._version++;
  }

  private cssFont(): string {
    return `${this.devicePointSize}px ${FALLBACK_FONT_FAMILY}`;
  }

  get(char: string): GlyphInfo | undefined {
    let glyph = this.glyphs.get(char);
    if (glyph === undefined) {
      glyph = this.font ? this.rasterizeStb(char, this.font) : this.rasterizeCanvas(char);
      this.glyphs.set(char, glyph);
    }
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
    return this.font.kern(previous, char, this.devicePointSize) / this.scale;
  }

  /** Our rasterizer: stb hands us 8-bit coverage, we own where it lands. */
  private rasterizeStb(char: string, font: StbFont): GlyphInfo {
    const advance = font.advance(char, this.devicePointSize) / this.scale;
    const bitmap = font.render(char, this.devicePointSize);
    if (bitmap.width <= 0 || bitmap.height <= 0) return blank(advance);

    const spot = this.reserve(bitmap.width, bitmap.height, char);
    if (!spot) return blank(advance);

    // Coverage → white pixels with the coverage as alpha, the same shape
    // `fillText` produced. `createImageData` (not the `ImageData` global) keeps
    // this working on an OffscreenCanvas too.
    const image = this.ctx.createImageData(bitmap.width, bitmap.height);
    const pixels = image.data;
    for (let i = 0; i < bitmap.coverage.length; i++) {
      const p = i * 4;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = bitmap.coverage[i];
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
      u0: spot.x / ATLAS_SIZE,
      v0: spot.y / ATLAS_SIZE,
      u1: (spot.x + bitmap.width) / ATLAS_SIZE,
      v1: (spot.y + bitmap.height) / ATLAS_SIZE,
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
      u0: spot.x / ATLAS_SIZE,
      v0: spot.y / ATLAS_SIZE,
      u1: (spot.x + w) / ATLAS_SIZE,
      v1: (spot.y + h) / ATLAS_SIZE,
      hasQuad: true,
    };
  }

  /** Shelf packing. Null when the atlas has no room left for this glyph. */
  private reserve(w: number, h: number, char: string): { x: number; y: number } | null {
    if (this.penX + w + PADDING > ATLAS_SIZE) {
      this.penX = PADDING;
      this.penY += this.rowHeight + PADDING;
      this.rowHeight = 0;
    }
    if (this.penY + h + PADDING > ATLAS_SIZE) {
      console.warn(`[zabloo] Glyph atlas (${this.pointSize}px) is full — glyph "${char}" skipped.`);
      return null;
    }
    const spot = { x: this.penX, y: this.penY };
    this.penX += w + PADDING;
    this.rowHeight = Math.max(this.rowHeight, h);
    return spot;
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

/** One atlas per requested point size (same shape as the SDK's FontLibrary). */
export class FontLibrary {
  private readonly atlases = new Map<number, GlyphAtlas>();

  constructor(
    private readonly scale: number,
    private font: StbFont | null = null,
  ) {}

  get(pointSize: number): GlyphAtlas {
    let atlas = this.atlases.get(pointSize);
    if (!atlas) {
      atlas = new GlyphAtlas(pointSize, this.scale, this.font);
      this.atlases.set(pointSize, atlas);
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
}
