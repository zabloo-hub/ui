import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** The DPR control: `auto · 1× · 2× · 3×`. */
function Dpr(props: { defaultValue?: string }) {
  return (
    <ToggleGroup type="single" aria-label="Device pixel ratio" {...props}>
      {["auto", "1×", "2×", "3×"].map((value) => (
        <ToggleGroupItem key={value} value={value}>
          {value}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

describe("ToggleGroup", () => {
  it("is one box with hairlines, not four buttons in a row", () => {
    render(<Dpr />);

    expect(screen.getByRole("radiogroup", { name: "Device pixel ratio" })).toHaveClass(
      "overflow-hidden",
      "rounded-md",
      "border",
    );
    // Every segment but the first draws the divider itself.
    expect(screen.getByText("1×")).toHaveClass("border-l", "first:border-l-0");
  });

  it("marks the active segment without lifting it", () => {
    render(<Dpr defaultValue="auto" />);

    const active = screen.getByRole("radio", { name: "auto" });
    expect(active).toHaveAttribute("aria-checked", "true");
    expect(active).toHaveClass("data-[state=on]:bg-muted", "data-[state=on]:font-medium");
    expect(active.className).not.toMatch(/shadow/);
  });

  it("rings inwards, because the box clips a halo", () => {
    render(<Dpr />);

    // The one primitive that cannot wear V2's `focus-ring`: it thickens all four
    // borders, and these segments have one edge each.
    const segment = screen.getByText("2×");
    expect(segment).toHaveClass("focus-visible:-outline-offset-[1.5px]");
    expect(segment.className).not.toMatch(/focus-visible:focus-ring/);
  });

  it("walks the segments with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Dpr defaultValue="auto" />);

    await user.tab();
    expect(screen.getByRole("radio", { name: "auto" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "1×" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "auto" })).toHaveFocus();
  });
});
