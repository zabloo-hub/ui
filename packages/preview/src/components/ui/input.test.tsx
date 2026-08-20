import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input, InputFrame } from "@/components/ui/input";

describe("Input", () => {
  it("is a 28px mono field", () => {
    render(<Input aria-label="player.name" />);

    expect(screen.getByRole("textbox")).toHaveClass("h-[28px]", "font-mono", "text-ui");
  });

  it("keeps its 28px when focused", () => {
    render(<Input aria-label="player.name" />);

    const input = screen.getByRole("textbox");
    // The mockup drops a focused input to 27px to pay for the 1.5px border;
    // `border-box` spends that half pixel on the content instead.
    expect(input).toHaveClass("h-[28px]", "focus-visible:focus-ring");
  });

  it("shrinks to the 44px pair of the custom viewport row", () => {
    render(<Input size="xs" aria-label="Width" />);

    expect(screen.getByRole("textbox")).toHaveClass("w-[44px]", "text-caption", "text-center");
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
    expect(frame).toHaveClass("h-[28px]", "border-border", "rounded-md");
    expect(frame.tagName).toBe("DIV");
  });

  it("rings when something inside it takes focus", () => {
    render(
      <InputFrame>
        <input aria-label="inner" />
      </InputFrame>,
    );

    expect(screen.getByLabelText("inner").parentElement).toHaveClass("focus-within:focus-ring");
  });
});
