/**
 * Which file is on screen. One field today, and it earns its slice by being the
 * IDENTITY the per-envelope memory hangs off: the remembered view is keyed by it,
 * and the statusbar prints it.
 *
 * The name is what the CLI will expose in V18; until then the session hands it
 * the conventional `zabloo.ir.json`. Learning the identity is what unlocks the
 * remembered selection, so it re-resolves the active view on the spot — the
 * session sets the identity before the first load, when `views` is still empty
 * and the answer is simply `null`, and `setViews` asks the same question again
 * the moment it has a list.
 */

import type { Getter, Setter } from "./state";
import type { PreviewStorage } from "./storage";
import { resolveActiveView } from "./views";

interface EnvelopeSlice {
  envelope: { name: string | null };
  setIdentity(name: string | null): void;
}

function createEnvelopeSlice(set: Setter, get: Getter, storage: PreviewStorage): EnvelopeSlice {
  return {
    envelope: { name: null },
    setIdentity: (name) => {
      if (get().envelope.name === name) return;
      // Set first, read second: the resolution below is about the NEW envelope's
      // memory, and `resolveActiveView` reads the identity from the state.
      set({ envelope: { name } });
      // A different file's selection means nothing here, so the current one is
      // deliberately not offered as a candidate.
      set({ activeView: resolveActiveView(get, storage, get().views, null) });
    },
  };
}

export type { EnvelopeSlice };
export { createEnvelopeSlice };
