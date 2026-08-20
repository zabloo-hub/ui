/**
 * `App` is a list of four lines, so this is a wiring test: the shell is on the
 * page, and the effects that reach outside React are actually installed. Each of
 * them is tested properly next to itself; what only this file can catch is one of
 * them being dropped from here.
 *
 * The session is mocked away: `App` mounts it (V6) and jsdom has no
 * `EventSource`, so the real one would open the dev loop's stream for a handful
 * of assertions about the chrome. What it does is proved in `session/`.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { App } from "@/App";
import { DEFAULT_LAYOUT, useStore } from "@/store";

vi.mock("@/session", () => ({ useSession: () => {} }));

beforeEach(() => {
  useStore.setState({ layout: DEFAULT_LAYOUT, theme: "light" });
  document.documentElement.classList.remove("dark");
});

describe("App", () => {
  it("renders the four regions of the chrome", () => {
    const { container } = render(<App />);

    for (const region of ["topbar", "stage", "console", "statusbar"]) {
      expect(container.querySelector(`[data-region="${region}"]`)).toBeInTheDocument();
    }
  });

  it("wires the theme to <html>", () => {
    render(<App />);

    act(() => useStore.getState().setTheme("dark"));

    expect(document.documentElement).toHaveClass("dark");
  });

  it("wires Escape to leaving zen", () => {
    render(<App />);

    act(() => useStore.getState().setZen(true));
    act(() => fireEvent.keyDown(window, { key: "Escape" }));

    expect(useStore.getState().layout.zen).toBe(false);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});
