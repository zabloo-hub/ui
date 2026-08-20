import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { decodeBase64, loadFont, type StbFont } from "./ttf.js";

/**
 * These run against the real shipped TTF through the real WASM module — the
 * point of ZAB-43 is that this exact pair produces the metrics, so mocking
 * either would test nothing.
 */
describe("StbFont", () => {
  // A slot: the font arrives in `beforeAll`, so it cannot be a `const` the
  // describe closes over.
  const stb: { font: StbFont } = { font: null as unknown as StbFont };

  beforeAll(async () => {
    stb.font = await loadFont(decodeBase64(DEFAULT_FONT_BASE64));
  });

  it("rejects bytes that are not a font", async () => {
    await expect(loadFont(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/could not be parsed/);
  });

  it("reads the font's vertical metrics at the requested em size", () => {
    // Liberation Sans: 2048 units/em, ascender 1854, descender -434, lineGap 67.
    const m = stb.font.metrics(16);
    expect(m.ascent).toBeCloseTo((1854 / 2048) * 16, 3);
    expect(m.descent).toBeCloseTo((434 / 2048) * 16, 3);
    expect(m.lineGap).toBeCloseTo((67 / 2048) * 16, 3);
    expect(m.lineHeight).toBeCloseTo(m.ascent + m.descent + m.lineGap, 6);
  });

  it("scales metrics linearly with the em size", () => {
    expect(stb.font.metrics(32).lineHeight).toBeCloseTo(stb.font.metrics(16).lineHeight * 2, 6);
    expect(stb.font.advance("m", 32)).toBeCloseTo(stb.font.advance("m", 16) * 2, 6);
  });

  it("covers latin text and reports what it does not cover", () => {
    expect(stb.font.has("A")).toBe(true);
    expect(stb.font.has("ñ")).toBe(true);
    expect(stb.font.has("€")).toBe(true);
    // Private-use area — Liberation Sans has no glyph there.
    expect(stb.font.has("")).toBe(false);
  });

  it("keeps advances proportional and fractional", () => {
    expect(stb.font.advance("i", 16)).toBeLessThan(stb.font.advance("m", 16));
    expect(stb.font.advance(" ", 16)).toBeGreaterThan(0);
    // Fractional, not rounded: rounding metrics would drift a run glyph by glyph.
    expect(Number.isInteger(stb.font.advance("m", 16))).toBe(false);
  });

  it("reads kerning pairs from the font's own tables", () => {
    expect(stb.font.kern("A", "V", 16)).toBeLessThan(0);
    expect(stb.font.kern("n", "n", 16)).toBe(0);
  });

  it("rasterizes ink for a visible glyph", () => {
    const bitmap = stb.font.render("A", 32);
    expect(bitmap.width).toBeGreaterThan(0);
    expect(bitmap.height).toBeGreaterThan(0);
    expect(bitmap.coverage).toHaveLength(bitmap.width * bitmap.height);
    expect(bitmap.coverage.some((v) => v > 0)).toBe(true);
    // The box sits above the baseline: stb's Y grows downwards.
    expect(bitmap.y0).toBeLessThan(0);
    expect(bitmap.y1).toBeLessThanOrEqual(0);
  });

  it("puts a descender's ink below the baseline", () => {
    expect(stb.font.render("p", 32).y1).toBeGreaterThan(0);
  });

  it("returns an empty bitmap for whitespace", () => {
    const bitmap = stb.font.render(" ", 32);
    expect(bitmap.width).toBe(0);
    expect(bitmap.height).toBe(0);
    expect(bitmap.coverage).toHaveLength(0);
  });

  it("rasterizes deterministically", () => {
    const a = stb.font.render("g", 24);
    const b = stb.font.render("g", 24);
    expect(Array.from(b.coverage)).toEqual(Array.from(a.coverage));
  });

  it("leaves no stale ink in the bitmap it allocates", () => {
    // An "L" leaves its whole top-right quadrant empty: if the scratch buffer
    // were not cleared, the dirty bytes emmalloc hands back would show as ink.
    const l = stb.font.render("L", 48);
    expect(l.coverage[l.width - 1]).toBe(0);
    expect(l.coverage.filter((v) => v === 0).length).toBeGreaterThan(l.coverage.length / 2);
  });

  it("survives many glyphs, growing the WASM heap if it must", () => {
    for (const size of Array.from({ length: 12 }, (_, i) => (i + 1) * 8)) {
      for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") {
        expect(stb.font.render(char, size).coverage.some((v) => v > 0)).toBe(true);
      }
    }
  });
});
