import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 36×20 with a 16px thumb inset 2, against shadcn's 44×24 — the switch sits in a
 * 296px panel next to an 11.5px mono path, and the stock one dwarfs it. The
 * generated `sm`/`default` sizes are gone: there is one switch in this chrome.
 *
 * The off thumb is the one value the design does not take from an existing
 * token: white in light, `#a1a1aa` in dark with the shadow removed. V2's table
 * had no name for it, so this branch adds `--switch-thumb-off` to `tokens.css`
 * — which is what ZAB-84 says to do when a variable is missing at merge time,
 * rather than writing the colour into the component. The ON thumb stays
 * `bg-white`: the design paints it white in both themes, like the tooltip.
 *
 * Track travel is written as absolute translations (2 → 18) instead of shadcn's
 * `translate-x-[calc(100%-2px)]`: with a 36px track and a 16px thumb the
 * percentage maths is off by the border, and 2/18 is what the mockup measures.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-[20px] w-[36px] shrink-0 items-center",
        "rounded-full border border-transparent transition-colors",
        "data-unchecked:bg-border data-checked:bg-switch-on",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "focus-visible:focus-ring",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[16px] rounded-full transition-transform",
          "data-checked:bg-white data-unchecked:bg-switch-thumb-off",
          "data-unchecked:translate-x-[2px] data-checked:translate-x-[18px]",
          "data-unchecked:shadow-[0_1px_2px_rgba(0,0,0,.15)] dark:data-unchecked:shadow-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
