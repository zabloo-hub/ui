/**
 * The mount/reload decision and everything that has to survive a save (ported
 * from `preview-client.test.ts`, ZAB-57/ZAB-67/ZAB-72). The renderer and the
 * server are injected, so nothing here touches a global.
 */

import type { Envelope } from "@zabloo/format";
import type { MountOptions, ZablooHandle } from "@zabloo/renderer-web";
import { createSession, type Session, type SessionCallbacks } from "@/bridge/session";

/** A mount, as the session made it — what the renderer would have been asked for. */
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

function fakeHandle(envelope: Envelope): FakeHandle {
  // Reassigned by `reload`, so the getter below has to read it through a slot.
  const current = { envelope };
  const handle = {
    // A getter, like the real handle's since ZAB-72: a hot-update can bring a
    // different set of views, and the session reads it fresh after every load.
    get viewIds(): string[] {
      return Object.keys(current.envelope.views);
    },
    ready: Promise.resolve(),
    data: [] as Array<[string, unknown]>,
    reloads: [] as string[],
    disposed: false,
    reload(json: string | object) {
      handle.reloads.push(String(json));
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

const TWO_VIEWS: Envelope = { ...GOLD, views: { ...GOLD.views, settings: { type: "Container" } } };

/** The world around one session: what the server serves, what the renderer does. */
interface World {
  session: Session;
  mounts: Mount[];
  /** Everything the session reported, in order, as `name: detail` lines. */
  reported: string[];
  /** The envelope `/envelope` answers with; null is a server with nothing to give. */
  serve(envelope: Envelope | null): void;
  /** Makes the fetch itself fail — what never becomes a diagnostic. */
  breakServer(error: Error): void;
  /** Parks the next fetch until the returned release is called — for racing a dispose against a load in flight. */
  holdServer(): () => void;
  /** Thrown by the next mount — the "envelope the renderer refuses" case. */
  refuse(error: Error | null): void;
  /** What a refusing mount reports through the sink before it throws. */
  refuseWith(diagnostic: Parameters<SessionCallbacks["onDiagnostic"]>[0] | null): void;
  /** The ratio the picker is on. */
  setDpr(value: number | undefined): void;
  fetches: number;
}

function world(initial: Envelope | null = GOLD): World {
  const mounts: Mount[] = [];
  const reported: string[] = [];
  // The knobs the returned World turns, as one slot object: they are read by the
  // session long after `world()` returned, so they are state, not values.
  const slot: {
    served: Envelope | null;
    serverError: Error | null;
    mountError: Error | null;
    mountDiagnostic: Parameters<SessionCallbacks["onDiagnostic"]>[0] | null;
    dpr: number | undefined;
    fetches: number;
    gate: Promise<void> | null;
  } = {
    served: initial,
    serverError: null,
    mountError: null,
    mountDiagnostic: null,
    dpr: undefined,
    fetches: 0,
    gate: null,
  };

  const session = createSession({
    canvas: document.createElement("canvas"),
    fetchEnvelope: async () => {
      slot.fetches += 1;
      if (slot.gate) await slot.gate;
      if (slot.serverError) throw slot.serverError;
      return slot.served === null ? null : (JSON.parse(JSON.stringify(slot.served)) as Envelope);
    },
    mount(_canvas, json, options) {
      if (slot.mountDiagnostic) options.onDiagnostic?.(slot.mountDiagnostic);
      if (slot.mountError) throw slot.mountError;
      const envelope = JSON.parse(json) as Envelope;
      const handle = fakeHandle(envelope);
      mounts.push({ envelope, options, handle });
      return handle;
    },
    dpr: () => slot.dpr,
    callbacks: {
      onEnvelope: (_envelope, bindings) =>
        reported.push(`envelope: ${bindings.map((b) => `${b.path}:${b.type}`).join(",")}`),
      onMounted: (viewIds) => reported.push(`mounted: ${viewIds.join(",")}`),
      onReloaded: (viewIds, state) =>
        reported.push(`reloaded${state.stale ? " (stale)" : ""}: ${viewIds.join(",")}`),
      onAction: (action, context) =>
        reported.push(context ? `action: ${action} @${context.path}` : `action: ${action}`),
      onDataChanged: (path, value) => reported.push(`changed: ${path}=${String(value)}`),
      onDiagnostic: (diagnostic) => reported.push(`diagnostic: ${diagnostic.code}`),
      onFrame: (frame) => reported.push(`frame: ${frame.drawCalls}`),
      onLoadError: (message) => reported.push(`load error: ${message}`),
    },
  });

  return {
    session,
    mounts,
    reported,
    serve: (envelope) => {
      slot.served = envelope;
    },
    breakServer: (error) => {
      slot.serverError = error;
    },
    holdServer: () => {
      // The resolver is a slot the Promise constructor insists on owning — a
      // field of a `const` holder, per the house table.
      const gate: { release: () => void } = { release: () => {} };
      slot.gate = new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return () => {
        slot.gate = null;
        gate.release();
      };
    },
    refuse: (error) => {
      slot.mountError = error;
    },
    refuseWith: (diagnostic) => {
      slot.mountDiagnostic = diagnostic;
    },
    setDpr: (value) => {
      slot.dpr = value;
    },
    get fetches() {
      return slot.fetches;
    },
  };
}

afterEach(() => {
  window.zabloo = undefined;
});

describe("the first load", () => {
  it("mounts what the server published and names its views", async () => {
    const it = world(TWO_VIEWS);

    await it.session.load();

    expect(it.mounts).toHaveLength(1);
    expect(it.reported).toContain("mounted: main,settings");
  });

  it("reports the paths the envelope binds before putting it on screen", async () => {
    const it = world();

    await it.session.load();

    expect(it.reported).toEqual(["envelope: player.gold:string", "mounted: main"]);
  });

  it("puts the handle on the console's own name", async () => {
    const it = world();

    await it.session.load();

    expect(window.zabloo).toBe(it.session.handle());
  });

  it("says nothing until the first export lands", async () => {
    const it = world(null);

    await it.session.load();

    expect(it.mounts).toEqual([]);
    expect(it.reported).toEqual([]);
  });
});

describe("the data channel", () => {
  it("pushes what the panel holds and keeps it", async () => {
    const it = world();
    await it.session.load();

    it.session.setData("player.gold", 900);

    expect(it.mounts[0].handle.data).toEqual([["player.gold", 900]]);
    expect(it.session.values().get("player.gold")).toBe(900);
  });

  it("keeps what a control wrote back, typed as the control wrote it (ZAB-29)", async () => {
    const it = world();
    await it.session.load();

    it.mounts[0].options.onDataChanged?.("shop.items.3.fav", true);

    expect(it.session.values().get("shop.items.3.fav")).toBe(true);
    expect(it.reported).toContain("changed: shop.items.3.fav=true");
  });

  it("replays the data the panel is holding, so a reload does not blank the view", async () => {
    const it = world();
    await it.session.load();
    it.session.setData("player.gold", 900);
    it.mounts[0].handle.data.length = 0;

    await it.session.load();

    expect(it.mounts[0].handle.data).toEqual([["player.gold", 900]]);
  });

  it("replays it into a fresh mount too", async () => {
    const it = world(TWO_VIEWS);
    await it.session.load();
    it.session.setData("player.gold", 900);

    await it.session.load("settings");

    expect(it.mounts[1].handle.data).toEqual([["player.gold", 900]]);
  });

  it("forwards the actions and the frames of the live view", async () => {
    const it = world();
    await it.session.load();

    it.mounts[0].options.onAction?.("buy", { path: "shop.items.3", index: 3, key: "3" });
    it.mounts[0].options.onFrame?.({
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

    expect(it.reported).toContain("action: buy @shop.items.3");
    expect(it.reported).toContain("frame: 9");
  });
});

describe("the next save", () => {
  it("hot-swaps the envelope instead of remounting", async () => {
    const it = world();
    await it.session.load();

    await it.session.load();

    expect(it.mounts).toHaveLength(1);
    expect(it.mounts[0].handle.reloads).toHaveLength(1);
    expect(it.mounts[0].handle.disposed).toBe(false);
  });

  // The picker was filled once, on mount, so a save that added a view left it
  // invisible until the page was reloaded by hand (ZAB-72).
  it("follows the envelope's views across a hot-update", async () => {
    const it = world();
    await it.session.load();
    expect(it.reported).toContain("mounted: main");

    it.serve(TWO_VIEWS);
    await it.session.load();

    expect(it.mounts).toHaveLength(1); // hot-swapped, not remounted
    expect(it.reported).toContain("reloaded: main,settings");
  });

  it("remounts on the view picker, and only then", async () => {
    const it = world(TWO_VIEWS);
    await it.session.load();

    await it.session.load("settings");

    expect(it.mounts).toHaveLength(2);
    expect(it.mounts[1].options.view).toBe("settings");
    expect(it.mounts[0].handle.disposed).toBe(true);
  });

  it("remounts when the ratio moves — the atlases are rasterized at it", async () => {
    const it = world();
    await it.session.load();
    expect(it.mounts[0].options.dpr).toBeUndefined();

    it.setDpr(2);
    await it.session.load();

    expect(it.mounts).toHaveLength(2);
    expect(it.mounts[1].options.dpr).toBe(2);
    // A remount, not a reload: the previous view had to be thrown away.
    expect(it.mounts[0].handle.disposed).toBe(true);
  });

  it("goes back to hot-swapping once the ratio settles", async () => {
    const it = world();
    it.setDpr(2);
    await it.session.load();

    await it.session.load();

    expect(it.mounts).toHaveLength(1);
    expect(it.mounts[0].handle.reloads).toHaveLength(1);
  });
});

describe("a load that does not make it onto the canvas", () => {
  const FATAL = {
    level: "fatal",
    code: "unsupported-version",
    path: "",
    message: "unsupported major version 2",
  } as const;

  it("reports an envelope the renderer refuses instead of stopping dead (ZAB-37)", async () => {
    const it = world();
    it.refuse(new Error("unsupported node"));

    await it.session.load();

    expect(it.reported).toContain("load error: envelope error: unsupported node");
  });

  it("reports a refused envelope once, by its code and not by the exception too", async () => {
    const it = world();
    it.refuseWith(FATAL);
    it.refuse(new Error("unsupported major version 2"));

    await it.session.load();

    expect(it.reported).toContain("diagnostic: unsupported-version");
    expect(it.reported.some((line) => line.startsWith("load error:"))).toBe(false);
  });

  it("reports what never becomes a diagnostic — the fetch itself", async () => {
    const it = world();
    it.breakServer(new Error("connection refused"));

    await it.session.load();

    expect(it.reported).toEqual(["load error: envelope error: connection refused"]);
    expect(it.mounts).toEqual([]);
  });

  it("remounts after a mount that threw, instead of reloading the view it disposed", async () => {
    const it = world(TWO_VIEWS);
    await it.session.load();
    const first = it.mounts[0].handle;
    it.refuse(new Error("unsupported node"));

    await it.session.load("settings");
    it.refuse(null);
    await it.session.load();

    // The handle the failed mount left behind was disposed: reloading THAT is the
    // bug (ZAB-67), and a fresh mount is the only way back.
    expect(first.disposed).toBe(true);
    expect(first.reloads).toEqual([]);
    expect(it.mounts).toHaveLength(2);
    expect(it.session.handle()).toBe(it.mounts[1].handle);
  });

  it("marks the view stale when a hot-update is refused", async () => {
    const it = world();
    await it.session.load();
    it.refuseWith(FATAL);

    it.mounts[0].handle.reload = () => {
      it.mounts[0].options.onDiagnostic?.(FATAL);
    };
    await it.session.load();

    expect(it.reported).toContain("reloaded (stale): main");
  });

  it("does not mark it stale when the update landed", async () => {
    const it = world();
    await it.session.load();

    await it.session.load();

    expect(it.reported).toContain("reloaded: main");
  });

  it("still tells the panel which data the refused envelope wanted", async () => {
    const it = world();
    it.refuse(new Error("unsupported node"));

    await it.session.load();

    expect(it.reported[0]).toBe("envelope: player.gold:string");
  });
});

describe("dispose", () => {
  it("drops the mounted view and the console's handle", async () => {
    const it = world();
    await it.session.load();
    const mounted = it.mounts[0].handle;

    it.session.dispose();

    expect(mounted.disposed).toBe(true);
    expect(it.session.handle()).toBeNull();
    expect(window.zabloo).toBeUndefined();
  });

  it("is terminal: a load after dispose mounts nothing — the wiring opens a fresh session instead", async () => {
    // `close()` in wire.ts nulls the session and `open()` always builds a new
    // one, so a disposed session that could still mount would only ever produce
    // an orphan. Verified against wire.ts:284-293.
    const it = world();
    await it.session.load();
    it.session.dispose();

    await it.session.load();

    expect(it.mounts).toHaveLength(1);
    expect(it.mounts[0].handle.reloads).toEqual([]);
    expect(window.zabloo).toBeUndefined();
  });

  it("kills a load in flight: dispose between the fetch and the mount leaves no orphan (StrictMode boot)", async () => {
    // The StrictMode dev boot in one test: the first effect's load is parked on
    // the fetch when the cleanup disposes its session. Without the guard, the
    // continuation resumed and mounted a WebGL context nobody would ever
    // dispose — on the canvas the second effect now owns.
    const it = world();
    const release = it.holdServer();
    const inFlight = it.session.load();

    it.session.dispose();
    release();
    await inFlight;

    expect(it.mounts).toHaveLength(0);
    expect(window.zabloo).toBeUndefined();
    expect(it.reported.filter((line) => line.startsWith("mounted"))).toEqual([]);
  });
});
