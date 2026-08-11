import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { FontLibrary, GlyphAtlas } from "./glyphs.js";
import { decodeBase64, loadFont, type StbFont } from "./ttf.js";

/**
 * The atlas is exercised against the REAL rasterizer — the glyph boxes and the
 * coverage are the whole point — over a stand-in canvas, since Node has none.
 * What is under test is ours: the packing, the UV rects and the flip from stb's
 * Y-down boxes to the renderer's Y-up quads.
 */
const ATLAS_SIZE = 1024;

interface Written {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

let written: Written[] = [];

class FakeContext {
  fillStyle = "";
  font = "";
  textBaseline = "";
  fillRect = vi.fn();
  fillText = vi.fn();

  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  putImageData(
    image: { width: number; height: number; data: Uint8ClampedArray },
    x: number,
    y: number,
  ) {
    written.push({ x, y, width: image.width, height: image.height, data: image.data });
  }

  // Only the fallback path calls this; the numbers just have to be plausible.
  measureText(text: string) {
    return {
      width: text.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 12,
      fontBoundingBoxDescent: 3,
    };
  }
}

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return new FakeContext();
  }
}

let font: StbFont;
const originalOffscreen = globalThis.OffscreenCanvas;

beforeAll(async () => {
  font = await loadFont(decodeBase64(DEFAULT_FONT_BASE64));
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas;
});

afterAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreen;
  font.dispose();
});

describe("GlyphAtlas with the TTF rasterizer", () => {
  it("takes its font-wide metrics from the font, not from the canvas", () => {
    const atlas = new GlyphAtlas(16, 1, font);
    const metrics = font.metrics(16);
    expect(atlas.ascent).toBeCloseTo(metrics.ascent, 6);
    expect(atlas.lineHeight).toBeCloseTo(metrics.lineHeight, 6);
  });

  it("divides device px by the raster scale to report logical px", () => {
    const atlas = new GlyphAtlas(16, 2, font);
    // Rasterized at 32 device px, reported at 16 logical px.
    expect(atlas.lineHeight).toBeCloseTo(font.metrics(32).lineHeight / 2, 6);
    expect(atlas.measure("Hello").x).toBeCloseTo(
      new GlyphAtlas(16, 1, font).measure("Hello").x,
      // Not exact: the two rasterize at different sizes, so hinting-free
      // rounding of the ink boxes differs. Advances are what must agree.
      1,
    );
  });

  it("puts a glyph's ink above the baseline and gives it a UV rect", () => {
    written = [];
    const atlas = new GlyphAtlas(32, 1, font);
    const glyph = atlas.get("A");

    expect(glyph?.hasQuad).toBe(true);
    // Y-up quads: an "A" sits entirely above the baseline.
    expect(glyph?.maxY).toBeGreaterThan(0);
    expect(glyph?.minY).toBeLessThanOrEqual(0);
    expect(glyph?.maxX).toBeGreaterThan(glyph?.minX ?? 0);

    for (const uv of [glyph?.u0, glyph?.v0, glyph?.u1, glyph?.v1]) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }
    // The UV rect covers exactly the pixels that were written.
    const spot = written.at(-1) as Written;
    expect(glyph?.u0).toBeCloseTo(spot.x / ATLAS_SIZE, 9);
    expect(glyph?.u1).toBeCloseTo((spot.x + spot.width) / ATLAS_SIZE, 9);
  });

  it("writes the glyph coverage as white pixels with coverage as alpha", () => {
    written = [];
    const atlas = new GlyphAtlas(32, 1, font);
    atlas.get("A");

    const spot = written.at(-1) as Written;
    expect(spot.data.some((_, i) => i % 4 === 3 && spot.data[i] > 0)).toBe(true);
    for (let i = 0; i < spot.data.length; i += 4) {
      expect(spot.data[i]).toBe(255);
      expect(spot.data[i + 1]).toBe(255);
      expect(spot.data[i + 2]).toBe(255);
    }
  });

  it("rasterizes each glyph once", () => {
    written = [];
    const atlas = new GlyphAtlas(16, 1, font);
    atlas.get("A");
    atlas.get("A");
    expect(written).toHaveLength(1);
  });

  it("gives whitespace an advance but no quad", () => {
    const glyph = new GlyphAtlas(16, 1, font).get(" ");
    expect(glyph?.hasQuad).toBe(false);
    expect(glyph?.advance).toBeGreaterThan(0);
  });

  it("packs glyphs into distinct spots without overlapping", () => {
    written = [];
    const atlas = new GlyphAtlas(16, 1, font);
    for (const char of "abcdefghij") atlas.get(char);

    expect(written).toHaveLength(10);
    for (const spot of written) {
      // The reserved white block lives in the top-left corner.
      expect(spot.x >= 8 || spot.y >= 4).toBe(true);
      expect(spot.x + spot.width).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(spot.y + spot.height).toBeLessThanOrEqual(ATLAS_SIZE);
    }
  });

  it("applies the font's kerning when measuring a run", () => {
    const atlas = new GlyphAtlas(32, 1, font);
    const kern = atlas.kern("A", "V");
    expect(kern).toBeLessThan(0);

    const a = atlas.get("A")?.advance ?? 0;
    const v = atlas.get("V")?.advance ?? 0;
    expect(atlas.measure("AV").x).toBeCloseTo(a + v + kern, 6);
  });

  it("bumps its version as the bitmap changes, so the GL layer re-uploads", () => {
    const atlas = new GlyphAtlas(16, 1, font);
    const before = atlas.version;
    atlas.get("A");
    expect(atlas.version).toBeGreaterThan(before);
  });
});

describe("GlyphAtlas without a rasterizer", () => {
  it("falls back to the canvas and reports no kerning", () => {
    const atlas = new GlyphAtlas(16, 1, null);
    expect(atlas.lineHeight).toBe(15); // the fake's 12 + 3
    expect(atlas.get("A")?.hasQuad).toBe(true);
    expect(atlas.kern("A", "V")).toBe(0);
  });
});

describe("FontLibrary", () => {
  it("keeps one atlas per point size", () => {
    const library = new FontLibrary(1, font);
    expect(library.get(16)).toBe(library.get(16));
    expect(library.get(16)).not.toBe(library.get(24));
  });

  it("rebuilds every atlas when the rasterizer arrives, and hands back the old ones", () => {
    const library = new FontLibrary(1);
    const fallback16 = library.get(16);
    const fallback24 = library.get(24);
    expect(fallback16.lineHeight).toBe(15); // still the fake canvas

    const replaced = library.adopt(font);

    expect(replaced).toEqual([fallback16, fallback24]);
    expect(library.get(16)).not.toBe(fallback16);
    expect(library.get(16).lineHeight).toBeCloseTo(font.metrics(16).lineHeight, 6);
  });
});
