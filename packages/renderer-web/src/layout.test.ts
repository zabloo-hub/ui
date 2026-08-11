import type { ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { type LayoutNode, type MeasureLeaf, measure } from "./layout.js";
import type { ResolvedValues } from "./transition.js";
import { createNodeAnim } from "./transition.js";

/**
 * A tree in the state the resolve pass leaves it in: tokens already collapsed into
 * `resolved`, which is where measure reads its width and padding from.
 */
function node(
  ir: Partial<ZNode> & { type: string },
  resolved: ResolvedValues = {},
  children: LayoutNode[] = [],
): LayoutNode {
  const built: LayoutNode = {
    ir: ir as ZNode,
    parent: null,
    children,
    measured: { x: 0, y: 0 },
    rect: { x: 0, y: 0, width: 0, height: 0 },
    pressed: false,
    focused: false,
    open: true,
    selected: false,
    selectedIndex: 0,
    checked: false,
    groupValue: undefined,
    visibleFlag: true,
    sectionShown: true,
    scrollOffset: { x: 0, y: 0 },
    scrollMax: { x: 0, y: 0 },
    resolved,
    textBlock: null,
    anim: createNodeAnim(),
  };
  for (const child of children) child.parent = built;
  return built;
}

const leaf = (resolved: ResolvedValues = {}) => node({ type: "Text", text: "" }, resolved);

/** Records the width offered to every leaf — the input a Text wraps to. */
function recorder(size = { x: 0, y: 0 }): {
  offers: Array<number | null>;
  measureLeaf: MeasureLeaf;
} {
  const offers: Array<number | null> = [];
  return {
    offers,
    measureLeaf: (_node, availableWidth) => {
      offers.push(availableWidth);
      return size;
    },
  };
}

describe("measure — the available width offered to a leaf", () => {
  it("offers the view width to a root leaf", () => {
    const { offers, measureLeaf } = recorder();
    measure(leaf(), measureLeaf, 300);
    expect(offers).toEqual([300]);
  });

  it("offers nothing when nothing is offered — unconstrained means no wrapping", () => {
    const { offers, measureLeaf } = recorder();
    measure(leaf(), measureLeaf, null);
    expect(offers).toEqual([null]);
  });

  it("subtracts the padding of every node it crosses, its own included", () => {
    const text = leaf({ padding: 4 });
    const root = node({ type: "Container" }, { padding: 10 }, [text]);
    const { offers, measureLeaf } = recorder();
    measure(root, measureLeaf, 300);
    expect(offers).toEqual([300 - 20 - 8]);
  });

  it("replaces the offer with an explicit width, on the node itself or on an ancestor", () => {
    const { offers, measureLeaf } = recorder();
    measure(leaf({ width: 120 }), measureLeaf, 300);
    expect(offers).toEqual([120]);

    const inner = leaf();
    const root = node({ type: "Container" }, { width: 200, padding: 10 }, [inner]);
    const second = recorder();
    measure(root, second.measureLeaf, 1000);
    expect(second.offers).toEqual([180]);
  });

  it("never offers a negative width", () => {
    const text = leaf();
    const root = node({ type: "Container" }, { padding: 40 }, [text]);
    const { offers, measureLeaf } = recorder();
    measure(root, measureLeaf, 50);
    expect(offers).toEqual([0]);
  });

  it("offers the full content width to every child, in a row as in a column", () => {
    const children = [leaf(), leaf(), leaf()];
    const row = node({ type: "Container", layout: { direction: "row" } }, {}, children);
    const { offers, measureLeaf } = recorder();
    measure(row, measureLeaf, 300);
    // v1 measures no cross-child competition: each child is offered the whole width.
    expect(offers).toEqual([300, 300, 300]);
  });

  it("skips the children that are out of layout", () => {
    const hidden = leaf();
    hidden.visibleFlag = false;
    const root = node({ type: "Container" }, {}, [hidden, leaf()]);
    const { offers, measureLeaf } = recorder();
    measure(root, measureLeaf, 300);
    expect(offers).toEqual([300]);
  });

  it("offers nothing on a ScrollView's scrollable axis", () => {
    for (const [axis, expected] of [
      ["vertical", 300],
      ["horizontal", null],
      ["both", null],
      [undefined, 300], // default: vertical
    ] as const) {
      const { offers, measureLeaf } = recorder();
      measure(node({ type: "ScrollView", axis }, {}, [leaf()]), measureLeaf, 300);
      expect(offers, `axis: ${axis}`).toEqual([expected]);
    }
  });
});

describe("measure — sizes", () => {
  it("grows a leaf by its own padding", () => {
    const { measureLeaf } = recorder({ x: 30, y: 20 });
    const size = measure(leaf({ padding: 5 }), measureLeaf, null);
    expect(size).toEqual({ x: 40, y: 30 });
  });

  it("stacks a column's children and keeps the widest", () => {
    const { measureLeaf } = recorder({ x: 30, y: 20 });
    const root = node({ type: "Container" }, { gap: 4 }, [leaf(), leaf()]);
    expect(measure(root, measureLeaf, null)).toEqual({ x: 30, y: 44 });
  });

  it("lets an explicit size win over what the content measured", () => {
    const { measureLeaf } = recorder({ x: 30, y: 20 });
    expect(measure(leaf({ width: 100, height: 8 }), measureLeaf, null)).toEqual({ x: 100, y: 8 });
  });
});
