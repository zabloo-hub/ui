import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "@/components/ui/toggle";

describe("Toggle", () => {
  it("presses, and says so", async () => {
    const user = userEvent.setup();
    render(<Toggle>{"{ } Bindings"}</Toggle>);

    const toggle = screen.getByRole("button", { name: "{ } Bindings" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("data-state", "off");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("data-state", "on");
  });

  it("goes indigo when on, and carries no shadow when off", () => {
    render(<Toggle>Bindings</Toggle>);

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveClass(
      "data-[state=on]:bg-indigo-soft",
      "data-[state=on]:text-indigo",
      "data-[state=on]:border-indigo-soft-border",
    );
    // Outline-off is flat: the design keeps the trigger shadow for triggers.
    expect(toggle.className).not.toMatch(/shadow-\[var\(--shadow-control\)\]/);
  });
});
