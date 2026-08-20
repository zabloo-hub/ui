import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { focusRing } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

/**
 * 36×20 with a 16px thumb inset 2, against shadcn's 44×24 — the switch sits in a
 * 296px panel next to an 11.5px mono path, and the stock one dwarfs it. The
 * generated `sm`/`default` sizes are gone: there is one switch in this chrome.
 *
 * The thumb is white in three of the four states; the fourth (dark, off) is
 * `#a1a1aa` with no shadow, which is not a token V2 ships. It is requested as
 * `--switch-thumb-off` in ZAB-83 rather than written literally here — if V2 does
 * not land it the thumb goes transparent, which is loud enough to notice, and
 * that is the point of not putting a fallback colour in a component.
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
        "data-unchecked:bg-border data-checked:bg-[var(--switch-on)]",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[16px] rounded-full bg-white transition-transform",
          "data-unchecked:translate-x-[2px] data-checked:translate-x-[18px]",
          "data-unchecked:shadow-[0_1px_2px_rgba(0,0,0,.15)]",
          "dark:data-unchecked:bg-[var(--switch-thumb-off)] dark:data-unchecked:shadow-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
