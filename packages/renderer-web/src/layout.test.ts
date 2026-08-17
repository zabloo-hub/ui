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
import type { ItemSpan } from "./repeat.js";
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

  it("measures the slots IN FLOW only — the resolve pass skipped the others", () => {
    // A slot out of layout keeps whatever `resolved` the last frame that painted
    // it left there, so measuring it would be measuring the past.
    const built = slider({}, 0.5);
    built.children[1].visibleFlag = false;
    const { offers, measureLeaf } = recorder();
    measure(built, measureLeaf, null);
    expect(offers).toEqual([200]); // the fill's offer, and nothing for the thumb
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

  it("gives the rail's thickness to a slot whose own height does not resolve", () => {
    // A `{sizes.thumb}` matching no token: `ir.layout` still reads as declared,
    // but the resolve pass left `resolved.height` undefined — and that is auto,
    // which across the rail means the full rail.
    const built = slider({}, 0.5);
    const thumb = built.children[1];
    thumb.ir.layout = { width: 18, height: "{sizes.thumb}" };
    thumb.resolved = { width: 18 };
    measure(built, noLeaf, null);

    const { thumb: rect } = laidOut(built);
    expect(rect.height).toBe(6);
    expect(rect.y).toBe(0); // centered on a rail it exactly covers
  });
});

// --- ScrollView: the reach the offsets are clamped against ---

describe("arrange: ScrollView", () => {
  const VIEWPORT: Rect = { x: 0, y: 0, width: 200, height: 100 };

  it("forgets the scroll extent when every child leaves the flow", () => {
    const size = { width: 200, height: 400 };
    const content = node({ type: "Container", layout: size }, { width: 200, height: 400 });
    const built = node({ type: "ScrollView", axis: "vertical" }, {}, [content]);
    measure(built, noLeaf, 200);
    arrange(built, VIEWPORT);
    expect(built.scrollMax).toEqual({ x: 0, y: 300 });

    // Scrolled to the bottom, and then the list empties out: the reach has to go
    // with it, or the view keeps scrolling into nothing.
    built.scrollOffset = { x: 0, y: 300 };
    content.visibleFlag = false;
    measure(built, noLeaf, 200);
    arrange(built, VIEWPORT);
    expect(built.scrollMax).toEqual({ x: 0, y: 0 });
    expect(built.scrollOffset).toEqual({ x: 0, y: 0 });
  });
});

// --- wrap (ZAB-32): a grid is a row that breaks into lines ---

/** A cell of `width × height`, already resolved. */
const cell = (width: number, height: number) =>
  node({ type: "Container", layout: { width, height } }, { width, height });

function grid(layout: Layout, cells: LayoutNode[], offer: number | null = null): LayoutNode {
  const built = node({ type: "Container", layout }, resolvedOf(layout), cells);
  built.resolved.gap = (layout.gap as number | undefined) ?? 0;
  measure(built, noLeaf, offer);
  return built;
}

