import { render, screen } from "@testing-library/react";
import { ScrollArea } from "@/components/ui/scroll-area";

describe("ScrollArea", () => {
  it("wraps its content in a focusable viewport with the design's ring", () => {
    const { container } = render(<ScrollArea>12:04:27 view loaded → controls</ScrollArea>);

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]');
    expect(viewport).toContainElement(screen.getByText(/loaded → controls/));
    expect(viewport).toHaveClass("focus-visible:focus-ring");
  });

  it("thins the scrollbar to match an 11.5px log", () => {
    // `always`: jsdom lays nothing out, so the scrollbar Radix mounts on overflow
    // would never appear here.
    const { container } = render(<ScrollArea type="always">log</ScrollArea>);

    expect(container.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveClass(
      "data-vertical:w-2",
    );
  });
});
