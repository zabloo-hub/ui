/**
 * The bar and the four controls it owns, tested where they live — rendering the
 * whole `<Topbar/>` is also what proves each one is wired to the store through
 * the bar and not only in isolation.
 *
 * `ViewSelector` is still V8's placeholder and renders nothing, so the three
 * slots are asserted as slots: that they exist, in order, is this ticket's
 * promise; what goes in two of them is not.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("pushes the connection pill and what follows it to the right", () => {
    render(<Topbar />);

    expect(slot("connection-pill")?.parentElement).toHaveClass("ml-auto");
  });
});

describe("ConnectionPill", () => {
  it.each([
    ["live", "Live"],
    ["stale", "Stale"],
    ["disconnected", "Disconnected"],
  ] as const)("says %s out loud", (connection, label) => {
    useStore.setState({ connection });
    render(<Topbar />);

    expect(slot("connection-pill")).toHaveTextContent(label);
    expect(slot("connection-pill")).toHaveAttribute("data-variant", connection);
  });

  it("explains a stale render with the error that caused it", async () => {
    useStore.setState({ connection: "stale", lastError: "export failed: unknown node" });
    const user = userEvent.setup();
    render(<Topbar />);

    await user.hover(screen.getByRole("button", { name: /Stale/ }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("export failed: unknown node");
  });

  /** Nothing to say, no tab stop: a `Live` pill is a label, not a control. */
  it("stays a plain label when there is no error to show", () => {
    useStore.setState({ connection: "live" });
    render(<Topbar />);

    expect(screen.queryByRole("button", { name: /Live/ })).not.toBeInTheDocument();
  });
});

describe("ThemeToggle", () => {
  const themeButton = () => screen.getByRole("button", { name: /Switch to (dark|light) theme/ });

  it("offers the theme you are not in", () => {
    render(<Topbar />);

    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("draws itself toggled once dark is on", () => {
    useStore.setState({ theme: "dark" });
    render(<Topbar />);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("writes the theme to the store, and swaps its icon with it", async () => {
    const user = userEvent.setup();
    render(<Topbar />);
    const before = themeButton().innerHTML;

    await user.click(themeButton());

    expect(useStore.getState().theme).toBe("dark");
    expect(themeButton().innerHTML).not.toBe(before);
  });
});

describe("ZenButton", () => {
  it("goes into zen, and only into it", async () => {
    const user = userEvent.setup();
    render(<Topbar />);

    await user.click(screen.getByRole("button", { name: "Zen mode" }));

    expect(useStore.getState().layout.zen).toBe(true);
  });
});

describe("BindingsToggle", () => {
  const toggle = () => screen.getByRole("button", { name: /Bindings/ });

  it("reflects whether the panel is open", () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, panelOpen: true } });
    render(<Topbar />);

    expect(toggle()).toHaveAttribute("data-state", "on");
  });

  it("opens and closes it", async () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, panelOpen: false } });
    const user = userEvent.setup();
    render(<Topbar />);

    await user.click(toggle());
    expect(useStore.getState().layout.panelOpen).toBe(true);

    await user.click(toggle());
    expect(useStore.getState().layout.panelOpen).toBe(false);
  });
});
