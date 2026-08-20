import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "@/components/ui/switch";

describe("Switch", () => {
  it("is a switch, and says which way it is", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="settings.sfx" />);

    const control = screen.getByRole("switch", { name: "settings.sfx" });
    expect(control).toHaveAttribute("aria-checked", "false");

    await user.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("is the design's 36×20 with a 16px thumb, not shadcn's 44×24", () => {
    const { container } = render(<Switch aria-label="settings.music" />);

    expect(screen.getByRole("switch")).toHaveClass("h-[20px]", "w-[36px]");
    expect(container.querySelector('[data-slot="switch-thumb"]')).toHaveClass("size-[16px]");
  });

  it("travels the 2 → 18 the track measures", () => {
    const { container } = render(<Switch defaultChecked aria-label="on" />);

    const thumb = container.querySelector('[data-slot="switch-thumb"]');
    expect(thumb).toHaveClass(
      "data-unchecked:translate-x-[2px]",
      "data-checked:translate-x-[18px]",
    );
  });

  it("takes the off thumb from the token this branch added to V2", () => {
    const { container } = render(<Switch aria-label="off" />);

    // `--switch-thumb-off`: white in light, #a1a1aa in dark. Not a colour in here.
    expect(container.querySelector('[data-slot="switch-thumb"]')).toHaveClass(
      "data-unchecked:bg-switch-thumb-off",
    );
  });

  it("keeps the keyboard contract of a checkbox", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="settings.sfx" />);

    await user.tab();
    expect(screen.getByRole("switch")).toHaveFocus();

    await user.keyboard(" ");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
