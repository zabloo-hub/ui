import { Minimize } from "lucide-react";
import { BadgeDot, Button, Separator } from "@/components/ui";
import { cn } from "@/lib/utils";
import { type ConnectionState, useCaptionParts, useStore } from "@/store";

/** The three states, on the tokens the connection pills already use. */
const DOT: Record<ConnectionState, string> = {
  live: "[--badge-dot:var(--ok)]",
  stale: "[--badge-dot:var(--warn)]",
  disconnected: "[--badge-dot:var(--danger)]",
};

/**
 * The only chrome left on screen in zen mode: a glass pill floating over the top
 * right of the stage, holding the two things you lose by hiding everything else —
 * whether what you are looking at is still live, and what size it is being laid
 * out at — plus the way back out.
 *
 * The dot's colour is set on the pill rather than passed to {@link BadgeDot},
 * which reads `--badge-dot`: the same pairing the connection badges use, so a
 * "live" pill cannot end up wearing an amber dot (see `ui/badge.tsx`).
 */
function ZenPill() {
  const connection = useStore((state) => state.connection);
  const caption = useCaptionParts();
  const setZen = useStore((state) => state.setZen);

  return (
    <div
      data-slot="zen-pill"
      data-connection={connection}
      className={cn(
        "absolute top-[14px] right-[14px] flex items-center gap-[10px]",
        "rounded-full border bg-glass py-[6px] pr-[8px] pl-[14px]",
        "shadow-pill backdrop-blur-[8px]",
        DOT[connection],
      )}
    >
      <BadgeDot />
      <span className="font-mono text-caption text-muted-foreground">
        {caption.preset} · {caption.size}
      </span>
      <Separator orientation="vertical" size="pill" />
      <Button
        variant="ghost"
        size="icon-round"
        aria-label="Exit zen mode"
        onClick={() => setZen(false)}
      >
        <Minimize />
      </Button>
    </div>
  );
}

export { ZenPill };
