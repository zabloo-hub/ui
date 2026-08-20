import { cva, type VariantProps } from "class-variance-authority";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The view selector and the viewport picker (artboard 1e). Compacted: radius 8
 * on the surface, 6px of padding, 1px gaps, and 12px items at 5px 9px — against
 * shadcn's 14px items in a `rounded-lg` card.
 *
 * Two things were removed rather than restyled. The generated content pins
 * itself to `--radix-dropdown-menu-trigger-width`, which would squeeze the
 * 200px view menu onto a 120px trigger; and the checkbox/radio/sub-menu
 * families are gone, because nothing in this chrome opens a second level and
 * every one of them would owe the kit page of V17 a state to draw.
 *
 * Selection is `data-active` on the item, not a check mark: the design says
 * indigo-soft with indigo 500 text.
 */
function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal(props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

/**
 * Shared with `<PopoverContent>`, which the design draws as the same card — the
 * viewport picker is a menu everywhere except in the row where you type a size.
 * Deliberately free of `--radix-dropdown-menu-*` variables: those are named per
 * primitive, so each content component adds its own below.
 */
const menuSurface = cn(
  "z-50 flex flex-col gap-px overflow-y-auto rounded-[8px] border border-border",
  "bg-popover p-[6px] text-popover-foreground shadow-[var(--shadow-menu)] duration-100",
  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
  "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
);

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          menuSurface,
          "min-w-[8rem] max-h-(--radix-dropdown-menu-content-available-height)",
          "origin-(--radix-dropdown-menu-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/**
 * Exported so that a list built inside a `<Popover>` — the viewport picker,
 * whose custom row holds two inputs a menu would swallow the typing of — can
 * reuse the item without cloning its class string.
 */
const dropdownMenuItemVariants = cva(
  cn(
    "group/dropdown-menu-item relative flex cursor-default select-none items-center gap-1.5",
    "rounded-[6px] px-[9px] py-[5px] text-[var(--text-secondary)] outline-hidden transition-colors",
    "focus:bg-accent focus:text-foreground",
    "data-active:bg-[var(--indigo-soft)] data-active:font-medium data-active:text-[var(--indigo)]",
    "data-disabled:pointer-events-none data-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px]",
  ),
  {
    variants: {
      size: {
        default: "text-[12px]",
        /** The view selector runs half a point larger than the rest of the chrome. */
        lg: "text-[12.5px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function DropdownMenuItem({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> &
  VariantProps<typeof dropdownMenuItemVariants>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-size={size}
      className={cn(dropdownMenuItemVariants({ size }), className)}
      {...props}
    />
  );
}

/**
 * The right-hand slot of an item: a resolution, in mono. It goes indigo inside
 * the selected row, where the design lifts it a shade off the muted grey.
 */
function DropdownMenuValue({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-value"
      className={cn(
        "ml-auto pl-4 font-mono text-[11px] font-normal text-muted-foreground",
        "group-data-active/dropdown-menu-item:text-[var(--indigo-foreground)]",
        className,
      )}
      {...props}
    />
  );
}

/** The other right-hand slot: a 6px red dot marking a view that has a fatal. */
function DropdownMenuDot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-dot"
      className={cn("ml-auto size-[6px] shrink-0 rounded-full bg-[var(--danger)]", className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        "px-[9px] py-[5px] text-[10px] font-semibold tracking-[.09em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-[6px] my-[5px] h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDot,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuValue,
  dropdownMenuItemVariants,
  menuSurface,
};
