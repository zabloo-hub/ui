import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input, InputFrame } from "@/components/ui/input";

describe("Input", () => {
  it("is a 28px mono field", () => {
    render(<Input aria-label="player.name" />);

    expect(screen.getByRole("textbox")).toHaveClass("h-[28px]", "font-mono", "text-[12px]");
  });

  it("rings inside the box, so focusing does not resize the control", () => {
    render(<Input aria-label="player.name" />);

    const input = screen.getByRole("textbox");
    // The mockup drops a focused input to 27px to pay for a 1.5px border; here
    // the extra half pixel is an inset shadow and the height never moves.
    expect(input).toHaveClass("h-[28px]");
    expect(input.className).toMatch(/focus-visible:shadow-\[inset_0_0_0_0\.5px_var\(--indigo\)/);
  });

  it("shrinks to the 44px pair of the custom viewport row", () => {
    render(<Input size="xs" aria-label="Width" />);

    expect(screen.getByRole("textbox")).toHaveClass("w-[44px]", "text-[11px]", "text-center");
  });

  it("still types", async () => {
    const user = userEvent.setup();
    render(<Input aria-label="player.name" defaultValue="" />);

    await user.type(screen.getByRole("textbox"), "Aria");
    expect(screen.getByRole("textbox")).toHaveValue("Aria");
  });
});

describe("InputFrame", () => {
  it("is the same frame with no input in it", () => {
    render(<InputFrame>1250</InputFrame>);

    const frame = screen.getByText("1250");
    expect(frame).toHaveClass("h-[28px]", "border-border", "rounded-[6px]");
    expect(frame.tagName).toBe("DIV");
  });

  it("rings when something inside it takes focus", () => {
    render(
      <InputFrame>
        <input aria-label="inner" />
      </InputFrame>,
    );

    expect(screen.getByLabelText("inner").parentElement).toHaveClass(
      "focus-within:border-[var(--indigo)]",
    );
  });
});
