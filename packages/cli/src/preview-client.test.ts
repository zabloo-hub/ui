// @vitest-environment jsdom
/**
 * The preview page's behavior (ZAB-57). None of this was covered while the code
 * lived inside a template string, and it is not decoration: the page is the
 * GAME's side of the dev loop — the walk that decides which data paths a project
 * even offers, the cache that keeps a save from re-sending every image, and the
 * mount/reload decision that separates "hot-swap the envelope" from "throw the
 * view away".
 *
 * The DOM is real (jsdom) and wired from the very markup the server serves, so a
 * renamed id fails here. What is stubbed is what a headless test cannot have: the
 * WebGL renderer (`ZablooRenderer`), the HTTP server behind `fetch`, and the SSE
 * stream — all three are contracts the page CONSUMES, and stubbing them is what
 * lets the assertions be about the page.
 */

import type { Envelope } from "@zabloo/format";
import type { MountOptions, ZablooHandle } from "@zabloo/renderer-web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerce,
  collectBindPaths,
  fitScale,
  formatStats,
  hydrateAssets,
  type PreviewClient,
  parseDpr,
  parseEvent,
  parseViewport,
  start,
} from "./preview-client.js";
import { PREVIEW_BODY, type PreviewEvent } from "./preview-server.js";

/** A mount, as the page made it — what the renderer would have been asked for. */
interface Mount {
  envelope: Envelope;
  options: MountOptions;
  handle: FakeHandle;
}

interface FakeHandle extends ZablooHandle {
  readonly data: Array<[string, unknown]>;
  readonly reloads: string[];
  disposed: boolean;
}

/**
 * Everything the fakes below write to and the assertions read back. One slot each
 * on a `const` holder, reset in `beforeEach` — the page under test drives them
 * from the outside, so they cannot be values a test owns.
 */
const fake: {
  mounts: Mount[];
  client: PreviewClient | null;
  /** Replies `fetch` is programmed with, by URL. */
  routes: Map<string, { ok: boolean; body: string }>;
  fetches: string[];
  /** The SSE stream the page opened, so a test can push a reload down it. */
  stream: FakeEventSource | null;
  /** Thrown by the next `mount` when set — the "envelope the renderer refuses" case. */
  mountError: Error | null;
  /** jsdom serves the page from an opaque origin, where `localStorage` is absent. */
  storage: Map<string, string>;
} = {
  mounts: [],
  client: null,
  routes: new Map(),
  fetches: [],
  stream: null,
  mountError: null,
  storage: new Map(),
};

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    fake.stream = this;
  }
  close(): void {
    this.closed = true;
  }
}

/** What the dev loop pushes down the stream, as the page receives it. */
function push(event: PreviewEvent): void {
  fake.stream?.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
}

function fakeHandle(envelope: Envelope): FakeHandle {
  // The envelope currently mounted: `reload()` swaps it, and `viewIds` is a
  // getter that has to see the swap.
  const mounted = { envelope };
  const handle = {
    // A getter, like the real handle's since ZAB-72: a hot-update can bring a
    // different set of views, and the page reads it fresh after every reload.
    get viewIds(): string[] {
      return Object.keys(mounted.envelope.views);
    },
    ready: Promise.resolve(),
    data: [] as Array<[string, unknown]>,
    reloads: [] as string[],
    disposed: false,
    reload(json: string | object) {
      handle.reloads.push(String(json));
      mounted.envelope = (typeof json === "string" ? JSON.parse(json) : json) as Envelope;
    },
    setData(path: string, value: unknown) {
      handle.data.push([path, value]);
    },
    setOpen: () => true,
    setSelectedTab: () => true,
    setChecked: () => true,
    setValue: () => true,
    setText: () => true,
    setScroll: () => true,
    snapshot: () => ({}) as ReturnType<ZablooHandle["snapshot"]>,
    stats: () => ({}) as ReturnType<ZablooHandle["stats"]>,
    dispose() {
      handle.disposed = true;
    },
  };
  return handle as unknown as FakeHandle;
}

/** Programs the server side: the envelope `/envelope` answers with, plus raw asset replies. */
function serve(envelope: unknown, assets: Record<string, string> = {}): void {
  fake.routes.set("/envelope", { ok: true, body: JSON.stringify(envelope) });
  for (const [hash, body] of Object.entries(assets)) {
    fake.routes.set(`/asset/${hash}`, { ok: true, body });
  }
}

