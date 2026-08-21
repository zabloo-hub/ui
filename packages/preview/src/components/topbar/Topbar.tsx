import { BindingsToggle } from "@/components/topbar/BindingsToggle";
import { ConnectionPill } from "@/components/topbar/ConnectionPill";
import { DprControl } from "@/components/topbar/DprControl";
import { ThemeToggle } from "@/components/topbar/ThemeToggle";
import { ViewportPicker } from "@/components/topbar/ViewportPicker";
import { ViewSelector } from "@/components/topbar/ViewSelector";
import { Wordmark } from "@/components/topbar/Wordmark";
import { ZenButton } from "@/components/topbar/ZenButton";
import { Separator } from "@/components/ui";

/**
 * The bar across the top: who you are looking at on the left, what you are
 * looking at in the middle, and whether it is still true on the right.
 *
 * The 44px and the bottom border are NOT here — `AppShell` owns every region's
 * height because they have to add up against a console the store can collapse,
 * so this is the row inside that header and nothing more. What it does own is
 * the surface (`bg-card`, the panel white of the design against the stage's
 * grey) and the 12/8 rhythm the artboards draw.
 *
 * The right cluster is one `ml-auto` box rather than a spacer element between
 * the halves: the split is a property of where that group starts, and a
 * `<div className="flex-1"/>` would be a node that means nothing to anybody. It
 * repeats the bar's own `gap-2`, which is what keeps the pill, the separator and
 * the two icon buttons on the same 8px rhythm as everything to their left.
 *
 * The three controls of V8 and V9 arrive through `display: contents` wrappers.
 * They are the handle this bar's tests address the slots by — neither picker
 * carries a `data-slot` of its own and both belong to other tickets — and
 * `contents` is what keeps the wrapper from being a flex item: `ViewSelector` is
 * still a placeholder that renders nothing, and an empty box between two
 * controls would eat one of the 8px gaps until V8 lands.
 */
function Topbar() {
  return (
    <div className="flex h-full items-center gap-2 bg-card px-3">
      <Wordmark />
      <Separator orientation="vertical" size="topbar" />
      <div data-slot="view-selector" className="contents">
        <ViewSelector />
      </div>
      <div data-slot="viewport-picker" className="contents">
        <ViewportPicker />
      </div>
      <div data-slot="dpr-control" className="contents">
        <DprControl />
      </div>
      <BindingsToggle />
      <div className="ml-auto flex items-center gap-2">
        <ConnectionPill />
        <Separator orientation="vertical" size="topbar" />
        <ThemeToggle />
        <ZenButton />
      </div>
    </div>
  );
}

export { Topbar };
