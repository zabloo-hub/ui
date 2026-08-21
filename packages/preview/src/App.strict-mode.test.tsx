/**
 * The boot, under the StrictMode the app actually ships with (`main.tsx`).
 *
 * React 19 mounts every effect, tears it down and mounts it again in
 * development. That double boot is not a curiosity — it is the shape of the P0
 * this preview shipped with: the first `useSession` effect's load was parked on
 * the fetch when its cleanup disposed the session, and the continuation woke up
 * afterwards and mounted a second WebGL context on the canvas the second effect
 * now owned. Nobody would ever dispose it.
 *
 * `session.test.ts` proves the guard at the level of one session, with the
 * session built by hand. What only this file can catch is the same race arriving
 * through the real wiring — `App` → `useSession` → `wire` → `session`, with the
 * Stage handing its canvas over twice in the middle of it. So nothing here is
 * faked except the two things a headless test cannot have: the renderer and the
 * dev server.
 */

import { act, render, waitFor } from "@testing-library/react";
import type { Envelope } from "@zabloo/format";
import type { ZablooHandle } from "@zabloo/renderer-web";
import { StrictMode } from "react";
import { App } from "@/App";
import type { EventSourceLike } from "@/bridge";
import { NAME_HEADER } from "@/session";
import { DEFAULT_LAYOUT, useStore } from "@/store";

interface FakeHandle extends ZablooHandle {
  disposed: boolean;
}

/** A mount the renderer was asked for, and whether anyone ever took it back. */
interface Mount {
  canvas: HTMLCanvasElement;
  handle: FakeHandle;
}

const renderer = vi.hoisted(() => {
  const mounts: Mount[] = [];

  function fakeHandle(envelope: Envelope): FakeHandle {
    const handle = {
      get viewIds(): string[] {
        return Object.keys(envelope.views);
      },
      ready: Promise.resolve(),
      disposed: false,
      reload: () => {},
      setData: () => {},
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

  return { mounts, fakeHandle };
});

vi.mock("@zabloo/renderer-web", () => ({
  mount: (canvas: HTMLCanvasElement, json: string) => {
    const handle = renderer.fakeHandle(JSON.parse(json) as Envelope);
    renderer.mounts.push({ canvas, handle });
    return handle;
  },
}));

const GOLD: Envelope = {
  v: 1,
  tokens: {},
  views: {
    main: { type: "Container", children: [{ type: "Text", text: { bind: "player.gold" } }] },
  },
};

/** The stream `wire` opens through the global `EventSource` jsdom does not have. */
class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
}

const streams: FakeStream[] = [];
/** The fetches waiting on `release()` — a dev server that has not answered yet. */
const parked: Array<() => void> = [];
const server = { holding: false };

/** Lets every parked fetch answer at once, which is the race in one line. */
function release(): void {
  const waiting = parked.splice(0);
  for (const answer of waiting) answer();
}

const live = () => renderer.mounts.filter((mount) => !mount.handle.disposed);
const open = () => streams.filter((stream) => !stream.closed);

beforeAll(() => {
  globalThis.EventSource = class extends FakeStream {
    constructor(_url: string) {
      super();
      streams.push(this);
    }
  } as unknown as typeof EventSource;

  globalThis.fetch = ((url: string) => {
    const body = JSON.stringify(GOLD);
    const response = {
      ok: url === "/envelope",
      headers: { get: (header: string) => (header === NAME_HEADER ? "gold.ir.json" : null) },
      json: () => Promise.resolve(JSON.parse(body) as unknown),
      text: () => Promise.resolve(body),
    };
    if (!server.holding) return Promise.resolve(response);
    return new Promise((resolve) => parked.push(() => resolve(response)));
  }) as unknown as typeof fetch;
});

beforeEach(() => {
  renderer.mounts.length = 0;
  streams.length = 0;
  parked.length = 0;
  server.holding = false;
  window.zabloo = undefined;
  useStore.setState({
    layout: DEFAULT_LAYOUT,
    theme: "light",
    runtime: { canvas: null },
    connection: "disconnected",
    lastError: null,
    views: [],
    activeView: null,
    problems: [],
    actions: [],
  });
});

describe("the app under StrictMode", () => {
  it("boots to one live view, through a double mount and back", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(live()).toHaveLength(1));
    expect(useStore.getState().views).toEqual(["main"]);
    expect(useStore.getState().connection).toBe("live");
    expect(window.zabloo).toBe(live()[0].handle);
  });

  /**
   * The P0 itself. The discarded boot's load is still on the fetch when its
   * cleanup runs, so the orphan is mounted — if it is mounted at all — by a
   * continuation that wakes up after the session it belongs to is gone.
   */
  it("leaves no orphan when the discarded boot's load lands late", async () => {
    server.holding = true;

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Both boots have run and the first is already disposed, with two loads
    // parked on a server that has not answered either of them.
    expect(renderer.mounts).toHaveLength(0);
    expect(parked).toHaveLength(2);

    await act(async () => release());

    expect(renderer.mounts).toHaveLength(1);
    expect(live()).toHaveLength(1);
    expect(window.zabloo).toBe(renderer.mounts[0].handle);
  });

  /** The other half of the leak: one stream, not two, and the dead one closed. */
  it("closes the stream the discarded boot opened", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(live()).toHaveLength(1));

    expect(streams).toHaveLength(2);
    expect(open()).toHaveLength(1);
  });

  it("takes everything back when the app goes away", async () => {
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(live()).toHaveLength(1));

    unmount();

    expect(live()).toHaveLength(0);
    expect(open()).toHaveLength(0);
    expect(window.zabloo).toBeUndefined();
  });
});
