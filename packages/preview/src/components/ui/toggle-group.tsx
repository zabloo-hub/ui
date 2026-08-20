import { cva, type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The DPR control (`auto · 1× · 2× · 3×`), which shadcn has no component for: it
 * is not a row of toggles with a shared border, it is ONE box with hairlines
 * inside it. So the generated `spacing`/`toggleVariants` machinery is replaced
 * by two variants of its own — the segmented box, and a plain row for anything
 * later that wants separate buttons.
 *
 * `border-l` on every item but the first draws the dividers, which means the
 * items must not be rounded and the box must clip them. That is also why this is
 * the one primitive that does not wear V2's `focus-ring`: see the note below.
 *
 * The mockup writes the segments at 5px 8px in the topbar and 5px 9px in the kit
 * (artboards 1a and 1e); ZAB-84 fixes 9.
 */
const toggleGroupVariants = cva("flex w-fit items-center", {
  variants: {
    variant: {
      default: "gap-1",
      segmented: cn(
        "overflow-hidden rounded-md border border-border shadow-control",
        "data-vertical:flex-col data-vertical:items-stretch",
      ),
    },
  },
  defaultVariants: {
    variant: "segmented",
  },
});

const toggleGroupItemVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap",
    "transition-colors disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        default: cn(
          "rounded-md border border-transparent px-[10px] py-[5px] text-ui font-medium",
          "text-muted-foreground hover:bg-accent data-[state=on]:bg-muted",
          "data-[state=on]:font-medium data-[state=on]:text-foreground",
        ),
        segmented: cn(
          "border-border border-l px-[9px] py-[5px] text-log first:border-l-0",
          "text-muted-foreground hover:bg-accent",
          // No shadow and no lift on the active segment: the box already has one,
          // and a second one inside it reads as a bug.
          "data-[state=on]:bg-muted data-[state=on]:font-medium data-[state=on]:text-foreground",
          "data-vertical:border-t data-vertical:border-l-0 data-vertical:first:border-t-0",
          // Not V2's `focus-ring`: it thickens all four borders (these items have
          // one edge) and its halo is an outline the box would clip. Same colour,
          // drawn inwards.
          "outline-none focus-visible:outline-[1.5px] focus-visible:outline-indigo",
          "focus-visible:-outline-offset-[1.5px]",
        ),
      },
    },
    defaultVariants: {
      variant: "segmented",
    },
  },
);

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleGroupVariants>>({
  variant: "segmented",
});

function ToggleGroup({
  className,
  variant = "segmented",
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleGroupVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-orientation={orientation}
      orientation={orientation}
      className={cn(toggleGroupVariants({ variant }), className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant }}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  const context = React.useContext(ToggleGroupContext);
  const resolved = variant ?? context.variant ?? "segmented";

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={resolved}
      className={cn(toggleGroupItemVariants({ variant: resolved }), className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants, toggleGroupVariants };
