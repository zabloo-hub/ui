import type { OverlayNode, ZNode } from "@zabloo/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayoutNode, type LayoutNode, type Rect } from "../layout.js";
import { collectLayer, focusScope, overlaysOf } from "../overlay.js";
import type { ResolvedTransition } from "../transition.js";
import { type OverlayHost, OverlayLayer } from "./layer.js";

/**
 * `OverlayLayer` against its own seam (ZAB-74). `overlay.ts` owns the pure rules
 * — what is modal, where an anchored box lands, what the layer contains — and
 * has its own suite; this owns the STATE that runs them frame to frame, all
 * keyed by node identity: the modal stack and the focus it borrowed, the
 * presence tweens, the `autoCloseMs` timers, and the popover flags.
 *
 * That keying is the reason it is worth testing here and not only through
 * `view.ts`: what happens when one of those nodes is released mid-flight is a
 * property of this module's bookkeeping, not of any frame.
 */

/** The rect the view lays its root AND its whole layer out against. */
const VIEW: Rect = { x: 0, y: 0, width: 200, height: 120 };

function node(ir: ZNode, rect: Rect): LayoutNode {
  const built = createLayoutNode(ir);
  built.measured = { x: rect.width, y: rect.height };
  built.natural = { x: rect.width, y: rect.height };
  built.rect = rect;
  return built;
}

function withChildren(parent: LayoutNode, children: LayoutNode[]): LayoutNode {
  parent.children = children;
  for (const child of children) child.parent = parent;
  return parent;
}

const PANEL = { x: 0, y: 0, width: 60, height: 40 };

function overlay(props: Omit<OverlayNode, "type">, children: LayoutNode[] = []): LayoutNode {
  return withChildren(node({ type: "Overlay", ...props }, PANEL), children);
}

/** The anchor, with room below it for a panel of `PANEL`'s size. */
const trigger = (): LayoutNode =>
  node({ type: "Button", id: "trigger" }, { x: 20, y: 20, width: 40, height: 20 });

const button = (id: string, rect: Rect = { x: 0, y: 0, width: 40, height: 20 }): LayoutNode =>
  node({ type: "Button", id }, rect);

const box = (children: LayoutNode[] = [], rect: Rect = VIEW): LayoutNode =>
  withChildren(node({ type: "Container" }, rect), children);

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

interface Rig {
  layer: OverlayLayer;
  host: { [K in keyof OverlayHost]: OverlayHost[K] };
  /** The live layer, recomputed from the tree through the layer's own predicate. */
  live(): readonly LayoutNode[];
  focus(node: LayoutNode | null): void;
  focused(): LayoutNode | null;
  /** Whether the focus is waiting on a virtualized row (ZAB-70). */
  pending(value: boolean): void;
  transition(value: ResolvedTransition | null): void;
}

/**
 * A layer wired to a whole tree, with the focus and the live layer under the
 * test's control. `isFocusable` is the view's own predicate reduced to what
 * every tree here builds: a control that is not disabled.
 */
function rig(root: LayoutNode): Rig {
  let focused: LayoutNode | null = null;
  let pending = false;
  let transition: ResolvedTransition | null = null;

  const host = {
    root: () => root,
    // The view keeps this set as it builds and releases nodes (ZAB-73); a rig
    // that holds a whole tree and nothing else re-derives it from the tree.
    eachOverlay: (visit: (overlay: LayoutNode) => void) => {
      for (const overlay of overlaysOf(root)) visit(overlay);
    },
    layer: () => live(),
    focused: () => focused,
    focusPending: () => pending,
    nodeById: (id: string) => find(root, id),
    scope: () => focusScope(root, live()),
    isFocusable: (target: LayoutNode) =>
      !target.disabled &&
      (target.ir.type === "Button" || target.ir.type === "Toggle" || target.ir.type === "Slider"),
    autofocus: vi.fn((scope: LayoutNode) => firstFocusable(scope)),
    setFocus: vi.fn((target: LayoutNode | null) => {
      focused = target;
    }),
    closeVisible: vi.fn(),
    dismissed: vi.fn(),
    transitionOf: () => transition,
    markAnimating: vi.fn(),
    radiusOf: () => 0,
    dim: (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback),
    render: vi.fn(),
  };

  const layer = new OverlayLayer(host as unknown as OverlayHost);
  const live = (): readonly LayoutNode[] => collectLayer(overlaysOf(root), layer.layerPresent);

  return {
    layer,
    host: host as unknown as Rig["host"],
    live,
    focus: (target) => {
      focused = target;
    },
    focused: () => focused,
    pending: (value) => {
      pending = value;
    },
    transition: (value) => {
      transition = value;
    },
  };
}

