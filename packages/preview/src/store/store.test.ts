/**
 * What survives a reload, and what a denied or corrupted storage does to the
 * chrome — which must be nothing at all.
 *
 * The dev loop reloads on every save, so this is not a nicety: the preset you
 * are working at, the theme and the collapsed console all have to come back, and
 * `zen` deliberately must not.
 */

import { browserStorage, memoryStorage, type PreviewStorage, STORE_KEY } from "./storage";
import { createPreviewStore } from "./store";

/** The blob as `persist` writes it, read back. */
function saved(storage: PreviewStorage): Record<string, unknown> {
  const raw = storage.read(STORE_KEY);
  expect(raw).not.toBeNull();
  return (JSON.parse(raw as string) as { state: Record<string, unknown> }).state;
}

function blob(state: unknown): string {
  return JSON.stringify({ state, version: 0 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what is persisted", () => {
  it("writes the ★ fields and nothing else", () => {
    const storage = memoryStorage();
    const store = createPreviewStore({ storage });

    store.getState().setTheme("dark");
    store.getState().setPreset("steamdeck");
    store.getState().setCustom({ width: 1024, height: 640 });
    store.getState().setDpr(2);
    store.getState().setConsoleTab("problems");

    expect(saved(storage)).toEqual({
      theme: "dark",
      viewport: { preset: "steamdeck" },
      custom: { width: 1024, height: 640 },
      dpr: 2,
      layout: { panelOpen: true, panelPos: null, consoleOpen: true, consoleTab: "problems" },
    });
  });

  it("leaves zen out, and everything the session owns with it", () => {
    const storage = memoryStorage();
    const store = createPreviewStore({ storage });

    store.getState().toggleZen();
    store.getState().setViews(["hud"]);
    store.getState().declare([{ path: "player.gold", type: "number" }]);
    store.getState().appendAction("view", "loaded → hud");
    store.getState().setStageSize({ width: 900, height: 600 });
    store.getState().setCanvas(document.createElement("canvas"));

    const state = saved(storage);
    expect(state.layout).not.toHaveProperty("zen");
    expect(Object.keys(state).sort()).toEqual(["custom", "dpr", "layout", "theme", "viewport"]);
  });
});

describe("what comes back", () => {
  it("restores the remembered chrome and starts out of zen", () => {
    const storage = memoryStorage({
      [STORE_KEY]: blob({
        theme: "dark",
        viewport: { preset: "4k" },
        custom: { width: 640, height: 480 },
        dpr: 3,
        layout: {
          panelOpen: false,
          panelPos: { x: 20, y: 30 },
          consoleOpen: false,
          consoleTab: "stats",
        },
      }),
    });

    const store = createPreviewStore({ storage });

    expect(store.getState()).toMatchObject({
      theme: "dark",
      viewport: { preset: "4k" },
      custom: { width: 640, height: 480 },
      dpr: 3,
    });
    expect(store.getState().layout).toEqual({
      panelOpen: false,
      panelPos: { x: 20, y: 30 },
      consoleOpen: false,
      consoleTab: "stats",
      zen: false,
    });
  });

  it("seeds itself from the old page's keys when there is no blob yet", () => {
    const storage = memoryStorage({
      "zabloo.preview.viewport": "1920x1080",
      "zabloo.preview.custom": "1024x640",
      "zabloo.preview.dpr": "2",
    });

    const store = createPreviewStore({ storage });

    expect(store.getState()).toMatchObject({
      viewport: { preset: "1080p" },
      custom: { width: 1024, height: 640 },
      dpr: 2,
    });
  });

  it("prefers the blob over the old keys once there is one", () => {
    const storage = memoryStorage({
      "zabloo.preview.viewport": "1920x1080",
      "zabloo.preview.dpr": "2",
      [STORE_KEY]: blob({ viewport: { preset: "switch" }, dpr: "auto" }),
    });

    const store = createPreviewStore({ storage });

    expect(store.getState()).toMatchObject({ viewport: { preset: "switch" }, dpr: "auto" });
  });

  it("ignores a blob somebody edited into nonsense", () => {
    const storage = memoryStorage({
      [STORE_KEY]: blob({
        theme: "blurple",
        viewport: { preset: "1920x1080" },
        custom: "wide",
        dpr: 9,
        layout: "collapsed",
      }),
    });

    const store = createPreviewStore({ storage });

    expect(store.getState()).toMatchObject({
      theme: "light",
      viewport: { preset: "fit" },
      custom: { width: 1280, height: 720 },
      dpr: "auto",
    });
    expect(store.getState().layout.consoleTab).toBe("actions");
  });

  it("boots on a blob that is not even JSON", () => {
    const storage = memoryStorage({ [STORE_KEY]: "{not json" });

    expect(() => createPreviewStore({ storage })).not.toThrow();
    expect(createPreviewStore({ storage }).getState().theme).toBe("light");
  });
});

describe("storage that refuses", () => {
  it("boots and keeps working when localStorage throws on every call", () => {
    const refuse = (): never => {
      throw new Error("The operation is insecure.");
    };
    vi.stubGlobal("localStorage", {
      getItem: refuse,
      setItem: refuse,
      removeItem: refuse,
    } as unknown as Storage);

    const store = createPreviewStore({ storage: browserStorage() });

    expect(() => store.getState().setTheme("dark")).not.toThrow();
    expect(() => store.getState().selectView("hud")).not.toThrow();
    expect(store.getState().theme).toBe("dark");
  });
});
