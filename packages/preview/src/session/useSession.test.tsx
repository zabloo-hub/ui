/**
 * The dev loop, end to end, with the two things a headless test cannot have
 * faked: the renderer and the server. Everything else is real — the real store,
 * the real bridge, the real hook — because the whole point of V6 is what happens
 * BETWEEN them, and a test that faked either side would be testing the fake.
 *
 * The behaviors here are the ones the old page paid for in bugs: a save that
 * hot-swaps instead of remounting, an export that fails and leaves the last good
 * render on screen (ZAB-67), a view list that a save may rewrite (ZAB-72), and
 * the data the panel is holding surviving every one of them.
 */

import { renderHook, waitFor } from "@testing-library/react";
import type { Envelope } from "@zabloo/format";
import type { MountOptions, ZablooHandle } from "@zabloo/renderer-web";
import type { EventSourceLike } from "@/bridge";
import { NAME_HEADER, type SessionDeps, useSession } from "@/session";
import { EXPORT_FAILED, useStore, viewKey } from "@/store";

/** A mount, as the wiring made it — what the renderer would have been asked for. */
interface Mount {
  canvas: HTMLCanvasElement;
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
 * `refuse` is what the renderer does with a hot-update it will not take: it
 * reports a fatal and DISCARDS the payload, keeping what is on screen (ZAB-37).
 */
function fakeHandle(envelope: Envelope, refuse: () => boolean = () => false): FakeHandle {
  // Reassigned by `reload`, so the getter below has to read it through a slot.
  const current = { envelope };
  const handle = {
    get viewIds(): string[] {
      return Object.keys(current.envelope.views);
    },
    ready: Promise.resolve(),
    data: [] as Array<[string, unknown]>,
    reloads: [] as string[],
    disposed: false,
    reload(json: string | object) {
      handle.reloads.push(String(json));
      if (refuse()) return;
      current.envelope = (typeof json === "string" ? JSON.parse(json) : json) as Envelope;
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

class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
}

const GOLD: Envelope = {
  v: 1,
  tokens: {},
  views: {
    main: {
      type: "Container",
      children: [
        { type: "Text", text: { bind: "player.gold" } },
        { type: "Slider", value: { bind: "settings.volume" } },
      ],
    },
  },
};

const TWO_VIEWS: Envelope = { ...GOLD, views: { ...GOLD.views, settings: { type: "Container" } } };

/** The world one wiring runs in: what the server serves, what the renderer does. */
interface World {
  deps: SessionDeps;
  mounts: Mount[];
  /** The stream the wiring opened, once it has. */
  stream(): FakeStream;
  /** The envelope `/envelope` answers with. */
  serve(envelope: Envelope): void;
  /** The name the response claims (V18's header), or none at all. */
  name(value: string | null): void;
  /** Makes the fetch itself fail — the case that never becomes a diagnostic. */
  breakServer(error: Error | null): void;
  /** Thrown by the next mount: the envelope the renderer refuses. */
  refuse(error: Error | null): void;
  /** Reported by the next mount before it decides whether to throw. */
  refuseWith(diagnostic: Parameters<NonNullable<MountOptions["onDiagnostic"]>>[0] | null): void;
  /** Reported by the next hot-update, which a fatal makes the renderer discard. */
  refuseReloadWith(
    diagnostic: Parameters<NonNullable<MountOptions["onDiagnostic"]>>[0] | null,
  ): void;
}

function world(initial: Envelope = GOLD): World {
  const mounts: Mount[] = [];
  // Knobs the wiring reads long after `world()` returned: state, not values.
  const slot: {
    served: Envelope;
    name: string | null;
    serverError: Error | null;
    mountError: Error | null;
    mountDiagnostic: Parameters<NonNullable<MountOptions["onDiagnostic"]>>[0] | null;
    reloadDiagnostic: Parameters<NonNullable<MountOptions["onDiagnostic"]>>[0] | null;
    stream: FakeStream | null;
  } = {
    served: initial,
    name: "settings.ir.json",
    serverError: null,
    mountError: null,
    mountDiagnostic: null,
    reloadDiagnostic: null,
    stream: null,
  };

  return {
    mounts,
    deps: {
      async http(url) {
        if (slot.serverError !== null) throw slot.serverError;
        // A copy per request, like a real response: the session hydrates the
        // envelope it is given, and a shared object would carry that over.
        const body = JSON.stringify(slot.served);
        return {
          ok: url === "/envelope",
          headers: { get: (header) => (header === NAME_HEADER ? slot.name : null) },
          json: () => Promise.resolve(JSON.parse(body) as unknown),
          text: () => Promise.resolve(body),
        };
      },
      mount(canvas, json, options) {
        if (slot.mountDiagnostic !== null) options.onDiagnostic?.(slot.mountDiagnostic);
        if (slot.mountError !== null) throw slot.mountError;
        const envelope = JSON.parse(json) as Envelope;
        const handle = fakeHandle(envelope, () => {
          if (slot.reloadDiagnostic === null) return false;
          options.onDiagnostic?.(slot.reloadDiagnostic);
          return slot.reloadDiagnostic.level === "fatal";
        });
        mounts.push({ canvas, envelope, options, handle });
        return handle;
      },
      openEvents() {
        slot.stream = new FakeStream();
        return slot.stream;
      },
    },
    stream() {
      if (slot.stream === null) throw new Error("the wiring opened no stream");
      return slot.stream;
    },
    serve: (envelope) => {
      slot.served = envelope;
    },
    name: (value) => {
      slot.name = value;
    },
    breakServer: (error) => {
      slot.serverError = error;
    },
    refuse: (error) => {
      slot.mountError = error;
    },
    refuseWith: (diagnostic) => {
      slot.mountDiagnostic = diagnostic;
    },
    refuseReloadWith: (diagnostic) => {
      slot.reloadDiagnostic = diagnostic;
    },
  };
}

/**
 * A `localStorage` of our own. jsdom serves these tests from an origin without
 * one (see `storage.test.ts`), and the remembered view is exactly the behavior
 * one of the cases below is about — so it is stubbed rather than borrowed.
 */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  } as unknown as Storage;
}

/** A canvas on the store, which is what the Stage does when it mounts (V10). */
function stage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  useStore.getState().setCanvas(canvas);
  return canvas;
}

