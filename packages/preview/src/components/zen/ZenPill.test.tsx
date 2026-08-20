/**
 * The pill. Two things are worth proving beyond "it renders": the dot takes its
 * colour from the connection rather than from the call site (the mistake
 * `ui/badge.tsx` was shaped to make impossible), and the caption says what is on
 * the stage — which in zen is the only place either fact is still shown.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_LAYOUT, useStore } from "@/store";
import { ZenPill } from "./ZenPill";

const pill = () => document.querySelector('[data-slot="zen-pill"]');

beforeEach(() => {
  useStore.setState({
    layout: { ...DEFAULT_LAYOUT, zen: true },
    connection: "live",
    viewport: { preset: "steamdeck" },
  });
});

describe("ZenPill", () => {
  it("says which preset the stage is laid out at", () => {
    render(<ZenPill />);

    expect(screen.getByText("Steam Deck · 1280×800")).toBeInTheDocument();
  });

  it.each([
    ["live", "var(--ok)"],
    ["stale", "var(--warn)"],
    ["disconnected", "var(--danger)"],
  ] as const)("colours the dot for %s", (connection, token) => {
    useStore.setState({ connection });

    render(<ZenPill />);

    expect(pill()).toHaveAttribute("data-connection", connection);
    expect(pill()).toHaveClass(`[--badge-dot:${token}]`);
  });

  it("leaves zen from its own button", async () => {
    render(<ZenPill />);

    await userEvent.click(screen.getByRole("button", { name: "Exit zen mode" }));

    expect(useStore.getState().layout.zen).toBe(false);
  });
});
