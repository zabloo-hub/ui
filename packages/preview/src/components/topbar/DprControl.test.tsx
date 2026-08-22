import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DprControl } from "@/components/topbar/DprControl";
import { useStore } from "@/store/store";

beforeEach(() => {
  useStore.setState({ dpr: "auto" });
});

describe("DprControl", () => {
  it("is one labelled box of four segments", () => {
    render(<DprControl />);

    expect(screen.getByRole("radiogroup", { name: "Device pixel ratio" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  it("lights the segment the store is on", () => {
    useStore.setState({ dpr: 2 });
    render(<DprControl />);

    expect(screen.getByRole("radio", { name: "2×" })).toHaveAttribute("data-state", "on");
    expect(screen.getByRole("radio", { name: "DPR auto" })).toHaveAttribute("data-state", "off");
  });

  it("writes a forced ratio as a number, not as its label", async () => {
    const user = userEvent.setup();
    render(<DprControl />);

    await user.click(screen.getByRole("radio", { name: "3×" }));

    expect(useStore.getState().dpr).toBe(3);
  });

  it("writes `auto` back", async () => {
    useStore.setState({ dpr: 1 });
    const user = userEvent.setup();
    render(<DprControl />);

    await user.click(screen.getByRole("radio", { name: "DPR auto" }));

    expect(useStore.getState().dpr).toBe("auto");
  });

  /** Radix hands back `""` for a deselect, and there is no "no DPR". */
  it("ignores pressing the segment that is already on", async () => {
    useStore.setState({ dpr: 2 });
    const user = userEvent.setup();
    render(<DprControl />);

    await user.click(screen.getByRole("radio", { name: "2×" }));

    expect(useStore.getState().dpr).toBe(2);
  });

  /**
   * The radio-group promise Radix leaves half-kept: it moves the focus with the
   * arrows and waits for Enter to select (ZAB-109).
   */
  it("changes the ratio with the arrows, as a radio group does", async () => {
    useStore.setState({ dpr: 1 });
    const user = userEvent.setup();
    render(<DprControl />);

    await user.tab();
    expect(screen.getByRole("radio", { name: "1×" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");

    expect(useStore.getState().dpr).toBe(2);
    expect(screen.getByRole("radio", { name: "2×" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "1×" })).toHaveAttribute("aria-checked", "false");
  });

  it("walks back to `auto` the same way", async () => {
    useStore.setState({ dpr: 1 });
    const user = userEvent.setup();
    render(<DprControl />);

    await user.tab();
    await user.keyboard("{ArrowLeft}");

    expect(useStore.getState().dpr).toBe("auto");
  });

  it("explains itself on hover", async () => {
    const user = userEvent.setup();
    render(<DprControl />);

    await user.hover(screen.getByRole("radiogroup", { name: "Device pixel ratio" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Pixel ratio the view rasterizes at (auto follows the display)",
    );
  });
});
