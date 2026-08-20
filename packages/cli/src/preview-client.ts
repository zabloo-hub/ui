/**
 * The code the `zabloo dev` preview page runs (ZAB-57, extracted from the HTML
 * template string in `preview-server.ts`). It used to live inside a template
 * literal, where TypeScript, biome and vitest could not see any of it — ~190
 * lines of non-trivial logic (the bind-path walk with its `Repeat` rule, the
 * asset cache keyed by content hash, the mount/reload decision) that nothing
 * ever executed in CI. It is a module now: typed, linted and tested.
 *
 * Its job is to play the GAME's role against the renderer. The preview is not a
 * viewer — it is the third target's host process: it pushes data into bound
 * paths, receives what controls write back, and swaps envelopes on every save.
 * Everything the page does, a real game does through the same API.
 *
 * Importing this starts nothing: the page calls `start()`, and so do the tests.
 */

import type { ActionContext, AssetEntry, Diagnostic, Envelope } from "@zabloo/format";
import type { FrameStats, MountOptions, ZablooHandle } from "@zabloo/renderer-web";
import type { PreviewEvent } from "./preview-server.js";

/**
 * The renderer's IIFE build, which the page loads as a classic script (`/renderer.js`)
 * before this module. Module scripts are deferred, so it is always there by now.
 */
declare const ZablooRenderer: {
  mount(canvas: HTMLCanvasElement, envelope: string, options?: MountOptions): ZablooHandle;
};

declare global {
  interface Window {
    /** The live handle, so the console can drive the view: `zabloo.setData(...)`. */
    zabloo?: ZablooHandle;
  }
}

/** How long a line stays in the action log. */
const LOG_MS = 6000;

/** How often the stats badge redraws — it must fall to "idle" on its own. */
const STATS_MS = 250;

/**
 * The size a view is laid out at, which stopped being the window's (ZAB-78). The
 * canvas was `flex: 1` and took whatever the window gave it, so a UI authored for
 * 1080p could not be looked at in 720p without resizing the browser — and there is
 * no window shape at all that answers "how does this read on a console at 4K".
 */
type Viewport = { fixed: false } | { fixed: true; width: number; height: number };

/** The picker's value, plus whatever is in the custom box, as one viewport. */
function parseViewport(preset: string, custom: string): Viewport {
  if (preset === "fit") return { fixed: false };
  const source = preset === "custom" ? custom : preset;
  const match = /^\s*(\d{1,5})\s*[x×*]\s*(\d{1,5})\s*$/.exec(source);
  if (match === null) return { fixed: false };
  const width = Number(match[1]);
  const height = Number(match[2]);
  // A half-typed "160" is not an error to shout about — it is a box mid-edit, and
  // falling back to fitting the window keeps something on screen while you type.
  if (width < 1 || height < 1) return { fixed: false };
  return { fixed: true, width, height };
}

/**
 * How far a fixed viewport has to shrink to fit the stage. Never above 1: a 720p
 * view blown up to fill a 4K monitor would be showing you resampling, not your UI.
 */
function fitScale(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): number {
  if (!(width > 0 && height > 0 && availableWidth > 0 && availableHeight > 0)) return 1;
  return Math.min(1, availableWidth / width, availableHeight / height);
}

/** The DPR picker's value: a number to force, or undefined for the browser's own. */
function parseDpr(value: string): number | undefined {
  const dpr = Number(value);
  return Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 8) : undefined;
}

/**
 * What the last painted frame cost, as the badge shows it. `stats()` has been on
 * the handle all along and was reachable only by typing `zabloo.stats()` into the
 * console — which is exactly when you are not looking at the screen (ZAB-78).
 *
 * `idle` rather than `0 fps` because the renderer paints ON DEMAND: a still scene
 * painting nothing is the system working, not a stall.
 */
