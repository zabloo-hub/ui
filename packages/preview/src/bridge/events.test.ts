/**
 * The reload channel (ported from `preview-client.test.ts`, ZAB-57/ZAB-67). The
 * `EventSource` is injected rather than stubbed onto `globalThis`: the CLI page
 * reached for the global because it wired itself up at import time, and this one
 * takes what it opens as an argument.
 */

import {
  connectEvents,
  type EventHandlers,
  type EventSourceLike,
  parseEvent,
} from "@/bridge/events";

class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
  /** What the dev loop pushes down the stream, as the page receives it. */
  push(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function spies(): EventHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onOpen: () => calls.push("open"),
    onLost: () => calls.push("lost"),
    onReload: () => calls.push("reload"),
    onError: (message) => calls.push(`error: ${message}`),
  };
}

describe("parseEvent", () => {
  it("reads a failed export off the stream", () => {
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

describe("connectEvents", () => {
  let stream: FakeEventSource;
  const open = (url: string): EventSourceLike => {
    stream = new FakeEventSource(url);
    return stream;
  };

  it("opens the stream it was pointed at", () => {
    connectEvents("/events", spies(), open);

    expect(stream.url).toBe("/events");
  });

  it("reports the connection coming up and going down", () => {
    const handlers = spies();
    connectEvents("/events", handlers, open);

    stream.onopen?.(new Event("open"));
    stream.onerror?.(new Event("error"));

    expect(handlers.calls).toEqual(["open", "lost"]);
  });

  it("asks for a load when an export lands", () => {
    const handlers = spies();
    connectEvents("/events", handlers, open);

    stream.push({ kind: "reload" });

    expect(handlers.calls).toEqual(["reload"]);
  });

  it("hands a failed export its message instead of reloading (ZAB-67)", () => {
    const handlers = spies();
    connectEvents("/events", handlers, open);

    stream.push({ kind: "error", message: "zabloo export: main.tsx" });

    // Nothing to fetch: what is on screen is the last good export, and the only
    // report of the failure is this message.
    expect(handlers.calls).toEqual(["error: zabloo export: main.tsx"]);
  });

  it("reloads on a frame it cannot read", () => {
    const handlers = spies();
    connectEvents("/events", handlers, open);

    stream.onmessage?.({ data: "who knows" } as MessageEvent<string>);

    expect(handlers.calls).toEqual(["reload"]);
  });

  it("closes the stream when the page is done with it", () => {
    const connection = connectEvents("/events", spies(), open);

    connection.close();

    expect(stream.closed).toBe(true);
  });
});
