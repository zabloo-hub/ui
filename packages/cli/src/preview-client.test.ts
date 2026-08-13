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
  hydrateAssets,
  type PreviewClient,
  start,
} from "./preview-client.js";
import { PREVIEW_BODY } from "./preview-server.js";

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

let mounts: Mount[] = [];
let client: PreviewClient | null = null;
/** Replies `fetch` is programmed with, by URL. */
let routes: Map<string, { ok: boolean; body: string }>;
let fetches: string[] = [];
/** The SSE stream the page opened, so a test can push a reload down it. */
let stream: FakeEventSource | null = null;
/** Thrown by the next `mount` when set — the "envelope the renderer refuses" case. */
let mountError: Error | null = null;

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    stream = this;
  }
  close(): void {
    this.closed = true;
  }
}

function fakeHandle(envelope: Envelope, viewIds?: string[]): FakeHandle {
  const handle = {
    viewIds: viewIds ?? Object.keys(envelope.views),
    ready: Promise.resolve(),
    data: [] as Array<[string, unknown]>,
    reloads: [] as string[],
    disposed: false,
    reload(json: string | object) {
      handle.reloads.push(String(json));
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
  routes.set("/envelope", { ok: true, body: JSON.stringify(envelope) });
  for (const [hash, body] of Object.entries(assets)) {
    routes.set(`/asset/${hash}`, { ok: true, body });
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

/** Types into a field the way a person would: set the value, fire `input`. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new window.Event("input"));
}

beforeEach(() => {
  document.body.innerHTML = PREVIEW_BODY;
  mounts = [];
  routes = new Map();
  fetches = [];
  stream = null;
  mountError = null;

  vi.stubGlobal("fetch", async (url: string) => {
    fetches.push(url);
    const route = routes.get(url);
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
      if (mountError) throw mountError;
      const envelope = JSON.parse(json) as Envelope;
      const handle = fakeHandle(envelope);
      mounts.push({ envelope, options, handle });
      return handle;
    },
  });
});

afterEach(() => {
  client?.stop();
  client = null;
  vi.unstubAllGlobals();
});

/** Starts the page against whatever `serve` last programmed, after the first load. */
async function open(): Promise<PreviewClient> {
  client = start();
  await client.ready;
  return client;
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
    routes.set("/asset/abcdef01", { ok: true, body: "QUJD" });
    const cache = new Map<string, string>();

    const envelope = await hydrateAssets(withAsset(), cache, () => {});

    expect(envelope.assets?.["hero.png"].data).toBe("QUJD");
  });

  it("re-fetches nothing on the next reload — the bytes behind a hash never change", async () => {
    routes.set("/asset/abcdef01", { ok: true, body: "QUJD" });
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset(), cache, () => {});
    const second = await hydrateAssets(withAsset(), cache, () => {});

    expect(second.assets?.["hero.png"].data).toBe("QUJD");
    expect(fetches).toEqual(["/asset/abcdef01"]);
  });

  it("caches the bytes of an envelope that did inline them", async () => {
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset("QUJD"), cache, () => {});

    expect(cache.get("abcdef01")).toBe("QUJD");
    expect(fetches).toEqual([]);
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

    expect(mounts).toHaveLength(1);
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
    expect(mounts[0].handle.data).toEqual([["player.gold", 900]]);
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

    mounts[0].options.onDataChanged?.("player.gold", 850);

    expect(panelInput("player.gold").value).toBe("850");
    expect(logLines()).toEqual(["player.gold = 850"]);
  });

  it("names the item an action fired from", async () => {
    serve(GOLD);
    await open();

    mounts[0].options.onAction?.("buy", { path: "shop.items.3", index: 3 });
    mounts[0].options.onAction?.("close");

    expect(logLines()).toEqual(["action: close", "buy → shop.items.3 (#3)"]);
  });

  it("hot-swaps the envelope on the next save instead of remounting", async () => {
    serve(GOLD);
    const page = await open();
    type(panelInput("player.gold"), "900");

    await page.load();

    expect(mounts).toHaveLength(1);
    expect(mounts[0].handle.reloads).toHaveLength(1);
    expect(mounts[0].handle.disposed).toBe(false);
  });

  it("replays the data the panel is holding, so a reload does not blank the view", async () => {
    serve(GOLD);
    const page = await open();
    type(panelInput("player.gold"), "900");
    mounts[0].handle.data.length = 0;

    await page.load();

    expect(mounts[0].handle.data).toEqual([["player.gold", 900]]);
  });

  it("remounts on the view picker, and only then", async () => {
    serve({ ...GOLD, views: { ...GOLD.views, settings: { type: "Container" } } });
    await open();

    const picker = document.getElementById("views") as HTMLSelectElement;
    picker.value = "settings";
    picker.dispatchEvent(new window.Event("change"));
    await vi.waitFor(() => expect(mounts).toHaveLength(2));

    expect(mounts[1].options.view).toBe("settings");
    expect(mounts[0].handle.disposed).toBe(true);
  });

  it("reloads when the server says the export landed", async () => {
    serve(GOLD);
    await open();

    stream?.onmessage?.();
    await vi.waitFor(() => expect(mounts[0].handle.reloads).toHaveLength(1));
  });

  it("lights the status dot with the live connection", async () => {
    serve(GOLD);
    await open();
    const dot = document.getElementById("status");

    stream?.onopen?.();
    expect(dot?.classList.contains("ok")).toBe(true);

    stream?.onerror?.();
    expect(dot?.classList.contains("ok")).toBe(false);
  });

  it("reports an envelope the renderer refuses instead of stopping dead (ZAB-37)", async () => {
    serve(GOLD);
    mountError = new Error("unsupported major version 2");

    await open();

    expect(logLines()).toEqual(["envelope error: unsupported major version 2"]);
  });

  it("says nothing until the first export lands", async () => {
    await open();

    expect(mounts).toEqual([]);
    expect(logLines()).toEqual([]);
  });

  it("shows the gamepad badge only while a pad is connected (ZAB-47)", async () => {
    let pads: Array<{ connected: boolean } | null> = [];
    Object.defineProperty(navigator, "getGamepads", { value: () => pads, configurable: true });
    serve(GOLD);
    await open();
    const badge = document.getElementById("pad");

    expect(badge?.classList.contains("off")).toBe(true);

    pads = [{ connected: true }];
    window.dispatchEvent(new window.Event("gamepadconnected"));
    expect(badge?.classList.contains("off")).toBe(false);

    pads = [null];
    window.dispatchEvent(new window.Event("gamepaddisconnected"));
    expect(badge?.classList.contains("off")).toBe(true);
  });
});
