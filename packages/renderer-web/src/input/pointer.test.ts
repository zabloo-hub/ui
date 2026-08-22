import type { OverlayNode, ZNode } from "@zabloo/format";
import { describe, expect, it, vi } from "vitest";
import { FieldEditor, type FieldHost } from "../controls/field.js";
import { createLayoutNode, type LayoutNode, type Rect } from "../layout.js";
import { overlaysOf } from "../overlay.js";
import { type OverlayHost, OverlayLayer } from "../overlays/layer.js";
import type { TextMetrics } from "../text.js";
import { caretAt } from "../textinput.js";
import { PointerHandler, type PointerHost, type SliderGesture } from "./pointer.js";

/**
 * `PointerHandler` against its own seam (ZAB-74). The gestures it resolves are
 * exercised end-to-end in `view.test.ts`; what only reaches here is the STATE
 * MACHINE underneath them — which node a press is anchored to, which gesture
 * owns the pointer, and the four ways one can end without a release: a cancel,
 * a node that left the tree, a control the game disabled mid-drag, and a
 * rebuild.
 *
 * Every host member is a spy, so a test can also assert what the pointer did
 * NOT ask for: a tap that must not become a scroll is a `setScrollOffset` that
 * never happened.
 */

const VIEW: Rect = { x: 0, y: 0, width: 200, height: 200 };

/** Monospace stand-in for the one field below — 10px per glyph. */
const FONT: TextMetrics = { advance: () => 10, kern: () => 0, lineHeight: 20, ascent: 16 };

function node(ir: ZNode, rect: Rect, children: LayoutNode[] = []): LayoutNode {
  const built = createLayoutNode(ir);
  built.children = children;
  built.measured = { x: rect.width, y: rect.height };
  built.natural = { x: rect.width, y: rect.height };
  built.rect = rect;
  for (const child of children) child.parent = built;
  return built;
}

const box = (children: LayoutNode[] = [], rect = VIEW): LayoutNode =>
  node({ type: "Container" }, rect, children);

const overlay = (props: Omit<OverlayNode, "type">, children: LayoutNode[] = []): LayoutNode =>
  node({ type: "Overlay", ...props }, VIEW, children);

/** Controls, each filling the top-left 100×100 unless told otherwise. */
const CONTROL: Rect = { x: 0, y: 0, width: 100, height: 100 };
const at = (rect: Rect) => rect;

const button = (id: string, rect = CONTROL): LayoutNode => node({ type: "Button", id }, rect);
const slider = (id: string, rect = CONTROL): LayoutNode => node({ type: "Slider", id }, rect);
const textInput = (id: string, rect = CONTROL): LayoutNode => node({ type: "TextInput", id }, rect);
const scroller = (id: string, children: LayoutNode[] = [], rect = VIEW): LayoutNode =>
  node({ type: "ScrollView", id }, rect, children);

/** The canvas the handler listens on: only what `pointer.ts` reaches for. */
class FakeCanvas {
  readonly captured: number[] = [];
  /** The LAYOUT box — the units the tree above is laid out in. */
  readonly clientWidth = VIEW.width;
  readonly clientHeight = VIEW.height;
  /** What a `transform` draws it at; 1 until a test scales it (ZAB-108). */
  zoom = 1;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    set.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return {
      left: 0,
      top: 0,
      width: this.clientWidth * this.zoom,
      height: this.clientHeight * this.zoom,
    };
  }

  /** Where a point of the view lands on the page once the canvas is scaled. */
  toClient(x: number, y: number): { x: number; y: number } {
    return { x: x * this.zoom, y: y * this.zoom };
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
  }
  dispatch(type: string, event: Record<string, unknown>): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

