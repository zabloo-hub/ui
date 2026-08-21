import { cva, type VariantProps } from "class-variance-authority";
import { Separator as SeparatorPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The generated separator stretches to its flex line (`self-stretch`), which in
 * a 44px topbar means a 44px hairline — the design draws 18px. Both fixed
 * heights it uses get a name here rather than an arbitrary class at the call
 * site, so the topbar and the zen pill cannot drift apart.
 */
const separatorVariants = cva(
  "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px",
  {
    variants: {
      size: {
        default: "data-vertical:self-stretch",
        /** Between the wordmark and the controls, and before the theme button. */
        topbar: "data-vertical:h-[18px]",
        /** Inside the floating zen pill, which is shorter. */
        pill: "data-vertical:h-[14px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  size = "default",
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root> & VariantProps<typeof separatorVariants>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(separatorVariants({ size }), className)}
      {...props}
    />
  );
}

export { Separator, separatorVariants };
