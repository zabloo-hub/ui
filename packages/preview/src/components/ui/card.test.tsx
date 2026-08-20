import { render, screen } from "@testing-library/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

describe("Card", () => {
  it("floats over the stage, or sits flat inside it", () => {
    render(
      <>
        <Card variant="floating">panel</Card>
        <Card variant="inset">json</Card>
      </>,
    );

    expect(screen.getByText("panel")).toHaveClass(
      "rounded-[10px]",
      "shadow-[var(--shadow-panel)]",
      "border",
    );
    expect(screen.getByText("json")).toHaveClass("rounded-[8px]");
    expect(screen.getByText("json").className).not.toMatch(/shadow-\[var\(--shadow-panel\)\]/);
  });

  it("keeps the panel's own paddings out of every consumer", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Data bindings</CardTitle>
        </CardHeader>
        <CardContent>fields</CardContent>
      </Card>,
    );

    expect(screen.getByText("Data bindings")).toHaveClass("text-[12px]", "font-semibold");
    expect(screen.getByText("fields")).toHaveClass("px-[14px]", "py-[12px]");
  });
});
