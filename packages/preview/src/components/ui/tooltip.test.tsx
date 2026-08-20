import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const HINT = "d-pad / stick: focus · A: press";

describe("Tooltip", () => {
  it("appears on hover", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>gamepad</TooltipTrigger>
          <TooltipContent>{HINT}</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.hover(screen.getByRole("button", { name: "gamepad" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(HINT);
  });

  it("looks the same in both themes, so it names zinc rather than a token", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>gamepad</TooltipTrigger>
          <TooltipContent>{HINT}</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.hover(screen.getByRole("button", { name: "gamepad" }));
    const tooltip = await screen.findByRole("tooltip");

    expect(tooltip).toHaveClass("bg-zinc-950", "text-zinc-100", "text-[11px]", "rounded-[6px]");
    // `--foreground`/`--background` would flip with `.dark`; this must not.
    expect(tooltip.className).not.toMatch(/bg-foreground|text-background/);
  });
});
