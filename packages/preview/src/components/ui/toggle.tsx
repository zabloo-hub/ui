import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The `{ } Bindings` button, and the only two-state control in the chrome whose
 * "on" is indigo rather than muted. shadcn's outline toggle carries the trigger
 * shadow; this one deliberately does not — the design gives it a flat border so
 * that it reads as a switch and not as another trigger next to the DPR control.
 *
 * The glyph is text (`{ }` in Geist Mono), not lucide's `Braces`: it is what the
 * mockup draws, and at 11px a stroked icon next to a 12px label goes muddy.
 */
const toggleVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-md border border-transparent px-[10px] py-[5px]",
    "text-ui leading-[1.5] font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px]",
    "focus-visible:focus-ring",
  ),
  {
    variants: {
      variant: {
        outline: cn(
          "border-border text-subtle hover:bg-accent",
          "data-[state=on]:border-indigo-soft-border",
          "data-[state=on]:bg-indigo-soft data-[state=on]:text-indigo",
          "data-[state=on]:hover:bg-indigo-soft",
        ),
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

function Toggle({
  className,
  variant = "outline",
  ...props
}: ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant}
      className={cn(toggleVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
