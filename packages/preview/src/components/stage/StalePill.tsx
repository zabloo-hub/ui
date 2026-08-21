import { cn } from "@/lib/utils";

/**
 * What the veil says out loud: the render underneath is the last good one, and
 * the file on disk has moved on since.
 *
 * Deliberately not an error overlay. A refused export is not a crash and the
 * canvas is not blank — hiding a working render behind a red box would take away
 * the very thing you were looking at. The detail belongs in the Problems tab
 * (V12); this is a one-line statement of fact.
 *
 * `bg-foreground text-background` rather than the artboard's literal
 * `#09090b`/`#f4f4f5`: in light that IS those two values, and in dark it flips
 * to a pale pill — a near-black one would be the same colour as the stage.
 */
function StalePill() {
  return (
    <div
      data-slot="stale-pill"
      className={cn(
        "absolute top-[14px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-[7px]",
        "rounded-full bg-foreground px-[12px] py-[5px]",
        "text-background text-log leading-none shadow-pill",
      )}
    >
      <span aria-hidden="true" className="size-[6px] rounded-full bg-warn" />
      Stale — export failed, showing last good render
    </div>
  );
}

export { StalePill };
