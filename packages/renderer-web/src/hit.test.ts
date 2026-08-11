import type { ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { effectiveClip, hitTest } from "./hit.js";
import type { LayoutNode, Rect } from "./layout.js";

/** A laid-out node: the arrange pass' output, hand-built (no canvas needed). */
function node(ir: Partial<ZNode> & { type: string }, rect: Rect, children: LayoutNode[] = []) {
  const built: LayoutNode = {
    ir: ir as ZNode,
    parent: null,
    children,
    measured: { x: rect.width, y: rect.height },
    rect,
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
  };
  for (const child of children) child.parent = built;
  return built;
}

const noRadius = () => 0;

/** A 200×200 viewport at (0, 0) with two 100-tall rows, the second scrolled half out. */
function scrollTree(scrolled = 0, extra: Partial<ZNode> = {}) {
  const visible = node(
    { type: "Container", id: "visible" },
    {
      x: 0,
      y: 0 - scrolled,
      width: 200,
      height: 100,
    },
  );
  const overflowing = node(
    { type: "Button", id: "overflowing" },
    {
      x: 0,
      y: 150 - scrolled,
      width: 200,
      height: 100,
    },
  );
  const scroll = node({ type: "ScrollView", ...extra }, { x: 0, y: 0, width: 200, height: 200 }, [
    visible,
    overflowing,
  ]);
  return { root: node({ type: "Container" }, { x: 0, y: 0, width: 400, height: 400 }, [scroll]) };
}

describe("hitTest", () => {
  it("returns the deepest node under the point", () => {
    const { root } = scrollTree();
    expect(hitTest(root, { x: 50, y: 50 }, noRadius)?.ir.id).toBe("visible");
  });

  it("stops at the clipping node where its children overflow the viewport", () => {
    const { root } = scrollTree();
    // y = 220 is inside the overflowing row (150..250) but outside the ScrollView.
    expect(hitTest(root, { x: 50, y: 220 }, noRadius)?.ir.id).toBeUndefined();
    expect(hitTest(root, { x: 50, y: 220 }, noRadius)?.ir.type).toBe("Container"); // the root
  });

  it("reaches a child once scrolling brings it inside the viewport", () => {
    const { root } = scrollTree(100);
    // The same row now sits at 50..150 in view space.
    expect(hitTest(root, { x: 50, y: 100 }, noRadius)?.ir.id).toBe("overflowing");
  });

  it("later siblings win — they paint last", () => {
    const first = node({ type: "Container", id: "first" }, { x: 0, y: 0, width: 100, height: 100 });
    const second = node(
      { type: "Container", id: "second" },
      {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    );
    const root = node({ type: "Container" }, { x: 0, y: 0, width: 100, height: 100 }, [
      first,
      second,
    ]);
    expect(hitTest(root, { x: 50, y: 50 }, noRadius)?.ir.id).toBe("second");
  });

  it("skips nodes out of layout (display:none semantics)", () => {
    const { root } = scrollTree();
    root.children[0].children[0].visibleFlag = false;
    expect(hitTest(root, { x: 50, y: 50 }, noRadius)?.ir.type).toBe("ScrollView");
  });

  it("reaches a child that overflows an unclipped parent — it is painted there", () => {
    const tall = node({ type: "Button", id: "tall" }, { x: 0, y: 0, width: 200, height: 300 });
    const short = node({ type: "Container" }, { x: 0, y: 0, width: 200, height: 100 }, [tall]);
    const root = node({ type: "Container" }, { x: 0, y: 0, width: 400, height: 400 }, [short]);
    expect(hitTest(root, { x: 50, y: 200 }, noRadius)?.ir.id).toBe("tall");
  });

  it("clips on `clip: true` without a ScrollView, and not without it", () => {
    const overflowing = node(
      { type: "Button", id: "overflowing" },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 300,
      },
    );
    const card = node({ type: "Container", clip: true }, { x: 0, y: 0, width: 200, height: 100 }, [
      overflowing,
    ]);
    const root = node({ type: "Container" }, { x: 0, y: 0, width: 400, height: 400 }, [card]);
    expect(hitTest(root, { x: 50, y: 200 }, noRadius)?.ir.id).toBeUndefined();

    card.ir = { ...card.ir, clip: false } as ZNode;
    expect(hitTest(root, { x: 50, y: 200 }, noRadius)?.ir.id).toBe("overflowing");
  });

  it("cuts the rounded corners of the viewport", () => {
    const { root } = scrollTree();
    const radius = (n: LayoutNode) => (n.ir.type === "ScrollView" ? 40 : 0);
    expect(hitTest(root, { x: 5, y: 5 }, radius)?.ir.id).toBeUndefined();
    expect(hitTest(root, { x: 5, y: 5 }, noRadius)?.ir.id).toBe("visible");
  });
});

describe("effectiveClip", () => {
  it("is null for a node with no clipping ancestor", () => {
    const { root } = scrollTree();
    expect(effectiveClip(root, noRadius)).toBeNull();
    expect(effectiveClip(root.children[0], noRadius)).toBeNull(); // the ScrollView's own rect
  });

  it("intersects every clipping ancestor, keeping the innermost radius", () => {
    const inner = node({ type: "Button", id: "inner" }, { x: 0, y: 0, width: 50, height: 50 });
    const scroll = node({ type: "ScrollView" }, { x: 0, y: 50, width: 200, height: 200 }, [inner]);
    const card = node({ type: "Container", clip: true }, { x: 0, y: 0, width: 120, height: 400 }, [
      scroll,
    ]);
    node({ type: "Container" }, { x: 0, y: 0, width: 400, height: 400 }, [card]);

    expect(effectiveClip(inner, (n) => (n.ir.type === "ScrollView" ? 8 : 0))).toEqual({
      x: 0,
      y: 50,
      width: 120,
      height: 200,
      radius: 8,
    });
  });
});
