/**
 * The panel, against the real store.
 *
 * The drag cases carry the weight, and they need one prop of their own: jsdom has
 * no layout, so every rect it reports is zero and a clamp fed zeros pins the card
 * at the origin no matter what you do. `stubRects` gives the stage a size and the
 * card a position derived from the style it is actually wearing — which is the
 * one thing the component controls — so the arithmetic under test is the
 * component's and not jsdom's.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Binding, BindingType } from "@/store/bindings";
import { DEFAULT_LAYOUT } from "@/store/layout";
import { useStore } from "@/store/store";
import { BindingsPanel } from "./BindingsPanel";

const STAGE = { width: 1000, height: 600 };
const CARD = { width: 296, height: 400 };

beforeEach(() => {
  useStore.setState({
    layout: DEFAULT_LAYOUT,
    bindings: { byPath: {}, order: [] },
    connection: "live",
    lastError: null,
    problems: [],
  });
});

function binding(path: string, type: BindingType = "string"): Binding {
  return { path, type, value: undefined, lastWriteFrom: null, writtenAt: null };
}

function declare(...paths: string[]): void {
  useStore.setState({
    bindings: {
      byPath: Object.fromEntries(paths.map((path) => [path, binding(path)])),
      order: paths,
    },
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

/**
 * The stage is a fixed box at the viewport's origin; the card reads its own
 * inline style, so `right: 14px` measures as the top-right corner exactly the
 * way a browser would resolve it.
 */
function stubRects(stage: HTMLElement, card: HTMLElement): void {
  stage.getBoundingClientRect = () => rect(0, 0, STAGE.width, STAGE.height);
  card.getBoundingClientRect = () => {
    const inset = Number.parseFloat(card.style.right);
    const left = Number.isNaN(inset)
      ? Number.parseFloat(card.style.left || "0")
      : STAGE.width - inset - CARD.width;
    return rect(left, Number.parseFloat(card.style.top || "0"), CARD.width, CARD.height);
  };
}

interface Panel {
  card: HTMLElement;
  handle: HTMLElement;
  grip: Element;
}

function renderPanel(): Panel {
  const { container } = render(
    <div data-region="stage" className="relative">
      <BindingsPanel />
    </div>,
  );
  const stage = container.firstElementChild as HTMLElement;
  const card = stage.querySelector<HTMLElement>('[data-panel="bindings"]');
  if (card === null) throw new Error("the panel did not render");
  const handle = card.querySelector<HTMLElement>("[data-drag-handle]");
  const grip = card.querySelector("[data-grip]");
  if (handle === null || grip === null) throw new Error("the panel has no drag handle");
  stubRects(stage, card);
  return { card, handle, grip };
}

/**
 * A press on the grip, delivered the way a browser delivers it. The header takes
 * a pointer capture on the way down, so every event after the `pointerdown` —
 * the release AND the `click` derived from it — is retargeted to the header: the
 * grip sees the press and nothing else. Driving it any other way tests a path
 * Chrome does not take, which is exactly how this bug shipped.
 */
function pressGrip(handle: HTMLElement, grip: Element): void {
  fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 970, clientY: 20 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 970, clientY: 20 });
  fireEvent.click(handle, { detail: 1 });
}

/**
 * jsdom implements no pointer capture at all, so the header's calls are no-ops
 * there. Standing them up is what lets a test say the capture is taken and given
 * back — the retargeting itself stays `pressGrip`'s job.
 */
function stubCapture(handle: HTMLElement): { captured: number[]; released: number[] } {
  const captured: number[] = [];
  const released: number[] = [];
  handle.setPointerCapture = (pointerId: number) => {
    captured.push(pointerId);
  };
  handle.hasPointerCapture = (pointerId: number) =>
    captured.includes(pointerId) && !released.includes(pointerId);
  handle.releasePointerCapture = (pointerId: number) => {
    released.push(pointerId);
  };
  return { captured, released };
}

/** One pointer, pressed at `from`, moved to `to` and released. */
function dragBy(handle: HTMLElement, from: [number, number], to: [number, number]): void {
  const [downX, downY] = from;
  const [upX, upY] = to;
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: downX, clientY: downY });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: upX, clientY: upY });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: upX, clientY: upY });
}

