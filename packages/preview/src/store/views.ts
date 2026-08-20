/**
 * The views the loaded envelope declares, which of them is on screen, and which
 * of them the validator refused.
 *
 * Two rules are inherited from the page this replaces and are the reason this
 * slice exists at all instead of a bare `useState`:
 *
 * 1. A hot-update may add, drop or rename views (ZAB-72), so the list is replaced
 *    on every load — and the view you had picked SURVIVES that replacement as
 *    long as it still exists. Losing your place on every save is what the old
 *    `syncViewOptions` was written to avoid.
 * 2. The choice is remembered per envelope (see `viewKey`): reopening the same
 *    file puts you back where you were, and opening a different one does not
 *    drag a view id that means nothing there.
 *
 * `fatalViews` is fed one diagnostic at a time by the session (V6) — the
 * validator names the view in the diagnostic's path — so it is marked, not set
 * wholesale, and cleared when a load starts.
 */

import type { Getter, Setter } from "./state";
import { type PreviewStorage, viewKey } from "./storage";

interface ViewsSlice {
  /** In the envelope's own order, which is the order the picker shows. */
  views: string[];
  activeView: string | null;
  /** The ids with a fatal diagnostic — a red dot in the picker, not a hidden view. */
  fatalViews: ReadonlySet<string>;
  setViews(ids: string[]): void;
  selectView(id: string): void;
  markFatalView(id: string): void;
  clearFatalViews(): void;
}

function createViewsSlice(set: Setter, get: Getter, storage: PreviewStorage): ViewsSlice {
  return {
    views: [],
    activeView: null,
    fatalViews: new Set(),

    setViews: (ids) => {
      const { activeView, fatalViews } = get();
      set({
        views: ids,
        activeView: resolveActiveView(get, storage, ids, activeView),
        // A fatal is about a view of the envelope that was just replaced; the
        // ones that are gone take their mark with them.
        fatalViews: prune(fatalViews, ids),
      });
    },

    selectView: (id) => {
      const name = get().envelope.name;
      if (name !== null) storage.write(viewKey(name), id);
      set({ activeView: id });
    },

    markFatalView: (id) => {
      const { fatalViews } = get();
      if (fatalViews.has(id)) return;
      set({ fatalViews: new Set(fatalViews).add(id) });
    },

    clearFatalViews: () => {
      if (get().fatalViews.size === 0) return;
      set({ fatalViews: new Set() });
    },
  };
}

/**
 * Which view a fresh list should show: the one you were on if it survived, else
 * the one this envelope remembers, else the first — which is also what the
 * renderer falls back to when the view it was asked for is gone.
 *
 * Shared with `setIdentity`, which has to answer the same question the moment it
 * learns WHICH envelope's memory to read.
 */
function resolveActiveView(
  get: Getter,
  storage: PreviewStorage,
  ids: string[],
  current: string | null,
): string | null {
  if (current !== null && ids.includes(current)) return current;
  const name = get().envelope.name;
  const remembered = name === null ? null : storage.read(viewKey(name));
  if (remembered !== null && ids.includes(remembered)) return remembered;
  return ids[0] ?? null;
}

function prune(marked: ReadonlySet<string>, ids: string[]): ReadonlySet<string> {
  const kept = [...marked].filter((id) => ids.includes(id));
  return kept.length === marked.size ? marked : new Set(kept);
}

export type { ViewsSlice };
export { createViewsSlice, resolveActiveView };