/** The wiring, mounted the way `App` mounts it. */
function run(it: World) {
  return renderHook(() => useSession(it.deps));
}

/** The state the singleton starts every test in — it is shared, so it is reset. */
beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  useStore.setState({
    views: [],
    activeView: null,
    fatalViews: new Set(),
    connection: "disconnected",
    lastError: null,
    bindings: { byPath: {}, order: [] },
    actions: [],
    problems: [],
    stats: { last: null, fps: 0 },
    envelope: { name: null },
    dpr: "auto",
    runtime: { canvas: null },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.zabloo = undefined;
});

describe("the first load", () => {
  it("mounts what the server published on the canvas the Stage registered", async () => {
    const it = world();
    const canvas = stage();

    run(it);

    await waitFor(() => expect(it.mounts).toHaveLength(1));
    expect(it.mounts[0].canvas).toBe(canvas);
    expect(it.mounts[0].envelope).toEqual(GOLD);
    // The console drives the view by this name, and the docs teach it.
    expect(window.zabloo).toBe(it.mounts[0].handle);
  });

  it("waits for the canvas instead of failing without one", async () => {
    const it = world();

    run(it);
    await waitFor(() => expect(it.stream().onopen).not.toBeNull());
    expect(it.mounts).toEqual([]);

    stage();

    await waitFor(() => expect(it.mounts).toHaveLength(1));
  });

  it("declares the paths the envelope binds, with the type of their site", async () => {
    const it = world();
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().bindings.order).toHaveLength(2));
    const { byPath, order } = useStore.getState().bindings;
    expect(order).toEqual(["player.gold", "settings.volume"]);
    expect(byPath["settings.volume"].type).toBe("number");
  });

  it("names the views and logs the one that reached the canvas", async () => {
    const it = world(TWO_VIEWS);
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().views).toEqual(["main", "settings"]));
    expect(useStore.getState().activeView).toBe("main");
    expect(useStore.getState().actions).toContainEqual(
      expect.objectContaining({ kind: "view", text: "loaded → main" }),
    );
  });

  it("learns which file it is looking at from the response", async () => {
    const it = world();
    it.name("shop.ir.json");
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().envelope.name).toBe("shop.ir.json"));
  });

  it("falls back to the name `zabloo dev` writes until V18 sends the header", async () => {
    const it = world();
    it.name(null);
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().envelope.name).toBe("zabloo.ir.json"));
  });

  it("remounts once to reach the view this envelope remembered (ZAB-72)", async () => {
    const it = world(TWO_VIEWS);
    vi.stubGlobal("localStorage", fakeStorage({ [viewKey("settings.ir.json")]: "settings" }));
    stage();

    run(it);

    // The first mount asked for nothing and got the first view; the remembered
    // one is only knowable once the ids are in, and then it is a remount.
    await waitFor(() => expect(it.mounts).toHaveLength(2));
    expect(it.mounts[1].options.view).toBe("settings");
    expect(useStore.getState().activeView).toBe("settings");
  });
});