function find(root: LayoutNode, id: string): LayoutNode | undefined {
  if ((root.ir as { id?: string }).id === id) return root;
  for (const child of root.children) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}

function firstFocusable(scope: LayoutNode): LayoutNode | null {
  if (scope.ir.type === "Button" && !scope.disabled) return scope;
  for (const child of scope.children) {
    const found = firstFocusable(child);
    if (found) return found;
  }
  return null;
}

afterEach(() => {
  vi.useRealTimers();
});

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

  it("falls back to the layer placement when the anchor matches nothing", () => {
    const layer = layerWith({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const anchored = overlay({ anchor: { id: "gone", at: "bottom" } });

    layer.arrangeOverlay(anchored, VIEW);
    layer.arrangeOverlay(anchored, VIEW);

    // A typo shows a v1 tooltip instead of nothing at all — and warns ONCE:
    // repeating it every frame would bury the console.
    expect(anchored.rect).toEqual(VIEW);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"gone"');
    warn.mockRestore();
  });
});

describe("a modal taking the focus", () => {
  it("hands it to the scope's autofocus and remembers what it interrupted", () => {
    const buy = button("buy");
    const ok = button("ok");
    const modal = overlay({ id: "confirm" }, [ok]);
    const state = rig(box([buy, modal]));
    state.focus(buy);

    state.layer.syncModalFocus();

    expect(state.focused()).toBe(ok);
  });

  it("gives it back to what it interrupted when it closes", () => {
    const buy = button("buy");
    const modal = overlay({ id: "confirm" }, [button("ok")]);
    const state = rig(box([buy, modal]));
    state.focus(buy);
    state.layer.syncModalFocus();

    modal.visibleFlag = false;
    state.layer.syncModalFocus();

    expect(state.focused()).toBe(buy);
  });

  it("returns to what preceded the WHOLE stack when several close at once", () => {
    const buy = button("buy");
    const first = overlay({ id: "one" }, [button("ok")]);
    const second = overlay({ id: "two", z: 1 }, [button("yes")]);
    const state = rig(box([buy, first, second]));
    state.focus(buy);
    state.layer.syncModalFocus();
    // The second modal opened on top: it borrowed the focus of the first.
    expect(state.focused()).toBe(find(second, "yes"));

    first.visibleFlag = false;
    second.visibleFlag = false;
    state.layer.syncModalFocus();

    // The OUTERMOST one that left owns the restore.
    expect(state.focused()).toBe(buy);
  });

  it("does not restore a node that is gone or no longer takes input", () => {
    const buy = button("buy");
    const modal = overlay({ id: "confirm" }, [button("ok")]);
    const state = rig(box([buy, modal]));
    state.focus(buy);
    state.layer.syncModalFocus();

    buy.disabled = true;
    modal.visibleFlag = false;
    state.layer.syncModalFocus();

    // Rather than leaving a dead control wearing the focused state, it falls
    // back to the scope's own autofocus.
    expect(state.focused()).not.toBe(buy);
    expect(state.host.autofocus).toHaveBeenCalled();
  });

  it("leaves a focus that is already inside the scope alone", () => {
    const ok = button("ok");
    const other = button("cancel");
    const modal = overlay({ id: "confirm" }, [ok, other]);
    const state = rig(box([button("buy"), modal]));
    state.layer.syncModalFocus();
    state.focus(other);

    state.layer.syncModalFocus();

    // Only a focus OUTSIDE the scope is moved: nothing yanks the player back to
    // the autofocus on every render.
    expect(state.focused()).toBe(other);
  });

  it("does not let the focus rest inside a closed popover", () => {
    const option = button("option");
    const popover = overlay(
      { id: "menu", anchor: { id: "trigger", at: "bottom", trigger: "press" } },
      [option],
    );
    const state = rig(box([trigger(), popover]));
    popover.popoverOpen = true;
    state.layer.syncModalFocus();
    state.focus(option);

    popover.popoverOpen = false;
    state.layer.syncModalFocus();

    // A node inside a closed popover stays `inLayout` — the open flag lives on
    // the overlay — but nothing paints it, so the focus must not stay there.
    expect(state.focused()).not.toBe(option);
  });

  /**
   * The focus is not free to give away when the row that holds it is simply not
   * realized right now (ZAB-70): scrolling a list must never teleport it to the
   * view's `autofocus`.
   */
  it("stays out of the way while the focus is pending on a virtualized row", () => {
    const state = rig(box([button("buy")]));
    state.focus(null);
    state.pending(true);

    state.layer.syncModalFocus();

    expect(state.host.setFocus).not.toHaveBeenCalled();
  });

  it("but a modal that just opened takes it anyway — it owns the focus by definition", () => {
    const ok = button("ok");
    const modal = overlay({ id: "confirm" }, [ok]);
    const state = rig(box([button("buy"), modal]));
    state.focus(null);
    state.pending(true);

    state.layer.syncModalFocus();

    expect(state.focused()).toBe(ok);
  });
});

