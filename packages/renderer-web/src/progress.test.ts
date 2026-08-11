import { describe, expect, it } from "vitest";
import type { Rect } from "./layout.js";
import { fillMain, fillRect } from "./progress.js";

/** A 200×12 content box at the origin — the track minus its padding. */
const content: Rect = { x: 0, y: 0, width: 200, height: 12 };

describe("fillMain", () => {
  it("is the fraction of the content box", () => {
    expect(fillMain(200, 0.25)).toBe(50);
    expect(fillMain(200, 1)).toBe(200);
    expect(fillMain(200, 0)).toBe(0);
  });

  it("clamps the value instead of overflowing the track", () => {
    expect(fillMain(200, 1.5)).toBe(200);
    expect(fillMain(200, -1)).toBe(0);
    // A binding pointing at nothing (or at a string) shows an empty bar, not a full one.
    expect(fillMain(200, Number.NaN)).toBe(0);
  });

  it("never returns a negative size on a track smaller than its padding", () => {
    expect(fillMain(-10, 0.5)).toBe(0);
  });
});

describe("fillRect", () => {
  it("grows from the start of the main axis and spans the cross axis", () => {
    expect(fillRect(content, true, 0.25)).toEqual({ x: 0, y: 0, width: 50, height: 12 });
  });

  it("grows downwards on a column bar", () => {
    const vertical: Rect = { x: 0, y: 0, width: 12, height: 200 };
    expect(fillRect(vertical, false, 0.25)).toEqual({ x: 0, y: 0, width: 12, height: 50 });
  });

  it("anchors to the end with justify: end — the bar drains backwards", () => {
    expect(fillRect(content, true, 0.25, "end")).toEqual({ x: 150, y: 0, width: 50, height: 12 });
    const vertical: Rect = { x: 0, y: 0, width: 12, height: 200 };
    expect(fillRect(vertical, false, 0.25, "end")).toEqual({
      x: 0,
      y: 150,
      width: 12,
      height: 50,
    });
  });

  it("grows from the middle out with justify: center", () => {
    expect(fillRect(content, true, 0.5, "center")).toEqual({ x: 50, y: 0, width: 100, height: 12 });
  });

  it("falls back to the start for a justify with no meaning on one child", () => {
    expect(fillRect(content, true, 0.5, "space-between")).toMatchObject({ x: 0, width: 100 });
  });

  it("starts from the content box, so the track's padding insets the fill", () => {
    // A 200×12 track with padding 2 leaves a 196×8 content box at (2, 2).
    const padded: Rect = { x: 2, y: 2, width: 196, height: 8 };
    expect(fillRect(padded, true, 0.5)).toEqual({ x: 2, y: 2, width: 98, height: 8 });
  });

  it("is empty at 0 and the whole content box at 1", () => {
    expect(fillRect(content, true, 0)).toMatchObject({ width: 0 });
    expect(fillRect(content, true, 1)).toMatchObject({ x: 0, width: 200 });
    // At full, the anchor stops mattering — there is no leftover to lead with.
    expect(fillRect(content, true, 1, "end")).toMatchObject({ x: 0, width: 200 });
  });
});
