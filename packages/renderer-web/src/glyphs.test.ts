import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { FontLibrary, GlyphAtlas } from "./glyphs.js";
import { layoutText } from "./text.js";
import { decodeBase64, type GlyphBitmap, loadFont, type StbFont } from "./ttf.js";

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

/**
 * A rasterizer we control, for the two inputs the real one cannot be talked into
 * producing cheaply: a glyph bigger than any atlas, and a failure. Structural,
 * so the cast is what stands in for the class's private WASM state — the atlas
 * only ever calls these five methods.
 */
/** A coverage bitmap of a given size, ink box hanging above the baseline. */
function bitmap(width: number, height: number): GlyphBitmap {
  return {
    width,
    height,
    x0: 0,
    y0: -height,
    x1: width,
    y1: 0,
    coverage: new Uint8Array(width * height),
  };
}

function stubFont(render: StbFont["render"]): StbFont {
  return {
    metrics: () => ({ ascent: 12, descent: 3, lineGap: 0, lineHeight: 15 }),
    advance: () => 10,
    kern: () => 0,
    has: () => true,
    glyphIndex: () => 1,
    render,
    dispose: () => {},
  } as unknown as StbFont;
}

describe("GlyphAtlas hardening (ZAB-69)", () => {
  it("blanks a glyph wider than the atlas itself instead of writing UVs past 1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    written = [];
    // Wider than MAX_ATLAS_SIZE, short enough that only the WIDTH is the problem
    // — growth by height alone used to place it anyway, off the right edge.
    const atlas = new GlyphAtlas(
      16,
      1,
      stubFont(() => bitmap(5000, 10)),
    );
    const glyph = atlas.get("A");

    expect(glyph?.hasQuad).toBe(false);
    // The advance survives: the run still reserves the space it always did.
    expect(glyph?.advance).toBe(10);
    for (const uv of [glyph?.u0, glyph?.v0, glyph?.u1, glyph?.v1]) {
      expect(uv).toBeLessThanOrEqual(1);
    }
    // Nothing was written into the atlas, at any offset.
    expect(written).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("degrades to a blank glyph when the rasterizer throws, instead of killing the view", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const atlas = new GlyphAtlas(
      16,
      1,
      stubFont(() => {
        // What `ttf.ts` throws when `zb_malloc` cannot serve the coverage buffer —
        // reached from the measure pass, inside render(), with nobody catching.
        throw new Error("zabloo renderer: out of WASM memory rasterizing a glyph");
      }),
    );

    expect(() => atlas.get("A")).not.toThrow();
    expect(atlas.get("A")?.hasQuad).toBe(false);
    expect(atlas.get("A")?.advance).toBe(10);
    // Measuring a run over the broken font still answers, so the frame survives.
    expect(runWidth(atlas, "AAA")).toBe(30);
    // Cached like any other glyph: the failure is not retried, and not re-warned.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("asks the font for each kerning pair once, not once per frame", () => {
    const kern = vi.fn((_previous: string, _char: string, _pixelSize: number) => -2);
    const atlas = new GlyphAtlas(16, 1, {
      ...stubFont(() => bitmap(4, 4)),
      kern,
    } as unknown as StbFont);

    // Ten frames measuring the same run — and the real renderer walks it twice a
    // frame, since the tessellator kerns the paint loop the same way.
    for (let frame = 0; frame < 10; frame++) expect(runWidth(atlas, "AVAV")).toBe(34);

    // "AVAV" has two distinct pairs, AV and VA. That is the whole cost.
    expect(kern).toHaveBeenCalledTimes(2);
    expect(atlas.kern("A", "V")).toBe(-2);
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

  /**
   * The library holds up to 8 canvases of up to 4096² RGBA — half a gigabyte in
   * the worst case, reclaimable only by the GC (ZAB-72). A page that mounts and
   * drops views (a preview switching documents, an editor opening tabs) has to be
   * able to give that back at the moment it disposes the view.
   */
  it("releases every atlas bitmap on dispose", () => {
    const library = new FontLibrary(1, font);
    const atlases = [library.get(16), library.get(24)];

    library.dispose();

    expect([...library.all()]).toEqual([]);
    // Resizing to zero is what actually frees the backing store; dropping the
    // reference alone would leave it up to the GC.
    for (const atlas of atlases) {
      expect(atlas.canvas.width).toBe(0);
      expect(atlas.canvas.height).toBe(0);
    }
  });

  it("starts over after a dispose, instead of handing back a dead atlas", () => {
    const library = new FontLibrary(1, font);
    const before = library.get(16);

    library.dispose();

    expect(library.get(16)).not.toBe(before);
    expect(library.get(16).canvas.width).toBeGreaterThan(0);
  });
});
