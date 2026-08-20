import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { controlShadow, focusRing, focusRingWithin } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

/**
 * A 28px input in Geist Mono — every value this chrome edits is data (a path's
 * value, a resolution), so mono is the default and not an override.
 *
 * The interesting part is the focus state. The mockup draws a focused input as
 * 27px tall with a 1.5px border, because it is compensating by hand for the
 * border growing; here the ring is painted INSIDE the box instead
 * ({@link focusRing}) so the control keeps its 28px and nothing around it moves.
 */
const inputVariants = cva(
  cn(
    "w-full min-w-0 rounded-[6px] border border-border bg-card",
    "font-mono text-foreground transition-colors placeholder:text-muted-foreground",
    "disabled:pointer-events-none disabled:opacity-50",
    controlShadow,
  ),
  {
    variants: {
      size: {
        default: "h-[28px] px-[10px] text-[12px]",
        /** The W×H pair in the viewport picker's custom row. */
        xs: "w-[44px] rounded-[5px] px-[6px] py-[3px] text-center text-[11px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(inputVariants({ size }), focusRing, className)}
      {...props}
    />
  );
}

/**
 * The same frame with no input in it. Two things need it: the disabled bindings
 * panel, where values are held and shown but not editable, and
 * `<NumberInput>`, which puts a real input and a stepper column side by side
 * inside one box — which is also why the ring here is `focus-within`.
 */
function InputFrame({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputVariants>) {
  return (
    <div
      data-slot="input-frame"
      data-size={size}
      className={cn(
        inputVariants({ size }),
        "flex items-center overflow-hidden",
        focusRingWithin,
        className,
      )}
      {...props}
    />
  );
}

export { Input, InputFrame, inputVariants };
