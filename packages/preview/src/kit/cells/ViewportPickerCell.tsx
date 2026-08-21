import {
  Button,
  DropdownMenuValue,
  dropdownMenuItemVariants,
  Input,
  menuSurface,
} from "@/components/ui";
import { KitCell } from "@/kit/KitCell";
import { cn } from "@/lib/utils";

/**
 * The eight presets of the artboard. `custom` is not one of them — the footer is
 * it — which is the same thing `ViewportPicker` does with the real list.
 */
const PRESETS: readonly { label: string; size?: string }[] = [
  { label: "Fit window" },
  { label: "1080p", size: "1920×1080" },
  { label: "4K TV", size: "3840×2160" },
  { label: "Ultrawide", size: "2560×1080" },
  { label: "Steam Deck", size: "1280×800" },
  { label: "Switch", size: "1280×720" },
  { label: "Phone portrait", size: "390×844" },
  { label: "Phone landscape", size: "844×390" },
];

const ACTIVE = "Steam Deck";

/**
 * The viewport menu, open, with its custom footer.
 *
 * Inline for the same reason as the view selector, and with the same classes —
 * except the surface, which the picker overrides in the app too: the footer sits
 * edge to edge, so the 6px of padding moves off the card and onto the list
 * inside it.
 *
 * The W×H boxes are real inputs seeded with the artboard's numbers and left
 * uncontrolled: the kit is a page you poke at to see the states, and a box you
 * cannot type in shows the resting state and nothing else.
 */
function ViewportPickerCell() {
  return (
    <KitCell id="viewport-picker" label="Viewport picker · open">
      <div className={cn(menuSurface, "w-[230px] gap-0 overflow-hidden p-0")}>
        <div className="flex flex-col gap-px p-[6px]">
          {PRESETS.map((item) => (
            <div
              key={item.label}
              data-active={item.label === ACTIVE || undefined}
              className={cn(dropdownMenuItemVariants(), "justify-between")}
            >
              <span>{item.label}</span>
              {item.size !== undefined && <DropdownMenuValue>{item.size}</DropdownMenuValue>}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-[6px] border-border border-t p-[9px]">
          <span className="text-ui text-subtle">Custom</span>
          <Input size="xs" inputMode="numeric" aria-label="Custom width" defaultValue="1512" />
          <span className="text-ui text-muted-foreground">×</span>
          <Input size="xs" inputMode="numeric" aria-label="Custom height" defaultValue="982" />
          <Button size="xs" className="ml-auto">
            Set
          </Button>
        </div>
      </div>
    </KitCell>
  );
}

export { ViewportPickerCell };
