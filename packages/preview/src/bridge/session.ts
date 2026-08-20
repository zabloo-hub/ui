/**
 * The mounted view and everything that has to survive a save: the data the panel
 * is holding, the handle on screen, and the decision between hot-swapping an
 * envelope and throwing the view away.
 *
 * Ported from `load`/`loadOrFail` in `packages/cli/src/preview-client.ts`, whose
 * shape is the accumulated answer to three bugs and is kept EXACTLY: the dispose
 * that happens before the mount (ZAB-67), the `sawFatal` that keeps a rejected
 * hot-update's report on screen, and the view ids read fresh after every load
 * (ZAB-72). What changed is only what it talks to — the CLI page wired itself to
 * DOM nodes by `id`, and this one reports through callbacks, so the store (V6)
 * can hold the state and React can render it.
 *
 * This module imports no framework and touches no DOM beyond the canvas it is
 * handed: `EventSource` lives in `./events.js`, and `fetch` and `mount` arrive
 * as arguments.
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

/** Everything the session reports; the chrome decides what to do with it. */
export interface SessionCallbacks {
  /**
   * A new envelope reached the session, with the paths it binds — before it is
   * put on screen, and whether or not the mount that follows succeeds. That is
   * where the CLI page rebuilt its panel, and the order matters: a view the
   * renderer refuses still tells you which data it wanted.
   */
  onEnvelope(envelope: Envelope, bindings: Binding[]): void;
  /** A view was mounted from scratch — the picker follows `viewIds`. */
  onMounted(viewIds: string[]): void;
  /**
   * The envelope was hot-swapped into the live view. `stale` says the update was
   * REFUSED (a fatal diagnostic arrived): the canvas is showing the previous
   * export, so whoever owns the error overlay must leave it up — clearing it here
   * would erase the only report of it (ZAB-67). The ids are synced either way,
   * because a refused update does not change what is mounted.
   */
  onReloaded(viewIds: string[], state: { stale: boolean }): void;
  /** A named action fired; from inside a repeated item it says WHICH one (ZAB-29). */
  onAction(action: string, context?: ActionContext): void;
  /** A control wrote its value back — already recorded for the next replay. */
  onDataChanged(path: string, value: unknown): void;
  /** An authoring diagnostic from the loading contract (ZAB-72). */
  onDiagnostic(diagnostic: Diagnostic): void;
  /** One painted frame, as the renderer reports it (ZAB-78). */
  onFrame(frame: FrameStats & { ms: number }): void;
  /** A load that never became a view, in the words to show. */
  onLoadError(message: string): void;
}

export interface SessionOptions {
  canvas: HTMLCanvasElement;
  /** The envelope the server published, or null while it has none to give. */
  fetchEnvelope: () => Promise<Envelope | null>;
  /** How the asset bytes are fetched; defaults to the page's own `fetch`. */
  fetchAsset?: FetchLike;
  mount: MountFn;
  /**
   * The ratio to rasterize at, read fresh on every load. It is fixed for the life
   * of a mount — the glyph atlases are built at it — so a change here is a
   * REMOUNT, which is why it is a getter and not a value: the session compares it
   * with what is on screen instead of being told to remount.
   */
  dpr: () => number | undefined;
  callbacks: SessionCallbacks;
}

/** The live preview, as the chrome (and the tests) get to drive it. */
export interface Session {
  /**
   * Fetches the envelope and puts it on screen: a reload when one is already
   * mounted, no view was asked for and the DPR has not moved; a fresh mount
   * otherwise. It never throws — see the note on the catch.
   */
  load(viewId?: string): Promise<void>;
  /** The mounted handle, or null before the first successful load. */
  handle(): ZablooHandle | null;
  /** Pushes a value into a bound path and keeps it for the next reload. */
  setData(path: string, value: unknown): void;
  /** The data the panel is holding, by path — what a reload replays. */
  values(): ReadonlyMap<string, unknown>;
  /** Drops the mounted view. */
  dispose(): void;
}