describe("the stream", () => {
  it("reports the connection it is on", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.stream().onopen).not.toBeNull());

    it.stream().onopen?.(new Event("open"));
    await waitFor(() => expect(useStore.getState().connection).toBe("live"));

    it.stream().onerror?.(new Event("error"));
    await waitFor(() => expect(useStore.getState().connection).toBe("disconnected"));
  });

  it("hot-swaps a save into the live view and replays what the panel holds", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));
    useStore.getState().setFromEditor("settings.volume", 0.6);
    it.mounts[0].handle.data.length = 0;

    it.stream().onmessage?.({ data: '{"kind":"reload"}' } as MessageEvent<string>);

    await waitFor(() => expect(it.mounts[0].handle.reloads).toHaveLength(1));
    expect(it.mounts).toHaveLength(1);
    expect(it.mounts[0].handle.data).toEqual([["settings.volume", 0.6]]);
  });

  it("picks up the views a save added without remounting (ZAB-72)", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    it.serve(TWO_VIEWS);
    it.stream().onmessage?.({ data: '{"kind":"reload"}' } as MessageEvent<string>);

    await waitFor(() => expect(useStore.getState().views).toEqual(["main", "settings"]));
    expect(it.mounts).toHaveLength(1);
  });

  it("goes stale on a failed export and leaves the last good render up (ZAB-67)", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));
    it.stream().onopen?.(new Event("open"));

    it.stream().onmessage?.({
      data: JSON.stringify({ kind: "error", message: "export failed: unexpected token" }),
    } as MessageEvent<string>);

    await waitFor(() => expect(useStore.getState().connection).toBe("stale"));
    expect(useStore.getState().lastError).toBe("export failed: unexpected token");
    expect(useStore.getState().problems).toContainEqual(
      expect.objectContaining({ code: EXPORT_FAILED, severity: "fatal" }),
    );
    expect(it.mounts[0].handle.disposed).toBe(false);
  });
});

describe("the store drives the view", () => {
  it("remounts on the view you picked", async () => {
    const it = world(TWO_VIEWS);
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    useStore.getState().selectView("settings");

    await waitFor(() => expect(it.mounts).toHaveLength(2));
    expect(it.mounts[1].options.view).toBe("settings");
    expect(it.mounts[0].handle.disposed).toBe(true);
  });

  it("remounts at the new DPR, because the atlases are built at it", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));
    expect(it.mounts[0].options.dpr).toBeUndefined();

    useStore.getState().setDpr(2);

    await waitFor(() => expect(it.mounts).toHaveLength(2));
    expect(it.mounts[1].options.dpr).toBe(2);
  });

  it("pushes what the panel edited into the live view, typed", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    useStore.getState().setFromEditor("settings.volume", "0.4");

    await waitFor(() => expect(it.mounts[0].handle.data).toEqual([["settings.volume", 0.4]]));
  });

  it("does not echo a value the view wrote back", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    it.mounts[0].options.onDataChanged?.("settings.volume", 0.7);

    await waitFor(() =>
      expect(useStore.getState().bindings.byPath["settings.volume"].value).toBe(0.7),
    );
    expect(it.mounts[0].handle.data).toEqual([]);
  });
});

