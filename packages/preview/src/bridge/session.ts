/**
 * The mounted view and everything that has to survive a save.
 *
 * A port of `load`/`loadOrFail` from `packages/cli/src/preview-client.ts`, whose
 * shape is the accumulated answer to three bugs and is kept exactly: the dispose
 * that happens before the mount (ZAB-67), the `sawFatal` that keeps a rejected
 * hot-update's report on screen, and the view ids read fresh after every load
 * (ZAB-72). What changed is only what it talks to — the CLI page wired itself to
 * DOM nodes by `id`, this one reports through callbacks.
 */

import type { ActionContext, Diagnostic, Envelope } from "@zabloo/format";
import type { FrameStats, MountOptions, ZablooHandle } from "@zabloo/renderer-web";
import { type FetchLike, hydrateAssets } from "./assets.js";
import { type Binding, collectBindings } from "./bindings.js";

declare global {
  interface Window {
    /** The live handle, so the console can drive the view: `zabloo.setData(...)`. */
    zabloo?: ZablooHandle;
  }
}

/** The renderer's `mount`, as the session is handed it (the IIFE build, or a fake). */
export type MountFn = (
  canvas: HTMLCanvasElement,
  envelope: string,
  options: MountOptions,
) => ZablooHandle;

export interface SessionCallbacks {
  /**
   * A new envelope arrived, with the paths it binds — before it goes on screen,
   * and whether or not the mount that follows succeeds: a view the renderer
   * refuses still tells you which data it wanted.
   */
  onEnvelope(envelope: Envelope, bindings: Binding[]): void;
  onMounted(viewIds: string[]): void;
  /**
   * The envelope was hot-swapped in. `stale` means the update was REFUSED and the
   * canvas is showing the previous export, so the error overlay must stay up —
   * clearing it would erase the only report of it (ZAB-67).
   */
  onReloaded(viewIds: string[], state: { stale: boolean }): void;
  onAction(action: string, context?: ActionContext): void;
  onDataChanged(path: string, value: unknown): void;
  onDiagnostic(diagnostic: Diagnostic): void;
  onFrame(frame: FrameStats & { ms: number }): void;
  onLoadError(message: string): void;
}

export interface SessionOptions {
  canvas: HTMLCanvasElement;
  /** The envelope the server published, or null while it has none to give. */
  fetchEnvelope: () => Promise<Envelope | null>;
  fetchAsset?: FetchLike;
  mount: MountFn;
  /**
   * The ratio to rasterize at, read fresh on every load. It is fixed for the life
   * of a mount — the atlases are built at it — so a change is a REMOUNT, which is
   * why the session reads it instead of being told.
   */
  dpr: () => number | undefined;
  callbacks: SessionCallbacks;
}

export interface Session {
  /**
   * Fetches the envelope and puts it on screen: a reload when one is mounted, no
   * view was asked for and the DPR has not moved; a fresh mount otherwise. It
   * never throws — see the note on the catch.
   */
  load(viewId?: string): Promise<void>;
  handle(): ZablooHandle | null;
  /** Pushes a value into a bound path and keeps it for the next reload. */
  setData(path: string, value: unknown): void;
  values(): ReadonlyMap<string, unknown>;
  dispose(): void;
}

export function createSession(options: SessionOptions): Session {
  const { canvas, fetchEnvelope, fetchAsset, mount, dpr, callbacks } = options;

  // The session's mutable state, in one slot object: a session outlives every
  // call on it, so this is genuinely state and not a value being folded.
  const live: {
    handle: ZablooHandle | null;
    /** The ratio the live view was mounted at — a change is a remount, not a reload. */
    mountedDpr: number | undefined;
    /** Whether this load already reported a fatal — see the catch in `load`. */
    sawFatal: boolean;
  } = { handle: null, mountedDpr: undefined, sawFatal: false };

  // The preview plays the role of "the game": it pushes values into bound paths,
  // and the traffic runs both ways — controls write their value back, which is
  // the whole point of a two-way binding.
  const dataValues = new Map<string, unknown>();
  const assetData = new Map<string, string>();

  function setData(path: string, value: unknown): void {
    dataValues.set(path, value);
    live.handle?.setData(path, value);
  }

  // From inside a repeated item the path addresses the element
  // ("shop.items.3.fav") — same channel, no per-component API (ZAB-29).
  function onDataChanged(path: string, value: unknown): void {
    dataValues.set(path, value);
    callbacks.onDataChanged(path, value);
  }

  function onDiagnostic(diagnostic: Diagnostic): void {
    if (diagnostic.level === "fatal") live.sawFatal = true;
    callbacks.onDiagnostic(diagnostic);
  }

  function replayData(): void {
    for (const [path, value] of dataValues) live.handle?.setData(path, value);
  }

  // A mount that refuses the envelope must say WHY (ZAB-37): an uncaught
  // rejection in the reload loop would leave a canvas that simply stopped
  // updating, which is the worst report of all.
  async function load(viewId?: string): Promise<void> {
    live.sawFatal = false;
    try {
      await loadOrFail(viewId);
    } catch (error) {
      // A refused envelope already reported itself through `onDiagnostic`, with
      // its code. This path covers what never becomes a diagnostic: the fetch,
      // the JSON of the response, the asset hydration.
      if (live.sawFatal) return;
      callbacks.onLoadError(
        `envelope error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function loadOrFail(viewId?: string): Promise<void> {
    const fetched = await fetchEnvelope();
    if (fetched === null) return;
    const envelope = await hydrateAssets(fetched, assetData, callbacks.onLoadError, fetchAsset);
    const json = JSON.stringify(envelope);
    callbacks.onEnvelope(envelope, collectBindings(envelope));
    const ratio = dpr();
    if (live.handle && viewId === undefined && ratio === live.mountedDpr) {
      live.handle.reload(json);
      replayData();
      // `reload` never throws: a refused hot-update comes back as a fatal
      // diagnostic and the previous view stays on screen. The ids are read fresh
      // because an update may add, drop or rename views (ZAB-72).
      callbacks.onReloaded([...live.handle.viewIds], { stale: live.sawFatal });
      return;
    }
    // Dropped BEFORE mounting, not after: a `mount` that throws used to leave
    // `handle` pointing at the view it had just disposed, and the next SSE reload
    // called `reload()` on the dead one (ZAB-67).
    if (live.handle) {
      live.handle.dispose();
      live.handle = null;
      window.zabloo = undefined;
    }
    live.handle = mount(canvas, json, {
      view: viewId,
      onAction: (action: string, context?: ActionContext) => callbacks.onAction(action, context),
      onDataChanged,
      onDiagnostic,
      dpr: ratio,
      onFrame: (frame) => callbacks.onFrame(frame),
    });
    live.mountedDpr = ratio;
    window.zabloo = live.handle;
    replayData();
    callbacks.onMounted([...live.handle.viewIds]);
  }

  return {
    load,
    handle: () => live.handle,
    setData,
    values: () => dataValues,
    dispose() {
      live.handle?.dispose();
      live.handle = null;
      window.zabloo = undefined;
    },
  };
}
