import { Gamepad2 } from "lucide-react";
import {
  Badge,
  BadgeDot,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { KitCell, KitLabel } from "@/kit/KitCell";

/**
 * Every small label in the chrome, and the one tooltip.
 *
 * The tooltip is real and held `open`, which means Radix portals it to the body
 * and positions it under its trigger — over whatever the grid put below this
 * cell. So the trigger reserves the room: `pb-14` is the tooltip's two lines
 * plus its offset, and the cell keeps its own height instead of borrowing the
 * next row's. Inline markup would have avoided that, but the tooltip's surface
 * is not an exported class the way the menu's is, and a copy of it here is a
 * copy that stops matching the day someone touches `ui/tooltip.tsx`.
 *
 * `delayDuration={0}` on the provider so the state is not also a timing
 * question: the tooltip is open because it was told to be.
 */
function BadgesCell() {
  return (
    <KitCell id="badges" label="Badges">
      <div className="flex w-[280px] flex-wrap items-center gap-2">
        <Badge variant="live">
          <BadgeDot />
          <span className="font-medium">Live</span>
        </Badge>
        <Badge variant="stale">
          <BadgeDot />
          <span className="font-medium">Stale</span>
        </Badge>
        <Badge variant="disconnected">
          <BadgeDot />
          <span className="font-medium">Disconnected</span>
        </Badge>
        <Badge variant="count">3</Badge>
        <Badge variant="mono-chip">60 fps</Badge>
        <Gamepad2 role="img" aria-label="Gamepad, idle" className="size-[15px] text-faint" />
        <Gamepad2 role="img" aria-label="Gamepad, connected" className="size-[15px] text-indigo" />
      </div>

      <KitLabel>Tooltip</KitLabel>
      {/* The padding is the room the portalled tooltip lands in; the anchor
          itself has no size, so the content starts at the top of it. */}
      <div className="pb-14">
        <TooltipProvider delayDuration={0}>
          <Tooltip open>
            <TooltipTrigger asChild>
              <span className="block size-0" />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" sideOffset={0}>
              d-pad / stick: focus · A: press
              <br />
              B: back · right stick: scroll
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </KitCell>
  );
}

export { BadgesCell };