interface Rig {
  pointer: PointerHandler;
  canvas: FakeCanvas;
  host: { [K in keyof PointerHost]: PointerHost[K] };
  overlays: OverlayLayer;
  field: FieldEditor;
  disposers: Array<() => void>;
  /**
   * Pointer gestures in view coordinates — the canvas sits at the origin. Under
   * `zoomCanvas` they are still view coordinates: the rig scales them on the way
   * out, so a test names where a control IS and the handler has to find it there.
   */
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel(): void;
  click(x: number, y: number): void;
  /** Deltas here are the browser's own — screen pixels, unscaled. */
  wheel(x: number, y: number, deltaX: number, deltaY: number): number;
  leave(): void;
  /** Draws the canvas smaller without laying it out smaller, and says so. */
  zoomCanvas(zoom: number): void;
}

/**
 * A handler wired to a tree, with every host member spied. `focusable` is the
 * view's own predicate; here it is "a control with an id", which is what every
 * tree below builds.
 */
function rig(root: LayoutNode, layer: readonly LayoutNode[] = []): Rig {
  const canvas = new FakeCanvas();
  const disposers: Array<() => void> = [];

  const host = {
    canvas: canvas as unknown as HTMLCanvasElement,
    claimInput: vi.fn(),
    root: () => root,
    layer: () => layer,
    radiusOf: () => 0,
    isFocusable: (n: LayoutNode) =>
      !n.disabled &&
      (n.ir.type === "Button" ||
        n.ir.type === "Toggle" ||
        n.ir.type === "Slider" ||
        n.ir.type === "TextInput"),
    isCollapseHeader: (n: LayoutNode) =>
      n.parent?.ir.type === "Collapse" && n.parent.children[0] === n,
    setFocus: vi.fn(),
    activate: vi.fn(),
    setCollapseOpen: vi.fn(),
    setSliderValue: vi.fn((n: LayoutNode, value: number) => {
      n.sliderValue = value;
    }),
    valueAtPoint: vi.fn((_n: LayoutNode, point: { x: number; y: number }) => point.x / 100),
    commitSlider: vi.fn(),
    setScrollOffset: vi.fn((n: LayoutNode, x: number, y: number) => {
      n.scrollOffset = { x, y };
    }),
    addDisposer: (dispose: () => void) => disposers.push(dispose),
    render: vi.fn(),
  };

  const fieldHost: FieldHost = {
    focused: () => null,
    metrics: () => FONT,
    contentBox: (n) => n.rect,
    textEdited: () => {},
    attachEditor: () => {},
    addDisposer: (dispose) => disposers.push(dispose),
    render: () => {},
  };
  const field = new FieldEditor(fieldHost);

  const overlays = new OverlayLayer({
    root: () => root,
    // The registry the view keeps as it builds (ZAB-73), re-derived here from
    // the tree this rig holds.
    eachOverlay: (visit) => {
      for (const overlay of overlaysOf(root)) visit(overlay);
    },
    layer: () => layer,
    focused: () => null,
    focusPending: () => false,
    nodeById: () => undefined,
    scope: () => root,
    isFocusable: host.isFocusable,
    autofocus: () => null,
    setFocus: () => {},
    closeVisible: vi.fn(),
    dismissed: vi.fn(),
    transitionOf: () => null,
    markAnimating: () => {},
    radiusOf: () => 0,
    dim: (value, fallback) => (typeof value === "number" ? value : fallback),
    render: vi.fn(),
  } satisfies OverlayHost);

  const pointer = new PointerHandler(host as unknown as PointerHost, field, overlays);
  pointer.listen();

  const event = (x: number, y: number, extra: Record<string, unknown> = {}) => {
    const client = canvas.toClient(x, y);
    return {
      clientX: client.x,
      clientY: client.y,
      pointerId: 1,
      pointerType: "mouse",
      preventDefault: () => {},
      ...extra,
    };
  };

  return {
    pointer,
    canvas,
    host: host as unknown as Rig["host"],
    overlays,
    field,
    disposers,
    down: (x, y) => canvas.dispatch("pointerdown", event(x, y)),
    move: (x, y) => canvas.dispatch("pointermove", event(x, y)),
    up: (x, y) => canvas.dispatch("pointerup", event(x, y)),
    cancel: () => canvas.dispatch("pointercancel", event(0, 0)),
    click: (x, y) => {
      canvas.dispatch("pointerdown", event(x, y));
      canvas.dispatch("pointerup", event(x, y));
    },
    wheel: (x, y, deltaX, deltaY) => {
      const prevented: true[] = [];
      canvas.dispatch(
        "wheel",
        event(x, y, { deltaX, deltaY, preventDefault: () => prevented.push(true) }),
      );
      return prevented.length;
    },
    leave: () => canvas.dispatch("pointerleave", {}),
    zoomCanvas: (zoom) => {
      canvas.zoom = zoom;
      // What the view does when the page announces the rescale: the cached rect
      // and the factor that came with it are both gone.
      pointer.invalidateBounds();
    },
  };
}

