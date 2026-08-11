import { describe, expect, it } from "vitest";
import type { Rect } from "./layout.js";
import { layoutText, placeLines, type TextLayoutOptions, type TextMetrics } from "./text.js";

/**
 * A monospace stand-in: every glyph advances 10px. Break points are a pure function
 * of the advances, so a fake font tests the algorithm exactly like a real one — and
 * the expected widths stay readable (a 3-letter word is 30 wide).
 */
const FONT: TextMetrics = {
  advance: () => 10,
  kern: () => 0,
  lineHeight: 20,
  ascent: 16,
};

/** A font with real per-glyph variation, to catch anything that assumes uniformity. */
const PROPORTIONAL: TextMetrics = {
  advance: (char) => (char === "i" ? 4 : 10),
  kern: () => 0,
  lineHeight: 20,
  ascent: 16,
};

/** Kerns "AV" tight, like a real font does — nothing else pairs. */
const KERNED: TextMetrics = {
  advance: () => 10,
  kern: (previous, char) => (previous === "A" && char === "V" ? -6 : 0),
  lineHeight: 20,
  ascent: 16,
};

const NBSP = " ";

function options(overrides: Partial<TextLayoutOptions> = {}): TextLayoutOptions {
  return {
    wrap: true,
    maxWidth: null,
    lineHeight: FONT.lineHeight,
    maxLines: null,
    overflow: "clip",
    ...overrides,
  };
}

/** Just the text of each line — what the break points actually are. */
function texts(content: string, opts: Partial<TextLayoutOptions>, font = FONT): string[] {
  return layoutText(content, font, options(opts)).lines.map((line) => line.text);
}

describe("layoutText — wrapping", () => {
  it("keeps text that fits on one line", () => {
    const block = layoutText("ab cd", FONT, options({ maxWidth: 100 }));
    expect(block.lines).toEqual([{ text: "ab cd", width: 50 }]);
    expect(block.truncated).toBe(false);
  });

  it("breaks greedily at spaces, filling each line as far as it fits", () => {
    // 10px/glyph: "aaa bbb" = 70 > 60, so the second word moves down.
    expect(texts("aaa bbb ccc", { maxWidth: 60 })).toEqual(["aaa", "bbb", "ccc"]);
    expect(texts("aaa bbb ccc", { maxWidth: 70 })).toEqual(["aaa bbb", "ccc"]);
  });

  it("drops the spaces at a break but keeps the ones that start a line", () => {
    expect(layoutText("aaa   bbb", FONT, options({ maxWidth: 60 })).lines).toEqual([
      { text: "aaa", width: 30 },
      { text: "bbb", width: 30 },
    ]);
    // Indentation is content: it paints, so it counts toward the width.
    expect(layoutText("  ab", FONT, options({ maxWidth: 100 })).lines).toEqual([
      { text: "  ab", width: 40 },
    ]);
  });

  it("excludes trailing spaces from a line's width", () => {
    expect(layoutText("ab   ", FONT, options({ maxWidth: 100 })).lines).toEqual([
      { text: "ab", width: 20 },
    ]);
  });

  it("breaks on tabs, never on a non-breaking space", () => {
    expect(texts("aa\tbb", { maxWidth: 30 })).toEqual(["aa", "bb"]);
    // U+00A0 holds its two words together: the pair moves down whole, and when it
    // does not fit at all it breaks between glyphs like any other long word.
    expect(texts(`cc aa${NBSP}bb`, { maxWidth: 50 })).toEqual(["cc", `aa${NBSP}bb`]);
    expect(texts(`aa${NBSP}bb`, { maxWidth: 30 })).toEqual([`aa${NBSP}`, "bb"]);
  });

  it("breaks a word too long for its own line between glyphs", () => {
    expect(texts("aaaaaaa", { maxWidth: 30 })).toEqual(["aaa", "aaa", "a"]);
    expect(texts("ab cdefgh", { maxWidth: 40 })).toEqual(["ab", "cdef", "gh"]);
  });

  it("puts at least one glyph on a line narrower than a single glyph", () => {
    // The minimum-one-glyph rule wins over the width: the alternative is a Text
    // that renders nothing at all.
    expect(texts("abc", { maxWidth: 3 })).toEqual(["a", "b", "c"]);
  });

  it("measures each glyph, not an average", () => {
    // A narrow "iii" (12) fits next to "aa" where an "aaa" (30) would not.
    expect(texts("aa iii aa", { maxWidth: 45 }, PROPORTIONAL)).toEqual(["aa iii", "aa"]);
    expect(texts("aa aaa aa", { maxWidth: 45 })).toEqual(["aa", "aaa", "aa"]);
  });

  it("counts the font's kerning, and drops the pair a break splits", () => {
    // "AV" kerns to 14, so it fits in 15 where two unkerned glyphs would not.
    expect(layoutText("AV", KERNED, options({ maxWidth: 15 })).lines).toEqual([
      { text: "AV", width: 14 },
    ]);
    // Broken between the two, neither line keeps the pair: 10 each, not 4 and 10.
    expect(layoutText("AV", KERNED, options({ maxWidth: 12 })).lines).toEqual([
      { text: "A", width: 10 },
      { text: "V", width: 10 },
    ]);
    // And the pair straddling a word break is gone with the space too.
    expect(layoutText("xA Vx", KERNED, options({ maxWidth: 30 })).lines).toEqual([
      { text: "xA", width: 20 },
      { text: "Vx", width: 20 },
    ]);
  });

  it("does not wrap without a usable width", () => {
    expect(texts("aaa bbb ccc", { maxWidth: null })).toEqual(["aaa bbb ccc"]);
    expect(texts("aaa bbb ccc", { maxWidth: 0 })).toEqual(["aaa bbb ccc"]);
    // `wrap: false` is one line whatever the width — `overflow` then decides how
    // much of it survives (see the truncation suite).
    expect(texts("aaa bbb ccc", { maxWidth: 30, wrap: false })).toEqual(["aaa"]);
  });
});

