import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

/**
 * What is worth asserting about a compacted primitive is the compaction: that
 * `sm` is the design's 28px trigger and not shadcn's 36px one, and that the
 * states the chrome toggles this button into are reachable from the outside.
 * The full class string is not the contract — these few classes are.
 */
describe("Button", () => {
  it("paints each variant from a token, never a colour", () => {
    render(
      <>
        <Button variant="default">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </>,
    );

    expect(screen.getByText("Primary")).toHaveClass("bg-primary", "text-primary-foreground");
    expect(screen.getByText("Secondary")).toHaveClass("bg-muted");
    expect(screen.getByText("Outline")).toHaveClass("border-border", "bg-card");
    expect(screen.getByText("Ghost")).toHaveClass("text-muted-foreground");
  });

  it("compacts the trigger sizes to the design's 28 and 26", () => {
    render(
      <>
        <Button size="sm">Trigger</Button>
        <Button size="icon">Icon</Button>
        <Button size="icon-round">Zen</Button>
        <Button size="xs">Set</Button>
      </>,
    );

    expect(screen.getByText("Trigger")).toHaveClass("h-[28px]");
    expect(screen.getByText("Icon")).toHaveClass("size-[28px]");
    expect(screen.getByText("Zen")).toHaveClass("size-[26px]", "rounded-full");
    expect(screen.getByText("Set")).toHaveClass("text-[11px]", "rounded-[5px]");
  });

  it("carries the design's focus ring instead of shadcn's ring-offset", () => {
    render(<Button>Focus</Button>);

    const button = screen.getByText("Focus");
    expect(button).toHaveClass("focus-visible:border-[var(--indigo)]");
    expect(button.className).not.toMatch(/ring-offset/);
  });

  it("exposes both toggled states the chrome uses", () => {
    render(
      <>
        <Button aria-pressed={true}>Theme</Button>
        <Button data-active={true}>Zen</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Theme", pressed: true })).toHaveClass(
      "aria-pressed:bg-accent",
    );
    expect(screen.getByText("Zen")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Zen")).toHaveClass("data-active:bg-[var(--indigo-soft)]");
  });

  it("renders as its child under asChild, keeping the variant", () => {
    render(
      <Button asChild variant="ghost" size="icon">
        <a href="/kit">Kit</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Kit" });
    expect(link).toHaveClass("size-[28px]", "text-muted-foreground");
  });

  it("stays out of the tab order and the pointer's way when disabled", () => {
    render(<Button disabled>Off</Button>);

    expect(screen.getByRole("button", { name: "Off" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Off" })).toHaveClass("disabled:pointer-events-none");
  });
});
