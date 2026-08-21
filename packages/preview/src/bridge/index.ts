/**
 * The renderer bridge: the pure half of `packages/cli/src/preview-client.ts`
 * (ZAB-57), which mixed this logic with DOM wiring by element `id`.
 *
 * Nothing here imports React, zustand or the store, and `EventSource`, `fetch`
 * and `mount` all arrive as arguments — V6 is what joins it to the store. The
 * CLI's copy stays live until V18 retires it.
 */

export { type FetchLike, hydrateAssets } from "./assets.js";
export { type Binding, type BindingType, collectBindings } from "./bindings.js";
export {
  connectEvents,
  type EventConnection,
  type EventHandlers,
  type EventSourceFactory,
  type EventSourceLike,
  type PreviewEvent,
  parseEvent,
} from "./events.js";
export {
  createSession,
  type MountFn,
  type Session,
  type SessionCallbacks,
  type SessionOptions,
} from "./session.js";
export { compact } from "./stats.js";
export { coerce, coerceTyped, show } from "./values.js";
