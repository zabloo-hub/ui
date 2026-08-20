import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { focusRing } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

/**
 * The console tabs (Actions / Problems / Stats) in the design's pill style: a
 * muted track with a raised card riding on the active tab. shadcn's `line`
 * variant and its animated underline are dropped — the chrome never uses them,
 * and the underline's `after:` pseudo-element is a third of the generated class
 * string.
 *
 * The trigger is `w-fit`, not shadcn's `flex-1`: the three tabs sit at the left
 * of a 34px header next to a "Clear" button, and stretching them to fill would
 * push it off the row.
 *
 * A trigger may hold a `<Badge variant="count">` after its label — that is what
 * the 6px gap is for — which is how a fatal shows up on the Problems tab.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("group/tabs flex min-h-0 flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva("inline-flex w-fit items-center", {
  variants: {
    variant: {
      pill: "gap-[2px] rounded-[8px] bg-muted p-[3px]",
    },
  },
  defaultVariants: {
    variant: "pill",
  },
});

function TabsList({
  className,
  variant = "pill",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center gap-[6px] whitespace-nowrap",
        "rounded-[6px] border border-transparent px-[12px] py-[3px]",
        "text-[12px] leading-[1.5] font-medium text-muted-foreground transition-colors",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        "data-active:bg-card data-active:text-foreground data-active:shadow-[var(--shadow-tab)]",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
