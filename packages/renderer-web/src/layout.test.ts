import type { SliderNode, ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { arrange, type LayoutNode, measure, type Rect } from "./layout.js";
import { createNodeAnim } from "./transition.js";

/** A tree node in the state `build` leaves it in, before measure/arrange. */
function node(ir: ZNode, children: LayoutNode[] = [], value = 0): LayoutNode {
  const built: LayoutNode = {
    ir,
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
    sliderValue: value,
    groupValue: undefined,
    visibleFlag: true,
    sectionShown: true,
    scrollOffset: { x: 0, y: 0 },
    scrollMax: { x: 0, y: 0 },
    // The view's resolve pass writes these; here they are the declared numbers.
    resolved: {
      width: ir.layout?.width as number | undefined,
      height: ir.layout?.height as number | undefined,
      padding: (ir.layout?.padding as number | undefined) ?? 0,
      gap: 0,
    },
    anim: createNodeAnim(),
  };
  for (const child of children) child.parent = built;
  return built;
}

const noLeaf = () => ({ x: 0, y: 0 });

/** The shape `<Slider>` emits: a 200×6 rail with a 6px fill and an 18px thumb. */
function slider(props: Omit<SliderNode, "type" | "children"> = {}, value = 0, length = 200) {
  const horizontal = props.axis !== "vertical";
  const rail = horizontal ? { width: length, height: 6 } : { width: 6, height: length };
  const fill = horizontal ? { height: 6 } : { width: 6 };
  const built = node(
    { type: "Slider", ...props, layout: { ...rail, ...props.layout } },
    [
      node({ type: "Container", layout: fill }),
      node({ type: "Container", layout: { width: 18, height: 18 } }),
    ],
    value,
  );
  measure(built, noLeaf);
  return built;
}

const laidOut = (target: LayoutNode, at: Rect = { x: 0, y: 0, width: 200, height: 6 }) => {
  arrange(target, at);
  return { fill: target.children[0].rect, thumb: target.children[1].rect };
};

describe("measure: Slider", () => {
  it("sizes itself from its own layout, never from its slots", () => {
    const built = slider();
    // A 18px thumb must not turn a 6px rail into an 18px one, nor add length.
    expect(built.measured).toEqual({ x: 200, y: 6 });
  });

  it("still measures the slots, so the thumb has a size to travel with", () => {
    const built = slider();
    expect(built.children[1].measured).toEqual({ x: 18, y: 18 });
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
    measure(built, noLeaf);
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
