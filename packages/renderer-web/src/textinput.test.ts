import { describe, expect, it } from "vitest";
import type { TextMetrics } from "./text.js";
import {
  caretAt,
  caretVisible,
  caretX,
  clampSelection,
  codePointIndex,
  indexAtX,
  insert,
  moveCaret,
  moveToEdge,
  remove,
  sanitizeLine,
  scrollFor,
  selectAll,
  selectedText,
  span,
  utf16Offset,
} from "./textinput.js";

/** Monospace stand-in: every glyph advances 10px, so the expected x stays readable. */
const FONT: TextMetrics = {
  advance: () => 10,
  kern: () => 0,
  lineHeight: 20,
  ascent: 16,
};

/** Kerns "AV" tight, like a real font — the caret must sit on the painted seam. */
const KERNED: TextMetrics = {
  advance: () => 10,
  kern: (previous, char) => (previous === "A" && char === "V" ? -6 : 0),
  lineHeight: 20,
  ascent: 16,
};

describe("insert", () => {
  it("inserts at the caret", () => {
    expect(insert("hola", caretAt(4), "!")).toEqual({
      text: "hola!",
      selection: caretAt(5),
    });
    expect(insert("hla", caretAt(1), "o")).toEqual({ text: "hola", selection: caretAt(2) });
  });

  it("replaces the selection and leaves the caret after the insertion", () => {
    expect(insert("hola mundo", { anchor: 5, focus: 10 }, "tú")).toEqual({
      text: "hola tú",
      selection: caretAt(7),
    });
  });

  it("replaces a backwards selection the same way", () => {
    expect(insert("hola mundo", { anchor: 10, focus: 5 }, "tú")).toEqual({
      text: "hola tú",
      selection: caretAt(7),
    });
  });

  it("counts maxLength over the whole field, keeping the prefix that fits", () => {
    expect(insert("abc", caretAt(3), "defg", 5)).toEqual({ text: "abcde", selection: caretAt(5) });
    // The selection it replaces frees its own room.
    expect(insert("abc", { anchor: 0, focus: 2 }, "XYZ", 4)).toEqual({
      text: "XYZc",
      selection: caretAt(3),
    });
  });

  it("drops the insertion entirely when the field is full", () => {
    expect(insert("abcde", caretAt(5), "f", 5)).toEqual({ text: "abcde", selection: caretAt(5) });
  });

  it("ignores a non-positive maxLength", () => {
    expect(insert("abc", caretAt(3), "d", 0).text).toBe("abcd");
  });

  it("turns pasted newlines and tabs into spaces (v1 is one line)", () => {
    expect(insert("", caretAt(0), "calle 1\nmadrid").text).toBe("calle 1 madrid");
    expect(insert("", caretAt(0), "a\r\nb").text).toBe("a b");
  });

  it("counts code points, so an emoji is one character", () => {
    const edit = insert("", caretAt(0), "🎮", 1);
    expect(edit.text).toBe("🎮");
    expect(edit.selection).toEqual(caretAt(1));
    expect(insert("🎮", caretAt(1), "x", 1).text).toBe("🎮");
  });
});

describe("remove", () => {
  it("eats the character behind the caret on backspace", () => {
    expect(remove("hola", caretAt(4), false)).toEqual({ text: "hol", selection: caretAt(3) });
  });

  it("eats the character ahead on delete", () => {
    expect(remove("hola", caretAt(0), true)).toEqual({ text: "ola", selection: caretAt(0) });
  });

  it("deletes the selection whichever key was pressed", () => {
    const selection = { anchor: 1, focus: 3 };
    expect(remove("hola", selection, false)).toEqual({ text: "ha", selection: caretAt(1) });
    expect(remove("hola", selection, true)).toEqual({ text: "ha", selection: caretAt(1) });
  });

  it("does nothing at the edges", () => {
    expect(remove("hola", caretAt(0), false)).toEqual({ text: "hola", selection: caretAt(0) });
    expect(remove("hola", caretAt(4), true)).toEqual({ text: "hola", selection: caretAt(4) });
  });

  it("removes a whole emoji, never half of it", () => {
    expect(remove("a🎮", caretAt(2), false)).toEqual({ text: "a", selection: caretAt(1) });
  });
});

describe("moveCaret", () => {
  it("steps one character", () => {
    expect(moveCaret("hola", caretAt(2), 1, false).selection).toEqual(caretAt(3));
    expect(moveCaret("hola", caretAt(2), -1, false).selection).toEqual(caretAt(1));
  });

  it("collapses a selection to the edge it is pushed against, without stepping", () => {
    const selection = { anchor: 1, focus: 3 };
    expect(moveCaret("hola", selection, -1, false).selection).toEqual(caretAt(1));
    expect(moveCaret("hola", selection, 1, false).selection).toEqual(caretAt(3));
  });

  it("drags the focus alone while extending, so shift+arrow also shrinks", () => {
    const grown = moveCaret("hola", caretAt(1), 1, true).selection;
    expect(grown).toEqual({ anchor: 1, focus: 2 });
    expect(moveCaret("hola", grown, 1, true).selection).toEqual({ anchor: 1, focus: 3 });
    expect(moveCaret("hola", grown, -1, true).selection).toEqual({ anchor: 1, focus: 1 });
  });

  it("reports the boundary only when a bare caret had nowhere to go", () => {
    expect(moveCaret("hola", caretAt(0), -1, false).atBoundary).toBe(true);
    expect(moveCaret("hola", caretAt(4), 1, false).atBoundary).toBe(true);
    expect(moveCaret("hola", caretAt(1), -1, false).atBoundary).toBe(false);
    // A selection to collapse is something to do, so it is not a boundary.
    expect(moveCaret("hola", { anchor: 0, focus: 2 }, -1, false).atBoundary).toBe(false);
    expect(moveCaret("", caretAt(0), 1, false).atBoundary).toBe(true);
  });
});

