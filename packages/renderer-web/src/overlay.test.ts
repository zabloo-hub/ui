import type { OverlayNode, ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { createLayoutNode, inLayout, type LayoutNode, type Rect } from "./layout.js";
import {
  anchorBox,
  anchorSpec,
  autofocusIn,
  collectLayer,
  focusScope,
  isOnScreen,
  isWithin,
  overlaySpec,
  resolveHit,
  stepPresence,
  topModal,
} from "./overlay.js";
import { createNodeAnim, type ResolvedTransition } from "./transition.js";

/** The view rect every overlay is arranged against. */
const VIEW: Rect = { x: 0, y: 0, width: 100, height: 100 };

/** A layout node in the state a fresh build + arrange leaves it in. */
function node(ir: ZNode, rect: Rect, children: LayoutNode[] = []): LayoutNode {
  // The layer rules read no animatable value: an un-resolved node is enough.
  const built = createLayoutNode(ir);
  built.children = children;
  built.measured = { x: rect.width, y: rect.height };
  built.rect = rect;
  for (const child of children) child.parent = built;
  return built;
}

const box = (children: LayoutNode[] = [], rect = VIEW): LayoutNode =>
  node({ type: "Container" }, rect, children);

const button = (id: string, rect: Rect, autofocus = false): LayoutNode =>
  node({ type: "Button", id, autofocus }, rect);

const overlay = (
  props: Omit<OverlayNode, "type">,
  children: LayoutNode[] = [],
  rect = VIEW,
): LayoutNode => node({ type: "Overlay", ...props }, rect, children);

const hidden = (target: LayoutNode): LayoutNode => {
  target.visibleFlag = false;
  return target;
};

const idsOf = (nodes: readonly LayoutNode[]): Array<string | undefined> =>
  nodes.map((n) => n.ir.id);

describe("overlaySpec", () => {
  it("applies the IR defaults: modal, order 0, no auto-close", () => {
    expect(overlaySpec(overlay({}))).toEqual({
      modal: true,
      z: 0,
      onDismiss: undefined,
      autoCloseMs: undefined,
    });
  });

  it("reads modal, z, onDismiss and autoCloseMs", () => {
    const spec = overlaySpec(
      overlay({ modal: false, z: 10, onDismiss: "close", autoCloseMs: 4000 }),
    );
    expect(spec).toEqual({ modal: false, z: 10, onDismiss: "close", autoCloseMs: 4000 });
  });

  it("ignores a non-positive auto-close: a typo is not 'close immediately'", () => {
    expect(overlaySpec(overlay({ autoCloseMs: 0 }))?.autoCloseMs).toBeUndefined();
    expect(overlaySpec(overlay({ autoCloseMs: -1 }))?.autoCloseMs).toBeUndefined();
  });

  it("is null for anything that is not an Overlay", () => {
    expect(overlaySpec(button("b", VIEW))).toBeNull();
  });
});

describe("collectLayer", () => {
  it("lifts overlays declared anywhere in the tree into one layer", () => {
    const root = box([box([overlay({ id: "modal" })]), button("buy", VIEW)]);
    expect(idsOf(collectLayer(root))).toEqual(["modal"]);
  });

  it("orders by z, breaking ties by document order", () => {
    const root = box([
      overlay({ id: "first" }),
      overlay({ id: "toast", z: 10 }),
      overlay({ id: "second" }),
      overlay({ id: "under", z: -1 }),
    ]);
    expect(idsOf(collectLayer(root))).toEqual(["under", "first", "second", "toast"]);
  });

  it("flattens a nested overlay into the same layer", () => {
    const root = box([overlay({ id: "outer" }, [overlay({ id: "inner", z: 1 })])]);
    expect(idsOf(collectLayer(root))).toEqual(["outer", "inner"]);
  });

  it("drops hidden overlays — no layer, no backdrop, no capture", () => {
    const root = box([hidden(overlay({ id: "closed" })), overlay({ id: "open" })]);
    expect(idsOf(collectLayer(root))).toEqual(["open"]);
  });

  it("drops overlays under something hidden, nested ones included", () => {
    const root = box([hidden(box([overlay({ id: "inside-a-closed-panel" })]))]);
    expect(collectLayer(root)).toEqual([]);
  });

  it("drops overlays inside a section the parent's state took out of layout", () => {
    const panel = box([overlay({ id: "in-collapsed-content" })]);
    panel.sectionShown = false;
    expect(collectLayer(box([panel]))).toEqual([]);
  });
});

describe("stepPresence", () => {
  // Linear so every assertion below is the fraction of the duration, nothing else.
  const fade: ResolvedTransition = { duration: 100, easing: "linear" };

  it("snaps on the first step: a modal already open when the view loads does not fade in", () => {
    const anim = createNodeAnim();
    expect(stepPresence(anim, true, fade, 0)).toEqual({ value: 1, animating: false });
  });

  it("fades in when it enters the layer", () => {
    const anim = createNodeAnim();
    expect(stepPresence(anim, false, fade, 0).value).toBe(0); // closed: the value to leave from
    expect(stepPresence(anim, true, fade, 0)).toEqual({ value: 0, animating: true });
    expect(stepPresence(anim, true, fade, 50).value).toBeCloseTo(0.5);
    expect(stepPresence(anim, true, fade, 100)).toEqual({ value: 1, animating: false });
  });

  it("keeps painting a closed overlay for one transition — the exit outlives its visible", () => {
    const anim = createNodeAnim();
    stepPresence(anim, true, fade, 0);
    expect(stepPresence(anim, false, fade, 0)).toEqual({ value: 1, animating: true });
    expect(stepPresence(anim, false, fade, 25).value).toBeCloseTo(0.75);
    expect(stepPresence(anim, false, fade, 100)).toEqual({ value: 0, animating: false });
  });

  it("is instant without a transition — exactly the pre-F7 frame", () => {
    const anim = createNodeAnim();
    stepPresence(anim, false, null, 0);
    expect(stepPresence(anim, true, null, 0)).toEqual({ value: 1, animating: false });
    expect(stepPresence(anim, false, null, 1)).toEqual({ value: 0, animating: false });
  });

  it("reopening mid-exit leaves from the opacity on screen, over a full duration", () => {
    const anim = createNodeAnim();
    stepPresence(anim, true, fade, 0);
    stepPresence(anim, false, fade, 0);
    expect(stepPresence(anim, false, fade, 50).value).toBeCloseTo(0.5);
    // Retargeted from 0.5, not from 0: half the way back after half a duration.
    expect(stepPresence(anim, true, fade, 50).value).toBeCloseTo(0.5);
    expect(stepPresence(anim, true, fade, 100).value).toBeCloseTo(0.75);
    expect(stepPresence(anim, true, fade, 150)).toEqual({ value: 1, animating: false });
  });
});

describe("the painted layer during an exit", () => {
  it("keeps a closed overlay in its own place while it fades, and only for that", () => {
    const closing = hidden(overlay({ id: "confirm" }));
    const toast = overlay({ id: "toast", modal: false, z: 10 });
    const root = box([closing, toast]);
    // The live layer — input, focus and the auto-close timers all read this one —
    // dropped it the moment `visible` went false.
    expect(idsOf(collectLayer(root))).toEqual(["toast"]);
    // The painted one keeps it, still under the toast that was above it.
    const painted = collectLayer(root, (n) => inLayout(n) || n === closing);
    expect(idsOf(painted)).toEqual(["confirm", "toast"]);
  });
});

describe("topModal and focusScope", () => {
  it("is the highest MODAL, not the highest overlay", () => {
    const layer = collectLayer(
      box([overlay({ id: "confirm" }), overlay({ id: "toast", modal: false, z: 10 })]),
    );
    expect(idsOf(layer)).toEqual(["confirm", "toast"]);
    expect(topModal(layer)?.ir.id).toBe("confirm");
  });

  it("is the last modal opened when several are stacked", () => {
    const layer = collectLayer(box([overlay({ id: "first" }), overlay({ id: "second" })]));
    expect(topModal(layer)?.ir.id).toBe("second");
  });

  it("has no modal while only non-modal overlays are up", () => {
    const layer = collectLayer(box([overlay({ id: "toast", modal: false })]));
    expect(topModal(layer)).toBeNull();
  });

  it("confines the focus scope to the top modal, and to the view without one", () => {
    const modal = overlay({ id: "confirm" });
    const toast = overlay({ id: "toast", modal: false });
    const root = box([modal, toast]);
    expect(focusScope(root, collectLayer(root))).toBe(modal);

    const loose = box([toast]);
    expect(focusScope(loose, collectLayer(loose))).toBe(loose);
  });
});

describe("isWithin", () => {
  it("holds for the node itself and for any descendant", () => {
    const ok = button("ok", VIEW);
    const modal = overlay({ id: "confirm" }, [box([ok])]);
    const outside = button("buy", VIEW);
    box([modal, outside]);

    expect(isWithin(modal, modal)).toBe(true);
    expect(isWithin(ok, modal)).toBe(true);
    expect(isWithin(outside, modal)).toBe(false);
  });
});

describe("autofocusIn", () => {
  const focusable = (n: LayoutNode) => n.ir.type === "Button";

  it("takes the first autofocus node in document order", () => {
    const scope = box([box([button("a", VIEW), button("b", VIEW, true)]), button("c", VIEW, true)]);
    expect(autofocusIn(scope, focusable)?.ir.id).toBe("b");
  });

  it("skips an autofocus on something that cannot take focus", () => {
    const container = node({ type: "Container", autofocus: true }, VIEW);
    const scope = box([container, button("real", VIEW, true)]);
    expect(autofocusIn(scope, focusable)?.ir.id).toBe("real");
  });

  it("skips autofocus nodes that are out of layout", () => {
    const scope = box([hidden(box([button("hidden", VIEW, true)])), button("shown", VIEW, true)]);
    expect(autofocusIn(scope, focusable)?.ir.id).toBe("shown");
  });

  it("is null when the scope declares none", () => {
    expect(autofocusIn(box([button("a", VIEW)]), focusable)).toBeNull();
  });
});

describe("resolveHit", () => {
  const point = { x: 50, y: 50 };
  const resolve = (root: LayoutNode) => resolveHit(root, collectLayer(root), point, () => 0);

  it("goes to the tree while the layer is empty", () => {
    const buy = button("buy", VIEW);
    expect(resolve(box([buy]))).toEqual({ kind: "node", node: buy });
  });

  it("gives the event to a modal's child, not to what it covers", () => {
    const ok = button("ok", VIEW);
    const buy = button("buy", VIEW);
    expect(resolve(box([buy, overlay({ id: "confirm" }, [ok])]))).toEqual({
      kind: "node",
      node: ok,
    });
  });

  it("captures for a modal: a point on no child is a backdrop tap, never a fall-through", () => {
    const buy = button("buy", VIEW);
    const modal = overlay({ id: "confirm" }, [button("ok", { x: 0, y: 0, width: 10, height: 10 })]);
    expect(resolve(box([buy, modal]))).toEqual({ kind: "backdrop", overlay: modal });
  });

  it("hides a lower overlay's children behind the modal above them", () => {
    const lower = overlay({ id: "lower", z: 0 }, [button("old", VIEW)]);
    const upper = overlay({ id: "upper", z: 1 });
    expect(resolve(box([lower, upper]))).toEqual({ kind: "backdrop", overlay: upper });
  });

  it("lets input through a non-modal overlay: its own rect is inert", () => {
    const buy = button("buy", VIEW);
    const toast = overlay({ id: "toast", modal: false }, [
      button("undo", { x: 0, y: 0, width: 10, height: 10 }),
    ]);
    expect(resolve(box([buy, toast]))).toEqual({ kind: "node", node: buy });
  });

  it("still gives a non-modal overlay's own children their events", () => {
    const undo = button("undo", VIEW);
    const buy = button("buy", VIEW);
    expect(resolve(box([buy, overlay({ id: "toast", modal: false }, [undo])]))).toEqual({
      kind: "node",
      node: undo,
    });
  });

  it("keeps looking below a non-modal overlay for the modal underneath it", () => {
    const modal = overlay({ id: "confirm", z: 0 });
    const toast = overlay({ id: "toast", modal: false, z: 10 });
    expect(resolve(box([modal, toast]))).toEqual({ kind: "backdrop", overlay: modal });
  });

  it("misses when the point is outside every rect", () => {
    const small = { x: 0, y: 0, width: 10, height: 10 };
    const root = node({ type: "Container" }, small, [overlay({ id: "confirm" }, [], small)]);
    expect(resolve(root)).toEqual({ kind: "miss" });
  });

  it("skips a hover-triggered overlay: a hint must not take the pointer from its anchor", () => {
    const buy = button("buy", VIEW);
    // Its own child covers the point, and it still gets nothing: taking the event
    // here would end the hover holding the bubble up, and the two would flicker.
    const hint = overlay({ id: "hint", modal: false, anchor: { id: "buy", trigger: "hover" } }, [
      box([], VIEW),
    ]);
    expect(resolve(box([buy, hint]))).toEqual({ kind: "node", node: buy });
  });

  it("still gives a manually triggered anchored overlay its events (a popover)", () => {
    const pick = button("pick", VIEW);
    const buy = button("buy", VIEW);
    const menu = overlay({ id: "menu", modal: false, anchor: { id: "buy" } }, [pick]);
    expect(resolve(box([buy, menu]))).toEqual({ kind: "node", node: pick });
  });
});

describe("anchorSpec", () => {
  it("applies the IR defaults: above the anchor, shown by `visible`", () => {
    expect(anchorSpec(overlay({ anchor: { id: "buy" } }))).toEqual({
      id: "buy",
      at: "top",
      offset: undefined,
      trigger: "manual",
    });
  });

  it("reads the placement, the offset and the trigger", () => {
    expect(
      anchorSpec(
        overlay({
          anchor: { id: "buy", at: "bottom-left", offset: "{space.2}", trigger: "hover" },
        }),
      ),
    ).toEqual({ id: "buy", at: "bottom-left", offset: "{space.2}", trigger: "hover" });
  });

  it("falls back to the default placement for a name this build does not know", () => {
    const unknown = { id: "buy", at: "over-there" } as unknown as OverlayNode["anchor"];
    expect(anchorSpec(overlay({ anchor: unknown }))?.at).toBe("top");
  });

  it("is null without an id, and for anything that is not an Overlay", () => {
    const idless = { at: "top" } as unknown as OverlayNode["anchor"];
    expect(anchorSpec(overlay({ anchor: idless }))).toBeNull();
    expect(anchorSpec(overlay({}))).toBeNull();
    expect(anchorSpec(button("b", VIEW))).toBeNull();
  });
});

describe("anchorBox", () => {
  /** An anchor in the middle of the view, with room on every side. */
  const anchor: Rect = { x: 40, y: 50, width: 20, height: 20 };
  const size = { x: 10, y: 6 };
  const place = (at: Parameters<typeof anchorBox>[2], target = anchor, bounds = VIEW) =>
    anchorBox(target, size, at, 4, bounds);

  it("puts the content on the named side, centered on the anchor's span", () => {
    expect(place("top")).toEqual({ x: 45, y: 40, width: 10, height: 6 });
    expect(place("bottom")).toEqual({ x: 45, y: 74, width: 10, height: 6 });
    expect(place("left")).toEqual({ x: 26, y: 57, width: 10, height: 6 });
    expect(place("right")).toEqual({ x: 64, y: 57, width: 10, height: 6 });
  });

  it("reads a corner as the same side, flush with that edge of the anchor", () => {
    expect(place("top-left")).toMatchObject({ x: 40, y: 40 });
    expect(place("top-right")).toMatchObject({ x: 50, y: 40 });
    expect(place("bottom-left")).toMatchObject({ x: 40, y: 74 });
    expect(place("bottom-right")).toMatchObject({ x: 50, y: 74 });
  });

  it("centers ON the anchor for `center`, ignoring the offset", () => {
    expect(place("center")).toMatchObject({ x: 45, y: 57 });
  });

  it("flips to the opposite side when the preferred one does not fit", () => {
    const top: Rect = { x: 40, y: 0, width: 20, height: 20 };
    expect(place("top", top)).toMatchObject({ y: 24 });
    // And the alignment survives the flip: a corner keeps its edge.
    expect(place("top-right", top)).toMatchObject({ x: 50, y: 24 });
  });

  it("keeps the preferred side when neither fits, and clamps it in", () => {
    const tall: Rect = { x: 40, y: 0, width: 20, height: 100 };
    expect(place("top", tall)).toMatchObject({ y: 0 });
  });

  it("slides along the other axis instead of flipping: a bubble follows its word", () => {
    const edge: Rect = { x: 95, y: 50, width: 20, height: 20 };
    // Centered on the anchor it would start at 100, half of it off screen.
    expect(place("top", edge)).toMatchObject({ x: 90, y: 40 });
  });

  it("clamps against the bounds it is given — the overlay's padding is that margin", () => {
    const inset: Rect = { x: 8, y: 8, width: 84, height: 84 };
    const edge: Rect = { x: 95, y: 50, width: 20, height: 20 };
    expect(place("top", edge, inset)).toMatchObject({ x: 82 });
    // Neither side fits this one, so it clamps — to the inset, not to the view:
    // against the raw view rect it would sit at y = 0, flush with the screen.
    expect(place("top", { x: 40, y: 9, width: 20, height: 88 }, inset)).toMatchObject({ y: 8 });
  });

  it("puts content wider than the bounds at their edge instead of off both", () => {
    const huge = anchorBox(anchor, { x: 200, y: 6 }, "top", 4, VIEW);
    expect(huge).toMatchObject({ x: 0, width: 200 });
  });
});

describe("isOnScreen", () => {
  const radius = () => 0;

  it("holds for a node in layout with nothing clipping it", () => {
    const buy = button("buy", { x: 10, y: 10, width: 20, height: 10 });
    box([buy]);
    expect(isOnScreen(buy, radius)).toBe(true);
  });

  it("fails when an ancestor is out of layout: the anchor is not on screen either", () => {
    const buy = button("buy", { x: 10, y: 10, width: 20, height: 10 });
    box([hidden(box([buy]))]);
    expect(isOnScreen(buy, radius)).toBe(false);
  });

  it("fails for an anchor scrolled out of its ScrollView — a tooltip pointing at nothing", () => {
    const inside = button("inside", { x: 0, y: 5, width: 20, height: 10 });
    const scrolledAway = button("gone", { x: 0, y: 40, width: 20, height: 10 });
    const list = node({ type: "ScrollView" }, { x: 0, y: 0, width: 100, height: 20 }, [
      inside,
      scrolledAway,
    ]);
    box([list]);
    expect(isOnScreen(inside, radius)).toBe(true);
    expect(isOnScreen(scrolledAway, radius)).toBe(false);
  });
});