describe("which gesture takes the pointer", () => {
  it("gives a Slider the press, before the scroller it lives in", () => {
    const value = slider("volume");
    const state = rig(scroller("list", [value]));

    state.down(40, 10);

    // The thumb jumps to the finger on the PRESS: the gesture is the slider's
    // from the first pixel, or dragging a control inside a list would scroll it.
    expect(state.host.setSliderValue).toHaveBeenCalledWith(value, 0.4);
    expect(state.pointer.isSliderDragging(value)).toBe(true);
    expect(state.host.setScrollOffset).not.toHaveBeenCalled();
  });

  it("gives a TextInput the press, so the drag selects instead of scrolling", () => {
    const name = textInput("name");
    name.text = "hola";
    const state = rig(scroller("list", [name]));

    state.down(21, 10);
    state.move(41, 10);

    expect(state.host.setFocus).toHaveBeenCalledWith(name);
    // Anchor where the press landed, focus following the pointer.
    expect(name.selection).toEqual({ anchor: 2, focus: 4 });
    expect(state.host.setScrollOffset).not.toHaveBeenCalled();
  });

  it("presses a Button, and the release over it activates it", () => {
    const buy = button("buy");
    const state = rig(box([buy]));

    state.down(10, 10);
    expect(buy.pressed).toBe(true);
    expect(state.pointer.pressed()).toBe(buy);

    state.up(10, 10);
    expect(buy.pressed).toBe(false);
    expect(state.host.activate).toHaveBeenCalledWith(buy);
  });

  it("falls THROUGH a disabled control to what is behind it (ZAB-63)", () => {
    const dead = button("dead");
    dead.disabled = true;
    const list = scroller("list", [dead]);
    const state = rig(list);

    state.down(10, 10);
    state.move(10, 60);

    // A dead button inside a scroller does not swallow the drag that scrolls it.
    expect(state.pointer.pressed()).toBeNull();
    expect(state.host.setScrollOffset).toHaveBeenCalled();
  });

  it("claims the keyboard for its view whatever the press lands on (ZAB-70)", () => {
    const state = rig(box());

    state.down(150, 150);

    // Pressing nothing is still using this view.
    expect(state.host.claimInput).toHaveBeenCalledTimes(1);
  });

  it("stops at an Overlay: a gesture inside a modal never reaches its declared parent", () => {
    const ok = button("ok");
    const modal = overlay({ id: "confirm" }, [ok]);
    // Declared INSIDE the scroller, but it belongs to the layer.
    const state = rig(scroller("list", [modal]), [modal]);

    state.down(10, 10);
    state.move(10, 60);

    expect(state.pointer.pressed()).toBe(ok);
    expect(state.host.setScrollOffset).not.toHaveBeenCalled();
  });
});

