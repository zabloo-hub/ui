import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewSelector } from "@/components/topbar/ViewSelector";
import { useStore } from "@/store/store";

beforeEach(() => {
  useStore.setState({
    views: ["layout", "typography", "controls", "overlays"],
    activeView: "controls",
    fatalViews: new Set(),
  });
});

const trigger = () => screen.getByRole("button", { name: /^View/ });
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(trigger());
};

describe("ViewSelector", () => {
  it("says the active view on the trigger", () => {
    render(<ViewSelector />);

    expect(trigger()).toHaveTextContent("View");
    expect(trigger()).toHaveTextContent("controls");
  });

  it("lists the views in the envelope's order, not alphabetically", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);

    await open(user);

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "layout",
      "typography",
      "controls",
      "overlays",
    ]);
  });

  it("marks the active view, which is what turns the row indigo", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);

    await open(user);

    expect(screen.getByRole("menuitem", { name: "controls" })).toHaveAttribute("data-active");
    expect(screen.getByRole("menuitem", { name: "layout" })).not.toHaveAttribute("data-active");
  });

  it("dots the views the validator refused, and only those", async () => {
    useStore.setState({ fatalViews: new Set(["overlays"]) });
    const user = userEvent.setup();
    render(<ViewSelector />);

    await open(user);

    expect(screen.getByRole("menuitem", { name: "overlays (has errors)" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "layout" })).toBeInTheDocument();
    // The dot is the row's own, not the menu's: nothing else wears one.
    expect(document.querySelectorAll('[data-slot="dropdown-menu-dot"]')).toHaveLength(1);
  });

  it("dots the trigger when the view on screen is the refused one", () => {
    useStore.setState({ fatalViews: new Set(["controls"]) });
    render(<ViewSelector />);

    expect(screen.getByRole("button", { name: "View (has errors)" })).toBeInTheDocument();
  });

  it("leaves the trigger undotted when the fatal is on a view you are not on", () => {
    useStore.setState({ fatalViews: new Set(["overlays"]) });
    render(<ViewSelector />);

    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
  });

  it("selects the view that was picked, and closes", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await open(user);

    await user.click(screen.getByRole("menuitem", { name: "overlays" }));

    expect(useStore.getState().activeView).toBe("overlays");
    expect(trigger()).toHaveTextContent("overlays");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is disabled, and says nothing, while the envelope has no views", () => {
    useStore.setState({ views: [], activeView: null });
    render(<ViewSelector />);

    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveTextContent("—");
  });

  /**
   * The rule ZAB-72 left behind: a hot-update that adds a view must show it. The
   * component is never remounted here — the slice writes and the list follows.
   */
  it("shows a view the store gained without being remounted", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await open(user);
    expect(screen.queryByRole("menuitem", { name: "hud" })).not.toBeInTheDocument();

    act(() => {
      useStore.getState().setViews(["layout", "typography", "controls", "overlays", "hud"]);
    });

    expect(screen.getByRole("menuitem", { name: "hud" })).toBeInTheDocument();
    // And it did not move you: the view you were on survived the new list.
    expect(screen.getByRole("menuitem", { name: "controls" })).toHaveAttribute("data-active");
  });
});