function formatStats(frame: (FrameStats & { ms: number }) | null, fps: number): string {
  if (frame === null) return "no frame painted yet";
  return [
    fps > 0 ? `${fps} fps` : "idle",
    `${frame.ms.toFixed(2)} ms`,
    `${frame.drawCalls} draws`,
    `${compact(frame.vertices)} verts`,
    `${frame.atlases} atlas ${(frame.atlasBytes / 1048576).toFixed(1)} MB`,
    frame.repaintOnly ? "repaint only" : `${frame.resolved} resolved`,
  ].join(" · ");
}

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/**
 * Preferences that outlive the page. The preset you are working at is a property
 * of the SCREEN you are designing, not of the tab, so losing it on every reload —
 * and the dev loop reloads on every save — would make the picker unusable.
 * Storage can be denied (private mode, a sandboxed frame); the preview works
 * without it, so nothing here may throw.
 */
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`zabloo.preview.${key}`, value);
  } catch {}
}

function recall(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`zabloo.preview.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Every data path the envelope BINDS — the ones the game is expected to push.
 *
 * Inside a `Repeat` template the paths are RELATIVE to the item (`"item.name"`):
 * they are addresses into the array, not values anyone pushes, so the template
 * child is skipped. Everything else about the Repeat is walked — its bound
 * array, its own `visible`, and the empty state, all of which the game does feed.
 */
function collectBindPaths(node: unknown, paths: Set<string> = new Set()): Set<string> {
  if (node === null || typeof node !== "object") return paths;
  const record = node as Record<string, unknown>;
  if (typeof record.bind === "string") paths.add(record.bind);
  if (record.type === "Repeat") {
    const { children, ...rest } = record;
    for (const value of Object.values(rest)) collectBindPaths(value, paths);
    const empty = Array.isArray(children) ? children.slice(1) : [];
    for (const child of empty) collectBindPaths(child, paths);
    return paths;
  }
  for (const value of Object.values(record)) collectBindPaths(value, paths);
  return paths;
}

/**
 * Reads a panel field as the value the game would have pushed. Arrays and
 * objects are values like any other since ZAB-29 — a list is fed by pushing its
 * array — so JSON is parsed; anything that does not parse stays the text the
 * person typed, because a half-written array is not an error worth shouting about.
 */
function coerce(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

/** How a value written back by a control is shown in its field and in the log. */
function show(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * Puts the asset bytes back into the manifest. They travel apart from the tree
 * (ZAB-14): the page keeps everything it has already fetched, keyed by content
 * hash — the bytes behind a hash never change — so a save only re-transfers what
 * actually changed, and the renderer still receives a COMPLETE envelope.
 *
 * An asset the server cannot serve is reported and left without bytes rather
 * than failing the reload: the rest of the view is still worth showing.
 */
async function hydrateAssets(
  envelope: Envelope,
  cache: Map<string, string>,
  report: (message: string) => void,
): Promise<Envelope> {
  const entries: AssetEntry[] = Object.values(envelope.assets ?? {});
  await Promise.all(
    entries.map(async (entry) => {
      if (typeof entry.data === "string") {
        cache.set(entry.hash, entry.data);
        return;
      }
      const data = cache.get(entry.hash) ?? (await fetchAssetData(entry.hash));
      if (data === null) {
        report(`asset unavailable: ${entry.hash.slice(0, 8)}`);
        return;
      }
      cache.set(entry.hash, data);
      entry.data = data;
    }),
  );
  return envelope;
}

/** An asset's base64 payload from the server, or `null` if it is not there. */
async function fetchAssetData(hash: string): Promise<string | null> {
  const res = await fetch(`/asset/${hash}`);
  return res.ok ? await res.text() : null;
}

/** The running preview page, as the tests (and the console) get to drive it. */
interface PreviewClient {
  /** The load `start()` kicked off — the page ignores it, a test waits on it. */
  ready: Promise<void>;
  /**
   * Fetches the envelope on the server and puts it on screen: a reload when one
   * is already mounted and no view was asked for, a fresh mount otherwise. It
   * never throws — see the note on the catch.
   */
  load(viewId?: string): Promise<void>;
  /** The mounted handle, or null before the first successful load. */
  handle(): ZablooHandle | null;
  /** The data the panel is holding, by path — what a reload replays. */
  values(): ReadonlyMap<string, string>;
  /** Drops the live connection and the mounted view. */
  stop(): void;
}

/**
 * Reads one SSE frame. Anything unrecognizable is treated as "something changed,
 * go look": a reload is the harmless answer, and a page that ignored a frame it
 * could not parse would silently stop updating.
 */
function parseEvent(data: string): PreviewEvent {
  try {
    const parsed = JSON.parse(data) as PreviewEvent;
    if (parsed.kind === "error" && typeof parsed.message === "string") return parsed;
  } catch {}
  return { kind: "reload" };
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`zabloo preview: no #${id} in the page`);
  return found as T;
}