describe("what the view reports", () => {
  it("shows a value a control wrote back, and says it came from the UI (ZAB-29)", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    it.mounts[0].options.onDataChanged?.("shop.items.3.fav", true);

    await waitFor(() => {
      const binding = useStore.getState().bindings.byPath["shop.items.3.fav"];
      expect(binding.value).toBe(true);
      expect(binding.lastWriteFrom).toBe("ui");
    });
    expect(useStore.getState().actions).toContainEqual(
      expect.objectContaining({ kind: "write", text: "shop.items.3.fav = true" }),
    );
  });

  it("logs where an action fired from", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    it.mounts[0].options.onAction?.("buy", { path: "shop.items.3", index: 3 });
    it.mounts[0].options.onAction?.("back");

    await waitFor(() => expect(useStore.getState().actions).toHaveLength(3));
    expect(useStore.getState().actions.map((entry) => entry.text)).toEqual([
      "loaded → main",
      "buy → shop.items.3 (#3)",
      "back",
    ]);
  });

  it("marks the view a fatal diagnostic names, for the picker's red dot", async () => {
    const it = world(TWO_VIEWS);
    it.refuseWith({
      level: "fatal",
      code: "invalid-node",
      path: 'views["settings"].children[0]',
      message: "settings: node has no type",
    });
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().problems).toHaveLength(1));
    expect(useStore.getState().problems[0]).toMatchObject({ severity: "fatal", view: "settings" });
    expect([...useStore.getState().fatalViews]).toEqual(["settings"]);
  });

  it("does not mark a view a repaired warning names", async () => {
    const it = world();
    it.refuseWith({
      level: "warn",
      code: "unknown-token",
      path: 'views["main"].children[0].color',
      message: "main: unknown token — dropped",
    });
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().problems).toHaveLength(1));
    expect([...useStore.getState().fatalViews]).toEqual([]);
  });

  it("forgets the previous export's diagnostics on the next load", async () => {
    const it = world();
    it.refuseWith({
      level: "warn",
      code: "unknown-token",
      path: 'views["main"]',
      message: "main: unknown token — dropped",
    });
    stage();
    run(it);
    await waitFor(() => expect(useStore.getState().problems).toHaveLength(1));

    it.refuseWith(null);
    it.stream().onmessage?.({ data: '{"kind":"reload"}' } as MessageEvent<string>);

    await waitFor(() => expect(useStore.getState().problems).toEqual([]));
  });

  it("records what the last frame cost", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    it.mounts[0].options.onFrame?.({
      ms: 0.51,
      drawCalls: 5,
      vertices: 940,
      indices: 1410,
      atlases: 2,
      atlasBytes: 4194304,
      resolved: 58,
      textLayouts: 0,
      bufferGrowths: 0,
      repaintOnly: false,
    });

    await waitFor(() => expect(useStore.getState().stats.last?.frameMs).toBe(0.51));
    expect(useStore.getState().stats.last?.drawCalls).toBe(5);
  });
});

describe("when a load fails", () => {
  it("reports a fetch that never became an envelope and goes stale", async () => {
    const it = world();
    it.breakServer(new Error("Failed to fetch"));
    stage();

    run(it);

    await waitFor(() => expect(useStore.getState().connection).toBe("stale"));
    expect(useStore.getState().problems).toContainEqual(
      expect.objectContaining({ code: EXPORT_FAILED, reason: "envelope error: Failed to fetch" }),
    );
    expect(it.mounts).toEqual([]);
  });

  it("remounts on the next save after a mount that threw (ZAB-67)", async () => {
    const it = world();
    it.refuse(new Error("no GL context"));
    stage();
    run(it);
    await waitFor(() => expect(useStore.getState().connection).toBe("stale"));

    it.refuse(null);
    it.stream().onmessage?.({ data: '{"kind":"reload"}' } as MessageEvent<string>);

    await waitFor(() => expect(it.mounts).toHaveLength(1));
    expect(useStore.getState().connection).toBe("live");
  });

  it("keeps the previous view up when a hot-update is refused (ZAB-67)", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));
    it.stream().onopen?.(new Event("open"));
    await waitFor(() => expect(useStore.getState().connection).toBe("live"));

    it.refuseReloadWith({
      level: "fatal",
      code: "unsupported-version",
      path: "",
      message: "envelope v2 is newer than this reader",
    });
    it.stream().onmessage?.({ data: '{"kind":"reload"}' } as MessageEvent<string>);

    await waitFor(() => expect(useStore.getState().connection).toBe("stale"));
    expect(useStore.getState().lastError).toBe("envelope v2 is newer than this reader");
    expect(it.mounts).toHaveLength(1);
    expect(it.mounts[0].handle.disposed).toBe(false);
  });
});

describe("when the chrome goes away", () => {
  it("closes the stream and drops the mounted view", async () => {
    const it = world();
    stage();
    const { unmount } = run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    unmount();

    expect(it.stream().closed).toBe(true);
    expect(it.mounts[0].handle.disposed).toBe(true);
    expect(window.zabloo).toBeUndefined();
  });

  it("drops the view when the Stage takes its canvas away", async () => {
    const it = world();
    stage();
    run(it);
    await waitFor(() => expect(it.mounts).toHaveLength(1));

    useStore.getState().setCanvas(null);

    expect(it.mounts[0].handle.disposed).toBe(true);
  });
});
