import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

describe("Popover", () => {
  it("wears the same card as the menu", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Steam Deck</PopoverTrigger>
        <PopoverContent>presets</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Steam Deck" }));
    expect(screen.getByText("presets")).toHaveClass(
      "rounded-[8px]",
      "p-[6px]",
      "shadow-[var(--shadow-menu)]",
    );
  });

  it("lets an input inside it keep the typing", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Steam Deck</PopoverTrigger>
        <PopoverContent>
          <Input size="xs" aria-label="Width" defaultValue="" />
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Steam Deck" }));
    await user.type(screen.getByLabelText("Width"), "1512");

    // This is the whole reason the viewport picker's custom row is not a menu:
    // a Radix menu would have answered "1" with its typeahead.
    expect(screen.getByLabelText("Width")).toHaveValue("1512");
  });
});
