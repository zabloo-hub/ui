import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDot,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuValue,
} from "@/components/ui/dropdown-menu";

/** The view selector of the topbar, with a fatal on one view. */
function ViewSelector() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>controls</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem size="lg">layout</DropdownMenuItem>
        <DropdownMenuItem size="lg" data-active={true}>
          controls
        </DropdownMenuItem>
        <DropdownMenuItem size="lg">
          overlays
          <DropdownMenuDot />
        </DropdownMenuItem>
        <DropdownMenuItem>
          Steam Deck
          <DropdownMenuValue>1280×800</DropdownMenuValue>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("opens onto a menu of items", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);

    await user.click(screen.getByRole("button", { name: "controls" }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
  });

  it("is a 6px card of 5px 9px items, not shadcn's 14px list", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await user.click(screen.getByRole("button", { name: "controls" }));

    expect(screen.getByRole("menu")).toHaveClass("rounded-lg", "p-[6px]", "gap-px", "shadow-menu");
    expect(screen.getByRole("menuitem", { name: "layout" })).toHaveClass(
      "px-[9px]",
      "py-[5px]",
      "rounded-md",
    );
  });

  it("does not pin its width to the trigger", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await user.click(screen.getByRole("button", { name: "controls" }));

    // The generated content did, which would squeeze a 200px menu onto a short trigger.
    expect(screen.getByRole("menu").className).not.toMatch(/trigger-width/);
  });

  it("marks the selected view in indigo instead of with a check", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await user.click(screen.getByRole("button", { name: "controls" }));

    const active = screen.getAllByRole("menuitem").find((item) => item.dataset.active === "true");
    expect(active).toHaveClass("data-active:bg-indigo-soft", "data-active:text-indigo");
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });

  it("gives an item a right-hand slot for a resolution and for a fatal", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await user.click(screen.getByRole("button", { name: "controls" }));

    expect(screen.getByText("1280×800")).toHaveClass("ml-auto", "font-mono", "text-caption");
    const dot = screen.getByRole("menuitem", { name: "overlays" }).querySelector("span");
    expect(dot).toHaveClass("size-[6px]", "bg-danger");
  });

  it("walks the menu with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<ViewSelector />);
    await user.click(screen.getByRole("button", { name: "controls" }));

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "layout" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "controls" })).toHaveFocus();
  });
});
