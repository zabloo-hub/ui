/**
 * Self-owned glyph atlas for the web renderer — the browser variant of the
 * pattern validated in the Unity text spike (2026-08-02): the platform's
 * rasterizer (Canvas2D `fillText`) draws glyphs, and WE snapshot them into an
 * atlas we own, with our own metrics table for the layout pass.
 *
 * The atlas also reserves a WHITE pixel region so solid geometry (rounded
 * rects) samples the same texture as text — the whole UI renders in one
 * draw call.
 */

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

/** Arial ≈ Unity's LegacyRuntime metrics — closest cross-target default. */
const FONT_FAMILY = "Arial, Helvetica, sans-serif";

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
  private penX = PADDING;
  private penY = PADDING;
  private rowHeight = 0;
  private _version = 0;

  /** Bumped every time the atlas bitmap changes (the GL layer re-uploads). */
  get version(): number {
    return this._version;
  }

  constructor(
    readonly pointSize: number,
    scale: number,
  ) {
    this.scale = Math.max(1, scale);
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
    ctx.font = this.cssFont();
    const m = ctx.measureText("Mg");
    const fontAscent = m.fontBoundingBoxAscent ?? pointSize * this.scale * 0.8;
    const fontDescent = m.fontBoundingBoxDescent ?? pointSize * this.scale * 0.25;
    this.ascent = fontAscent / this.scale;
    this.lineHeight = (fontAscent + fontDescent) / this.scale;
    this._version++;
  }

  private cssFont(): string {
    return `${this.pointSize * this.scale}px ${FONT_FAMILY}`;
  }

  get(char: string): GlyphInfo | undefined {
    let glyph = this.glyphs.get(char);
    if (glyph === undefined) {
      glyph = this.rasterize(char);
      this.glyphs.set(char, glyph);
    }
    return glyph;
  }

  /** Single-line measure in logical px — what the layout pass calls for Text. */
  measure(text: string): { x: number; y: number } {
    let width = 0;
    for (const char of text) {
      const glyph = this.get(char);
      if (glyph) width += glyph.advance;
    }
    return { x: width, y: this.lineHeight };
  }

  private rasterize(char: string): GlyphInfo {
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

    if (w <= 0 || h <= 0 || /\s/.test(char)) {
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

    // Shelf packing.
    if (this.penX + w + PADDING > ATLAS_SIZE) {
      this.penX = PADDING;
      this.penY += this.rowHeight + PADDING;
      this.rowHeight = 0;
    }
    if (this.penY + h + PADDING > ATLAS_SIZE) {
      console.warn(`[zabloo] Glyph atlas (${this.pointSize}px) is full — glyph "${char}" skipped.`);
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

    const x = this.penX;
    const y = this.penY;
    ctx.fillText(char, x + left, y + up);
    this.penX += w + PADDING;
    this.rowHeight = Math.max(this.rowHeight, h);
    this._version++;

    return {
      advance,
      minX: -left / this.scale,
      maxX: right / this.scale,
      maxY: up / this.scale,
      minY: -down / this.scale,
      u0: x / ATLAS_SIZE,
      v0: y / ATLAS_SIZE,
      u1: (x + w) / ATLAS_SIZE,
      v1: (y + h) / ATLAS_SIZE,
      hasQuad: true,
    };
  }
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

  constructor(private readonly scale: number) {}

  get(pointSize: number): GlyphAtlas {
    let atlas = this.atlases.get(pointSize);
    if (!atlas) {
      atlas = new GlyphAtlas(pointSize, this.scale);
      this.atlases.set(pointSize, atlas);
    }
    return atlas;
  }

  all(): Iterable<GlyphAtlas> {
    return this.atlases.values();
  }
}
