/**
 * The reload channel of `zabloo dev`, as the page consumes it.
 *
 * Ported from `packages/cli/src/preview-client.ts` (ZAB-57). `PreviewEvent` is
 * DECLARED here rather than imported: the wire contract belongs to the CLI's
 * preview server, and this app is served as static files by it — depending on
 * `@zabloo/cli` to read three lines of JSON would put the whole CLI in the
 * browser bundle's graph. Keep the two in step; the server's copy is the
 * authority (`packages/cli/src/preview-server.ts`).
 */

/** What the dev loop pushes down the stream on every export. */
export type PreviewEvent = { kind: "reload" } | { kind: "error"; message: string };

/**
 * Reads one SSE frame. Anything unrecognizable is treated as "something changed,
 * go look": a reload is the harmless answer, and a page that ignored a frame it
 * could not parse would silently stop updating.
 */
export function parseEvent(data: string): PreviewEvent {
  try {
    const parsed = JSON.parse(data) as PreviewEvent;
    if (parsed.kind === "error" && typeof parsed.message === "string") return parsed;
  } catch {}
  return { kind: "reload" };
}

/** What the chrome does with the stream, once the frames are read for it. */
export interface EventHandlers {
  /** The connection is live — the status dot goes green. */
  onOpen(): void;
  /** The connection dropped (the browser retries on its own). */
  onLost(): void;
  /** An export landed: fetch it. */
  onReload(): void;
  /** The export FAILED, with the message to show over the now-stale view (ZAB-67). */
  onError(message: string): void;
}

/** The stream, as anything that can be closed. */
export interface EventConnection {
  close(): void;
}

/**
 * The minimum of `EventSource` this needs, so a test can pass a fake one in
 * instead of stubbing a global — the same `FakeEventSource` the CLI's test has,
 * now injected rather than smuggled through `globalThis`.
 */
export interface EventSourceLike {
  onopen: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** Opens the stream and reads it into the handlers. */
export function connectEvents(
  url: string,
  handlers: EventHandlers,
  open: EventSourceFactory = (target) => new EventSource(target),
): EventConnection {
  const source = open(url);
  source.onopen = () => handlers.onOpen();
  source.onerror = () => handlers.onLost();
  source.onmessage = (event: MessageEvent<string>) => {
    const payload = parseEvent(event.data);
    if (payload.kind === "error") {
      handlers.onError(payload.message);
      return;
    }
    handlers.onReload();
  };
  return {
    close: () => source.close(),
  };
}