describe("layoutText — hard breaks", () => {
  it("always breaks on a newline, whatever the width", () => {
    expect(texts("ab\ncd", { maxWidth: 1000 })).toEqual(["ab", "cd"]);
    expect(texts("ab\ncd", { maxWidth: null, wrap: false })).toEqual(["ab", "cd"]);
  });

  it("normalizes CRLF and a lone CR", () => {
    expect(texts("ab\r\ncd\ref", { maxWidth: null })).toEqual(["ab", "cd", "ef"]);
  });

  it("gives an empty paragraph a line of its own, so a blank line takes space", () => {
    const block = layoutText("ab\n\ncd", FONT, options({ maxWidth: 100 }));
    expect(block.lines.map((line) => line.text)).toEqual(["ab", "", "cd"]);
    expect(block.height).toBe(60);
  });

  it("wraps each paragraph independently", () => {
    expect(texts("aaa bbb\nccc ddd", { maxWidth: 30 })).toEqual(["aaa", "bbb", "ccc", "ddd"]);
  });
});

describe("layoutText — size", () => {
  it("is as wide as its widest line and as tall as lines × lineHeight", () => {
    const block = layoutText("aaaa bb", FONT, options({ maxWidth: 40, lineHeight: 24 }));
    expect(block.lines.map((line) => line.text)).toEqual(["aaaa", "bb"]);
    expect(block.width).toBe(40);
    expect(block.height).toBe(48);
    expect(block.lineHeight).toBe(24);
  });

  it("measures an empty text as one empty line", () => {
    const block = layoutText("", FONT, options({ maxWidth: 100 }));
    expect(block.lines).toEqual([{ text: "", width: 0 }]);
    expect(block.height).toBe(20);
  });
});

