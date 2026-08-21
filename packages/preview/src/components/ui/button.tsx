import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn's Button, compacted: 12px text instead of 14, a 28px trigger instead of
 * 36, and radius 6 instead of the style's `rounded-lg`.
 *
 * Four variants survive from what `shadcn add` generated (`destructive` and
 * `link` are not in the design, and dead variants are variants the kit page of
 * V17 would have to invent states for). The design's own shape shows up as two
 * extra sizes — `icon-round`, the 26px circle that exits zen mode — and as two
 * toggled states, because the chrome uses this button as a toggle in three
 * places: `aria-pressed`/`data-state=on` is the muted "on" of the theme button,
 * and `data-active` is the indigo "on" of the zen button (artboard 1e labels the
 * three icon buttons "rest · toggled · zen active").
 *
 * `active:translate-y-px` from the generated file is gone: nothing in a 44px
 * toolbar should move under the cursor.
 */
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-md border border-transparent text-ui leading-[1.5] font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px]",
    "focus-visible:focus-ring",
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-control",
        secondary: "bg-muted text-foreground hover:bg-border",
        outline: cn(
          "border-border bg-card text-foreground hover:bg-accent",
          "aria-expanded:bg-accent shadow-control",
        ),
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
      },
      size: {
        /** The design fixes padding, not height: 12px/1.5 + 6px twice lands on 30px. */
        default: "px-[14px] py-[6px]",
        /** The 28px trigger the whole topbar is built out of. */
        sm: "h-[28px] px-[10px]",
        /** The "Set" button in the viewport picker's custom row (artboard 1e). */
        xs: "h-auto rounded-sm px-[9px] py-[3px] text-caption",
        icon: "size-[28px]",
        /** Exit zen: the one round control in the chrome. */
        "icon-round": "size-[26px] rounded-full",
      },
    },
    compoundVariants: [
      /** Ghost is the only variant the design gives a tighter horizontal padding. */
      { variant: "ghost", size: "default", class: "px-[10px]" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(
        buttonVariants({ variant, size }),
        // Toggled, muted: the theme button once a theme is forced.
        "aria-pressed:bg-accent aria-pressed:text-muted-foreground",
        "data-[state=on]:bg-accent data-[state=on]:text-muted-foreground",
        // Toggled, indigo: zen mode active.
        "data-active:bg-indigo-soft data-active:text-indigo",
        className,
      )}
      {...props}
    />
  );
}

export { Button, buttonVariants };
