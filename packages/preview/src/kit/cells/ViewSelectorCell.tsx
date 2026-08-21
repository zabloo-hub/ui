import { ChevronDown } from "lucide-react";
import { Button, DropdownMenuDot, dropdownMenuItemVariants, menuSurface } from "@/components/ui";
import { KitCell } from "@/kit/KitCell";
import { cn } from "@/lib/utils";

/** The four rows of the artboard: rest, hover, active, and a view with a fatal. */
const ITEMS: readonly { label: string; state?: "hover" | "active" | "fatal" }[] = [
  { label: "layout" },
  { label: "typography", state: "hover" },
  { label: "controls", state: "active" },
  { label: "overlays", state: "fatal" },
];

/**
 * The view selector, closed and open at the same time.
 *
 * The open menu is drawn INLINE — `menuSurface` and `dropdownMenuItemVariants`
 * on plain elements — and not as a real `<DropdownMenu open>`. A Radix menu
 * portals to the body and positions itself against its trigger, so on this page
 * it would float over the neighbouring cells instead of standing in the grid,
 * and `forceMount` does not change that. The two class strings are the exported
 * ones the real menu wears (that is what ZAB-84 exports them for), so the kit
 * cannot drift from it; what the kit gives up is the behaviour, which is the
 * app's to demonstrate, not the kit's.
 *
 * The hover row is the one place a state is spelled out by hand: the primitive
 * paints it with `focus:bg-accent`, because in a live menu the highlight follows
 * the roving focus, and a static `<div>` cannot be focused. Written as the two
 * utilities that variant resolves to, and listed in the PR as a deviation of V3
 * — a `data-highlighted` on the item would let the kit force it honestly.
 */
function ViewSelectorCell() {
  return (
    <KitCell id="view-selector" label="View selector">
      <Button variant="outline" size="sm" className="w-fit gap-[7px]">
        <span className="text-caption text-muted-foreground">View</span>
        <span className="font-medium">controls</span>
        <ChevronDown className="size-[10px] text-muted-foreground" />
      </Button>

      <div className={cn(menuSurface, "w-[200px]")}>
        {ITEMS.map((item) => (
          <div
            key={item.label}
            data-active={item.state === "active" || undefined}
            className={cn(
              dropdownMenuItemVariants({ size: "lg" }),
              item.state === "hover" && "bg-accent text-foreground",
            )}
          >
            {item.label}
            {item.state === "hover" && (
              <span className="text-label text-muted-foreground">· hover</span>
            )}
            {item.state === "fatal" && <DropdownMenuDot />}
          </div>
        ))}
      </div>
    </KitCell>
  );
}

export { ViewSelectorCell };