describe("wrap", () => {
  it("breaks the row into lines that fit the offered width", () => {
    // 4 × 72 + 3 × 8 = 312: four per line, and the fifth starts a new one.
    const built = grid(
      { direction: "row", wrap: true, gap: 8, width: 312 },
      Array.from({ length: 5 }, () => cell(72, 40)),
    );
    expect(built.measured).toEqual({ x: 312, y: 88 }); // two lines of 40 + the gap
    arrange(built, { x: 0, y: 0, width: 312, height: 88 });
    expect(built.children[3].rect).toEqual({ x: 240, y: 0, width: 72, height: 40 });
    expect(built.children[4].rect).toEqual({ x: 0, y: 48, width: 72, height: 40 });
  });

  it("stays on one line without the flag — what every node emitted before assumes", () => {
    const built = grid(
      { direction: "row", gap: 8, width: 312 },
      Array.from({ length: 5 }, () => cell(72, 40)),
    );
    expect(built.measured).toEqual({ x: 312, y: 40 });
    arrange(built, { x: 0, y: 0, width: 312, height: 40 });
    expect(built.children[4].rect.x).toBe(320); // it overflows; no content is lost
  });

  it("gives every child a line of its own when none of them fits", () => {
    const built = grid({ direction: "row", wrap: true, gap: 0, width: 50 }, [
      cell(80, 10),
      cell(80, 10),
    ]);
    // Two lines of 10 — the declared width still stands, the cells overflow it.
    expect(built.measured).toEqual({ x: 50, y: 20 });
  });

  it("justifies and aligns WITHIN a line, and stacks the lines from the start", () => {
    const built = grid(
      { direction: "row", wrap: true, gap: 0, width: 200, justify: "center", align: "end" },
      [cell(80, 40), cell(80, 20), cell(80, 30)],
    );
    arrange(built, { x: 0, y: 0, width: 200, height: 200 });
    // Line 1 (160 wide) centered in 200 → 20px lead; the short cell sits at the
    // bottom of ITS line (40 tall), not at the bottom of the node.
    expect(built.children[0].rect).toMatchObject({ x: 20, y: 0 });
    expect(built.children[1].rect).toMatchObject({ x: 100, y: 20 });
    // Line 2 has a single cell, centered on its own line, right below line 1.
    expect(built.children[2].rect).toMatchObject({ x: 60, y: 40 });
  });

  it("shares the leftovers of a line between the children ON that line", () => {
    const growing = () => {
      const built = node({ type: "Container", layout: { width: 60, grow: 1 } }, { width: 60 });
      return built;
    };
    const built = grid({ direction: "row", wrap: true, gap: 0, width: 100 }, [
      growing(),
      growing(),
      growing(),
    ]);
    arrange(built, { x: 0, y: 0, width: 100, height: 100 });
    // Two per line: the first line splits its 100 - 120 (nothing to share), the
    // last one takes the 40 it has left over on its own.
    expect(built.children[2].rect.width).toBe(100);
  });
});

// --- virtualized Repeat (ZAB-31): reserved space and the realized window ---

function virtualized(layout: Layout, span: ItemSpan, cells: LayoutNode[]): LayoutNode {
  const built = node(
    { type: "Repeat", ...({ items: { bind: "x" } } as object), layout },
    resolvedOf(layout),
    cells,
  );
  built.resolved.gap = (layout.gap as number | undefined) ?? 0;
  built.virtual = span;
  measure(built, noLeaf, 300);
  return built;
}

describe("virtualized Repeat", () => {
  it("measures the whole array, not the realized window", () => {
    const built = virtualized(
      { direction: "column", gap: 10 },
      { first: 10, count: 5, lead: 500, reserved: 4990, perLine: 1 },
      Array.from({ length: 5 }, () => cell(200, 40)),
    );
    expect(built.measured.y).toBe(4990);
  });

  it("places the realized window at the position of its first item", () => {
    const built = virtualized(
      { direction: "column", gap: 10 },
      { first: 10, count: 5, lead: 500, reserved: 4990, perLine: 1 },
      Array.from({ length: 5 }, () => cell(200, 40)),
    );
    arrange(built, { x: 0, y: 0, width: 300, height: 4990 });
    expect(built.children[0].rect.y).toBe(500);
    expect(built.children[1].rect.y).toBe(550);
  });

  it("reserves the CROSS axis when it wraps — a grid stacks its lines there", () => {
    const built = virtualized(
      { direction: "row", wrap: true, gap: 8, width: 312 },
      { first: 8, count: 8, lead: 136, reserved: 1692, perLine: 4 },
      Array.from({ length: 8 }, () => cell(72, 60)),
    );
    expect(built.measured).toEqual({ x: 312, y: 1692 });
    arrange(built, { x: 0, y: 0, width: 312, height: 1692 });
    expect(built.children[0].rect).toMatchObject({ x: 0, y: 136 });
    expect(built.children[4].rect).toMatchObject({ x: 0, y: 204 }); // next line
  });

  it("breaks exactly where the window assumed it would, whatever the width allows", () => {
    // The offer would fit five per line; the window was computed for four.
    const built = virtualized(
      { direction: "row", wrap: true, gap: 8, width: 400 },
      { first: 0, count: 8, lead: 0, reserved: 136, perLine: 4 },
      Array.from({ length: 8 }, () => cell(72, 60)),
    );
    arrange(built, { x: 0, y: 0, width: 400, height: 136 });
    expect(built.children[4].rect).toMatchObject({ x: 0, y: 68 });
  });
});

// --- Toggle (ZAB-36): the indicator slots share one box ---

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