/** The panel's fields, in the order the page laid them out. */
function panelPaths(): string[] {
  return [...document.querySelectorAll("#fields label")].map((label) => label.textContent ?? "");
}

function panelInput(path: string): HTMLInputElement {
  const labels = [...document.querySelectorAll("#fields label")];
  const label = labels.find((candidate) => candidate.textContent === path);
  if (!label) throw new Error(`no field for ${path}`);
  return label.nextElementSibling as HTMLInputElement;
}

function logLines(): string[] {
  return [...document.querySelectorAll("#log div")].map((line) => line.textContent ?? "");
}

/** What the error overlay is showing, or null while it is hidden. */
function overlay(): string | null {
  const box = document.getElementById("error") as HTMLElement;
  return box.classList.contains("empty") ? null : box.textContent;
}

function statusDot(): string {
  return (document.getElementById("status") as HTMLElement).className;
}

/** Types into a field the way a person would: set the value, fire `input`. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new window.Event("input"));
}

/**
 * The page remembers the viewport preset and the stats toggle across reloads, and
 * the dev loop reloads on every save, so `localStorage` is stubbed — which also
 * makes each test start from a clean slate.
 */
beforeEach(() => {
  document.body.innerHTML = PREVIEW_BODY;
  fake.storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => fake.storage.get(key) ?? null,
    setItem: (key: string, value: string) => fake.storage.set(key, value),
    removeItem: (key: string) => fake.storage.delete(key),
  });
  fake.mounts = [];
  fake.routes = new Map();
  fake.fetches = [];
  fake.stream = null;
  fake.mountError = null;

  vi.stubGlobal("fetch", async (url: string) => {
    fake.fetches.push(url);
    const route = fake.routes.get(url);
    if (!route) return { ok: false, status: 404, text: async () => "" };
    return {
      ok: route.ok,
      status: route.ok ? 200 : 404,
      text: async () => route.body,
      json: async () => JSON.parse(route.body),
    };
  });
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("ZablooRenderer", {
    mount(_canvas: HTMLCanvasElement, json: string, options: MountOptions) {
      if (fake.mountError) throw fake.mountError;
      const envelope = JSON.parse(json) as Envelope;
      const handle = fakeHandle(envelope);
      fake.mounts.push({ envelope, options, handle });
      return handle;
    },
  });
});

afterEach(() => {
  fake.client?.stop();
  fake.client = null;
  vi.unstubAllGlobals();
});

