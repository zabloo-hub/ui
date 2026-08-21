/**
 * The footer. What is worth proving here is what it says when the state is not
 * the happy one: the two problem levels are counted apart and only the fatals go
 * red, a still scene reads as `idle` rather than as a stall, and the fps counter
 * has a clock under it — which it only needs when the Stats tab is not the one
 * providing it.
 */

import { act, render, screen } from "@testing-library/react";
import { FPS_TICK_MS, Statusbar } from "@/components/statusbar/Statusbar";
import { DEFAULT_LAYOUT, type FrameSample, type Problem, useStore } from "@/store";

const bar = () => document.querySelector('[data-slot="statusbar"]');

const problem = (severity: Problem["severity"], code: string): Problem => ({
  severity,
  code,
  path: "views.main",
  reason: "…",
});

const FRAME: FrameSample = {
  frameMs: 1.94,
  drawCalls: 12,
  vertices: 480,
  atlases: 1,
  atlasBytes: 1024,
  resolved: 6,
  repaintOnly: false,
  textLayouts: 0,
  bufferGrowths: 0,
};

beforeEach(() => {
  useStore.setState({
    connection: "live",
    problems: [],
    envelope: { name: "demo.envelope.json" },
    stats: { last: null, fps: 0 },
    layout: DEFAULT_LAYOUT,
  });
});

describe("Statusbar", () => {
  it.each([
    ["live", "Live", "var(--ok)"],
    ["stale", "Stale", "var(--warn)"],
    ["disconnected", "Disconnected", "var(--danger)"],
  ] as const)("says %s and colours the dot for it", (connection, label, token) => {
    useStore.setState({ connection });

    render(<Statusbar />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(bar()).toHaveAttribute("data-connection", connection);
    expect(bar()).toHaveClass(`[--badge-dot:${token}]`);
  });

  describe("the problem summary", () => {
    it("says so when there are none", () => {
      render(<Statusbar />);

      expect(screen.getByText("0 problems")).toBeInTheDocument();
    });

    it("counts the two levels apart and reddens only the fatals", () => {
      useStore.setState({
        problems: [
          problem("fatal", "unknown-node"),
          problem("warn", "missing-binding"),
          problem("warn", "unknown-prop"),
        ],
      });

      render(<Statusbar />);

      expect(bar()).toHaveTextContent("1 fatal · 2 warnings");
      expect(screen.getByText("1 fatal")).toHaveClass("text-danger-fg");
    });

    /** A `0 fatal` in the danger colour reads as a failure at a glance. */
    it("drops the red half when nothing is fatal", () => {
      useStore.setState({ problems: [problem("warn", "missing-binding")] });

      render(<Statusbar />);

      expect(screen.getByText("1 warning")).toBeInTheDocument();
      expect(screen.queryByText(/fatal/)).not.toBeInTheDocument();
    });

    it("does not pluralise fatal", () => {
      useStore.setState({ problems: [problem("fatal", "a"), problem("fatal", "b")] });

      render(<Statusbar />);

      expect(screen.getByText("2 fatal")).toBeInTheDocument();
    });
  });

  it("names the file on screen", () => {
    render(<Statusbar />);

    expect(screen.getByText("demo.envelope.json")).toBeInTheDocument();
  });

  it("says nothing where the filename goes until there is one", () => {
    useStore.setState({ envelope: { name: null } });

    render(<Statusbar />);

    expect(document.querySelector('[data-slot="envelope-name"]')).not.toBeInTheDocument();
  });

  describe("the fps readout", () => {
    it("reads a still scene as idle, with no frame time behind it", () => {
      useStore.setState({ stats: { last: FRAME, fps: 0 } });

      render(<Statusbar />);

      expect(screen.getByText("idle")).toBeInTheDocument();
      expect(bar()).not.toHaveTextContent("1.9");
    });

    it("prints the count and the last frame", () => {
      useStore.setState({ stats: { last: FRAME, fps: 60 } });

      render(<Statusbar />);

      expect(screen.getByText("60 fps · 1.9 ms")).toBeInTheDocument();
    });
  });

  describe("the fps clock", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-counts the window itself while the Stats tab is not the one showing", () => {
      const tick = vi.fn();
      useStore.setState({ tickStats: tick, layout: { ...DEFAULT_LAYOUT, consoleTab: "actions" } });

      render(<Statusbar />);
      act(() => vi.advanceTimersByTime(FPS_TICK_MS * 2));

      expect(tick).toHaveBeenCalledTimes(2);
    });

    /** V12 already ticks at 4Hz there; a second clock on one counter buys nothing. */
    it("stands down when the Stats tab is on screen", () => {
      const tick = vi.fn();
      useStore.setState({
        tickStats: tick,
        layout: { ...DEFAULT_LAYOUT, consoleOpen: true, consoleTab: "stats" },
      });

      render(<Statusbar />);
      act(() => vi.advanceTimersByTime(FPS_TICK_MS * 2));

      expect(tick).not.toHaveBeenCalled();
    });

    it("keeps its own clock when the console is collapsed on Stats", () => {
      const tick = vi.fn();
      useStore.setState({
        tickStats: tick,
        layout: { ...DEFAULT_LAYOUT, consoleOpen: false, consoleTab: "stats" },
      });

      render(<Statusbar />);
      act(() => vi.advanceTimersByTime(FPS_TICK_MS));

      expect(tick).toHaveBeenCalledTimes(1);
    });
  });
});
