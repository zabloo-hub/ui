/**
 * The two directions, tested apart from the markup that uses them.
 *
 * jsdom has no layout, so `test/setup.ts` installs a `ResizeObserver` that never
 * fires — honest, and useless here. These tests swap in one they can fire by
 * hand, which is the only way to say anything about what the stage does when it
 * changes size.
 */

import { render } from "@testing-library/react";
import { useStore } from "@/store";
import { useGeometryResize, useStageSize } from "./useStageSize";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  /** What the browser would report after a layout pass. */
  emit(width: number, height: number): void {
    const entry = { contentRect: { width, height } } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

const observer = (): FakeResizeObserver => {
  const last = FakeResizeObserver.instances.at(-1);
  if (last === undefined) throw new Error("nothing observed the stage");
  return last;
};

function Area() {
  const ref = useStageSize();
  return <div ref={ref} data-testid="area" />;
}

function Geometry({ width, height, zoom = 1 }: { width: number; height: number; zoom?: number }) {
  useGeometryResize({ width, height }, zoom);
  return null;
}

const original = globalThis.ResizeObserver;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  useStore.setState({ stageSize: { width: 0, height: 0 } });
});

afterEach(() => {
  globalThis.ResizeObserver = original;
});

describe("useStageSize", () => {
  it("puts what the browser measured into the store", () => {
    const { getByTestId } = render(<Area />);

    expect(observer().targets).toEqual([getByTestId("area")]);

    observer().emit(1400, 480);

    expect(useStore.getState().stageSize).toEqual({ width: 1400, height: 480 });
  });

  it("rounds the fractional box a real layout reports", () => {
    render(<Area />);

    observer().emit(1399.6, 479.2);

    expect(useStore.getState().stageSize).toEqual({ width: 1400, height: 479 });
  });

  it("stops observing when the stage goes away", () => {
    const { unmount } = render(<Area />);

    unmount();

    expect(observer().disconnected).toBe(true);
  });
});

describe("useGeometryResize", () => {
  const listener = vi.fn();

  beforeEach(() => {
    listener.mockClear();
    window.addEventListener("resize", listener);
  });

  afterEach(() => {
    window.removeEventListener("resize", listener);
  });

  it("says nothing on mount", () => {
    render(<Geometry width={1280} height={800} />);

    expect(listener).not.toHaveBeenCalled();
  });

  it("fires once when the logical size changes", () => {
    const { rerender } = render(<Geometry width={1280} height={800} />);

    rerender(<Geometry width={1920} height={1080} />);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a render that changed nothing", () => {
    const { rerender } = render(<Geometry width={1280} height={800} />);

    rerender(<Geometry width={1280} height={800} />);

    expect(listener).not.toHaveBeenCalled();
  });

  // The case the window never reports: collapsing the console under a fixed
  // preset leaves the view laid out at 1280×800 and draws it smaller, and a
  // renderer that was not told maps every click through the old scale (ZAB-108).
  it("fires when the zoom changes with the logical size still", () => {
    const { rerender } = render(<Geometry width={1280} height={800} zoom={0.76} />);

    rerender(<Geometry width={1280} height={800} zoom={0.58} />);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires once when the size and the zoom move together", () => {
    const { rerender } = render(<Geometry width={1280} height={800} zoom={0.76} />);

    rerender(<Geometry width={1920} height={1080} zoom={0.5} />);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