describe("a dismiss request", () => {
  it("writes `false` into the bound visible path and fires onDismiss", () => {
    const modal = overlay({ id: "confirm", onDismiss: "cancelled" });
    const state = rig(box([modal]));

    state.layer.requestDismiss(modal);

    expect(state.host.closeVisible).toHaveBeenCalledWith(modal);
    expect(state.host.dismissed).toHaveBeenCalledWith(modal, "cancelled");
    expect(state.host.render).toHaveBeenCalled();
  });

  it("closes a popover with its own flag, never with a write into the game's data", () => {
    const popover = overlay({
      id: "menu",
      anchor: { id: "trigger", at: "bottom", trigger: "press" },
    });
    popover.popoverOpen = true;
    const state = rig(box([trigger(), popover]));

    state.layer.requestDismiss(popover);

    // A popover's open state is the SDK's: `visible` never held it open.
    expect(popover.popoverOpen).toBe(false);
    expect(state.host.closeVisible).not.toHaveBeenCalled();
  });

  it("fires nothing at all for a node that is not an Overlay", () => {
    const buy = button("buy");
    const state = rig(box([buy]));

    state.layer.requestDismiss(buy);

    expect(state.host.closeVisible).not.toHaveBeenCalled();
    expect(state.host.render).not.toHaveBeenCalled();
  });
});

describe("the enter/exit fade", () => {
  it("records a hidden overlay at 0, so opening it is a change to animate from", () => {
    const modal = overlay({ id: "confirm" });
    modal.visibleFlag = false;
    const state = rig(box([modal]));

    state.layer.syncPresence(0);

    // A missing entry would paint it fully opaque for exactly one frame, which
    // reads as a flash right before the fade in.
    expect(state.layer.presenceOf(modal)).toBe(0);
  });

  it("snaps to 1 for an overlay with no transition of its own", () => {
    const modal = overlay({ id: "confirm" });
    const state = rig(box([modal]));

    state.layer.syncPresence(0);

    expect(state.layer.presenceOf(modal)).toBe(1);
    expect(state.host.markAnimating).not.toHaveBeenCalled();
  });

  it("keeps an overlay that left the layer painting while it fades", () => {
    const modal = overlay({ id: "confirm" });
    const state = rig(box([modal]));
    state.transition({ duration: 200, easing: "linear" });
    state.layer.syncPresence(0);
    state.layer.syncPresence(200);
    expect(state.layer.presenceOf(modal)).toBe(1);

    modal.visibleFlag = false;
    state.layer.syncPresence(300);

    // Out of the live layer but still visible: it paints, and nothing else.
    expect(state.layer.isExiting(modal)).toBe(true);
    expect(state.layer.anyExiting()).toBe(true);
    expect(state.layer.presenceOf(modal)).toBeGreaterThan(0);
    expect(state.host.markAnimating).toHaveBeenCalled();
  });

  it("stops calling it exiting once the fade is over", () => {
    const modal = overlay({ id: "confirm" });
    const state = rig(box([modal]));
    state.transition({ duration: 200, easing: "linear" });
    state.layer.syncPresence(0);
    state.layer.syncPresence(200);

    modal.visibleFlag = false;
    state.layer.syncPresence(200);
    state.layer.syncPresence(500);

    expect(state.layer.isExiting(modal)).toBe(false);
    expect(state.layer.anyExiting()).toBe(false);
  });

  it("tracks every Overlay of the tree, not only the ones in the layer", () => {
    const shown = overlay({ id: "toast" });
    const hidden = overlay({ id: "modal" });
    hidden.visibleFlag = false;
    const state = rig(box([shown, box([hidden])]));

    state.layer.syncPresence(0);

    expect(state.layer.presenceOf(shown)).toBe(1);
    expect(state.layer.presenceOf(hidden)).toBe(0);
  });
});

