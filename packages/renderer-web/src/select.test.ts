import { describe, expect, it } from "vitest";
import { clampSelected, resolveTabsGroup } from "./select.js";

/** Plain stand-in for a node tree — the accessors are what select.ts needs. */
interface Node {
  type: string;
  children?: Node[];
  id?: string;
}

const typeOf = (n: Node) => n.type;
const childrenOf = (n: Node) => n.children ?? [];
const resolve = (children: Node[]) => resolveTabsGroup(children, typeOf, childrenOf);

const bar = (...ids: string[]): Node => ({
  type: "Container",
  children: ids.map((id) => ({ type: "Button", id })),
});
const panel = (id: string): Node => ({ type: "Container", id });

describe("resolveTabsGroup", () => {
  it("pairs the bar's buttons with the sibling panels, in order", () => {
    const { buttons, panels, warning } = resolve([
      bar("video", "audio"),
      panel("p-video"),
      panel("p-audio"),
    ]);
    expect(buttons.map((b) => b.id)).toEqual(["video", "audio"]);
    expect(panels.map((p) => p.id)).toEqual(["p-video", "p-audio"]);
    expect(warning).toBeNull();
  });

  it("ignores non-Button children of the bar, so decoration doesn't shift indices", () => {
    const decorated: Node = {
      type: "Container",
      children: [
        { type: "Text" },
        { type: "Button", id: "video" },
        { type: "Text" },
        { type: "Button", id: "audio" },
      ],
    };
    const { buttons } = resolve([decorated, panel("p-video"), panel("p-audio")]);
    expect(buttons.map((b) => b.id)).toEqual(["video", "audio"]);
  });

  it("degrades to the pairs that line up when the counts disagree", () => {
    const { buttons, panels, warning } = resolve([bar("a", "b", "c"), panel("p-a")]);
    expect(buttons.map((b) => b.id)).toEqual(["a"]);
    expect(panels.map((p) => p.id)).toEqual(["p-a"]);
    expect(warning).toMatch(/3 tab button\(s\) but 1 panel\(s\)/);
  });

  it("reports a group with no children at all", () => {
    expect(resolve([])).toEqual({ buttons: [], panels: [], warning: expect.stringMatching(/bar/) });
  });

  it("reports a bar without buttons", () => {
    const { buttons, warning } = resolve([{ type: "Container" }, panel("p")]);
    expect(buttons).toEqual([]);
    expect(warning).toMatch(/no Button children/);
  });

  it("reports a bar with buttons but no panels", () => {
    const { buttons, panels, warning } = resolve([bar("a")]);
    expect(buttons).toEqual([]);
    expect(panels).toEqual([]);
    expect(warning).toMatch(/1 tab button\(s\) but 0 panel\(s\)/);
  });
});

describe("clampSelected", () => {
  it("defaults to the first tab when the IR omits `selected`", () => {
    expect(clampSelected(undefined, 3)).toBe(0);
  });

  it("keeps an in-range index", () => {
    expect(clampSelected(2, 3)).toBe(2);
  });

  it("clamps out-of-range indices into the tab count", () => {
    expect(clampSelected(7, 3)).toBe(2);
    expect(clampSelected(-1, 3)).toBe(0);
  });

  it("ignores non-integer values (forward tolerance)", () => {
    expect(clampSelected(1.5, 3)).toBe(0);
    expect(clampSelected("1", 3)).toBe(0);
    expect(clampSelected(null, 3)).toBe(0);
  });

  it("returns 0 for an empty group", () => {
    expect(clampSelected(2, 0)).toBe(0);
  });
});
