import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The gamepad hint in the statusbar, and the one surface in the chrome that does
 * NOT flip with the theme: the design draws the same near-black tooltip in light
 * and in dark. So it cannot use `--foreground`/`--background`, which swap — it
 * names the two zinc steps those tokens are cut from (`#09090b` = zinc-950,
 * `#f4f4f5` = zinc-100) through Tailwind's own palette. Still not a colour
 * invented in a component; just one that is deliberately theme-independent.
 *
 * The arrow the generated file renders is dropped — the mockup has none.
 */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit max-w-xs rounded-[6px] bg-zinc-950 px-[11px] py-[7px]",
          "text-[11px] leading-[1.6] text-zinc-100",
          "shadow-[var(--shadow-tooltip)] origin-(--radix-tooltip-content-transform-origin)",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