/** Lets the load the page just kicked off run to the end (it is not returned). */
function settle(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

/** Starts the page against whatever `serve` last programmed, after the first load. */
async function open(): Promise<PreviewClient> {
  fake.client = start();
  await fake.client.ready;
  return fake.client;
}

const GOLD: Envelope = {
  v: 1,
  tokens: {},
  views: {
    main: {
      type: "Container",
      children: [{ type: "Text", text: { bind: "player.gold" } }],
    },
  },
};

describe("collectBindPaths", () => {
  it("finds every bound path in the tree", () => {
    expect([...collectBindPaths(GOLD)]).toEqual(["player.gold"]);
  });

  it("skips the paths of a Repeat template, which are relative to the item", () => {
    const paths = collectBindPaths({
      type: "Repeat",
      items: { bind: "shop.items" },
      children: [
        { type: "Text", text: { bind: "item.name" } },
        { type: "Text", text: { bind: "shop.emptyMessage" } },
      ],
    });

    // The array and the empty state are values the game pushes; "item.name" is
    // an address INTO the array, and nobody can push it.
    expect([...paths].sort()).toEqual(["shop.emptyMessage", "shop.items"]);
  });

  it("still collects the Repeat's own bindings", () => {
    const paths = collectBindPaths({
      type: "Repeat",
      items: { bind: "shop.items" },
      visible: { bind: "shop.open" },
      children: [{ type: "Text", text: { bind: "item.name" } }],
    });

    expect([...paths].sort()).toEqual(["shop.items", "shop.open"]);
  });

  it("walks into nested Repeats", () => {
    const paths = collectBindPaths({
      type: "Container",
      children: [
        {
          type: "Repeat",
          items: { bind: "shop.categories" },
          children: [
            {
              type: "Repeat",
              items: { bind: "category.items" },
              children: [{ type: "Text", text: { bind: "item.name" } }],
            },
          ],
        },
      ],
    });

    // The inner Repeat is the outer template: everything under it is relative.
    expect([...paths]).toEqual(["shop.categories"]);
  });
});

describe("coerce", () => {
  it("parses arrays and objects — a list is fed by pushing its array (ZAB-29)", () => {
    expect(coerce('[{"id":1}]')).toEqual([{ id: 1 }]);
    expect(coerce('  {"gold": 3} ')).toEqual({ gold: 3 });
  });

  it("keeps a half-written array as text instead of shouting", () => {
    expect(coerce('[{"id":')).toBe('[{"id":');
  });

  it("reads booleans and numbers as themselves", () => {
    expect(coerce("true")).toBe(true);
    expect(coerce("false")).toBe(false);
    expect(coerce("900")).toBe(900);
    expect(coerce(" 1.5 ")).toBe(1.5);
  });

  it("leaves text — including the empty string — alone", () => {
    expect(coerce("Comprar")).toBe("Comprar");
    expect(coerce("")).toBe("");
    expect(coerce("   ")).toBe("   ");
  });
});

describe("parseEvent", () => {
  it("reads a failed export off the fake.stream", () => {
    expect(parseEvent('{"kind":"error","message":"boom"}')).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("treats anything else as a reload — one wasted fetch beats a page that froze", () => {
    expect(parseEvent("reload")).toEqual({ kind: "reload" });
    expect(parseEvent('{"kind":"error"}')).toEqual({ kind: "reload" });
    expect(parseEvent('{"kind":"whatever-comes-next"}')).toEqual({ kind: "reload" });
  });
});

describe("hydrateAssets", () => {
  const withAsset = (data?: string): Envelope => ({
    v: 1,
    tokens: {},
    views: {},
    assets: {
      "hero.png": { hash: "abcdef01", mime: "image/png", size: 3, ...(data ? { data } : {}) },
    },
  });

  it("fetches the bytes an envelope arrived without", async () => {
    fake.routes.set("/asset/abcdef01", { ok: true, body: "QUJD" });
    const cache = new Map<string, string>();

    const envelope = await hydrateAssets(withAsset(), cache, () => {});

    expect(envelope.assets?.["hero.png"].data).toBe("QUJD");
  });

  it("re-fake.fetches nothing on the next reload — the bytes behind a hash never change", async () => {
    fake.routes.set("/asset/abcdef01", { ok: true, body: "QUJD" });
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset(), cache, () => {});
    const second = await hydrateAssets(withAsset(), cache, () => {});

    expect(second.assets?.["hero.png"].data).toBe("QUJD");
    expect(fake.fetches).toEqual(["/asset/abcdef01"]);
  });

  it("caches the bytes of an envelope that did inline them", async () => {
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset("QUJD"), cache, () => {});

    expect(cache.get("abcdef01")).toBe("QUJD");
    expect(fake.fetches).toEqual([]);
  });

  it("reports an asset the server cannot serve and renders the rest", async () => {
    const reported: string[] = [];

    const envelope = await hydrateAssets(withAsset(), new Map(), (message) =>
      reported.push(message),
    );

    expect(reported).toEqual(["asset unavailable: abcdef01"]);
    expect(envelope.assets?.["hero.png"].data).toBeUndefined();
  });
});

describe("the preview page", () => {
  it("mounts the exported envelope and lists its views", async () => {
    serve({ ...GOLD, views: { ...GOLD.views, settings: { type: "Container" } } });

    await open();

    expect(fake.mounts).toHaveLength(1);
    expect([...document.querySelectorAll("#views option")].map((o) => o.textContent)).toEqual([
      "main",
      "settings",
    ]);
  });

  it("offers one field per bound path and pushes what is typed into it", async () => {
    serve(GOLD);
    const page = await open();

    type(panelInput("player.gold"), "900");

    expect(panelPaths()).toEqual(["player.gold"]);
    expect(fake.mounts[0].handle.data).toEqual([["player.gold", 900]]);
    expect(page.values().get("player.gold")).toBe("900");
  });

  it("hides the panel when the envelope binds nothing", async () => {
    serve({ v: 1, tokens: {}, views: { main: { type: "Text", text: "hola" } } });

    await open();

    expect(document.getElementById("data")?.classList.contains("empty")).toBe(true);
  });

  it("shows what a control wrote back and logs it (ZAB-29)", async () => {
    serve(GOLD);
    await open();

    fake.mounts[0].options.onDataChanged?.("player.gold", 850);

    expect(panelInput("player.gold").value).toBe("850");
    expect(logLines()).toEqual(["player.gold = 850"]);
  });

  it("names the item an action fired from", async () => {
    serve(GOLD);
    await open();

    fake.mounts[0].options.onAction?.("buy", { path: "shop.items.3", index: 3 });
    fake.mounts[0].options.onAction?.("close");

    expect(logLines()).toEqual(["action: close", "buy → shop.items.3 (#3)"]);
  });

  it("hot-swaps the envelope on the next save instead of remounting", async () => {
    serve(GOLD);
    const page = await open();
    type(panelInput("player.gold"), "900");

    await page.load();

    expect(fake.mounts).toHaveLength(1);
    expect(fake.mounts[0].handle.reloads).toHaveLength(1);
    expect(fake.mounts[0].handle.disposed).toBe(false);
  });

  it("replays the data the panel is holding, so a reload does not blank the view", async () => {
    serve(GOLD);
    const page = await open();
    type(panelInput("player.gold"), "900");
    fake.mounts[0].handle.data.length = 0;

    await page.load();

    expect(fake.mounts[0].handle.data).toEqual([["player.gold", 900]]);
  });

  it("remounts on the view picker, and only then", async () => {
    serve({ ...GOLD, views: { ...GOLD.views, settings: { type: "Container" } } });
    await open();

    const picker = document.getElementById("views") as HTMLSelectElement;
    picker.value = "settings";
    picker.dispatchEvent(new window.Event("change"));
    await vi.waitFor(() => expect(fake.mounts).toHaveLength(2));

    expect(fake.mounts[1].options.view).toBe("settings");
    expect(fake.mounts[0].handle.disposed).toBe(true);
  });

  it("reloads when the server says the export landed", async () => {
    serve(GOLD);
    await open();

    push({ kind: "reload" });
    await vi.waitFor(() => expect(fake.mounts[0].handle.reloads).toHaveLength(1));
  });

  it("lights the status dot with the live connection", async () => {
    serve(GOLD);
    await open();
    const dot = document.getElementById("status");

    fake.stream?.onopen?.();
    expect(dot?.classList.contains("ok")).toBe(true);

    fake.stream?.onerror?.();
    expect(dot?.classList.contains("ok")).toBe(false);
  });

  it("reports an envelope the renderer refuses instead of stopping dead (ZAB-37)", async () => {
    serve(GOLD);
    fake.mountError = new Error("unsupported major version 2");

    await open();

    expect(logLines()).toEqual(["envelope error: unsupported major version 2"]);
  });

  it("says nothing until the first export lands", async () => {
    await open();

    expect(fake.mounts).toEqual([]);
    expect(logLines()).toEqual([]);
  });

  // Until ZAB-67 a failed export was invisible here: the page kept the last good
  // render, the dot stayed green, and the only report was a line in a terminal you
  // might not be looking at — "I saved and nothing happened".
  it("shows a failed export over the stale view, with the dot in red", async () => {
    serve(GOLD);
    await open();

    push({ kind: "error", message: "zabloo export: main.tsx\n  Unexpected token" });

    expect(overlay()).toBe("zabloo export: main.tsx\n  Unexpected token");
    expect(statusDot()).toContain("err");
    // What is on screen is the last good export; nothing was reloaded.
    expect(fake.mounts[0].handle.reloads).toEqual([]);
  });

  it("takes the overlay down when an export lands again", async () => {
    serve(GOLD);
    await open();
    push({ kind: "error", message: "boom" });

    push({ kind: "reload" });

    await vi.waitFor(() => expect(overlay()).toBeNull());
    expect(statusDot()).not.toContain("err");
  });

  it("remounts after a mount that threw, instead of reloading the view it disposed", async () => {
    serve({ ...GOLD, views: { ...GOLD.views, broken: { type: "Container" } } });
    await open();
    const first = fake.mounts[0].handle;
    fake.mountError = new Error("unsupported node");

    const picker = document.getElementById("views") as HTMLSelectElement;
    picker.value = "broken";
    picker.dispatchEvent(new window.Event("change"));
    await vi.waitFor(() => expect(overlay()).toContain("unsupported node"));

    fake.mountError = null;
    push({ kind: "reload" });

    await vi.waitFor(() => expect(fake.mounts).toHaveLength(2));
    // The handle the failed mount left behind was disposed: reloading THAT is the
    // bug, and a fresh mount is the only way back.
    expect(first.disposed).toBe(true);
    expect(first.reloads).toEqual([]);
    expect(overlay()).toBeNull();
  });

  /**
   * The validator's diagnostics used to reach the page as console lines, which a
   * page cannot read: the export you were looking at could be missing half its
   * nodes with nothing on screen admitting it (ZAB-72).
   */
  it("logs a repaired warning without marking the view stale", async () => {
    serve(GOLD);
    await open();

    fake.mounts[0].options.onDiagnostic?.({
      level: "warn",
      code: "unknown-token",
      path: 'views["main"].style.background',
      message: 'views["main"].style.background: unknown token {color.nope}',
    });

    // Repaired: what is on the canvas is correct, minus the broken bit — so it
    // takes a log line, not the overlay that means "this view is stale".
    expect(logLines()).toEqual([
      '[unknown-token] views["main"].style.background: unknown token {color.nope}',
    ]);
    expect(overlay()).toBeNull();
    expect(statusDot()).not.toContain("err");
  });

  it("puts a fatal diagnostic on the overlay, with the dot in red", async () => {
    serve(GOLD);
    await open();

    fake.mounts[0].options.onDiagnostic?.({
      level: "fatal",
      code: "unsupported-version",
      path: "",
      message: "unsupported major version 2",
    });

    expect(overlay()).toBe("[unsupported-version] unsupported major version 2");
    expect(statusDot()).toContain("err");
  });

  it("reports a refused envelope once, by its code and not by the exception too", async () => {
    serve(GOLD);
    fake.mountError = Object.assign(new Error("unsupported major version 2"), {});
    // A real mount reports through the sink and THEN throws; the page must not
    // say the same thing twice.
    vi.stubGlobal("ZablooRenderer", {
      mount(_canvas: HTMLCanvasElement, _json: string, options: MountOptions) {
        options.onDiagnostic?.({
          level: "fatal",
          code: "unsupported-version",
          path: "",
          message: "unsupported major version 2",
        });
        throw fake.mountError;
      },
    });

    await open();

    expect(logLines()).toEqual(["[unsupported-version] unsupported major version 2"]);
    expect(overlay()).toBe("[unsupported-version] unsupported major version 2");
  });

  // The picker was filled once, on mount, so a save that added a view left it
  // invisible until the page was reloaded by hand (ZAB-72).
  it("follows the envelope's views across a hot-update", async () => {
    serve(GOLD);
    const page = await open();
    const picker = document.getElementById("views") as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(["main"]);

    serve({ ...GOLD, views: { ...GOLD.views, settings: { type: "Container" } } });
    await page.load();

    expect(fake.mounts).toHaveLength(1); // hot-swapped, not remounted
    expect([...picker.options].map((option) => option.value)).toEqual(["main", "settings"]);
  });

  it("shows the gamepad badge only while a pad is connected (ZAB-47)", async () => {
    const pad: { connected: Array<{ connected: boolean } | null> } = { connected: [] };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => pad.connected,
      configurable: true,
    });
    serve(GOLD);
    await open();
    const badge = document.getElementById("pad");

    expect(badge?.classList.contains("off")).toBe(true);

    pad.connected = [{ connected: true }];
    window.dispatchEvent(new window.Event("gamepadconnected"));
    expect(badge?.classList.contains("off")).toBe(false);

    pad.connected = [null];
    window.dispatchEvent(new window.Event("gamepaddisconnected"));
    expect(badge?.classList.contains("off")).toBe(true);
  });
});