describe("BindingsPanel", () => {
  it("does not render when the panel is closed", () => {
    useStore.getState().setPanelOpen(false);

    render(<BindingsPanel />);

    expect(screen.queryByText("Data bindings")).not.toBeInTheDocument();
  });

  it("does not render in zen mode", () => {
    useStore.getState().setZen(true);

    render(<BindingsPanel />);

    expect(screen.queryByText("Data bindings")).not.toBeInTheDocument();
  });

  it("counts the declared paths in its header", () => {
    declare("player.gold", "player.name", "settings.sfx");

    renderPanel();

    expect(screen.getByText("3 paths")).toBeInTheDocument();
  });

  it("says 'path' when there is only one", () => {
    declare("player.gold");

    renderPanel();

    expect(screen.getByText("1 path")).toBeInTheDocument();
  });

  it("renders one field per path, in the store's order", () => {
    declare("player.gold", "player.name", "settings.sfx");

    const { card } = renderPanel();

    const paths = [...card.querySelectorAll("[data-binding-path]")].map((row) =>
      row.getAttribute("data-binding-path"),
    );
    expect(paths).toEqual(["player.gold", "player.name", "settings.sfx"]);
  });

  it("closes from the header, leaving the panel reopenable", () => {
    const { handle } = renderPanel();

    fireEvent.click(within(handle).getByRole("button", { name: "Close bindings panel" }));

    expect(useStore.getState().layout.panelOpen).toBe(false);
    expect(screen.queryByText("Data bindings")).not.toBeInTheDocument();
  });

  it("sits in the default corner until it is dragged", () => {
    const { card } = renderPanel();

    expect(card.style.top).toBe("14px");
    expect(card.style.right).toBe("14px");
    expect(card.style.left).toBe("");
  });

  it("moves with the pointer and persists where it was dropped", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { card, handle } = renderPanel();

    // Grabbed 50px into the card, dropped 250px to the right and 80px down.
    dragBy(handle, [150, 120], [400, 200]);

    expect(useStore.getState().layout.panelPos).toEqual({ x: 350, y: 180 });
    expect(card.style.left).toBe("350px");
    expect(card.style.top).toBe("180px");
  });

  it("keeps the card inside the stage", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { handle } = renderPanel();

    dragBy(handle, [150, 120], [5000, 5000]);

    expect(useStore.getState().layout.panelPos).toEqual({
      x: STAGE.width - CARD.width,
      y: STAGE.height - CARD.height,
    });
  });

  it("pulls the card back inside a shrunken window without persisting it", () => {
    useStore.getState().setPanelPos({ x: 600, y: 150 });
    const { card } = renderPanel();
    const stage = card.parentElement as HTMLElement;
    stage.getBoundingClientRect = () => rect(0, 0, 700, 600);

    fireEvent(window, new Event("resize"));

    expect(card.style.left).toBe("404px");
    // A resize says something about the window, not about where you put the panel.
    expect(useStore.getState().layout.panelPos).toEqual({ x: 600, y: 150 });
  });

  it("pulls a position persisted on another window back on stage at mount, not only on resize", () => {
    // The rects must exist BEFORE the panel mounts — the mount-time measurement
    // is the thing under test here, so the stub goes on the prototype instead of
    // on the instances `renderPanel` hands back after rendering.
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      return this.hasAttribute("data-panel")
        ? rect(0, 0, CARD.width, CARD.height)
        : rect(0, 0, STAGE.width, STAGE.height);
    });
    useStore.getState().setPanelPos({ x: 1600, y: 50 });

    const { card } = renderPanel();

    expect(card.style.left).toBe(`${STAGE.width - CARD.width}px`);
    expect(card.style.top).toBe("50px");
    // Pulled on screen, not rewritten: the persisted position still belongs to
    // the window it was dragged on — same contract as the resize pull-back.
    expect(useStore.getState().layout.panelPos).toEqual({ x: 1600, y: 50 });
    spy.mockRestore();
  });

  it("does not move on a press that never went anywhere", () => {
    const { handle } = renderPanel();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 800, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800, clientY: 20 });

    expect(useStore.getState().layout.panelPos).toBeNull();
  });

  it("reads a press with a pixel of jitter as a click, not a reposition", () => {
    // Trackpads move during a click. Below the threshold the sequence is still a
    // click — so it neither commits a position nor swallows the grip's reset.
    const { handle } = renderPanel();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 800, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 802, clientY: 21 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 802, clientY: 21 });

    expect(useStore.getState().layout.panelPos).toBeNull();
  });

  /**
   * The regression itself: with the header capturing, no `click` ever reaches
   * the grip, so a reset that hangs off the grip's `onClick` never runs and the
   * panel has no way home but clearing `localStorage`.
   */
  it("goes back to the default corner on a press of the grip, though the click lands on the header", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { card, handle, grip } = renderPanel();

    pressGrip(handle, grip);

    expect(useStore.getState().layout.panelPos).toBeNull();
    expect(card.style.right).toBe("14px");
    expect(card.style.left).toBe("");
  });

  it("takes the pointer capture on the header and gives it back on the release", () => {
    const { handle } = renderPanel();
    const capture = stubCapture(handle);

    dragBy(handle, [150, 120], [400, 200]);

    expect(capture.captured).toEqual([1]);
    expect(capture.released).toEqual([1]);
  });

  it("resets from a captured press on the grip too", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { card, handle, grip } = renderPanel();
    stubCapture(handle);

    pressGrip(handle, grip);

    expect(useStore.getState().layout.panelPos).toBeNull();
    expect(card.style.right).toBe("14px");
  });

  /**
   * The grip arms the reset, not the whole header — the header is the drag
   * target, and a press on it that changes its mind must leave the position
   * where it was.
   */
  it("does not reset on a press that started on the header rather than the grip", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { handle } = renderPanel();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 150, clientY: 120 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150, clientY: 120 });
    fireEvent.click(handle, { detail: 1 });

    expect(useStore.getState().layout.panelPos).toEqual({ x: 100, y: 100 });
  });

  /**
   * A press on the grip that aborts before it is a drag — a secondary button —
   * must not leave the reset armed for whatever press comes next.
   */
  it("does not carry an aborted press on the grip into the next one", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { handle, grip } = renderPanel();

    fireEvent.pointerDown(grip, { pointerId: 1, button: 2, clientX: 970, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 970, clientY: 20 });

    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 150, clientY: 120 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 150, clientY: 120 });

    expect(useStore.getState().layout.panelPos).toEqual({ x: 100, y: 100 });
  });

  it("goes back to the default corner on a double click of the grip", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { card, handle, grip } = renderPanel();

    // Two presses, not a `dblclick` handler: each release is a reset on its own,
    // so the second one lands on a panel already home.
    pressGrip(handle, grip);
    pressGrip(handle, grip);

    expect(useStore.getState().layout.panelPos).toBeNull();
    expect(card.style.right).toBe("14px");
  });

  /**
   * The keyboard's own path, which is why the grip is a real button. A `click`
   * a key produced carries no count in `detail` — that is what tells it apart
   * from the one a press leaves behind.
   */
  it("goes back to the default corner when the grip is activated from the keyboard", () => {
    useStore.getState().setPanelPos({ x: 100, y: 100 });
    const { card, grip } = renderPanel();

    expect(screen.getByRole("button", { name: "Reset panel position" })).toBe(grip);
    fireEvent.click(grip, { detail: 0 });

    expect(useStore.getState().layout.panelPos).toBeNull();
    expect(card.style.right).toBe("14px");
  });

  /**
   * And it still works once the panel has been dragged. It did not while the
   * guard was a flag set by the drag and cleared only by the next press: a
   * keyboard reset after any drag read a gesture that had long since ended.
   */
  it("still resets from the keyboard after a drag", () => {
    const { card, handle, grip } = renderPanel();

    dragBy(handle, [150, 120], [400, 200]);
    fireEvent.click(grip, { detail: 0 });

    expect(useStore.getState().layout.panelPos).toBeNull();
    expect(card.style.right).toBe("14px");
  });

  /**
   * The grip is both the drag affordance and the reset, so a drag that starts on
   * it must survive its own ending: the release commits the move rather than
   * undoing it, and the `click` that follows is nobody's reset.
   */
  it("does not reset on the click that ends a drag started from the grip", () => {
    const { handle, grip } = renderPanel();
    stubCapture(handle);

    // Pressed on the grip; everything after it retargeted to the header by the
    // capture, and the click delivered there as well.
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 800, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.click(handle, { detail: 1 });

    expect(useStore.getState().layout.panelPos).not.toBeNull();
  });

  /**
   * And the same drag in a browser that did not capture, where the `click` does
   * land on the grip. It carries `detail: 1` because a pointer made it, and that
   * is what keeps it from throwing away the move just made.
   */
  it("does not reset on a click that reaches the grip after a drag", () => {
    const { grip } = renderPanel();

    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 800, clientY: 20 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.click(grip, { detail: 1 });

    expect(useStore.getState().layout.panelPos).not.toBeNull();
  });

  it("says so when the view declares no paths", () => {
    renderPanel();

    expect(screen.getByText("No bindings")).toBeInTheDocument();
    expect(screen.getByText("This view declares no data paths.")).toBeInTheDocument();
  });

  it("holds the values and says so when the export is stale", () => {
    declare("player.gold");
    useStore.getState().exportFailed("export blew up");

    const { card } = renderPanel();

    expect(screen.getByText(/Values held/)).toBeInTheDocument();
    expect(card.querySelector('[data-slot="card-content"]')).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("holds the values on a fatal too, with the export still live", () => {
    declare("player.gold");
    useStore
      .getState()
      .replaceProblems([{ severity: "fatal", code: "unknown-node", path: "a", reason: "no" }]);

    renderPanel();

    expect(screen.getByText(/Values held/)).toBeInTheDocument();
  });

  it("shows no footer while the export is live", () => {
    declare("player.gold");

    const { card } = renderPanel();

    expect(screen.queryByText(/Values held/)).not.toBeInTheDocument();
    expect(card.querySelector('[data-slot="card-content"]')).not.toHaveAttribute("aria-disabled");
  });
});
