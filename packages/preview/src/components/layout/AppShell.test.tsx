/**
 * What the shell owes the rest of the milestone: the four regions, the two shapes
 * the store bends them into, and the one thing that must NOT happen while it does.
 *
 * The stage is stubbed: it belongs to V10 and will grow markup of its own, and a
 * canvas is what the last test needs to hold on to. The bindings panel is NOT —
 * whether it draws in zen is its own decision (V14), so the real one is the only
 * thing that can prove the shell left that decision alone.
 */

import { act, render, screen } from "@testing-library/react";
import { DEFAULT_LAYOUT, useStore } from "@/store";
import { AppShell } from "./AppShell";

vi.mock("@/components/stage/Stage", () => ({
  // A canvas, because the point of the last test is that this exact node survives.
  Stage: () => <canvas data-testid="canvas" />,
}));
const region = (name: string) => document.querySelector(`[data-region="${name}"]`);
const panel = () => document.querySelector('[data-panel="bindings"]');
const consoleRegion = () => screen.getByRole("region", { name: "Console" });

beforeEach(() => {
  useStore.setState({ layout: DEFAULT_LAYOUT });
});

describe("AppShell", () => {
  it("stacks the four regions, each with a landmark of its own", () => {
    render(<AppShell />);

    expect(screen.getByRole("banner")).toHaveAttribute("data-region", "topbar");
    expect(screen.getByRole("main")).toHaveAttribute("data-region", "stage");
    expect(consoleRegion()).toHaveAttribute("data-region", "console");
    expect(screen.getByRole("contentinfo")).toHaveAttribute("data-region", "statusbar");
  });

  it("mounts the bindings panel inside the stage, which is what positions it", () => {
    render(<AppShell />);

    expect(screen.getByRole("main")).toHaveClass("relative");
    expect(screen.getByRole("main")).toContainElement(panel() as HTMLElement);
  });

  it("collapses the console to its header height", () => {
    render(<AppShell />);
    expect(consoleRegion()).toHaveClass("h-[198px]");

    act(() => useStore.getState().toggleConsole());

    expect(consoleRegion()).toHaveClass("h-[34px]");
    expect(consoleRegion()).not.toHaveClass("h-[198px]");
  });

  it("leaves nothing but the stage and the pill in zen", () => {
    render(<AppShell />);

    act(() => useStore.getState().setZen(true));

    expect(region("topbar")).not.toBeInTheDocument();
    expect(region("console")).not.toBeInTheDocument();
    expect(region("statusbar")).not.toBeInTheDocument();
    expect(panel()).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit zen mode" })).toBeInTheDocument();
  });

  it("puts the chrome back on the way out", () => {
    render(<AppShell />);

    act(() => useStore.getState().setZen(true));
    act(() => useStore.getState().setZen(false));

    expect(region("topbar")).toBeInTheDocument();
    expect(panel()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exit zen mode" })).not.toBeInTheDocument();
  });

  it("does not remount the canvas going into zen and back", () => {
    render(<AppShell />);
    const canvas = screen.getByTestId("canvas");

    act(() => useStore.getState().setZen(true));
    expect(screen.getByTestId("canvas")).toBe(canvas);

    act(() => useStore.getState().setZen(false));
    expect(screen.getByTestId("canvas")).toBe(canvas);
  });
});
