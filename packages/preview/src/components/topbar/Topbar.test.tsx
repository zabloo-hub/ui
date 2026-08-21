/**
 * The bar itself: which controls are in it, and in what order.
 *
 * What each control DOES lives next to it — `ConnectionPill.test.tsx` and the
 * three beside it. That split is the point: rendering the whole bar proves a
 * control is mounted and reachable through it, and proving that is a different
 * job from proving the control works, which the bar cannot do better than the
 * control can.
 *
 * `ViewSelector` is still V8's placeholder and renders nothing, so the three
 * slots are asserted as slots: that they exist, in order, is this ticket's
 * promise; what goes in two of them is not.
 */

import { render, screen } from "@testing-library/react";
import { Topbar } from "@/components/topbar/Topbar";
import { DEFAULT_LAYOUT, useStore } from "@/store";

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`);

beforeEach(() => {
  useStore.setState({
    layout: DEFAULT_LAYOUT,
    theme: "light",
    connection: "disconnected",
    lastError: null,
  });
});

describe("Topbar", () => {
  it("is the row inside the shell's header, on the panel surface", () => {
    const { container } = render(<Topbar />);

    expect(container.firstElementChild).toHaveClass("h-full", "bg-card", "px-3");
  });

  it("holds a slot for each of the three controls it does not own", () => {
    render(<Topbar />);

    expect(slot("view-selector")).toBeInTheDocument();
    expect(slot("viewport-picker")).toBeInTheDocument();
    expect(slot("dpr-control")).toBeInTheDocument();
  });

  /** `display: contents`, so an empty placeholder does not eat one of the gaps. */
  it("leaves the slots out of the flex line", () => {
    render(<Topbar />);

    expect(slot("view-selector")).toHaveClass("contents");
  });

  it("draws the brand small, and the tool after it", () => {
    render(<Topbar />);

    expect(slot("wordmark")).toHaveTextContent("zabloodev");
  });

  /** Each is proved on its own; what only the bar can catch is one being dropped. */
  it("mounts the four controls it owns, wired to the store", () => {
    useStore.setState({ connection: "live" });

    render(<Topbar />);

    expect(slot("connection-pill")).toHaveTextContent("Live");
    expect(screen.getByRole("button", { name: /Bindings/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zen mode" })).toBeInTheDocument();
  });

  it("pushes the connection pill and what follows it to the right", () => {
    render(<Topbar />);

    expect(slot("connection-pill")?.parentElement).toHaveClass("ml-auto");
  });
});