/**
 * Viewport presets (ZAB-78). The canvas used to be `flex: 1` and take the window,
 * so a UI authored for 1080p could not be checked at 720p without resizing the
 * browser — and no window shape at all answers "how does this read on a console".
 */
describe("parseViewport", () => {
  it("reads the presets the picker offers", () => {
    expect(parseViewport("1920x1080", "")).toEqual({ fixed: true, width: 1920, height: 1080 });
    expect(parseViewport("1280x720", "")).toEqual({ fixed: true, width: 1280, height: 720 });
  });

  it("fits the window when nothing is pinned", () => {
    expect(parseViewport("fit", "1600x900")).toEqual({ fixed: false });
  });

  it("reads the custom box, in the shapes a person types", () => {
    for (const text of ["1600x900", "1600 x 900", " 1600×900 ", "1600*900"]) {
      expect(parseViewport("custom", text), text).toEqual({
        fixed: true,
        width: 1600,
        height: 900,
      });
    }
  });

  it("falls back to fitting while the custom box is half-typed", () => {
    // Not an error worth shouting about: it is a box mid-edit, and something
    // has to stay on screen while you type the rest.
    for (const text of ["", "1600", "1600x", "nope", "0x900"]) {
      expect(parseViewport("custom", text), text).toEqual({ fixed: false });
    }
  });
});

