/**
 * What the last painted frame cost, as a live table instead of a line of text.
 *
 * The numbers themselves are not new — `zabloo.stats()` has been on the handle
 * since ZAB-78, reachable only by typing it into the console, which is exactly
 * the moment you are not looking at the canvas. What is new is that they are on
 * screen while you play with the thing they measure.
 *
 * Two decisions carry this file:
 *
 * 1. **`idle`, never `0 fps`.** The renderer paints ON DEMAND (see
 *    `store/stats.ts`): a still scene painting nothing is the system working.
 *    Printing a zero there would report a stall on every screen that is not
 *    animating, which is most of them.
 * 2. **The tab drives its own clock.** `fps` counts a one-second window, and a
 *    window nobody recomputes never falls — a scene that stopped painting would
 *    keep showing the rate it had when it stopped. So while the tab is on
 *    screen it calls `tickStats()` four times a second, and it stops the moment
 *    it is not: a timer running behind a collapsed console is a wake-up every
 *    250ms for a number nobody can read.
 *
 * The second row is the telemetry ZAB-73 added — the counters that are supposed
 * to sit at zero on a steady frame. Muted, because they are only interesting
 * when they are not zero.
 */

import { useEffect } from "react";
import { compact } from "@/bridge/stats";
import { cn } from "@/lib/utils";
import { useLayout, useStats } from "@/store/hooks";
import type { FrameSample } from "@/store/stats";

/** Four times a second: fast enough that `fps` falls to `idle` while you watch. */
const TICK_MS = 250;

function StatsTab() {
  const { last, fps, tick } = useStats();
  const { consoleOpen, consoleTab } = useLayout();
  const visible = consoleOpen && consoleTab === "stats";

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [visible, tick]);

  return (
    <div
      data-slot="stats-tab"
      className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[14px] py-[10px]"
    >
      {last === null ? (
        // Not an error and not a zero: the canvas has simply not painted yet.
        <span className="font-mono text-caption text-muted-foreground">no frame painted yet</span>
      ) : (
        <>
          <div className="flex gap-[22px] font-mono text-caption text-subtle">
            <Stat label="fps" value={fps > 0 ? String(fps) : "idle"} />
            <Stat label="frame" value={`${last.frameMs.toFixed(1)}ms`} />
            <Stat label="draws" value={String(last.drawCalls)} />
            <Stat label="verts" value={compact(last.vertices)} />
            <Stat label="atlases" value={atlases(last)} />
          </div>
          <div className="flex gap-[22px] font-mono text-caption text-muted-foreground">
            <Stat
              label="resolved"
              // A repaint-only frame did not resolve a single node — that is the
              // whole point of it, so it says so rather than printing a zero.
              value={last.repaintOnly ? "repaint only" : String(last.resolved)}
              muted
            />
            <Stat label="textLayouts" value={String(last.textLayouts)} muted />
            <Stat label="bufferGrowths" value={String(last.bufferGrowths)} muted />
          </div>
        </>
      )}
    </div>
  );
}

/** `3 · 12MB`: how many atlases are alive and what they cost in CPU bitmaps. */
function atlases(frame: FrameSample): string {
  return `${frame.atlases} · ${Math.round(frame.atlasBytes / 1048576)}MB`;
}

interface StatProps {
  label: string;
  value: string;
  /** The second row: same shape, but it does not compete with the frame cost. */
  muted?: boolean;
}

function Stat({ label, value, muted = false }: StatProps) {
  return (
    <span data-slot="stat" data-label={label} className="flex flex-col gap-[2px]">
      <span className="text-tag text-muted-foreground">{label}</span>
      <span className={cn(muted ? "text-caption" : "text-stat")}>{value}</span>
    </span>
  );
}

export { StatsTab, TICK_MS };