export function createSession(options: SessionOptions): Session {
  const { canvas, fetchEnvelope, fetchAsset, mount, dpr, callbacks } = options;

  let handle: ZablooHandle | null = null;
  /** The ratio the live view was mounted at — a change is a remount, not a reload. */
  let mountedDpr: number | undefined;
  /** Whether this load already reported a fatal — see the catch in `load`. */
  let sawFatal = false;

  // The preview plays the role of "the game": it discovers the envelope's
  // data-path bindings and offers inputs to push values (zabloo.setData). The
  // traffic runs both ways — controls write their value back (onDataChanged),
  // and the field shows it, which is the whole point of a two-way binding.
  const dataValues = new Map<string, unknown>();
  const assetData = new Map<string, string>();

  function setData(path: string, value: unknown): void {
    dataValues.set(path, value);
    handle?.setData(path, value);
  }

  // A control wrote its own value: keep it for the next reload and report it.
  // From inside a repeated item the path addresses the element
  // ("shop.items.3.fav") — same channel, no per-component API (ZAB-29).
  function onDataChanged(path: string, value: unknown): void {
    dataValues.set(path, value);
    callbacks.onDataChanged(path, value);
  }

  function onDiagnostic(diagnostic: Diagnostic): void {
    if (diagnostic.level === "fatal") sawFatal = true;
    callbacks.onDiagnostic(diagnostic);
  }

  function replayData(): void {
    for (const [path, value] of dataValues) handle?.setData(path, value);
  }

  // The preview plays the game's role here too (ZAB-37): a mount that refuses the
  // envelope must show WHY on the page — an uncaught rejection in the reload loop
  // would leave a canvas that simply stopped updating, which is the worst report
  // of all. reload() never throws, so this catches the first mount and the fetch.
  async function load(viewId?: string): Promise<void> {
    sawFatal = false;
    try {
      await loadOrFail(viewId);
    } catch (error) {
      // A refused envelope already reported itself through `onDiagnostic`, with
      // its code — repeating the exception's message would say it twice. This
      // path still covers what never becomes a diagnostic: the fetch, the JSON of
      // the response, the asset hydration.
      if (sawFatal) return;
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
    if (handle && viewId === undefined && ratio === mountedDpr) {
      handle.reload(json);
      replayData();
      // `reload` never throws: a refused hot-update comes back as a fatal
      // diagnostic and the previous view stays on screen. The view ids are read
      // fresh because a hot-update may add, drop or rename views (ZAB-72).
      callbacks.onReloaded([...handle.viewIds], { stale: sawFatal });
      return;
    }
    // Dropped BEFORE mounting, not after: a `mount` that throws — a view the
    // renderer refuses — used to leave `handle` pointing at the view it had just
    // disposed, and the next SSE reload called `reload()` on the dead one (ZAB-67).
    // Null means the next load remounts, which is what a broken view needs.
    if (handle) {
      handle.dispose();
      handle = null;
      window.zabloo = undefined;
    }
    handle = mount(canvas, json, {
      view: viewId,
      onAction: (action: string, context?: ActionContext) => callbacks.onAction(action, context),
      onDataChanged,
      onDiagnostic,
      // Fixed for the life of the mount — the atlases are rasterized at it — so
      // the picker remounts rather than trying to change it underneath.
      dpr: ratio,
      onFrame: (frame) => callbacks.onFrame(frame),
    });
    mountedDpr = ratio;
    // The public docs name it: the browser console drives the view through here.
    window.zabloo = handle;
    replayData();
    callbacks.onMounted([...handle.viewIds]);
  }

  return {
    load,
    handle: () => handle,
    setData,
    values: () => dataValues,
    dispose() {
      handle?.dispose();
      handle = null;
      window.zabloo = undefined;
    },
  };
}
