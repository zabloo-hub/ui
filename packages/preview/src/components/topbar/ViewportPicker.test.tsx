import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewportPicker } from "@/components/topbar/ViewportPicker";
import { DEFAULT_CUSTOM } from "@/store/presets";
import { useStore } from "@/store/store";

beforeEach(() => {
  useStore.setState({ viewport: { preset: "steamdeck" }, custom: DEFAULT_CUSTOM });
});

const trigger = () => screen.getByRole("button", { name: /Viewport/ });
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(trigger());
};

describe("ViewportPicker", () => {
  it("says the preset and its resolution on the trigger", () => {
    render(<ViewportPicker />);

    expect(trigger()).toHaveTextContent("Steam Deck");
    expect(trigger()).toHaveTextContent("1280×800");
  });

  it("says no resolution under `fit`, which is not one", () => {
    useStore.setState({ viewport: { preset: "fit" } });
    render(<ViewportPicker />);

    expect(trigger()).toHaveTextContent("Fit window");
    expect(trigger()).not.toHaveTextContent("×");
  });

  it("lists the presets but not `custom`, whose row is the footer", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);

    await open(user);

    expect(screen.getByRole("button", { name: "Fit window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phone landscape 844×390" })).toBeInTheDocument();
    // "Custom" in the popover is the footer's label, not a row that selects.
    expect(screen.queryByRole("button", { name: "Custom" })).not.toBeInTheDocument();
  });

  it("marks the current preset, which is what turns the row indigo", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);

    await open(user);

    expect(screen.getByRole("button", { name: /Steam Deck/ })).toHaveAttribute("data-active");
    expect(screen.getByRole("button", { name: /1080p/ })).not.toHaveAttribute("data-active");
  });

  /** A row wearing `focus:bg-accent` reads as hovered, and the top one is not. */
  it("opens without parking focus on the first row", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);

    await open(user);

    expect(screen.getByRole("button", { name: "Fit window" })).not.toHaveFocus();
  });

  it("writes the store and closes when a preset is picked", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);

    await user.click(screen.getByRole("button", { name: /1080p/ }));

    expect(useStore.getState().viewport.preset).toBe("1080p");
    expect(screen.queryByRole("button", { name: /1080p/ })).not.toBeInTheDocument();
  });

  it("disables Set while a box is empty or makes no sense", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);
    const width = screen.getByRole("textbox", { name: "Custom width" });

    await user.clear(width);
    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();

    await user.type(width, "abc");
    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();

    await user.clear(width);
    await user.type(width, "0");
    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();

    await user.clear(width);
    await user.type(width, "1512");
    expect(screen.getByRole("button", { name: "Set" })).toBeEnabled();
  });

  it("applies a custom size to both fields of the store", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);

    await user.clear(screen.getByRole("textbox", { name: "Custom width" }));
    await user.type(screen.getByRole("textbox", { name: "Custom width" }), "1512");
    await user.clear(screen.getByRole("textbox", { name: "Custom height" }));
    await user.type(screen.getByRole("textbox", { name: "Custom height" }), "982");
    await user.click(screen.getByRole("button", { name: "Set" }));

    expect(useStore.getState().custom).toEqual({ width: 1512, height: 982 });
    expect(useStore.getState().viewport.preset).toBe("custom");
    expect(trigger()).toHaveTextContent("Custom");
    expect(trigger()).toHaveTextContent("1512×982");
  });

  it("applies on Enter, from either box", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);

    await user.clear(screen.getByRole("textbox", { name: "Custom height" }));
    await user.type(screen.getByRole("textbox", { name: "Custom height" }), "600{Enter}");

    expect(useStore.getState().custom).toEqual({ width: 1280, height: 600 });
    expect(useStore.getState().viewport.preset).toBe("custom");
  });

  it("does nothing on Enter while the size makes no sense", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);

    await user.clear(screen.getByRole("textbox", { name: "Custom width" }));
    await user.type(screen.getByRole("textbox", { name: "Custom width" }), "{Enter}");

    expect(useStore.getState().viewport.preset).toBe("steamdeck");
    expect(screen.getByRole("button", { name: "Set" })).toBeInTheDocument();
  });

  /** The whole reason this is a `<Popover>` and not a `<DropdownMenu>`. */
  it("keeps the typing in the box instead of answering it as a menu would", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);
    const width = screen.getByRole("textbox", { name: "Custom width" });

    await user.clear(width);
    await user.type(width, "1512");

    expect(width).toHaveValue("1512");
    expect(width).toHaveFocus();
    expect(useStore.getState().viewport.preset).toBe("steamdeck");
  });

  it("forgets a size that was typed and abandoned", async () => {
    const user = userEvent.setup();
    render(<ViewportPicker />);
    await open(user);
    await user.clear(screen.getByRole("textbox", { name: "Custom width" }));
    await user.type(screen.getByRole("textbox", { name: "Custom width" }), "999");

    await user.keyboard("{Escape}");
    await open(user);

    expect(screen.getByRole("textbox", { name: "Custom width" })).toHaveValue("1280");
  });
});
