/**
 * The switch for the floating panel, and the one control in the bar whose "on"
 * is a surface being there rather than a setting being true.
 *
 * The second thing proved here is the reason it reaches for two narrow selectors
 * instead of `useLayout()`: the layout slice also carries the panel position a
 * drag commits on release and the console's own toggle, and through the slice
 * hook this button would re-render on every one of them.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { DEFAULT_LAYOUT, useStore } from "@/store";
import { BindingsToggle } from "./BindingsToggle";

const toggle = () => screen.getByRole("button", { name: /Bindings/ });

beforeEach(() => {
  useStore.setState({ layout: { ...DEFAULT_LAYOUT, panelOpen: false, consoleOpen: false } });
});

describe("BindingsToggle", () => {
  it("reflects whether the panel is open", () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, panelOpen: true } });

    render(<BindingsToggle />);

    expect(toggle()).toHaveAttribute("data-state", "on");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("opens and closes it", async () => {
    const user = userEvent.setup();
    render(<BindingsToggle />);

    await user.click(toggle());
    expect(useStore.getState().layout.panelOpen).toBe(true);

    await user.click(toggle());
    expect(useStore.getState().layout.panelOpen).toBe(false);
  });

  /** Text, not lucide's `Braces`: at 11px a stroked glyph next to a 12px label goes muddy. */
  it("draws its glyph as mono text beside the word", () => {
    render(<BindingsToggle />);

    expect(toggle()).toHaveTextContent("{ }Bindings");
    expect(toggle().querySelector("svg")).toBeNull();
  });

  /**
   * A commit of this subtree is a re-render of this button, and nothing else is
   * mounted to cause one — so counting them is what says the selectors are narrow.
   */
  it("ignores the rest of the layout slice", () => {
    const commits: string[] = [];
    render(
      <Profiler id="bindings-toggle" onRender={() => commits.push("commit")}>
        <BindingsToggle />
      </Profiler>,
    );
    const mounted = commits.length;

    act(() => useStore.getState().toggleConsole());
    act(() => useStore.getState().setPanelPos({ x: 40, y: 80 }));

    expect(commits).toHaveLength(mounted);

    act(() => useStore.getState().setPanelOpen(true));

    expect(commits.length).toBeGreaterThan(mounted);
  });
});
