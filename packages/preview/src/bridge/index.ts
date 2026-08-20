/**
 * The renderer bridge: everything the preview does that is not chrome.
 *
 * It is the pure half of `packages/cli/src/preview-client.ts` (ZAB-57), which
 * mixed this logic with DOM wiring by element `id`. Nothing here imports React,
 * zustand or the store — `EventSource`, `fetch` and `mount` all arrive as
 * arguments — so the dev loop's memory (the `Repeat` rule of the binding walk,
 * the asset cache keyed by content hash, the mount-vs-reload decision) can be
 * tested exactly as it was, and V6 is what joins it to the store.
 *
 * The CLI's copy stays live until V18 retires it; until then the two are the same
 * behavior in two places, on purpose.
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
export { formatStats, fpsWindow } from "./stats.js";
export { coerce, coerceTyped, show } from "./values.js";
export {
  fitScale,
  isViewportPreset,
  parseDpr,
  parseViewport,
  VIEWPORT_PRESETS,
  type Viewport,
  type ViewportPreset,
} from "./viewport.js";