describe("fitScale", () => {
  it("shrinks a viewport that does not fit", () => {
    expect(fitScale(1920, 1080, 960, 1080)).toBe(0.5);
    expect(fitScale(1920, 1080, 1920, 540)).toBe(0.5);
  });

  it("never scales UP — that would be showing you resampling, not your UI", () => {
    expect(fitScale(1280, 720, 3840, 2160)).toBe(1);
  });

  it("stays at 1 when the stage has not been laid out yet", () => {
    expect(fitScale(1920, 1080, 0, 0)).toBe(1);
  });
});

describe("parseDpr", () => {
  it("passes a forced ratio through", () => {
    expect(parseDpr("1")).toBe(1);
    expect(parseDpr("2")).toBe(2);
  });

  it("leaves the browser's own in place for `auto`", () => {
    expect(parseDpr("auto")).toBeUndefined();
    expect(parseDpr("")).toBeUndefined();
  });
});

describe("the viewport picker", () => {
  function stage(): HTMLElement {
    return document.getElementById("stage") as HTMLElement;
  }
  function pick(value: string): void {
    const picker = document.getElementById("viewport") as HTMLSelectElement;
    picker.value = value;
    picker.dispatchEvent(new window.Event("change"));
  }

  it("leaves the canvas filling the stage in `fit`", async () => {
    serve(GOLD);
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    await open();

    expect(stage().classList.contains("framed")).toBe(false);
    expect(canvas.style.width).toBe("");
    expect(canvas.style.transform).toBe("");
  });

  it("gives the canvas the preset's own pixel size, and only SCALES it to fit", async () => {
    serve(GOLD);
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    await open();

    pick("1920x1080");

    // The declared size is what the renderer lays out against, because
    // `clientWidth` is layout and `transform` is paint. Shrinking with width
    // instead would silently re-author the UI at whatever the window is.
    expect(canvas.style.width).toBe("1920px");
    expect(canvas.style.height).toBe("1080px");
    expect(canvas.style.transform).toMatch(/^scale\(/);
    expect(stage().classList.contains("framed")).toBe(true);
  });

  it("tells the renderer the logical size moved", async () => {
    serve(GOLD);
    await open();
    const resizes = vi.fn();
    globalThis.addEventListener("resize", resizes);

    pick("1280x720");

    expect(resizes).toHaveBeenCalledTimes(1);
    globalThis.removeEventListener("resize", resizes);
  });

  it("shows the custom box only for `custom`", async () => {
    serve(GOLD);
    await open();
    const box = document.getElementById("custom") as HTMLInputElement;

    expect(box.classList.contains("off")).toBe(true);
    pick("custom");
    expect(box.classList.contains("off")).toBe(false);
  });

  it("remembers the preset across reloads — the dev loop reloads on every save", async () => {
    serve(GOLD);
    await open();
    pick("1280x720");

    fake.client?.stop();
    document.body.innerHTML = PREVIEW_BODY;
    await open();

    expect((document.getElementById("viewport") as HTMLSelectElement).value).toBe("1280x720");
    expect((document.getElementById("canvas") as HTMLCanvasElement).style.width).toBe("1280px");
  });
});

describe("the dpr picker", () => {
  it("mounts at the browser's own ratio by default", async () => {
    serve(GOLD);
    await open();

    expect(fake.mounts[0].options.dpr).toBeUndefined();
  });

  it("remounts at the forced ratio — the atlases are rasterized at it", async () => {
    serve(GOLD);
    await open();
    const picker = document.getElementById("dpr") as HTMLSelectElement;

    picker.value = "2";
    picker.dispatchEvent(new window.Event("change"));
    await settle();

    expect(fake.mounts.length).toBeGreaterThan(1);
    expect(fake.mounts.at(-1)?.options.dpr).toBe(2);
    // A remount, not a reload: the previous view had to be thrown away.
    expect(fake.mounts[0].handle.disposed).toBe(true);
  });
});

/**
 * The stats badge (ZAB-78). `stats()` has been on the handle all along, reachable
 * only by typing `zabloo.stats()` into the console — which is precisely when you
 * are not looking at the screen.
 */
describe("formatStats", () => {
  const frame = {
    drawCalls: 17,
    vertices: 3400,
    indices: 5100,
    atlases: 1,
    atlasBytes: 4 * 1048576,
    resolved: 312,
    textLayouts: 0,
    bufferGrowths: 0,
    repaintOnly: false,
    ms: 2.125,
  };

  it("says what the frame cost, in the renderer's own terms", () => {
    const text = formatStats(frame, 48);
    expect(text).toContain("48 fps");
    expect(text).toContain("2.13 ms");
    expect(text).toContain("17 draws");
    expect(text).toContain("3.4k verts");
    expect(text).toContain("1 atlas 4.0 MB");
    expect(text).toContain("312 resolved");
  });

  it("says `idle`, not `0 fps` — the renderer paints on demand", () => {
    // A still scene painting nothing is the system working. Reporting it as zero
    // frames per second reads as a stall.
    expect(formatStats(frame, 0)).toContain("idle");
    expect(formatStats(frame, 0)).not.toContain("0 fps");
  });

  it("marks a repaint-only frame as what it is", () => {
    expect(formatStats({ ...frame, repaintOnly: true }, 60)).toContain("repaint only");
  });

  it("has something to say before the first frame", () => {
    expect(formatStats(null, 0)).toBe("no frame painted yet");
  });
});

describe("the stats badge", () => {
  function badge(): HTMLElement {
    return document.getElementById("stats") as HTMLElement;
  }
  function toggle(): HTMLButtonElement {
    return document.getElementById("stats-toggle") as HTMLButtonElement;
  }

  it("is off until asked for", async () => {
    serve(GOLD);
    await open();

    expect(badge().classList.contains("empty")).toBe(true);
  });

  it("counts the frames the RENDERER reports, not the page's own rAF", async () => {
    serve(GOLD);
    await open();
    toggle().click();

    // The renderer paints on demand, so only it knows when it drew. This is the
    // callback it reports through.
    const onFrame = fake.mounts[0].options.onFrame;
    expect(onFrame).toBeTypeOf("function");
    onFrame?.({
      drawCalls: 9,
      vertices: 120,
      indices: 180,
      atlases: 1,
      atlasBytes: 1048576,
      resolved: 40,
      textLayouts: 0,
      bufferGrowths: 0,
      repaintOnly: false,
      ms: 0.5,
    });
    toggle().click();
    toggle().click(); // redraws immediately on being switched back on

    expect(badge().classList.contains("empty")).toBe(false);
    expect(badge().textContent).toContain("9 draws");
    expect(badge().textContent).toContain("1 fps");
  });

  it("remembers being on across a reload", async () => {
    serve(GOLD);
    await open();
    toggle().click();

    fake.client?.stop();
    document.body.innerHTML = PREVIEW_BODY;
    await open();

    expect(badge().classList.contains("empty")).toBe(false);
    expect(toggle().classList.contains("on")).toBe(true);
  });
});
