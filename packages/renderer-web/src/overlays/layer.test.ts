import type { OverlayNode, ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { createLayoutNode, type LayoutNode, type Rect } from "../layout.js";
import { type OverlayHost, OverlayLayer } from "./layer.js";

/** The rect the view lays its root AND its whole layer out against. */
const VIEW: Rect = { x: 0, y: 0, width: 200, height: 120 };

function node(ir: ZNode, rect: Rect): LayoutNode {
  const built = createLayoutNode(ir);
  built.measured = { x: rect.width, y: rect.height };
  built.natural = { x: rect.width, y: rect.height };
  built.rect = rect;
  return built;
}

const PANEL = { x: 0, y: 0, width: 60, height: 40 };

function overlay(props: Omit<OverlayNode, "type">, children: LayoutNode[] = []): LayoutNode {
  const built = node({ type: "Overlay", ...props }, PANEL);
  built.children = children;
  for (const child of children) child.parent = built;
  return built;
}

/** The anchor, with room below it for a panel of `PANEL`'s size. */
const trigger = (): LayoutNode =>
  node({ type: "Button", id: "trigger" }, { x: 20, y: 20, width: 40, height: 20 });

/**
 * A host with only what `arrangeOverlay` reaches for: the anchor index and the
 * dim resolver. Anything else it touched would be a change worth noticing here.
 */
function layerWith(anchors: Record<string, LayoutNode>): OverlayLayer {
  const unused = (name: string) => (): never => {
    throw new Error(`arrangeOverlay must not reach OverlayHost.${name}`);
  };
  return new OverlayLayer({
    root: unused("root"),
    eachOverlay: unused("eachOverlay"),
    layer: () => [],
    focused: () => null,
    focusPending: unused("focusPending"),
    nodeById: (id) => anchors[id],
    scope: unused("scope"),
    isFocusable: unused("isFocusable"),
    autofocus: unused("autofocus"),
    setFocus: unused("setFocus"),
    closeVisible: unused("closeVisible"),
    dismissed: unused("dismissed"),
    transitionOf: () => null,
    markAnimating: unused("markAnimating"),
    radiusOf: unused("radiusOf"),
    dim: (value, fallback) => (typeof value === "number" ? value : fallback),
    render: unused("render"),
  } satisfies OverlayHost);
}

describe("arrangeOverlay", () => {
  it("gives every entry a rect of its OWN, never the view's object", () => {
    // One `viewRect` lays the root and the whole layer out. Handing them all the
    // same object makes each `node.rect` an alias of the others: nothing mutates
    // a rect in place today, and the day something does it must move one node.
    const layer = layerWith({ trigger: trigger() });
    const anchored = overlay({ anchor: { id: "trigger", at: "bottom" } });
    const full = overlay({});

    layer.arrangeOverlay(anchored, VIEW);
    layer.arrangeOverlay(full, VIEW);

    expect(anchored.rect).toEqual(VIEW);
    expect(full.rect).toEqual(VIEW);
    expect(anchored.rect).not.toBe(VIEW);
    expect(full.rect).not.toBe(VIEW);
    expect(anchored.rect).not.toBe(full.rect);
  });

  it("still places an anchored entry's content around its anchor", () => {
    const layer = layerWith({ trigger: trigger() });
    const panel = node({ type: "Container" }, PANEL);
    const anchored = overlay({ anchor: { id: "trigger", at: "bottom", offset: 4 } }, [panel]);

    layer.arrangeOverlay(anchored, VIEW);

    // The entry's own rect is the view's; the box its CONTENT went into is not.
    // That is what keeps a modal popover dimming the whole screen while its
    // panel hangs off the button, 4px under it and centered on it.
    expect(anchored.rect).toEqual(VIEW);
    expect(panel.rect).toEqual({ x: 10, y: 44, width: 60, height: 40 });
  });
});
