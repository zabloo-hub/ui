/**
 * The reload channel of `zabloo dev`, from `packages/cli/src/preview-client.ts`
 * (ZAB-57). `PreviewEvent` is declared here rather than imported: the contract
 * belongs to the CLI's preview server, and depending on `@zabloo/cli` for three
 * lines of JSON would put the whole CLI in the browser bundle's graph. Its copy
 * in `packages/cli/src/preview-server.ts` is the authority.
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

export interface EventHandlers {
  onOpen(): void;
  onLost(): void;
  onReload(): void;
  /** The export FAILED, with the message to show over the now-stale view (ZAB-67). */
  onError(message: string): void;
}

export interface EventConnection {
  close(): void;
}

/** The minimum of `EventSource` this needs, so a test can pass a fake one in. */
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