describe("layoutText — truncation", () => {
  it("drops the lines past maxLines", () => {
    const block = layoutText("aaa bbb ccc", FONT, options({ maxWidth: 30, maxLines: 2 }));
    expect(block.lines.map((line) => line.text)).toEqual(["aaa", "bbb"]);
    expect(block.truncated).toBe(true);
    expect(block.height).toBe(40);
  });

  it("marks the last kept line with an ellipsis", () => {
    const block = layoutText(
      "aaa bbb ccc",
      FONT,
      options({ maxWidth: 30, maxLines: 2, overflow: "ellipsis" }),
    );
    // "bbb…" would be 40 > 30, so glyphs go until the mark fits.
    expect(block.lines.map((line) => line.text)).toEqual(["aaa", "bb…"]);
    expect(block.lines[1].width).toBe(30);
  });

  it("leaves the kept lines alone when clipping — clip has no mark", () => {
    const block = layoutText("aaa bbb", FONT, options({ maxWidth: 30, maxLines: 1 }));
    expect(block.lines).toEqual([{ text: "aaa", width: 30 }]);
    expect(block.truncated).toBe(true);
  });

  it("does not truncate when everything fits within maxLines", () => {
    const block = layoutText("aaa bbb", FONT, options({ maxWidth: 30, maxLines: 5 }));
    expect(block.lines).toHaveLength(2);
    expect(block.truncated).toBe(false);
  });

  it("clips the glyphs that cross the boundary of an unwrapped line", () => {
    const block = layoutText("abcdefgh", FONT, options({ maxWidth: 35, wrap: false }));
    expect(block.lines).toEqual([{ text: "abc", width: 30 }]);
    expect(block.truncated).toBe(true);
  });

  it("ellipsizes an unwrapped line, dropping the spaces the mark uncovers", () => {
    const block = layoutText(
      "ab cdefgh",
      FONT,
      options({ maxWidth: 40, wrap: false, overflow: "ellipsis" }),
    );
    expect(block.lines).toEqual([{ text: "ab…", width: 30 }]);
  });

  it("keeps the mark even when not a single glyph fits beside it", () => {
    const block = layoutText(
      "abcd",
      FONT,
      options({ maxWidth: 5, wrap: false, overflow: "ellipsis" }),
    );
    expect(block.lines[0].text).toBe("…");
  });
});

describe("placeLines", () => {
  const RECT: Rect = { x: 100, y: 200, width: 80, height: 100 };
  type Align = "start" | "center" | "end";

  function place(
    content: string,
    opts: Partial<TextLayoutOptions>,
    align: Align,
    alignY: Align = "start",
  ) {
    return placeLines(layoutText(content, FONT, options(opts)), RECT, FONT, align, alignY);
  }

  it("stacks the lines one lineHeight apart from the rect's top-left", () => {
    expect(place("aa bb", { maxWidth: 20 }, "start")).toEqual([
      { text: "aa", x: 100, y: 200 },
      { text: "bb", x: 100, y: 220 },
    ]);
  });

  it("aligns each line by its OWN width", () => {
    // Lines of 20 and 40 inside a rect of 80.
    expect(place("aa bbbb", { maxWidth: 40 }, "center").map((line) => line.x)).toEqual([130, 120]);
    expect(place("aa bbbb", { maxWidth: 40 }, "end").map((line) => line.x)).toEqual([160, 140]);
  });

  it("aligns the block as a whole on the vertical axis", () => {
    // Two lines = 40 tall inside a rect of 100.
    expect(place("aa bb", { maxWidth: 20 }, "start", "center").map((line) => line.y)).toEqual([
      230, 250,
    ]);
    expect(place("aa bb", { maxWidth: 20 }, "start", "end").map((line) => line.y)).toEqual([
      260, 280,
    ]);
  });

  it("splits the extra leading of a taller lineHeight above and below each line", () => {
    // lineHeight 30 over a font of 20: 5px above every line, so raising it does not
    // push a single-line Text off its box.
    expect(place("aa bb", { maxWidth: 20, lineHeight: 30 }, "start")).toEqual([
      { text: "aa", x: 100, y: 205 },
      { text: "bb", x: 100, y: 235 },
    ]);
  });

  it("starts at the rect's edge when the block overflows it", () => {
    const tight: Rect = { x: 100, y: 200, width: 80, height: 20 };
    const block = layoutText("aaaaaaaaaaaa", FONT, options({ wrap: false }));
    expect(placeLines(block, tight, FONT, "center", "center")).toEqual([
      { text: "aaaaaaaaaaaa", x: 100, y: 200 },
    ]);
  });
});