describe("moveToEdge", () => {
  it("jumps to the start and the end", () => {
    expect(moveToEdge("hola", caretAt(2), true, false).selection).toEqual(caretAt(4));
    expect(moveToEdge("hola", caretAt(2), false, false).selection).toEqual(caretAt(0));
  });

  it("selects up to the edge while extending", () => {
    expect(moveToEdge("hola", caretAt(2), true, true).selection).toEqual({ anchor: 2, focus: 4 });
  });

  it("is a boundary only when the caret is already there with nothing selected", () => {
    expect(moveToEdge("hola", caretAt(4), true, false).atBoundary).toBe(true);
    expect(moveToEdge("hola", { anchor: 0, focus: 4 }, true, false).atBoundary).toBe(false);
  });
});

describe("selection helpers", () => {
  it("orders and clamps a span", () => {
    expect(span({ anchor: 3, focus: 1 }, 4)).toEqual({ start: 1, end: 3 });
    expect(span({ anchor: -2, focus: 99 }, 4)).toEqual({ start: 0, end: 4 });
  });

  it("reads the selected substring", () => {
    expect(selectedText("hola mundo", { anchor: 5, focus: 10 })).toBe("mundo");
    expect(selectedText("hola", caretAt(2))).toBe("");
  });

  it("keeps a selection inside a text the game shortened under it", () => {
    expect(clampSelection({ anchor: 2, focus: 8 }, 3)).toEqual({ anchor: 2, focus: 3 });
  });

  it("anchors select-all at the start, so shift+left shrinks it", () => {
    expect(selectAll("hola")).toEqual({ anchor: 0, focus: 4 });
  });
});

describe("caretX / indexAtX", () => {
  it("measures up to the seam before the index", () => {
    expect(caretX("hola", 0, FONT)).toBe(0);
    expect(caretX("hola", 2, FONT)).toBe(20);
    expect(caretX("hola", 4, FONT)).toBe(40);
  });

  it("includes kerning, so the caret lands where the glyphs are painted", () => {
    expect(caretX("AV", 2, KERNED)).toBe(14);
  });

  it("clamps an index past the end", () => {
    expect(caretX("hola", 99, FONT)).toBe(40);
  });

  it("snaps a pointer to the nearest seam", () => {
    expect(indexAtX("hola", 0, FONT)).toBe(0);
    expect(indexAtX("hola", 4, FONT)).toBe(0); // left half of the first glyph
    expect(indexAtX("hola", 6, FONT)).toBe(1); // right half
    expect(indexAtX("hola", 25, FONT)).toBe(3);
    expect(indexAtX("hola", 999, FONT)).toBe(4);
  });

  it("round-trips against the painted positions, kerning included", () => {
    expect(indexAtX("AV", caretX("AV", 1, KERNED), KERNED)).toBe(1);
  });

  it("treats an emoji as one indivisible step", () => {
    expect(indexAtX("a🎮", 25, FONT)).toBe(2);
    expect(caretX("a🎮", 1, FONT)).toBe(10);
  });
});

describe("scrollFor", () => {
  it("stays put while the caret is inside the viewport", () => {
    expect(scrollFor(0, 30, 100, 40)).toBe(0);
  });

  it("follows the caret out of the right edge by the smallest step", () => {
    expect(scrollFor(0, 120, 100, 200)).toBe(21); // caret width included
  });

  it("follows the caret out of the left edge", () => {
    expect(scrollFor(50, 20, 100, 200)).toBe(20);
  });

  it("never scrolls past the content, and snaps back when the text fits again", () => {
    expect(scrollFor(500, 40, 100, 40)).toBe(0);
    expect(scrollFor(80, 200, 100, 200)).toBe(101);
  });
});

describe("the bridge to the browser's own field", () => {
  it("folds newlines and tabs into spaces", () => {
    expect(sanitizeLine("a\n\tb")).toBe("a b");
    expect(sanitizeLine("plano")).toBe("plano");
  });

  it("converts between UTF-16 offsets and code point indices", () => {
    // The emoji is two UTF-16 units and one character.
    expect(codePointIndex("a🎮b", 3)).toBe(2);
    expect(codePointIndex("a🎮b", 1)).toBe(1);
    expect(utf16Offset("a🎮b", 2)).toBe(3);
    expect(utf16Offset("a🎮b", 3)).toBe(4);
  });

  it("round-trips a caret through both conversions", () => {
    const text = "hola 🎮 mundo";
    for (const i of Array(13).keys()) {
      expect(codePointIndex(text, utf16Offset(text, i))).toBe(i);
    }
  });

  it("clamps an offset past either end", () => {
    expect(codePointIndex("abc", -5)).toBe(0);
    expect(utf16Offset("abc", 99)).toBe(3);
  });
});

describe("caretVisible", () => {
  it("is on for the first half of every period", () => {
    expect(caretVisible(0, 1000)).toBe(true);
    expect(caretVisible(499, 1000)).toBe(true);
    expect(caretVisible(500, 1000)).toBe(false);
    expect(caretVisible(1200, 1000)).toBe(true);
  });

  it("stays on when the blink is disabled or the clock is broken", () => {
    expect(caretVisible(700, 0)).toBe(true);
    expect(caretVisible(Number.NaN, 1000)).toBe(true);
  });
});
