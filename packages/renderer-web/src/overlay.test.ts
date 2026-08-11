import type { OverlayNode, ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { inLayout, type LayoutNode, type Rect } from "./layout.js";
import {
  autofocusIn,
  collectLayer,
  focusScope,
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
  const built: LayoutNode = {
    ir,
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
    sliderValue: 0,
    groupValue: undefined,
    visibleFlag: true,
    sectionShown: true,
    progress: 0,
    loopStartedAt: null,
    scrollOffset: { x: 0, y: 0 },
    scrollMax: { x: 0, y: 0 },
    // The layer rules read no animatable value: an un-resolved node is enough.
    resolved: {},
    textBlock: null,
    anim: createNodeAnim(),
    scopes: [],
    repeat: null,
    virtual: null,
  };
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
});
