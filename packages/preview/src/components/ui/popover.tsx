import { Popover as PopoverPrimitive } from "radix-ui";
import type * as React from "react";
import { menuSurface } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The same card as `<DropdownMenuContent>`, opened by something that is not a
 * menu. The chrome needs exactly one: the viewport picker's "Custom" row holds
 * two inputs and a Set button, and a Radix menu answers typing with its own
 * typeahead — the W of "1512" would jump the highlight to a preset instead of
 * landing in the field.
 *
 * The generated `w-72` and its Header/Title/Description trio are dropped: this
 * popover is a menu surface, sized by whoever opens it.
 */
function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          menuSurface,
          "outline-hidden origin-(--radix-popover-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
