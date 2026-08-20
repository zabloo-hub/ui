import { render, screen } from "@testing-library/react";
import { Separator } from "@/components/ui/separator";

describe("Separator", () => {
  it("is decorative by default, and announced when it is not", () => {
    const { rerender } = render(<Separator orientation="vertical" />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();

    rerender(<Separator orientation="vertical" decorative={false} />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
  });

  it("takes a fixed height instead of stretching to its flex line", () => {
    const { container } = render(
      <>
        <Separator orientation="vertical" size="topbar" />
        <Separator orientation="vertical" size="pill" />
      </>,
    );

    const [topbar, pill] = container.querySelectorAll('[data-slot="separator"]');
    expect(topbar).toHaveClass("data-vertical:h-[18px]");
    expect(topbar.className).not.toMatch(/self-stretch/);
    expect(pill).toHaveClass("data-vertical:h-[14px]");
  });
});
