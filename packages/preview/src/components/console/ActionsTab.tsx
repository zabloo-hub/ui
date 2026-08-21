/**
 * The Actions log: what the running view did, oldest first, one line each.
 *
 * The line is three columns and not a sentence — `12:04:31  action  buy →
 * shop.items.3 (#3)` — because the question you bring to this tab is "did that
 * fire?", and the answer is found by scanning the middle column, which only
 * works if the column is a column. Hence mono, a fixed-width keyword, and the
 * time in the faintest colour on the page: it is there to be read once you have
 * already found the line, not to compete with it.
 *
 * The `(#n)` of an item action is split back off the text and greyed. The store
 * keeps one string per entry (`store/actions.ts`) — the right call there, since
 * a log line is a log line — so the index is recovered here, where it is a
 * matter of how the line is DRAWN, and nowhere else.
 *
 * **Auto-scroll, and when not to.** A log that always jumps to the bottom is a
 * log you cannot read while anything is happening. So the tab follows the tail
 * only while the viewport is already at it: scroll up and it stops, scroll back
 * down and it resumes. `pinned` is updated from the scroll event rather than
 * measured when a line arrives, because by then the DOM already has the new line
 * in it and the reading would say "not at the bottom" for everyone.
 *
 * The viewport is reached through Radix's `data-slot` instead of a ref the
 * primitive would have to expose: `components/ui/**` is vendored (ZAB-84), and
 * that attribute is the handle its own tests already address it by.
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ActionEntry, ActionKind } from "@/store/actions";
import { useActions } from "@/store/hooks";

/** `view` is muted on purpose: a load is context for the lines under it. */
const KIND_CLASS: Record<ActionKind, string> = {
  view: "text-muted-foreground",
  write: "text-log-write",
  action: "text-log-action",
};

/** The item index an action carried, as `actionLine` appended it. */
const INDEX_SUFFIX = /^(.*?)\s(\(#\d+\))$/;

const VIEWPORT = '[data-slot="scroll-area-viewport"]';

/** A pixel of slack: fractional scroll positions never land on the integer. */
function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
}

/** `12:04:31` — local wall clock, which is the one the developer is watching. */
function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

function Line({ entry }: { entry: ActionEntry }) {
  const match = INDEX_SUFFIX.exec(entry.text);
  const [text, index] = match === null ? [entry.text, null] : [match[1], match[2]];

  return (
    <div className="flex gap-[2ch]">
      <time className="shrink-0 text-faint">{clock(entry.ts)}</time>
      {/* Six characters is `action`, the longest of the three. */}
      <span className={cn("w-[6ch] shrink-0", KIND_CLASS[entry.kind])}>{entry.kind}</span>
      <span className="min-w-0 break-all">
        {text}
        {index !== null && <span className="text-muted-foreground"> {index}</span>}
      </span>
    </div>
  );
}

function ActionsTab() {
  const { entries } = useActions();
  const viewport = useRef<HTMLElement | null>(null);
  const pinned = useRef(true);

  // A callback ref and not an effect: the log is unmounted while it is empty, so
  // the viewport comes and goes, and this fires exactly when it does.
  const attach = useCallback((root: HTMLDivElement | null) => {
    const el = root?.querySelector<HTMLElement>(VIEWPORT) ?? null;
    viewport.current = el;
    if (el === null) return;

    const onScroll = () => {
      pinned.current = atBottom(el);
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      viewport.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (entries.length === 0 || el === null || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-caption text-muted-foreground">
        No actions yet
      </div>
    );
  }

  return (
    <ScrollArea ref={attach} className="h-full">
      <div className="px-[14px] py-2 font-mono text-log text-subtle">
        {/* Nothing but its position identifies a line: two identical actions a frame
            apart are two entries with the same timestamp and the same text, and both
            belong in the log. It is a safe identity here — the list only grows at the
            end (the cap trims the front), and a line holds no state to lose when it
            does. */}
        {entries.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the position IS the identity — see above.
          <Line key={`${entry.ts}-${i}`} entry={entry} />
        ))}
      </div>
    </ScrollArea>
  );
}

export { ActionsTab };
