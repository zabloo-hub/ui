import type { ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import {
  emptySlots,
  itemsOf,
  itemsPerLine,
  itemTemplate,
  lineCount,
  reconcileWindow,
  visibleSpan,
  windowSlots,
} from "./repeat.js";

const repeat = (children: ZNode[]): ZNode =>
  ({ type: "Repeat", items: { bind: "shop.items" }, children }) as ZNode;

const text = (value: string): ZNode => ({ type: "Text", text: value });

describe("slots — the positional convention", () => {
  it("takes children[0] as the template and children[1..] as the empty state", () => {
    const ir = repeat([text("row"), text("nada"), text("aún")]);
    expect(itemTemplate(ir)).toEqual(text("row"));
    expect(emptySlots(ir)).toEqual([text("nada"), text("aún")]);
  });

  it("has no template and no empty state when there are no children", () => {
    const ir = repeat([]);
    expect(itemTemplate(ir)).toBeUndefined();
    expect(emptySlots(ir)).toEqual([]);
  });
});

describe("itemsOf — anything that is not an array is the empty case", () => {
  it("repeats the elements of an array", () => {
    expect(itemsOf([1, 2])).toEqual([1, 2]);
  });

  it("repeats nothing for missing data or a value of the wrong shape", () => {
    expect(itemsOf(undefined)).toEqual([]);
    expect(itemsOf({ length: 3 })).toEqual([]);
    expect(itemsOf("items")).toEqual([]);
  });
});

describe("windowSlots — the identity each instance is keyed by", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("keys by the declared key path, in the keyed space", () => {
    expect(windowSlots(items, "id", 0, 3)).toEqual([
      { index: 0, identity: "k:a" },
      { index: 1, identity: "k:b" },
      { index: 2, identity: "k:c" },
    ]);
  });

  it("falls back to the position when there is no key", () => {
    expect(windowSlots(items, undefined, 0, 3).map((slot) => slot.identity)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  it("covers only the window, clamped to the array", () => {
    expect(windowSlots(items, "id", 1, 10)).toEqual([
      { index: 1, identity: "k:b" },
      { index: 2, identity: "k:c" },
    ]);
    // The window is [first, first + count) intersected with the array: it never
    // walks off either end, whatever the geometry hands it.
    expect(windowSlots(items, "id", -1, 3)).toEqual([
      { index: 0, identity: "k:a" },
      { index: 1, identity: "k:b" },
    ]);
  });

  it("gives a duplicated key its positional identity — one identity is one instance", () => {
    const dup = [{ id: "a" }, { id: "a" }];
    expect(windowSlots(dup, "id", 0, 2)).toEqual([
      { index: 0, identity: "k:a" },
      { index: 1, identity: "1" },
    ]);
  });
});

describe("reconcileWindow — what survives a SetData", () => {
  it("moves an instance with its item when the array reorders", () => {
    const previous = new Map([
      ["k:a", "A"],
      ["k:b", "B"],
    ]);
    const { entries, dropped } = reconcileWindow(previous, [
      { index: 0, identity: "k:b" },
      { index: 1, identity: "k:a" },
    ]);
    expect(entries.map((entry) => entry.instance)).toEqual(["B", "A"]);
    expect(dropped).toEqual([]);
  });

  it("builds what is new and drops what left the window", () => {
    const previous = new Map([
      ["k:a", "A"],
      ["k:gone", "G"],
    ]);
    const { entries, dropped } = reconcileWindow(previous, [
      { index: 0, identity: "k:a" },
      { index: 1, identity: "k:new" },
    ]);
    expect(entries.map((entry) => entry.instance)).toEqual(["A", undefined]);
    expect(dropped).toEqual(["G"]);
  });

  it("never hands the same instance to two slots", () => {
    const previous = new Map([["k:a", "A"]]);
    const { entries } = reconcileWindow(previous, [
      { index: 0, identity: "k:a" },
      { index: 1, identity: "k:a" },
    ]);
    expect(entries.map((entry) => entry.instance)).toEqual(["A", undefined]);
  });
});

describe("itemsPerLine / lineCount — the grid arithmetic", () => {
  it("fits as many as the line takes, counting the gaps between them", () => {
    // 4 × 72 + 3 × 8 = 312 — the width <Grid> resolves for 4 columns.
    expect(itemsPerLine(312, 72, 8)).toBe(4);
    expect(itemsPerLine(311, 72, 8)).toBe(3);
  });

  it("always gives one line at least, however wide the item is", () => {
    expect(itemsPerLine(100, 400, 0)).toBe(1);
    expect(itemsPerLine(0, 72, 8)).toBe(1);
  });

  it("counts the lines a number of items needs", () => {
    expect(lineCount(9, 4)).toBe(3);
    expect(lineCount(0, 4)).toBe(0);
  });
});

describe("visibleSpan — the window a viewport sees", () => {
  const metrics = { extent: 40, gap: 10, perLine: 1 };

  it("reserves every line, realized or not — the scroll bounds do not depend on the window", () => {
    const span = visibleSpan(100, metrics, 0, 200, 0);
    expect(span.reserved).toBe(100 * 40 + 99 * 10);
  });

  it("realizes the lines the viewport crosses, and nothing else", () => {
    // stride 50: the viewport [500, 700) covers lines 10..14.
    const span = visibleSpan(100, metrics, 500, 200, 0);
    expect(span).toEqual({ first: 10, count: 5, lead: 500, reserved: 4990, perLine: 1 });
  });

  it("keeps a buffer of lines on both sides, so a scroll never shows a hole", () => {
    const span = visibleSpan(100, metrics, 500, 200, 2);
    expect(span.first).toBe(8);
    expect(span.count).toBe(9);
    expect(span.lead).toBe(400);
  });

  it("clamps at both ends of the array", () => {
    const top = visibleSpan(100, metrics, 0, 200, 2);
    expect(top.first).toBe(0);
    expect(top.lead).toBe(0);
    const bottom = visibleSpan(10, metrics, 10_000, 200, 2);
    expect(bottom.first).toBe(9);
    expect(bottom.count).toBe(1);
  });

  it("realizes everything when the array is smaller than the viewport", () => {
    const span = visibleSpan(3, metrics, 0, 600, 2);
    expect(span).toEqual({ first: 0, count: 3, lead: 0, reserved: 140, perLine: 1 });
  });

  it("counts LINES, not items, when the node wraps", () => {
    const grid = { extent: 60, gap: 8, perLine: 4 };
    // stride 68: the viewport [136, 340) covers lines 2..5 → items 8..23.
    const span = visibleSpan(100, grid, 136, 204, 0);
    expect(span).toEqual({
      first: 8,
      count: 16,
      lead: 136,
      reserved: 25 * 60 + 24 * 8,
      perLine: 4,
    });
  });

  it("realizes everything when the extent is not known yet", () => {
    const span = visibleSpan(50, { extent: 0, gap: 0, perLine: 1 }, 0, 200);
    expect(span.first).toBe(0);
    expect(span.count).toBe(50);
  });

  it("has nothing to reserve for an empty array", () => {
    expect(visibleSpan(0, metrics, 0, 200)).toEqual({
      first: 0,
      count: 0,
      lead: 0,
      reserved: 0,
      perLine: 1,
    });
  });
});
