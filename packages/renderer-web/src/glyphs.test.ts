import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { FontLibrary, GlyphAtlas } from "./glyphs.js";
import { layoutText } from "./text.js";
import { decodeBase64, loadFont, type StbFont } from "./ttf.js";

/**
 * Width of a single-line run through the real measuring path: an atlas is the
 * `TextMetrics` the layout algorithm walks (ZAB-17), so this is what the layout
 * pass would reserve for the run — kerning included.
 */
function runWidth(atlas: GlyphAtlas, text: string): number {
  const block = layoutText(text, atlas, {
    wrap: false,
    maxWidth: null,
    lineHeight: atlas.lineHeight,
    maxLines: null,
    overflow: "clip",
  });
  return block.lines[0].width;
}

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
    expect(runWidth(atlas, "Hello")).toBeCloseTo(
      runWidth(new GlyphAtlas(16, 1, font), "Hello"),
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
    // Through the layout algorithm, which is what has to see it: a run measured
    // without kerning would not be the run the tessellator paints.
    expect(runWidth(atlas, "AV")).toBeCloseTo(a + v + kern, 6);
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

describe("GlyphAtlas growth (ZAB-55)", () => {
  /**
   * Distinct printable ASCII, from '!'. The shipped TTF has no CJK coverage
   * (an uncovered code point renders no ink and reserves no room), so the way
   * to fill the atlas honestly is fewer glyphs at a bigger point size — the
   * audit's other culprit, an animated/tokened `fontSize`.
   */
  function ascii(count: number): string[] {
    return Array.from({ length: count }, (_, i) => String.fromCharCode(33 + i));
  }

  it("grows past the first full atlas instead of caching the glyph as blank", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 200px glyphs ≈ 150² px each incl. padding → ~30 per 1024².
    const atlas = new GlyphAtlas(200, 1, font);
    const glyphs = ascii(60).map((char) => atlas.get(char));

    // Every glyph got a quad — nobody was skipped for lack of room.
    expect(glyphs.every((glyph) => glyph?.hasQuad)).toBe(true);
    expect(atlas.canvas.width).toBeGreaterThan(1024);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps every UV rect inside the grown surface, and re-rasterizes the old glyphs", () => {
    const atlas = new GlyphAtlas(200, 1, font);
    const first = atlas.get("A");
    for (const char of ascii(60)) atlas.get(char);

    const regrown = atlas.get("A");
    expect(atlas.canvas.width).toBeGreaterThan(1024);
    // Same metrics (same font, same size)…
    expect(regrown?.advance).toBe(first?.advance);
    expect(regrown?.hasQuad).toBe(true);
    // …and every UV, old or new, inside the grown surface.
    for (const char of ["A", ...ascii(60)]) {
      const glyph = atlas.get(char);
      for (const uv of [glyph?.u0, glyph?.v0, glyph?.u1, glyph?.v1]) {
        expect(uv).toBeGreaterThanOrEqual(0);
        expect(uv).toBeLessThanOrEqual(1);
      }
    }
  });

  it("bumps the version on growth so the GL layer re-uploads the bigger bitmap", () => {
    const atlas = new GlyphAtlas(200, 1, font);
    atlas.get("A");
    const before = atlas.version;
    for (const char of ascii(60)) atlas.get(char);
    expect(atlas.canvas.width).toBeGreaterThan(1024);
    expect(atlas.version).toBeGreaterThan(before);
  });

  it("gives up only at the max size, warning once instead of per glyph", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // ~1500px-wide glyphs: two or three per 4096² row, so a dozen overflow the max.
    const atlas = new GlyphAtlas(2000, 1, font);
    const glyphs = [..."MWQ@GB#%&8DHK"].map((char) => atlas.get(char));

    expect(atlas.canvas.width).toBe(4096);
    expect(glyphs.some((glyph) => glyph?.hasQuad === false)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

  it("evicts the least-recently-used atlas past the cap, releasing it to the caller", () => {
    const evicted: GlyphAtlas[] = [];
    const library = new FontLibrary(1, font, (atlas) => evicted.push(atlas));
    const first = library.get(10);
    for (let size = 11; size <= 18; size++) library.get(size); // 9 sizes: one over the cap

    expect(evicted).toEqual([first]);
    expect([...library.all()]).toHaveLength(8);
    // Asking for it again is a fresh atlas, not the evicted one back.
    expect(library.get(10)).not.toBe(first);
  });

  it("touching an atlas keeps it alive — recency, not insertion order", () => {
    const evicted: GlyphAtlas[] = [];
    const library = new FontLibrary(1, font, (atlas) => evicted.push(atlas));
    const first = library.get(10);
    for (let size = 11; size <= 17; size++) library.get(size); // at the cap of 8
    library.get(10); // touch the oldest…
    library.get(19); // …so the overflow drops 11, not 10

    expect(evicted).toHaveLength(1);
    expect(evicted[0]).not.toBe(first);
    expect(library.get(10)).toBe(first);
  });
});