describe("autoCloseMs", () => {
  it("arms while the overlay is in the layer and dismisses when it fires", () => {
    vi.useFakeTimers();
    const toast = overlay({ id: "toast", autoCloseMs: 1000 });
    const state = rig(box([toast]));

    state.layer.syncAutoClose();
    vi.advanceTimersByTime(999);
    expect(state.host.closeVisible).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(state.host.closeVisible).toHaveBeenCalledWith(toast);
  });

  it("arms once, not once per render", () => {
    vi.useFakeTimers();
    const toast = overlay({ id: "toast", autoCloseMs: 1000 });
    const state = rig(box([toast]));

    state.layer.syncAutoClose();
    vi.advanceTimersByTime(500);
    state.layer.syncAutoClose();
    vi.advanceTimersByTime(500);

    // A timer re-armed every frame would never fire at all.
    expect(state.host.closeVisible).toHaveBeenCalledTimes(1);
  });

  it("disarms when the overlay leaves the layer before its time", () => {
    vi.useFakeTimers();
    const toast = overlay({ id: "toast", autoCloseMs: 1000 });
    const state = rig(box([toast]));
    state.layer.syncAutoClose();

    toast.visibleFlag = false;
    state.layer.syncAutoClose();
    vi.advanceTimersByTime(2000);

    expect(state.host.closeVisible).not.toHaveBeenCalled();
  });

  it("never arms one for a hover-triggered overlay", () => {
    vi.useFakeTimers();
    const anchor = trigger();
    anchor.hovered = true;
    const hint = overlay({
      id: "hint",
      autoCloseMs: 1000,
      anchor: { id: "trigger", at: "bottom", trigger: "hover" },
    });
    const state = rig(box([anchor, hint]));

    state.layer.syncAutoClose();
    vi.advanceTimersByTime(2000);

    // What dismisses a hint is leaving the anchor; a timer would take it away
    // from under a pointer still resting on it.
    expect(state.host.closeVisible).not.toHaveBeenCalled();
  });

  it("clears everything armed when the view goes down", () => {
    vi.useFakeTimers();
    const toast = overlay({ id: "toast", autoCloseMs: 1000 });
    const state = rig(box([toast]));
    state.layer.syncAutoClose();

    state.layer.clearAutoClose();
    vi.advanceTimersByTime(2000);

    expect(state.host.closeVisible).not.toHaveBeenCalled();
  });
});

describe("an anchor that comes and goes", () => {
  it("keeps the entry in the layer exactly while its anchor is on screen", () => {
    const anchor = trigger();
    const hint = overlay({ id: "hint", anchor: { id: "trigger", at: "bottom" } });
    const state = rig(box([anchor, hint]));
    expect(state.live()).toContain(hint);

    anchor.visibleFlag = false;

    expect(state.live()).not.toContain(hint);
  });

  it("shows a hover-triggered overlay only while its anchor is lit", () => {
    const anchor = trigger();
    const hint = overlay({
      id: "hint",
      anchor: { id: "trigger", at: "bottom", trigger: "hover" },
    });
    const state = rig(box([anchor, hint]));
    expect(state.live()).not.toContain(hint);

    anchor.hovered = true;
    expect(state.live()).toContain(hint);

    anchor.hovered = false;
    anchor.focused = true;
    // Focus lights it too: a pad player gets the same hint a mouse does.
    expect(state.live()).toContain(hint);
  });

  it("warns once about an anchor that can never light up", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const anchor = node(
      { type: "Container", id: "trigger" },
      { x: 0, y: 0, width: 10, height: 10 },
    );
    const hint = overlay({
      id: "hint",
      anchor: { id: "trigger", at: "bottom", trigger: "hover" },
    });
    const state = rig(box([anchor, hint]));

    state.live();
    state.live();

    // A Container takes no input, so it is never hovered NOR focused and the
    // hint would simply never appear — authoring error, reported once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("takes no");
    warn.mockRestore();
  });
});

