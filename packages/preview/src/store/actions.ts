/**
 * The Actions tab: everything the running view did, oldest first.
 *
 * The old page kept its log for six seconds and let each line fade — fine for a
 * corner of a bare page, useless as a tab you open to answer "did that button
 * fire?". Here the log persists for the life of the session and is capped
 * instead, at 500 lines: a repeating action can produce a line per frame, and an
 * unbounded array behind a scrolling list is a memory leak with a UI on top.
 * The cap drops the OLDEST, because the interesting end of a log is the new one.
 */

import type { Getter, Setter } from "./state";

/** `view` — a view loaded · `action` — the UI fired one · `write` — a value came back. */
export type ActionKind = "view" | "action" | "write";

export interface ActionEntry {
  /** Wall clock, so the tab can print a time of day. */
  ts: number;
  kind: ActionKind;
  text: string;
}

/** How many lines the tab keeps. */
export const ACTION_LOG_CAP = 500;

export interface ActionsSlice {
  actions: ActionEntry[];
  appendAction(kind: ActionKind, text: string): void;
  clearActions(): void;
}

export function createActionsSlice(set: Setter, get: Getter): ActionsSlice {
  return {
    actions: [],
    appendAction: (kind, text) => {
      const entries = [...get().actions, { ts: Date.now(), kind, text }];
      set({ actions: entries.length > ACTION_LOG_CAP ? entries.slice(-ACTION_LOG_CAP) : entries });
    },
    clearActions: () => set({ actions: [] }),
  };
}