/** Wires the page up and kicks off the first load. */
function start(): PreviewClient {
  const canvas = element<HTMLCanvasElement>("canvas");
  const stage = element("stage");
  const views = element<HTMLSelectElement>("views");
  const viewport = element<HTMLSelectElement>("viewport");
  const custom = element<HTMLInputElement>("custom");
  const dprPicker = element<HTMLSelectElement>("dpr");
  const status = element("status");
  const logBox = element("log");
  const errorBox = element("error");
  const panel = element("data");
  const fields = element("fields");
  const padBadge = element("pad");
  const statsToggle = element<HTMLButtonElement>("stats-toggle");
  const statsBox = element("stats");

  /** The mounted view, and whether this load already reported a fatal. */
  const live: { handle: ZablooHandle | null; sawFatal: boolean } = {
    handle: null,
    sawFatal: false,
  };

  function log(message: string): void {
    const line = document.createElement("div");
    line.textContent = message;
    logBox.prepend(line);
    setTimeout(() => line.remove(), LOG_MS);
  }

  /**
   * A save that did not make it onto the canvas, said out loud (ZAB-67): the view
   * on screen is now STALE, and nothing else here would admit it — a log line
   * fades, and the status dot only knew about the connection. The overlay stays
   * until an export lands, and the dot goes red meanwhile.
   */
  function showError(message: string): void {
    errorBox.textContent = message;
    errorBox.classList.remove("empty");
    status.classList.add("err");
  }

  function clearError(): void {
    errorBox.textContent = "";
    errorBox.classList.add("empty");
    status.classList.remove("err");
  }

  /**
   * Authoring errors, straight from the validator (ZAB-72). The preview used to
   * have no access to these at all: they were console lines, and a page cannot
   * read its own console — so the export you were looking at could be missing
   * half its nodes with nothing on screen admitting it.
   *
   * The two levels get the two presentations the page already has, because they
   * mean different things: a `warn` was REPAIRED — what is on the canvas is
   * correct, minus the broken node — so it takes a log line that fades. A `fatal`
   * means nothing loaded and the view is stale: overlay, and the red dot, the
   * same report a failed save gets (ZAB-67).
   */
  function onDiagnostic(diagnostic: Diagnostic): void {
    // The message already names the path, the field and the reason; the code is
    // the stable identity, worth showing next to it.
    const line = `[${diagnostic.code}] ${diagnostic.message}`;
    log(line);
    if (diagnostic.level === "fatal") {
      live.sawFatal = true;
      showError(line);
    }
  }

  // The preview plays the role of "the game": it discovers the envelope's
  // data-path bindings and offers inputs to push values (zabloo.setData). The
  // traffic runs both ways — controls write their value back (onDataChanged),
  // and the field shows it, which is the whole point of a two-way binding.
  const dataValues = new Map<string, string>();
  const dataInputs = new Map<string, HTMLInputElement>();

  function buildDataPanel(envelope: Envelope): void {
    const paths = collectBindPaths(envelope);
    panel.classList.toggle("empty", paths.size === 0);
    fields.innerHTML = "";
    dataInputs.clear();
    for (const path of [...paths].sort()) {
      const label = document.createElement("label");
      label.textContent = path;
      const input = document.createElement("input");
      input.placeholder = "value or JSON…";
      const held = dataValues.get(path);
      if (held !== undefined) input.value = held;
      input.addEventListener("input", () => {
        dataValues.set(path, input.value);
        live.handle?.setData(path, coerce(input.value));
      });
      dataInputs.set(path, input);
      fields.append(label, input);
    }
  }

  // A control wrote its own value: keep it for the next reload and show it. From
  // inside a repeated item the path addresses the element ("shop.items.3.fav") —
  // same channel, no per-component API (ZAB-29).
  function onDataChanged(path: string, value: unknown): void {
    const text = show(value);
    dataValues.set(path, text);
    const input = dataInputs.get(path);
    if (input) input.value = text;
    log(`${path} = ${text}`);
  }

  function replayData(): void {
    for (const [path, value] of dataValues) live.handle?.setData(path, coerce(value));
  }

  const assetData = new Map<string, string>();

  // The preview plays the game's role here too (ZAB-37): a mount that refuses the
  // envelope must show WHY on the page — an uncaught rejection in the reload loop
  // would leave a canvas that simply stopped updating, which is the worst report
  // of all. reload() never throws, so this catches the first mount and the fetch.
  async function load(viewId?: string): Promise<void> {
    live.sawFatal = false;
    try {
      await loadOrFail(viewId);
    } catch (error) {
      // A refused envelope already reported itself through `onDiagnostic`, with
      // its code — repeating the exception's message would say it twice. This
      // path still covers what never becomes a diagnostic: the fetch, the JSON of
      // the response, the asset hydration.
      if (live.sawFatal) return;
      const message = `envelope error: ${error instanceof Error ? error.message : String(error)}`;
      log(message);
      showError(message);
    }
  }

  async function loadOrFail(viewId?: string): Promise<void> {
    const res = await fetch("/envelope");
    if (!res.ok) return;
    const envelope = await hydrateAssets((await res.json()) as Envelope, assetData, log);
    const json = JSON.stringify(envelope);
    buildDataPanel(envelope);
    if (live.handle && viewId === undefined) {
      live.handle.reload(json);
      replayData();
      syncViewOptions(live.handle);
      // `reload` never throws: a refused hot-update comes back as a fatal
      // diagnostic and the previous view stays on screen. Clearing the overlay
      // here would erase the only report of it — the canvas IS stale now.
      if (!live.sawFatal) clearError();
      return;
    }
    // Dropped BEFORE mounting, not after: a `mount` that throws — a view the
    // renderer refuses — used to leave `handle` pointing at the view it had just
    // disposed, and the next SSE reload called `reload()` on the dead one (ZAB-67).
    // Null means the next load remounts, which is what a broken view needs.
    if (live.handle) {
      live.handle.dispose();
      live.handle = null;
      window.zabloo = undefined;
    }
    live.handle = ZablooRenderer.mount(canvas, json, {
      view: viewId,
      // An action from inside a row carries the item it fired from (ZAB-29).
      onAction: (action: string, context?: ActionContext) =>
        log(context ? `${action} → ${context.path} (#${context.index})` : `action: ${action}`),
      onDataChanged,
      onDiagnostic,
      // Fixed for the life of the mount — the atlases are rasterized at it — so
      // the picker remounts rather than trying to change it underneath.
      dpr: parseDpr(dprPicker.value),
      onFrame: recordFrame,
    });
    window.zabloo = live.handle;
    replayData();
    syncViewOptions(live.handle);
    clearError();
  }

  /**
   * The view picker against the envelope on screen. `viewIds` is read fresh here
   * because a hot-update may add, drop or rename views (ZAB-72) — the picker used
   * to be filled once, on mount, and a save that added a view left it invisible
   * until the page was reloaded by hand.
   */
  function syncViewOptions(live: ZablooHandle): void {
    const ids = live.viewIds;
    const shown = [...views.options].map((option) => option.value);
    if (shown.length === ids.length && shown.every((id, i) => id === ids[i])) return;
    const selected = views.value;
    views.innerHTML = "";
    for (const id of ids) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      views.append(option);
    }
    // Keep the view the user picked selected across the rebuild; if the update
    // dropped it, the renderer already fell back to the first one.
    if (ids.includes(selected)) views.value = selected;
  }

  views.addEventListener("change", () => {
    void load(views.value);
  });

  // The viewport the view is laid out at. Under a preset the canvas keeps its
  // declared pixel size — `clientWidth` is layout and a `transform` is paint, so
  // the renderer goes on measuring the full 1920 while the screen shows it
  // shrunk — and only the scale changes when the window does.
  function applyViewport(notify: boolean): void {
    const size = parseViewport(viewport.value, custom.value);
    custom.classList.toggle("off", viewport.value !== "custom");
    stage.classList.toggle("framed", size.fixed);
    if (!size.fixed) {
      canvas.style.width = "";
      canvas.style.height = "";
      canvas.style.transform = "";
    } else {
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      canvas.style.transform = `scale(${fitScale(size.width, size.height, stage.clientWidth, stage.clientHeight)})`;
    }
    // Only when the LOGICAL size moved: the renderer listens for `resize` itself,
    // and re-firing it on every window resize would have the two of us bouncing
    // the same event back and forth.
    if (notify) globalThis.dispatchEvent(new Event("resize"));
  }

  function onWindowResize(): void {
    // The logical size is unchanged — only how much of it fits on screen.
    applyViewport(false);
  }

  viewport.value = recall("viewport", "fit");
  custom.value = recall("custom", "");
  dprPicker.value = recall("dpr", "auto");
  viewport.addEventListener("change", () => {
    remember("viewport", viewport.value);
    applyViewport(true);
  });
  custom.addEventListener("input", () => {
    remember("custom", custom.value);
    applyViewport(true);
  });
  dprPicker.addEventListener("change", () => {
    remember("dpr", dprPicker.value);
    // A remount, not a reload: passing a view id is what forces one, and the
    // glyph atlases have to be rebuilt at the new scale.
    void load(views.value || undefined);
  });
  globalThis.addEventListener("resize", onWindowResize);
  applyViewport(false);

  // The stats badge (ZAB-78). Frames are counted as the renderer reports them —
  // it paints on demand, so the page's own rAF would be measuring the page.
  const stats: {
    last: (FrameStats & { ms: number }) | null;
    painted: number[];
    timer?: ReturnType<typeof setInterval>;
  } = { last: null, painted: [] };

  function recordFrame(frame: FrameStats & { ms: number }): void {
    stats.last = frame;
    stats.painted.push(performance.now());
  }

  function drawStats(): void {
    const cutoff = performance.now() - 1000;
    stats.painted = stats.painted.filter((at) => at >= cutoff);
    statsBox.textContent = formatStats(stats.last, stats.painted.length);
  }

  function showStats(on: boolean): void {
    statsToggle.classList.toggle("on", on);
    statsBox.classList.toggle("empty", !on);
    clearInterval(stats.timer);
    stats.timer = undefined;
    if (!on) return;
    drawStats();
    stats.timer = setInterval(drawStats, STATS_MS);
  }

  statsToggle.addEventListener("click", () => {
    const on = !statsToggle.classList.contains("on");
    remember("stats", on ? "on" : "off");
    showStats(on);
  });
  showStats(recall("stats", "off") === "on");

  // Gamepad indicator (ZAB-47). The renderer polls the pad itself; the page only
  // says whether there is one, so console navigation can be told apart from a
  // controller the browser has not seen yet — it reports none until the first
  // button press, which is the API's own rule, not a bug in the preview.
  function syncPad(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const connected = [...pads].some((pad) => pad?.connected);
    padBadge.classList.toggle("off", !connected);
  }
  window.addEventListener("gamepadconnected", syncPad);
  window.addEventListener("gamepaddisconnected", syncPad);
  syncPad();

  const events = new EventSource("/events");
  events.onopen = () => status.classList.add("ok");
  events.onerror = () => status.classList.remove("ok");
  events.onmessage = (event: MessageEvent<string>) => {
    const payload = parseEvent(event.data);
    if (payload.kind === "error") {
      showError(payload.message);
      return;
    }
    void load();
  };

  return {
    ready: load(),
    load,
    handle: () => live.handle,
    values: () => dataValues,
    stop() {
      events.close();
      window.removeEventListener("gamepadconnected", syncPad);
      window.removeEventListener("gamepaddisconnected", syncPad);
      globalThis.removeEventListener("resize", onWindowResize);
      clearInterval(stats.timer);
      live.handle?.dispose();
      live.handle = null;
    },
  };
}

export type { PreviewClient, Viewport };
export {
  coerce,
  collectBindPaths,
  fitScale,
  formatStats,
  hydrateAssets,
  parseDpr,
  parseEvent,
  parseViewport,
  show,
  start,
};
