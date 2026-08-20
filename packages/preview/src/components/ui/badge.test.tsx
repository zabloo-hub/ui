import { render, screen } from "@testing-library/react";
import { Badge, BadgeDot } from "@/components/ui/badge";

describe("Badge", () => {
  it("gives every connection state its own token trio", () => {
    render(
      <>
        <Badge variant="live">Live</Badge>
        <Badge variant="stale">Stale</Badge>
        <Badge variant="disconnected">Disconnected</Badge>
      </>,
    );

    expect(screen.getByText("Live")).toHaveClass("bg-[var(--ok-bg)]", "text-[var(--ok-fg)]");
    expect(screen.getByText("Stale")).toHaveClass("bg-[var(--warn-bg)]", "text-[var(--warn-fg)]");
    expect(screen.getByText("Disconnected")).toHaveClass(
      "bg-[var(--danger-bg)]",
      "text-[var(--danger-fg)]",
    );
  });

  it("hands the dot its colour through the pill, so the pair cannot drift", () => {
    const { container } = render(
      <Badge variant="stale">
        <BadgeDot />
        Stale
      </Badge>,
    );

    expect(container.querySelector('[data-variant="stale"]')).toHaveClass(
      "[--badge-dot:var(--warn)]",
    );
    expect(container.querySelector('[data-slot="badge-dot"]')).toHaveClass(
      "size-[7px]",
      "bg-[var(--badge-dot)]",
    );
  });

  it("keeps the small labels at the sizes the design draws", () => {
    render(
      <>
        <Badge variant="count">3</Badge>
        <Badge variant="mono-chip">60 fps</Badge>
        <Badge variant="type-tag">number</Badge>
        <Badge variant="ui-chip">← UI</Badge>
      </>,
    );

    expect(screen.getByText("3")).toHaveClass("text-[9.5px]", "rounded-full");
    expect(screen.getByText("60 fps")).toHaveClass("text-[10.5px]", "font-mono", "rounded-[5px]");
    expect(screen.getByText("number")).toHaveClass("text-[9.5px]", "rounded-[4px]", "border");
    expect(screen.getByText("← UI")).toHaveClass("bg-[var(--indigo-chip)]", "text-[var(--indigo)]");
  });

  it("fixes both severity chips at the same padding", () => {
    render(
      <>
        <Badge variant="severity-fatal">FATAL</Badge>
        <Badge variant="severity-warn">WARN</Badge>
      </>,
    );

    // The mockup draws 1px 6px in artboard 1b and 2px 7px in 1e; ZAB-84 picks 1px 6px.
    expect(screen.getByText("FATAL")).toHaveClass("px-[6px]", "py-px");
    expect(screen.getByText("WARN")).toHaveClass("px-[6px]", "py-px");
  });
});
