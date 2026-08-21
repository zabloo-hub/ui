import { CONNECTION_LABEL } from "@/components/connection-ui";
import {
  Badge,
  BadgeDot,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { useConnection } from "@/store";

/**
 * Whether what is on the canvas is still the truth — the most important thing
 * the topbar says, which is why it sits alone on the right with everything else
 * pushed away from it.
 *
 * The three variants of `Badge` already pair each colour with its dot, so this
 * is a variant lookup and not a palette (see `ui/badge.tsx`).
 *
 * `stale` is the only state that grows a tooltip, and only once there is a
 * message to put in it: "Stale" says the render is older than the file on disk,
 * and the export error is what says why. Then, and only then, the pill becomes a
 * `<button>` — a tooltip nobody can focus is a tooltip half the users of a dev
 * tool never see, and Radix needs a real interactive trigger to give it to them.
 * The other two states stay a plain span: a `Live` pill that takes a tab stop
 * and reveals nothing would be a control that is not one.
 *
 * The `<TooltipProvider>` is local, like `DprControl`'s: Radix nests them, so
 * this keeps working unchanged the day something above mounts a global one.
 */
function ConnectionPill() {
  const { connection, lastError } = useConnection();

  const label = (
    <>
      <BadgeDot />
      {CONNECTION_LABEL[connection]}
    </>
  );

  if (connection !== "stale" || lastError === null) {
    return (
      <Badge data-slot="connection-pill" variant={connection}>
        {label}
      </Badge>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge data-slot="connection-pill" variant="stale" asChild>
            <button type="button" className="focus-visible:focus-ring">
              {label}
            </button>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{lastError}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { ConnectionPill };