describe("popovers", () => {
  it("toggles the ones an anchor owns, and says whether it had any", () => {
    const anchor = trigger();
    const menu = overlay({
      id: "menu",
      anchor: { id: "trigger", at: "bottom", trigger: "press" },
    });
    const state = rig(box([anchor, menu]));

    expect(state.layer.togglePopovers(anchor)).toBe(true);
    expect(menu.popoverOpen).toBe(true);
    expect(state.live()).toContain(menu);

    // The same press that opens a dropdown closes it.
    state.layer.togglePopovers(anchor);
    expect(menu.popoverOpen).toBe(false);
    expect(state.live()).not.toContain(menu);
  });

  it("says nothing happened for an anchor with no popover", () => {
    const buy = button("buy");
    const state = rig(box([buy]));

    expect(state.layer.togglePopovers(buy)).toBe(false);
  });

  it("closes the popover a chosen option lives in", () => {
    const option = button("option");
    const menu = overlay(
      { id: "menu", anchor: { id: "trigger", at: "bottom", trigger: "press" } },
      [option],
    );
    menu.popoverOpen = true;
    const state = rig(box([trigger(), menu]));

    state.layer.closeEnclosingPopover(option);

    expect(menu.popoverOpen).toBe(false);
  });

  it("leaves a node that is in no popover alone", () => {
    const ok = button("ok");
    const modal = overlay({ id: "confirm" }, [ok]);
    const state = rig(box([modal]));

    expect(() => state.layer.closeEnclosingPopover(ok)).not.toThrow();
  });
});

describe("state keyed by node identity", () => {
  /** A released node's identity dies with it — the bookkeeping has to die too. */
  it("forgets the modal stack entry of a node that is gone", () => {
    const buy = button("buy");
    const modal = overlay({ id: "confirm" }, [button("ok")]);
    const state = rig(box([buy, modal]));
    state.focus(buy);
    state.layer.syncModalFocus();

    state.layer.forget(modal);
    modal.visibleFlag = false;
    state.layer.syncModalFocus();

    // No entry left to restore from: the focus goes to the scope's autofocus,
    // not to a node the stack was still pointing at.
    expect(state.host.autofocus).toHaveBeenCalled();
  });

  it("forgets a remembered focus whose node was released", () => {
    // `cancel` comes first, so it is what the scope's autofocus answers — the
    // restore and the fallback are then telling apart.
    const other = button("cancel");
    const buy = button("buy", { x: 60, y: 0, width: 40, height: 20 });
    const modal = overlay({ id: "confirm" }, [button("ok")]);
    const state = rig(box([other, buy, modal]));
    state.focus(buy);
    state.layer.syncModalFocus();

    state.layer.forget(buy);
    modal.visibleFlag = false;
    state.layer.syncModalFocus();

    expect(state.focused()).toBe(other);
  });

  it("drops everything on a rebuild — a reload snaps, like every other tween", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const toast = overlay({ id: "toast", autoCloseMs: 1000 });
    const missing = overlay({ id: "hint", anchor: { id: "gone", at: "bottom" } });
    const state = rig(box([toast, missing]));
    state.transition({ duration: 200, easing: "linear" });
    state.layer.syncAutoClose();
    state.layer.syncPresence(0);
    state.live();
    expect(warn).toHaveBeenCalledTimes(1);

    state.layer.reset();
    vi.advanceTimersByTime(2000);

    expect(state.host.closeVisible).not.toHaveBeenCalled();
    expect(state.layer.anyExiting()).toBe(false);
    // The warning set went too: the new document's anchors are a new question.
    state.live();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