describe("the drag threshold", () => {
  it("keeps a jittery press a tap: under 4px nothing scrolls", () => {
    const header = button("header");
    const state = rig(scroller("list", [header]));

    state.down(10, 10);
    state.move(12, 12);

    // 2.83px of travel: still a tap, so the release must still reach `up`'s
    // Collapse handling instead of being swallowed as a scroll gesture.
    expect(state.host.setScrollOffset).not.toHaveBeenCalled();
  });

  it("turns into a scroll once the finger clears it, and never back", () => {
    const list = scroller("list");
    const state = rig(list);

    state.down(10, 10);
    state.move(10, 20);
    expect(list.scrollOffset).toEqual({ x: 0, y: -10 });

    // Already a drag: a move back INSIDE the threshold still scrolls.
    state.move(10, 12);
    expect(list.scrollOffset).toEqual({ x: 0, y: -2 });
  });

  it("moves the content by the delta since the LAST move, not since the press", () => {
    const list = scroller("list");
    const state = rig(list);

    state.down(10, 10);
    state.move(10, 30);
    state.move(10, 50);

    // Two 20px steps, not one 20 and one 40: the list follows the finger.
    expect(state.host.setScrollOffset).toHaveBeenNthCalledWith(1, list, 0, -20);
    expect(state.host.setScrollOffset).toHaveBeenNthCalledWith(2, list, 0, -40);
  });

  it("does not turn a drag into a click", () => {
    // The header of a Collapse is not a pressable type, so the press falls to
    // the scroller — and the release, after a real drag, must not toggle the
    // section the finger happened to start on.
    const header = box([], at({ x: 0, y: 0, width: 200, height: 40 }));
    const section = node({ type: "Collapse", id: "section" }, VIEW, [
      header,
      box([], at({ x: 0, y: 40, width: 200, height: 160 })),
    ]);
    const state = rig(scroller("list", [section]));

    state.down(10, 10);
    state.move(10, 60);
    state.up(10, 60);

    expect(state.host.setCollapseOpen).not.toHaveBeenCalled();
    expect(state.host.activate).not.toHaveBeenCalled();
  });
});

