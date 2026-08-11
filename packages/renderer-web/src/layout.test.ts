import type { Layout, SliderNode, ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import {
  arrange,
  createLayoutNode,
  type LayoutNode,
  type MeasureLeaf,
  measure,
  type Rect,
} from "./layout.js";
import type { ResolvedValues } from "./transition.js";

/**
 * A tree in the state the resolve pass leaves it in: tokens already collapsed into
 * `resolved`, which is where measure reads its width and padding from.
 */
function node(
  ir: Partial<ZNode> & { type: string },
  resolved: ResolvedValues = {},
  children: LayoutNode[] = [],
): LayoutNode {
  const built = createLayoutNode(ir as ZNode);
  built.children = children;
  built.resolved = resolved;
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

// --- Slider (ZAB-24): the slots are placed by the value, not by the flex pass ---

const noLeaf: MeasureLeaf = () => ({ x: 0, y: 0 });

/** What the resolve pass leaves behind for a slot whose layout is plain numbers. */
const resolvedOf = (layout: Layout): ResolvedValues => ({
  width: layout.width as number | undefined,
  height: layout.height as number | undefined,
  padding: (layout.padding as number | undefined) ?? 0,
});

/** The shape `<Slider>` emits: a 200×6 rail with a 6px fill and an 18px thumb. */
function slider(props: Omit<SliderNode, "type" | "children"> = {}, value = 0, length = 200) {
  const horizontal = props.axis !== "vertical";
  const rail: Layout = horizontal
    ? { width: length, height: 6, ...props.layout }
    : { width: 6, height: length, ...props.layout };
  const fill: Layout = horizontal ? { height: 6 } : { width: 6 };
  const thumb: Layout = { width: 18, height: 18 };
  const built = node({ type: "Slider", ...props, layout: rail }, resolvedOf(rail), [
    node({ type: "Container", layout: fill }, resolvedOf(fill)),
    node({ type: "Container", layout: thumb }, resolvedOf(thumb)),
  ]);
  built.sliderValue = value;
  // Settled: the arrange pass paints the DISPLAY value, which only trails the
  // logical one while a bound change is gliding into place.
  built.sliderDisplay = value;
  measure(built, noLeaf, null);
  return built;
}

const laidOut = (target: LayoutNode, at: Rect = { x: 0, y: 0, width: 200, height: 6 }) => {
  arrange(target, at);
  return { fill: target.children[0].rect, thumb: target.children[1].rect };
};

describe("measure: Slider", () => {
  it("sizes itself from its own layout, never from its slots", () => {
    // A 18px thumb must not turn a 6px rail into an 18px one, nor add length.
    expect(slider().measured).toEqual({ x: 200, y: 6 });
  });

  it("still measures the slots, so the thumb has a size to travel with", () => {
    expect(slider().children[1].measured).toEqual({ x: 18, y: 18 });
  });
});

describe("arrange: Slider", () => {
  it("keeps the thumb inside the rail at both ends", () => {
    const min = laidOut(slider({}, 0));
    expect(min.thumb.x).toBe(0);
    expect(min.fill.width).toBe(0);

    const max = laidOut(slider({}, 1));
    expect(max.thumb.x + max.thumb.width).toBe(200);
    expect(max.fill.width).toBe(200);
  });

  it("puts the thumb on the value and fills up to it", () => {
    const { fill, thumb } = laidOut(slider({}, 0.5));
    expect(fill.width).toBe(100);
    expect(thumb.x).toBe(91); // (200 - 18) * 0.5
    expect(thumb.x + thumb.width / 2).toBe(100); // centered on the value
  });

  it("centers the fat thumb across the thin rail (it overflows, and that is fine)", () => {
    const { fill, thumb } = laidOut(slider({}, 0.5));
    expect(fill.height).toBe(6); // the fill keeps the rail's thickness
    expect(thumb.height).toBe(18);
    expect(thumb.y).toBe(-6); // 6px rail, 18px thumb → 6px out on each side
  });

  it("honours the rail's own offset", () => {
    const { fill, thumb } = laidOut(slider({}, 0.5), { x: 40, y: 10, width: 200, height: 6 });
    expect(fill.x).toBe(40);
    expect(thumb.x).toBe(131);
    expect(thumb.y).toBe(4);
  });

  it("runs a vertical slider bottom-to-top", () => {
    const rect: Rect = { x: 0, y: 0, width: 6, height: 200 };
    const bottom = laidOut(slider({ axis: "vertical" }, 0), rect);
    // Value 0 sits at the BOTTOM: the fill has no height and the thumb rests there.
    expect(bottom.fill.height).toBe(0);
    expect(bottom.fill.y).toBe(200);
    expect(bottom.thumb.y + bottom.thumb.height).toBe(200);

    const top = laidOut(slider({ axis: "vertical" }, 1), rect);
    expect(top.fill.height).toBe(200);
    expect(top.fill.y).toBe(0);
    expect(top.thumb.y).toBe(0);
  });

  it("insets the rail with its own padding", () => {
    const built = slider({ layout: { padding: 10 } }, 1);
    const { fill } = laidOut(built, { x: 0, y: 0, width: 200, height: 26 });
    expect(fill.x).toBe(10);
    expect(fill.width).toBe(180);
  });

  it("leaves a hidden slot out (a fill bound to `visible`)", () => {
    const built = slider({}, 1);
    built.children[0].visibleFlag = false;
    arrange(built, { x: 0, y: 0, width: 200, height: 6 });
    expect(built.children[0].rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(built.children[1].rect.x).toBe(182);
  });
});

/** The shape `<Checkbox>`/`<Switch>` emit: two indicator slots and a label. */
function toggle(checkedSize = 30, uncheckedSize = 30) {
  const slot = (size: number) => {
    const layout: Layout = { width: size, height: size };
    return node({ type: "Container", layout }, resolvedOf(layout));
  };
  return node({ type: "Toggle", layout: { direction: "row", gap: 10 } }, { gap: 10, padding: 0 }, [
    slot(checkedSize),
    slot(uncheckedSize),
    node({ type: "Text", text: "Sound" }, {}, []),
  ]);
}

describe("Toggle: the indicator slots share one box", () => {
  it("measures the two slots as ONE item, as big as the larger of them", () => {
    // 30 (the shared box) + 10 gap + 50 (label): the unchecked slot adds nothing
    // to the main axis — it sits ON the checked one, ready to crossfade.
    const built = toggle(30, 20);
    measure(built, () => ({ x: 50, y: 10 }), null);
    expect(built.measured).toEqual({ x: 90, y: 30 });
  });

  it("reserves the LARGER slot, so flipping never resizes the control", () => {
    const small = toggle(20, 30);
    const large = toggle(30, 20);
    measure(small, () => ({ x: 50, y: 10 }), null);
    measure(large, () => ({ x: 50, y: 10 }), null);
    expect(small.measured).toEqual(large.measured);
  });

  it("arranges both slots on the same rect, with the label after the shared box", () => {
    const built = toggle();
    measure(built, () => ({ x: 50, y: 10 }), null);
    arrange(built, { x: 0, y: 0, width: 90, height: 30 });
    expect(built.children[1].rect).toEqual(built.children[0].rect);
    expect(built.children[0].rect).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    expect(built.children[2].rect.x).toBe(40); // 30 + the 10px gap
  });

  it("lays a lone slot out normally (a slot hidden by `visible`)", () => {
    const built = toggle();
    built.children[0].visibleFlag = false;
    measure(built, () => ({ x: 50, y: 10 }), null);
    arrange(built, { x: 0, y: 0, width: 90, height: 30 });
    expect(built.children[1].rect).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    expect(built.children[2].rect.x).toBe(40);
  });
});

describe("measure: the natural size", () => {
  it("keeps what the content asked for when a declared height replaces it", () => {
    const layout: Layout = { direction: "column" };
    const built = node({ type: "Collapse", layout }, { height: 24, padding: 0 }, [
      node({ type: "Text", text: "Options" }, {}),
      node({ type: "Text", text: "Sound: on" }, {}),
    ]);
    measure(built, () => ({ x: 60, y: 20 }), null);
    // The box is the override — a closing Collapse, say; the natural size is the
    // content's, which is exactly where its motion has to open back to.
    expect(built.measured.y).toBe(24);
    expect(built.natural.y).toBe(40); // two 20px lines
  });

  it("is the measured size itself when nothing overrides it", () => {
    const built = node({ type: "Container" }, {}, [node({ type: "Text", text: "hi" }, {})]);
    measure(built, () => ({ x: 30, y: 20 }), null);
    expect(built.natural).toEqual(built.measured);
  });
});
