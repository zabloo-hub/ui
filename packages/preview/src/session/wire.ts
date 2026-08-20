/**
 * The join: the bridge on one side, the store on the other, and this in the
 * middle. The bridge knows nothing about the store and the store knows nothing
 * about the renderer — everything that makes the canvas move is here.
 *
 * It is a plain function rather than a hook so the wiring can be read (and
 * driven) without React in the way; `useSession` is the two lines that mount it.
 *
 * The traffic runs in both directions. Down: every callback of a live view lands
 * as a write to a slice — the views it declares, the paths it binds, what the
 * validator said, what a control wrote back, what the last frame cost. Up: the
 * view on screen follows the store — a different `activeView` or `dpr` is a
 * remount, an edited binding is a `setData`.
 */

import type { Envelope } from "@zabloo/format";
import { mount as mountRenderer } from "@zabloo/renderer-web";
import {
  coerceTyped,
  connectEvents,
  createSession,
  type EventSourceFactory,
  type MountFn,
  type Session,
  type SessionCallbacks,
} from "@/bridge";
import { type Dpr, EXPORT_FAILED, type PreviewState, type Problem, useStore } from "@/store";
import {
  actionLine,
  DEFAULT_ENVELOPE_NAME,
  dprOf,
  NAME_HEADER,
  problemOf,
  viewLine,
  writeLine,
} from "./translate";

/** What `zabloo dev` publishes, and the stream that says it published again. */
const ENVELOPE_URL = "/envelope";
const EVENTS_URL = "/events";

/** What a refused hot-update says when its fatal carried no message of its own. */
const REFUSED = "the export was refused";

/**
 * The bit of `fetch` this needs: the envelope's headers and JSON, an asset's
 * text. Narrowed to an interface so a test serves the dev server without
 * building `Response` objects.
 */