describe("a press that does not conclude", () => {
  it("fires nothing when the release lands off the control", () => {
    const buy = button("buy", at({ x: 0, y: 0, width: 50, height: 50 }));
    const state = rig(box([buy]));

    state.down(10, 10);
    state.up(120, 120);

    expect(buy.pressed).toBe(false);
    expect(state.host.activate).not.toHaveBeenCalled();
  });

  it("fires nothing when the control was scrolled out from under the finger", () => {
    const buy = button("buy", at({ x: 0, y: 0, width: 200, height: 40 }));
    const list = scroller("list", [buy], at({ x: 0, y: 100, width: 200, height: 100 }));
    // The button's own rect still contains the point; its parent's clip does not.
    const state = rig(list);

    state.down(10, 10);
    state.up(10, 10);

    expect(state.host.activate).not.toHaveBeenCalled();
  });

  /**
   * A pointer can END without a release: a touch the system interrupted, a
   * browser gesture taking over, a lost `pointerId` (ZAB-70). Everything in
   * flight stops, and none of it concludes.
   */
  it("drops a button press on a cancel — a cancel is not a click", () => {
    const buy = button("buy");
    const state = rig(box([buy]));

    state.down(10, 10);
    state.cancel();

    expect(buy.pressed).toBe(false);
    expect(state.pointer.pressed()).toBeNull();
    expect(state.host.activate).not.toHaveBeenCalled();
  });

  it("settles a Slider that was mid-drag: the value it left is the value it committed", () => {
    const volume = slider("volume");
    const state = rig(box([volume]));

    state.down(40, 10);
    state.move(70, 10);
    state.cancel();

    // The exception, and the same reading as a pad unplugged mid-nudge: the
    // value is on screen and was written on every move, so `onCommit` is owed.
    expect(state.host.commitSlider).toHaveBeenCalledWith({ node: volume, from: 0 });
    expect(volume.pressed).toBe(false);
    expect(state.pointer.isSliderDragging(volume)).toBe(false);
  });

  it("ends a scroll drag, so the pointer stops dragging the list around", () => {
    const list = scroller("list");
    const state = rig(list);

    state.down(10, 10);
    state.move(10, 60);
    state.cancel();
    state.move(10, 120);

    expect(state.host.setScrollOffset).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss the modal whose backdrop it had pressed", () => {
    const modal = overlay({ id: "confirm" }, [
      button("ok", at({ x: 0, y: 0, width: 10, height: 10 })),
    ]);
    const state = rig(box([modal]), [modal]);
    const dismiss = vi.spyOn(state.overlays, "requestDismiss");

    state.down(150, 150);
    state.cancel();
    state.up(150, 150);

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("commits a cancelled Slider AFTER the state is clean", () => {
    const volume = slider("volume");
    const state = rig(box([volume]));
    const commit: { dragging: boolean | null } = { dragging: null };
    (state.host.commitSlider as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (gesture: SliderGesture) => {
        commit.dragging = state.pointer.isSliderDragging(gesture.node);
      },
    );

    state.down(40, 10);
    state.cancel();

    // The handler an `onCommit` runs can re-enter this view: it must not find a
    // gesture that is already over still in flight.
    expect(commit.dragging).toBe(false);
  });
});

describe("a modal's backdrop", () => {
  it("dismisses on release, like a button click", () => {
    const modal = overlay({ id: "confirm" }, [
      button("ok", at({ x: 0, y: 0, width: 10, height: 10 })),
    ]);
    const state = rig(box([modal]), [modal]);
    const dismiss = vi.spyOn(state.overlays, "requestDismiss");

    state.down(150, 150);
    state.up(150, 150);

    expect(dismiss).toHaveBeenCalledWith(modal);
  });

  it("does not dismiss when the release left the backdrop", () => {
    const ok = button("ok", at({ x: 0, y: 0, width: 20, height: 20 }));
    const modal = overlay({ id: "confirm" }, [ok]);
    const state = rig(box([modal]), [modal]);
    const dismiss = vi.spyOn(state.overlays, "requestDismiss");

    state.down(150, 150);
    state.up(10, 10);

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("captures the wheel: nothing below a modal scrolls", () => {
    const list = scroller("list");
    const modal = overlay({ id: "confirm" }, []);
    const state = rig(box([list, modal]), [modal]);

    const prevented = state.wheel(50, 50, 0, 40);

    expect(prevented).toBe(1);
    expect(state.host.setScrollOffset).not.toHaveBeenCalled();
  });
});

describe("the wheel", () => {
  it("scrolls the nearest ScrollView under the pointer", () => {
    const list = scroller("list");
    const state = rig(list);

    const prevented = state.wheel(50, 50, 5, 40);

    expect(state.host.setScrollOffset).toHaveBeenCalledWith(list, 5, 40);
    // Prevented, or the page behind the canvas scrolls too.
    expect(prevented).toBe(1);
  });

  it("leaves the page alone when there is nothing to scroll", () => {
    const state = rig(box([button("buy")]));

    const prevented = state.wheel(50, 50, 0, 40);

    expect(state.host.setScrollOffset).not.toHaveBeenCalled();
    expect(prevented).toBe(0);
  });
});

/**
 * The canvas drawn smaller than it is laid out — the preview's fixed viewports,
 * where a `transform: scale()` shrinks a 1280×800 view into whatever room the
 * stage has (ZAB-108). The tree is still laid out in the big unit and the
 * browser reports the small one, so every point that arrives has to be converted
 * back before it means anything.
 */
describe("a canvas drawn smaller than it is laid out", () => {
  /** A control the visual point would MISS: at half scale it lands short of it. */
  const FAR: Rect = { x: 120, y: 120, width: 60, height: 60 };

  it("activates the control the pointer is over, not the one under the raw point", () => {
    const buy = button("buy", FAR);
    const state = rig(box([buy]));
    state.zoomCanvas(0.5);

    state.click(150, 150);

    expect(state.host.activate).toHaveBeenCalledWith(buy);
  });

  it("hovers it too — the hit-test is the same one", () => {
    const buy = button("buy", FAR);
    const state = rig(box([buy]));
    state.zoomCanvas(0.5);

    state.move(150, 150);

    expect(state.pointer.hovered()).toBe(buy);
  });

  it("hands a Slider the value the thumb is at, not the one the raw point is at", () => {
    const value = slider("volume");
    const state = rig(box([value]));
    state.zoomCanvas(0.5);

    state.down(40, 10);
    state.move(80, 10);

    // `valueAtPoint` here is `point.x / 100`, and the control is 100 wide: the
    // press is at 0.4 of it and the drag at 0.8, whatever it is drawn at.
    expect(state.host.setSliderValue).toHaveBeenNthCalledWith(1, value, 0.4);
    expect(state.host.setSliderValue).toHaveBeenNthCalledWith(2, value, 0.8);
  });

  it("moves a scroll drag by the distance the finger covered on the view", () => {
    const list = scroller("list");
    const state = rig(list);
    state.zoomCanvas(0.5);

    state.down(100, 100);
    state.move(100, 60);

    // 40 view px of travel — 20 on screen, which is still past the threshold.
    expect(state.host.setScrollOffset).toHaveBeenCalledWith(list, 0, 40);
  });

  it("scrolls the wheel by what it would have scrolled unscaled", () => {
    const list = scroller("list");
    const state = rig(list);
    state.zoomCanvas(0.5);

    // The browser's deltas are screen pixels, like the point they arrive at: a
    // notch that moves 40px of screen moves 80px of a view drawn at half size,
    // which is what the same gesture as a drag covers.
    state.wheel(50, 50, 5, 40);

    expect(state.host.setScrollOffset).toHaveBeenCalledWith(list, 10, 80);
  });

  it("re-reads the scale when the canvas is rescaled under it", () => {
    const buy = button("buy", FAR);
    const state = rig(box([buy]));

    // The first gesture caches the rect at 1:1 (ZAB-73) — and the second one
    // must not be answered with it.
    state.click(150, 150);
    state.zoomCanvas(0.5);
    state.click(150, 150);

    expect(state.host.activate).toHaveBeenCalledTimes(2);
    expect(state.host.activate).toHaveBeenNthCalledWith(2, buy);
  });
});

describe("hover", () => {
  it("lights up the same nodes directional navigation does, and only those", () => {
    const buy = button("buy");
    const plain = box([], at({ x: 100, y: 0, width: 100, height: 100 }));
    const state = rig(box([buy, plain]));

    state.move(10, 10);
    expect(buy.hovered).toBe(true);

    state.move(150, 10);
    expect(buy.hovered).toBe(false);
    expect(state.pointer.hovered()).toBeNull();
  });

  it("is a MOUSE state: a touch never lights anything up", () => {
    const buy = button("buy");
    const state = rig(box([buy]));

    state.canvas.dispatch("pointermove", {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      pointerType: "touch",
      preventDefault: () => {},
    });

    // A finger that taps and leaves would otherwise keep a control lit up.
    expect(buy.hovered).toBe(false);
  });

  it("drops when the pointer leaves the canvas", () => {
    const buy = button("buy");
    const state = rig(box([buy]));
    state.move(10, 10);

    state.leave();

    expect(buy.hovered).toBe(false);
  });

  it("repaints only when the hover actually moved", () => {
    const state = rig(box([button("buy")]));
    state.move(10, 10);
    const renders = (state.host.render as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    state.move(20, 20);

    expect((state.host.render as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      renders,
    );
  });
});

describe("gestures whose node went away", () => {
  it("drops the hover of a node that left the layout", () => {
    const buy = button("buy");
    const state = rig(box([buy]));
    state.move(10, 10);

    buy.visibleFlag = false;
    state.pointer.pruneHover();

    expect(state.pointer.hovered()).toBeNull();
    expect(buy.hovered).toBe(false);
  });

  it("keeps the hover of a node that is merely elsewhere", () => {
    const buy = button("buy");
    const state = rig(box([buy]));
    state.move(10, 10);

    state.pointer.pruneHover();

    expect(state.pointer.hovered()).toBe(buy);
  });

  /**
   * The game disabling a control under a gesture (ZAB-63). The slider drag is
   * CANCELLED, not committed: the value never settled, which is the same rule as
   * a press that ends outside its control.
   */
  it("releases the hover and the press of a control the game just disabled", () => {
    const buy = button("buy");
    const state = rig(box([buy]));
    state.move(10, 10);
    state.down(10, 10);

    buy.disabled = true;
    state.pointer.pruneDisabled();

    expect(state.pointer.hovered()).toBeNull();
    expect(state.pointer.pressed()).toBeNull();
    expect(buy.pressed).toBe(false);
  });

  it("cancels a Slider drag on a disabled control without committing it", () => {
    const volume = slider("volume");
    const state = rig(box([volume]));
    state.down(40, 10);

    volume.disabled = true;
    state.pointer.pruneDisabled();

    expect(state.pointer.isSliderDragging(volume)).toBe(false);
    expect(state.host.commitSlider).not.toHaveBeenCalled();
    expect(volume.pressed).toBe(false);
  });

  it("keeps scrolling a disabled section — it is still readable", () => {
    const list = scroller("list");
    const state = rig(list);
    state.down(10, 10);
    state.move(10, 60);

    list.disabled = true;
    state.pointer.pruneDisabled();
    state.move(10, 100);

    expect(state.host.setScrollOffset).toHaveBeenCalledTimes(2);
  });

  it("forgets every gesture anchored on a node that was released", () => {
    const buy = button("buy");
    const state = rig(box([buy]));
    state.down(10, 10);

    state.pointer.forget(buy);
    state.up(10, 10);

    // The identity died with the node: the release lands on nothing.
    expect(state.pointer.pressed()).toBeNull();
    expect(state.host.activate).not.toHaveBeenCalled();
  });

  it("forgets a backdrop press whose overlay is gone", () => {
    const modal = overlay({ id: "confirm" }, [
      button("ok", at({ x: 0, y: 0, width: 10, height: 10 })),
    ]);
    const state = rig(box([modal]), [modal]);
    const dismiss = vi.spyOn(state.overlays, "requestDismiss");

    state.down(150, 150);
    state.pointer.forget(modal);
    state.up(150, 150);

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("drops everything on a rebuild — the tree it referenced is gone (ZAB-57)", () => {
    const buy = button("buy");
    const state = rig(box([buy]));
    state.move(10, 10);
    state.down(10, 10);

    state.pointer.reset();

    expect(state.pointer.pressed()).toBeNull();
    expect(state.pointer.hovered()).toBeNull();
    state.up(10, 10);
    expect(state.host.activate).not.toHaveBeenCalled();
  });
});

describe("a Collapse header", () => {
  const collapse = (header: LayoutNode, body: LayoutNode): LayoutNode =>
    node({ type: "Collapse", id: "section" }, VIEW, [header, body]);

  it("toggles its section on a tap", () => {
    const header = box([], at({ x: 0, y: 0, width: 200, height: 40 }));
    const section = collapse(header, box([], at({ x: 0, y: 40, width: 200, height: 160 })));
    const state = rig(section);

    state.click(10, 10);

    expect(state.host.setCollapseOpen).toHaveBeenCalledWith(section, false);
  });

  it("does not toggle a disabled one", () => {
    const header = box([], at({ x: 0, y: 0, width: 200, height: 40 }));
    const section = collapse(header, box([], at({ x: 0, y: 40, width: 200, height: 160 })));
    header.disabled = true;
    const state = rig(section);

    state.click(10, 10);

    expect(state.host.setCollapseOpen).not.toHaveBeenCalled();
  });
});

describe("listening", () => {
  it("registers its teardown with the view, and it unhooks everything", () => {
    const state = rig(box([button("buy")]));
    expect(state.canvas.listenerCount()).toBe(6);

    for (const dispose of state.disposers) dispose();

    expect(state.canvas.listenerCount()).toBe(0);
  });

  it("captures the pointer so a gesture survives leaving the canvas", () => {
    const state = rig(box([button("buy")]));

    state.down(10, 10);

    expect(state.canvas.captured).toEqual([1]);
  });
});

describe("the caret a press places", () => {
  it("puts it where the pointer landed, and drags a selection from there", () => {
    const name = textInput("name");
    name.text = "hola mundo";
    name.selection = caretAt(0);
    const state = rig(box([name]));

    state.down(21, 10);
    state.move(61, 10);
    state.up(61, 10);

    expect(name.selection).toEqual({ anchor: 2, focus: 6 });
    // The release ends the selection drag and nothing else: no action fires.
    expect(state.host.activate).not.toHaveBeenCalled();
  });
});
