import { useEffect } from "react";
import { CONNECTION_DOT, CONNECTION_LABEL } from "@/components/connection-ui";
import { GamepadIndicator } from "@/components/statusbar/GamepadIndicator";
import { BadgeDot } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fatalCount, useStore, warnCount } from "@/store";

/** How often the statusbar re-counts the fps window when nobody else is. */
const FPS_TICK_MS = 1000;

/**
 * The 26px footer: whether what you see is still the truth, what the validator
 * said about it, which file it is, what the last frame cost, and whether there
 * is a gamepad. Five facts that are only worth a whole row because they are the
 * ones you want without asking — everything that needs a question lives in the
 * console above.
 *
 * All five are read as narrow selectors rather than through the slice hooks: the
 * counts come from `problems`, an array that is replaced on every load, and the
 * frame comes from `stats`, which moves several times a second. `useProblems()`
 * would hand the whole list to a component that only ever prints two integers.
 */
function Statusbar() {
  const connection = useStore((state) => state.connection);
  const name = useStore((state) => state.envelope.name);

  useFpsTick();

  return (
    <div
      data-slot="statusbar"
      data-connection={connection}
      className={cn(
        "flex h-full items-center gap-[14px] bg-background px-3",
        "text-caption text-muted-foreground",
        CONNECTION_DOT[connection],
      )}
    >
      <span className="flex items-center gap-[5px]">
        {/* A shade smaller than the pills': 6px against 26px of footer. */}
        <BadgeDot className="size-[6px]" />
        {CONNECTION_LABEL[connection]}
      </span>
      <ProblemSummary />
      {name !== null && (
        <span data-slot="envelope-name" className="font-mono text-code text-faint">
          {name}
        </span>
      )}
      <Fps />
      <GamepadIndicator />
    </div>
  );
}

/**
 * `0 problems`, or the fatals in red and the warnings after them.
 *
 * The two levels are not summed. A fatal means the view on screen did not load
 * and a warn means it did with a node repaired out of it, so `3 problems` over a
 * mix of the two would name a number that stands for nothing you can act on.
 * With no fatals the red half is dropped entirely rather than printed as
 * `0 fatal` — a zero in the danger colour reads as a failure at a glance.
 */
function ProblemSummary() {
  const fatal = useStore(fatalCount);
  const warn = useStore(warnCount);

  if (fatal === 0 && warn === 0) return <span>0 problems</span>;

  return (
    <span>
      {/* `fatal` does not pluralise ("2 fatals" is not what anyone says about a
          diagnostic); `warning` does. */}
      {fatal > 0 && <span className="font-medium text-danger-fg">{fatal} fatal</span>}
      {fatal > 0 && warn > 0 && " · "}
      {warn > 0 && `${warn} warning${warn === 1 ? "" : "s"}`}
    </span>
  );
}

/**
 * `60 fps · 1.9 ms`, pushed to the right edge — or `idle`.
 *
 * Zero fps is not a stall: the renderer paints on demand, so a scene nobody is
 * touching reports no frames and that is the system working. It prints as `idle`
 * and drops the frame time with it, which would otherwise be a stale number from
 * whenever the last frame happened to be.
 */
function Fps() {
  const fps = useStore((state) => state.stats.fps);
  const last = useStore((state) => state.stats.last);
  const ms = last === null ? "" : ` · ${last.frameMs.toFixed(1)} ms`;

  return (
    <span className="ml-auto font-mono text-code text-faint">
      {fps === 0 ? "idle" : `${fps} fps${ms}`}
    </span>
  );
}

/**
 * The clock behind the fps counter, when there is nobody else to keep it.
 *
 * `fps` only falls to zero because something re-counts the window — no frame
 * arrives to say frames stopped arriving (see `store/stats.ts`) — so the reading
 * needs a tick under it or a still scene would show 60 fps forever. The Stats tab
 * runs one at 4Hz while it is on screen (V12), and this one stands down for it:
 * two clocks on the same counter buy nothing, and 1Hz is as fine as a statusbar
 * needs to be.
 */
function useFpsTick() {
  const statsVisible = useStore(
    (state) => state.layout.consoleOpen && state.layout.consoleTab === "stats",
  );
  const tick = useStore((state) => state.tickStats);

  useEffect(() => {
    if (statsVisible) return;
    const id = setInterval(tick, FPS_TICK_MS);
    return () => clearInterval(id);
  }, [statsVisible, tick]);
}

export { FPS_TICK_MS, Statusbar };