interface HttpResponse {
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type Http = (url: string) => Promise<HttpResponse>;

/**
 * Everything a browser provides and a test does not. The defaults are the real
 * ones, so `useSession()` in the app takes no arguments.
 */
interface SessionDeps {
  http?: Http;
  mount?: MountFn;
  openEvents?: EventSourceFactory;
}

interface Wiring {
  dispose(): void;
}

/** What the live view was asked to be — see `drain`. */
interface Applied {
  view: string | null;
  dpr: Dpr;
}

function wireSession(deps: SessionDeps = {}): Wiring {
  const http = deps.http ?? ((url: string) => fetch(url) as unknown as Promise<HttpResponse>);
  const mount = deps.mount ?? mountRenderer;
  const state = (): PreviewState => useStore.getState();

  // One slot object for what genuinely is state: a wiring outlives every call on
  // it, and the store is not the place for any of it — this is bookkeeping about
  // the canvas, not something the chrome renders.
  const live: {
    session: Session | null;
    /** In flight; the callbacks below run inside it, and so must not re-enter. */
    loading: boolean;
    /** What the mount on screen was asked for, or null while there is none. */
    applied: Applied | null;
    /** A save arrived and has not been picked up yet. */
    reload: boolean;
    /** The problems of the export being loaded — replaced per load, never appended. */
    problems: Problem[];
    /** The first fatal of this load, which is what makes a refused reload stale. */
    fatal: string | null;
  } = {
    session: null,
    loading: false,
    applied: null,
    reload: false,
    problems: [],
    fatal: null,
  };

  /**
   * The envelope the server is publishing, and WHICH file it is. The identity is
   * learned here, before anything else in the load: the remembered view hangs off
   * it, and `setViews` is about to ask which view to show.
   */
  async function fetchEnvelope(): Promise<Envelope | null> {
    const res = await http(ENVELOPE_URL);
    if (!res.ok) return null;
    state().setIdentity(res.headers.get(NAME_HEADER) ?? DEFAULT_ENVELOPE_NAME);
    return (await res.json()) as Envelope;
  }

  function report(problem: Problem): void {
    live.problems = [...live.problems, problem];
    state().replaceProblems(live.problems);
  }

  /**
   * What both endings of a load share: the views it brought and what it found.
   *
   * It also corrects `applied` to the view that is actually ON SCREEN, which is
   * the one we asked for — or, when we asked for nothing, the renderer's own
   * fallback: the first one. Without that correction the load that asked for
   * nothing would look like it had missed its target the moment `setViews`
   * resolved `activeView`, and every mount would remount itself once.
   */
  function settle(viewIds: string[], loaded: boolean): void {
    const shown = live.applied?.view ?? viewIds[0] ?? null;
    if (live.applied !== null) live.applied = { ...live.applied, view: shown };
    state().setViews(viewIds);
    state().replaceProblems(live.problems);
    if (loaded && shown !== null) state().appendAction("view", viewLine(shown));
  }

  const callbacks: SessionCallbacks = {
    onEnvelope(_envelope, bindings) {
      // A load says everything it has to say about ONE export: the diagnostics of
      // the previous one describe a file that no longer exists.
      live.problems = [];
      live.fatal = null;
      state().clearFatalViews();
      // Declared before the mount and not after it, which is what V5 reports this
      // early for: a view the renderer refuses still tells you which data it wanted.
      state().declare(bindings);
    },

    onMounted(viewIds) {
      settle(viewIds, true);
      state().exportLoaded();
    },

    onReloaded(viewIds, { stale }) {
      settle(viewIds, !stale);
      // A refused hot-update leaves the PREVIOUS export on the canvas (ZAB-67).
      // Calling it live would paint the chrome green over a view that is provably
      // older than the file on disk.
      if (stale) state().exportFailed(live.fatal ?? REFUSED);
      else state().exportLoaded();
    },

    onAction(action, context) {
      state().appendAction("action", actionLine(action, context));
    },

    onDataChanged(path, value) {
      // A control wrote its own value: the panel shows it and says who wrote it.
      state().setFromUI(path, value);
      state().appendAction("write", writeLine(path, value));
    },

    onDiagnostic(diagnostic) {
      const problem = problemOf(diagnostic);
      report(problem);
      if (problem.severity !== "fatal") return;
      live.fatal = live.fatal ?? diagnostic.message;
      if (problem.view !== undefined) state().markFatalView(problem.view);
    },

    onFrame(frame) {
      state().recordFrame({
        frameMs: frame.ms,
        drawCalls: frame.drawCalls,
        vertices: frame.vertices,
        atlases: frame.atlases,
        atlasBytes: frame.atlasBytes,
        resolved: frame.resolved,
        repaintOnly: frame.repaintOnly,
      });
    },

    onLoadError(message) {
      // The case that never becomes a diagnostic — the fetch, its JSON, an asset
      // the server could not serve. It is reported as a fatal of our own so the
      // tab, the badge and the veil all learn about it through one channel.
      report({ severity: "fatal", code: EXPORT_FAILED, path: "", reason: message });
      state().exportFailed(message);
    },
  };

  /**
   * Loads until the canvas agrees with the store, one load at a time.
   *
   * The queue is not ceremony: `setViews` moves `activeView` from INSIDE a load —
   * it resolves the remembered view the moment it knows the ids — so a wiring
   * that reacted to every change as it happened would remount itself. `applied`
   * is what is on screen (see `settle`), so the loop runs until the canvas and the
   * store name the same view at the same ratio: the very first load asks for
   * nothing and gets the first view, and one remount is what reaching the view
   * this envelope remembered costs.
   */
  async function drain(): Promise<void> {
    const session = live.session;
    if (session === null) return;
    const want: Applied = { view: state().activeView, dpr: state().dpr };
    if (live.applied === null || want.view !== live.applied.view || want.dpr !== live.applied.dpr) {
      live.applied = want;
      // A fresh load is newer than any save waiting to be picked up.
      live.reload = false;
      // Asking for a view is what forces a REMOUNT, which is what a new view and
      // a new DPR both need — the atlases are rasterized at the ratio of the mount.
      await session.load(want.view ?? undefined);
      return drain();
    }
    if (live.reload) {
      live.reload = false;
      // No view asked for and the DPR has not moved: the envelope is hot-swapped
      // into the live view and the values are replayed into it.
      await session.load();
      return drain();
    }
  }

  async function pump(): Promise<void> {
    if (live.loading) return;
    live.loading = true;
    try {
      await drain();
    } finally {
      live.loading = false;
    }
  }

  /**
   * What the panel typed, on its way into the view. Only the editor's own writes:
   * a value that came FROM the view is already in it, and pushing it back would
   * be an echo. `coerceTyped` is what reads an editor that knows what it edits —
   * a typed value passes through untouched, and text is read as its type.
   */
  function push(next: PreviewState, previous: PreviewState): void {
    const session = live.session;
    if (session === null) return;
    for (const [path, binding] of Object.entries(next.bindings.byPath)) {
      const held = previous.bindings.byPath[path];
      if (binding.lastWriteFrom !== "editor" || binding.value === held?.value) continue;
      session.setData(path, coerceTyped(binding.type, binding.value));
    }
  }

  /** The Stage registered its canvas: this is the moment there is a view to have. */
  function open(canvas: HTMLCanvasElement): void {
    live.session = createSession({
      canvas,
      fetchEnvelope,
      fetchAsset: http,
      mount,
      // Read fresh on every load rather than passed in: it is fixed for the life
      // of a mount, so a change is a remount and the session has to see the new one.
      dpr: () => dprOf(state().dpr),
      callbacks,
    });
    live.applied = null;
    void pump();
  }

  function close(): void {
    live.session?.dispose();
    live.session = null;
    live.applied = null;
  }

  const unsubscribe = useStore.subscribe((next, previous) => {
    if (next.runtime.canvas !== previous.runtime.canvas) {
      close();
      if (next.runtime.canvas !== null) open(next.runtime.canvas);
    }
    if (next.bindings !== previous.bindings) push(next, previous);
    if (next.activeView !== previous.activeView || next.dpr !== previous.dpr) void pump();
  });

  const events = connectEvents(
    EVENTS_URL,
    {
      onOpen: () => state().streamOpened(),
      onLost: () => state().streamLost(),
      onReload: () => {
        live.reload = true;
        void pump();
      },
      onError: (message) => {
        // The export FAILED: what is on the canvas is now older than the file on
        // disk, and nothing else here would admit it (ZAB-67). The view stays.
        state().exportFailed(message);
        state().addExportFailure(message);
      },
    },
    deps.openEvents,
  );

  const canvas = state().runtime.canvas;
  if (canvas !== null) open(canvas);

  return {
    dispose() {
      events.close();
      unsubscribe();
      close();
    },
  };
}

export type { Http, HttpResponse, SessionDeps, Wiring };
export { wireSession };
