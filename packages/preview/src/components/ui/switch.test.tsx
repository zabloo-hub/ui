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

  it("asks V2 for the dark off-thumb rather than writing one", () => {
    const { container } = render(<Switch aria-label="off" />);

    // ZAB-83 owes us `--switch-thumb-off`; no literal fallback lives here on purpose.
    expect(container.querySelector('[data-slot="switch-thumb"]')).toHaveClass(
      "dark:data-unchecked:bg-[var(--switch-thumb-off)]",
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
