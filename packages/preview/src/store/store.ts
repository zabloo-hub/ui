/**
 * The store itself: eleven slices under one `create`, with the ★ fields — theme,
 * viewport, custom, dpr and the layout minus zen — persisted.
 *
 * Everything is persisted under ONE key (`zabloo.preview`) rather than the three
 * loose keys the old page wrote. Those are still honoured, in one direction: the
 * viewport slice seeds itself from them (`legacy.ts`) so an existing setup is not
 * lost, and this blob lands on top. See `legacy.ts` for why they are not deleted.
 *
 * `createPreviewStore` exists next to `useStore` because a module-level singleton
 * is untestable on the two things that matter most here — what actually reaches
 * storage, and what happens when storage refuses — and because a test that had to
 * reset a shared store between cases would eventually forget one field.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createActionsSlice } from "./actions";
import { createBindingsSlice } from "./bindings";
import { createConnectionSlice } from "./connection";
import { createEnvelopeSlice } from "./envelope";
import { createLayoutSlice, type Layout, mergeLayout } from "./layout";
import { type Dpr, isDpr, isPresetId, type PresetId, type Size } from "./presets";
import { createProblemsSlice } from "./problems";
import { createRuntimeSlice } from "./runtime";
import type { PreviewState } from "./state";
import { createStatsSlice } from "./stats";
import { browserStorage, type PreviewStorage, STORE_KEY, stateStorage } from "./storage";
import { createThemeSlice, isTheme, type Theme } from "./theme";
import { createViewportSlice } from "./viewport";
import { createViewsSlice } from "./views";

/** Exactly what goes to storage — a whitelist, because `runtime.canvas` exists. */
interface PersistedState {
  theme: Theme;
  viewport: { preset: PresetId };
  custom: Size;
  dpr: Dpr;
  layout: Omit<Layout, "zen">;
}

interface PreviewStoreOptions {
  /** Defaults to `localStorage`, wrapped so it cannot throw. */
  storage?: PreviewStorage;
  /**
   * The monotonic clock the fps window is measured on. Injectable because
   * `performance.now()` is not one of the things `vi.useFakeTimers` fakes by
   * default, and a test that has to sleep a real second is a test nobody runs.
   */
  now?: () => number;
}

function createPreviewStore(options: PreviewStoreOptions = {}) {
  const storage = options.storage ?? browserStorage();
  const now = options.now ?? (() => performance.now());

  return create<PreviewState>()(
    persist(
      (set, get) => ({
        ...createThemeSlice(set, get),
        ...createViewsSlice(set, get, storage),
        ...createViewportSlice(set, get, storage),
        ...createConnectionSlice(set, get),
        ...createBindingsSlice(set, get),
        ...createActionsSlice(set, get),
        ...createProblemsSlice(set, get),
        ...createStatsSlice(set, get, now),
        ...createLayoutSlice(set, get),
        ...createEnvelopeSlice(set, get, storage),
        ...createRuntimeSlice(set),
      }),
      {
        name: STORE_KEY,
        storage: createJSONStorage(() => stateStorage(storage)),
        partialize: (state): PersistedState => ({
          theme: state.theme,
          viewport: state.viewport,
          custom: state.custom,
          dpr: state.dpr,
          // Zen is session-only on purpose — see the docstring in `layout.ts`.
          layout: {
            panelOpen: state.layout.panelOpen,
            panelPos: state.layout.panelPos,
            consoleOpen: state.layout.consoleOpen,
            consoleTab: state.layout.consoleTab,
          },
        }),
        merge: mergePersisted,
      },
    ),
  );
}

/**
 * What the remembered blob is allowed to change, field by field.
 *
 * zustand's default merge is a shallow spread, which would be wrong twice over:
 * `layout` would arrive without its `zen` and overwrite the whole object, and a
 * blob edited by hand (it is a JSON string in a devtools panel, after all) could
 * put anything at all in a field the chrome then renders. Every value is checked
 * and anything unrecognizable falls back to the running default.
 */
function mergePersisted(persisted: unknown, current: PreviewState): PreviewState {
  const saved = persisted as Partial<PersistedState> | undefined;
  if (saved === undefined || saved === null) return current;
  const preset = saved.viewport?.preset;
  return {
    ...current,
    theme: isTheme(saved.theme) ? saved.theme : current.theme,
    viewport: { preset: isPresetId(preset) ? preset : current.viewport.preset },
    custom: isSize(saved.custom) ? saved.custom : current.custom,
    dpr: isDpr(saved.dpr) ? saved.dpr : current.dpr,
    layout: mergeLayout(current.layout, saved.layout),
  };
}

function isSize(value: unknown): value is Size {
  if (value === null || typeof value !== "object") return false;
  const size = value as Size;
  return Number.isFinite(size.width) && Number.isFinite(size.height);
}

/** The one the chrome uses. */
const useStore = createPreviewStore();

type PreviewStore = ReturnType<typeof createPreviewStore>;

export type { PersistedState, PreviewStore, PreviewStoreOptions };
export { createPreviewStore, mergePersisted, useStore };
