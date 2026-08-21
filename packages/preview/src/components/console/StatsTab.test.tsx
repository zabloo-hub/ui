/**
 * The Stats tab, against the real store.
 *
 * Two halves: the formatting — `idle` rather than a zero, `18.2k` rather than
 * 18200 — and the clock. The clock is the half that can rot silently: nothing
 * on screen tells you the tab stopped recomputing the window, it just shows a
 * rate that is no longer true, so the interval is tested for both of the things
 * it must do — start while the tab is on screen, and stop when it is not.
 */

import { act, render, screen } from "@testing-library/react";
import { DEFAULT_LAYOUT } from "@/store/layout";
import type { FrameSample } from "@/store/stats";
import { useStore } from "@/store/store";
import { STATS_TICK_MS, StatsTab } from "./StatsTab";

const FRAME: FrameSample = {
  frameMs: 1.94,
  drawCalls: 42,
  vertices: 18_200,
  atlases: 3,
  atlasBytes: 12 * 1024 * 1024,
  resolved: 118,
  repaintOnly: false,
  textLayouts: 0,
  bufferGrowths: 0,
};

/** The real action, so a test that swaps it for a spy can put it back. */
const tickStats = useStore.getState().tickStats;

function seed(last: FrameSample | null, fps = 0): void {
  useStore.setState({
    stats: { last, fps },
    tickStats,
    layout: { ...DEFAULT_LAYOUT, consoleOpen: true, consoleTab: "stats" },
  });
}

/** The value under a label, without the label itself. */
function stat(label: string): string | undefined {
  const cell = document.querySelector(`[data-slot="stat"][data-label="${label}"]`);
  return cell?.lastElementChild?.textContent ?? undefined;
}

beforeEach(() => {
  seed(FRAME);
});

test("admits there is nothing to measure yet", () => {
  seed(null);

  render(<StatsTab />);

  expect(screen.getByText("no frame painted yet")).toBeInTheDocument();
  expect(stat("fps")).toBeUndefined();
});

test("prints the frame cost the way the design draws it", () => {
  seed(FRAME, 60);

  render(<StatsTab />);

  expect(stat("fps")).toBe("60");
  expect(stat("frame")).toBe("1.9ms");
  expect(stat("draws")).toBe("42");
  expect(stat("verts")).toBe("18.2k");
  expect(stat("atlases")).toBe("3 · 12MB");
});

test("a scene that is painting nothing is idle, not zero", () => {
  seed(FRAME, 0);

  render(<StatsTab />);

  // The renderer paints on demand — a still scene is the system working.
  expect(stat("fps")).toBe("idle");
});

test("shows the resolve telemetry, and names a repaint-only frame", () => {
  seed({ ...FRAME, textLayouts: 4, bufferGrowths: 1 });

  const { rerender } = render(<StatsTab />);

  expect(stat("resolved")).toBe("118");
  expect(stat("textLayouts")).toBe("4");
  expect(stat("bufferGrowths")).toBe("1");

  act(() => {
    useStore.setState({ stats: { last: { ...FRAME, repaintOnly: true }, fps: 0 } });
  });
  rerender(<StatsTab />);

  expect(stat("resolved")).toBe("repaint only");
});

describe("the fps window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("is recomputed while the tab is on screen, and left alone when it is not", () => {
    const tick = vi.fn();
    useStore.setState({ tickStats: tick });

    const { unmount } = render(<StatsTab />);
    act(() => {
      vi.advanceTimersByTime(STATS_TICK_MS * 4);
    });

    expect(tick).toHaveBeenCalledTimes(4);

    // Another tab: the window is nobody's business until this one is back.
    act(() => {
      useStore.getState().setConsoleTab("actions");
    });
    act(() => {
      vi.advanceTimersByTime(STATS_TICK_MS * 4);
    });

    expect(tick).toHaveBeenCalledTimes(4);

    // And back — the same timer, started again.
    act(() => {
      useStore.getState().setConsoleTab("stats");
    });
    act(() => {
      vi.advanceTimersByTime(STATS_TICK_MS * 2);
    });

    expect(tick).toHaveBeenCalledTimes(6);

    unmount();
    act(() => {
      vi.advanceTimersByTime(STATS_TICK_MS * 4);
    });

    expect(tick).toHaveBeenCalledTimes(6);
  });

  test("stops with the console, not only with the tab", () => {
    const tick = vi.fn();
    useStore.setState({ tickStats: tick });

    render(<StatsTab />);
    act(() => {
      useStore.getState().setConsoleOpen(false);
    });
    act(() => {
      vi.advanceTimersByTime(STATS_TICK_MS * 4);
    });

    expect(tick).not.toHaveBeenCalled();
  });
});
