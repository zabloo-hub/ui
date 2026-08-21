/**
 * Whether what you are looking at is still the truth. Three states, and the
 * middle one is the whole point (ZAB-67): a save that did not make it onto the
 * canvas leaves the LAST GOOD RENDER on screen — never a blank canvas, never a
 * red overlay — and something has to say out loud that it is stale.
 *
 * - `live`        — the stream is up and the last export loaded.
 * - `stale`       — the server is reachable but the last export failed; the view
 *                   on screen is older than the file on disk.
 * - `disconnected`— the stream is gone (server stopped, network down).
 *
 * The order of the two axes matters, which is why `streamOpened` is not simply
 * "go live": a reconnect that lands while an export is still broken must not
 * paint the chrome green over a canvas that is provably out of date.
 */

import type { Getter, Setter } from "./state";

type ConnectionState = "live" | "stale" | "disconnected";

interface ConnectionSlice {
  connection: ConnectionState;
  /** The message of the failure that made it `stale`, for the statusbar and the log. */
  lastError: string | null;
  streamOpened(): void;
  streamLost(): void;
  exportFailed(message: string): void;
  exportLoaded(): void;
}

function createConnectionSlice(set: Setter, get: Getter): ConnectionSlice {
  return {
    connection: "disconnected",
    lastError: null,
    streamOpened: () => set({ connection: get().lastError === null ? "live" : "stale" }),
    streamLost: () => set({ connection: "disconnected" }),
    exportFailed: (message) => set({ connection: "stale", lastError: message }),
    exportLoaded: () => set({ connection: "live", lastError: null }),
  };
}

export type { ConnectionSlice, ConnectionState };
export { createConnectionSlice };
