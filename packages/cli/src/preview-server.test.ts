import { request } from "node:http";
import { createServer, type Server } from "node:net";
import type { Envelope } from "@zabloo/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostAllowed,
  hostnameOf,
  type PreviewEvent,
  type PreviewServer,
  startPreviewServer,
} from "./preview-server.js";

const ENVELOPE = JSON.stringify({
  v: 1,
  tokens: {},
  assets: { "hero.png": { hash: "aaa", mime: "image/png", size: 3, data: "QUJD" } },
  views: { main: { type: "Image", src: "asset:hero.png" } },
});

const started: PreviewServer[] = [];
const squatters: Server[] = [];
const streams: AbortController[] = [];

afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(started.splice(0).map((server) => server.close()));
  await Promise.all(
    squatters.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  vi.restoreAllMocks();
});

/** Port 0 by default: the OS picks a free one, so tests never fight over 5078. */
async function start(port = 0): Promise<PreviewServer> {
  const server = await startPreviewServer(port);
  started.push(server);
  return server;
}

function portOf(server: PreviewServer): number {
  return Number(new URL(server.url).port);
}

/** Something that is not us, holding a port. */
async function squat(port: number): Promise<boolean> {
  const server = createServer();
  squatters.push(server);
  return new Promise((done) => {
    server.once("error", () => done(false));
    server.once("listening", () => done(true));
    server.listen(port, "127.0.0.1");
  });
}

/** Reads the SSE stream the way the page does: one `data:` payload at a time. */
async function openEvents(server: PreviewServer): Promise<{ next(): Promise<PreviewEvent> }> {
  const abort = new AbortController();
  streams.push(abort);
  const res = await fetch(`${server.url}events`, { signal: abort.signal });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<PreviewEvent> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end === -1) {
          const { value, done } = await reader.read();
          if (done) throw new Error("the stream ended");
          buffer += decoder.decode(value, { stream: true });
          continue;
        }
        const record = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        // The opening `retry:` record carries no data; skip to the next one.
        const data = record.split("\n").find((line) => line.startsWith("data: "));
        if (data !== undefined) return JSON.parse(data.slice("data: ".length)) as PreviewEvent;
      }
    },
  };
}

describe("preview server", () => {
  it("serves the envelope without the asset bytes", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    const res = await fetch(`${server.url}envelope`);
    const envelope = (await res.json()) as Envelope;

    expect(res.status).toBe(200);
    expect(envelope.assets?.["hero.png"]).toEqual({ hash: "aaa", mime: "image/png", size: 3 });
    expect(envelope.views).toEqual({ main: { type: "Image", src: "asset:hero.png" } });
  });

  it("serves each asset by content hash, cacheable forever", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    const res = await fetch(`${server.url}asset/aaa`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("QUJD");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("404s an unknown hash", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    const res = await fetch(`${server.url}asset/nope`);

    expect(res.status).toBe(404);
  });

  it("drops the blobs of an export that no longer has assets", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);
    server.setEnvelope(JSON.stringify({ v: 1, tokens: {}, views: {} }));

    const res = await fetch(`${server.url}asset/aaa`);

    expect(res.status).toBe(404);
  });

  // The page loads its own code from here (ZAB-57). Like `/renderer.js`, it
  // serves a build artifact, so it needs `pnpm build` first — CI runs it before
  // the tests, and an unbuilt tree gets a message that says exactly that.
  it("serves the preview client the page imports", async () => {
    const server = await start();

    const res = await fetch(`${server.url}preview.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(await res.text()).toContain("collectBindPaths");
  });

  it("answers 503 until the first export lands", async () => {
    const server = await start();

    const res = await fetch(`${server.url}envelope`);

    expect(res.status).toBe(503);
  });
});

/**
 * The bind tests need REAL port numbers, and they stay well below the ephemeral
 * range (49152+ here) on purpose: ask the OS for a free port and it hands back the
 * one it is also about to give the test's own outgoing connection, which then ends
 * up talking to itself over loopback — a flake that looks exactly like a broken
 * server. Nothing else in the file cares, so only these two pin a number.
 */
const BUSY_BASE = 5178;
const FULL_BASE = 5288;

// A busy port used to be announced anyway: the bind failed, `address()` came back
// null and the URL fell back to the port ASKED for — the preview of whatever was
// already there (ZAB-67). What the URL says must be a socket we actually own.
describe("preview server, on a busy port", () => {
  it("binds the next free port and announces that one", async () => {
    const taken = await start(BUSY_BASE);
    const busy = portOf(taken);
    taken.setEnvelope(ENVELOPE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const server = await start(busy);

    expect(portOf(server)).not.toBe(busy);
    // Ours, not the neighbour's: this one has no envelope yet.
    expect((await fetch(`${server.url}envelope`)).status).toBe(503);
    expect(warn.mock.calls.flat().join(" ")).toContain(`port ${busy} is already in use`);
    expect(warn.mock.calls.flat().join(" ")).toContain(`using ${portOf(server)} instead`);
  });

  it("says nothing when the port it asked for was free", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await start();

    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses to start when the whole range is taken", async () => {
    // Everything the walk would try. A port somebody else already holds counts as
    // taken too, so a squat that fails still leaves the range unavailable.
    for (let port = FULL_BASE; port < FULL_BASE + 10; port++) await squat(port);

    await expect(startPreviewServer(FULL_BASE)).rejects.toThrow(
      new RegExp(`preview ports ${FULL_BASE}-${FULL_BASE + 9} are all in use`),
    );
  });
});

// The dev loop's other half of "did my save land?": the page has to hear about a
// FAILED export, or it keeps showing the last good render with a green dot (ZAB-67).
describe("the reload channel", () => {
  it("asks connected pages to reload", async () => {
    const server = await start();
    const stream = await openEvents(server);

    server.notify();

    expect(await stream.next()).toEqual({ kind: "reload" });
  });

  it("pushes a failed export, newlines and all", async () => {
    const server = await start();
    const stream = await openEvents(server);

    server.notifyError("zabloo export: main.tsx\n  Unexpected token");

    expect(await stream.next()).toEqual({
      kind: "error",
      message: "zabloo export: main.tsx\n  Unexpected token",
    });
  });

  it("tells a page that connects after the failure", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);
    server.notifyError("boom");

    const stream = await openEvents(server);

    expect(await stream.next()).toEqual({ kind: "error", message: "boom" });
  });

  it("stops replaying it once an export succeeds", async () => {
    const server = await start();
    server.notifyError("boom");
    server.setEnvelope(ENVELOPE);

    const stream = await openEvents(server);
    server.notify();

    // Were the failure still held, the replay would arrive before this reload.
    expect(await stream.next()).toEqual({ kind: "reload" });
  });
});

/**
 * The DNS-rebinding guard (ZAB-78). Binding to loopback is not the defence people
 * assume: an attacker page on `evil.example` whose DNS answers 127.0.0.1 reaches
 * the preview from INSIDE the loopback, through the developer's own browser, and
 * reads whatever envelope was being worked on. What tells the two apart is the
 * `Host` the browser sends — this is the hole Vite closed with `allowedHosts`.
 */
describe("host guard", () => {
  /**
   * A request as a browser would send it, addressed to `host`.
   *
   * Raw `node:http` and not `fetch`: `Host` is a forbidden header name, so undici
   * silently drops it and every request would arrive addressed to localhost —
   * which is the one thing this whole guard is about.
   */
  function get(
    server: PreviewServer,
    path: string,
    host?: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((done, fail) => {
      const url = new URL(path, server.url);
      const req = request(
        {
          hostname: "127.0.0.1",
          port: Number(url.port),
          path: url.pathname,
          headers: host === undefined ? {} : { host },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () => done({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", fail);
      req.end();
    });
  }

  it("serves the loopback names a developer actually types", async () => {
    const server = await start();
    const port = portOf(server);
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, "[::1]", "LOCALHOST"]) {
      expect((await get(server, "/", host)).status, host).toBe(200);
    }
  });

  it("refuses a hostname that is not ours, and says how to allow it", async () => {
    const server = await start();

    const res = await get(server, "/", "evil.example");

    expect(res.status).toBe(403);
    expect(res.body).toContain("--allow-host");
  });

  it("guards the envelope and the assets, not just the page", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    expect((await get(server, "/envelope", "evil.example")).status).toBe(403);
    expect((await get(server, "/asset/aaa", "evil.example")).status).toBe(403);
    expect((await get(server, "/events", "evil.example")).status).toBe(403);
  });

  it("answers to a host that was explicitly allowed (a Codespace, a tunnel)", async () => {
    const server = await startPreviewServer(0, { allowedHosts: ["studio.example"] });
    started.push(server);

    expect((await get(server, "/", "studio.example")).status).toBe(200);
    expect((await get(server, "/", "other.example")).status).toBe(403);
  });

  it("turns the guard off entirely for `*`", async () => {
    const server = await startPreviewServer(0, { allowedHosts: ["*"] });
    started.push(server);

    expect((await get(server, "/", "anything.example")).status).toBe(200);
  });
});

describe("hostAllowed", () => {
  it("drops the port before comparing, brackets and all", () => {
    expect(hostnameOf("localhost:5078")).toBe("localhost");
    expect(hostnameOf("[::1]:5078")).toBe("[::1]");
    expect(hostnameOf("EXAMPLE.com")).toBe("example.com");
  });

  it("allows a request with no Host at all", () => {
    // Rebinding works by a browser sending an attacker's hostname, and every
    // browser sends one — so a missing header is a script talking to localhost
    // deliberately, not the attack this guard exists for.
    expect(hostAllowed(undefined, [])).toBe(true);
  });

  it("matches allowed hosts case-insensitively", () => {
    expect(hostAllowed("Studio.Example:5078", ["studio.example"])).toBe(true);
  });
});

/**
 * The SSE keepalive (ZAB-78). On localhost it changes nothing, which is exactly
 * why it was missing: through any proxy — a Codespace, a tunnel, a corporate box —
 * an idle stream is dropped after a minute and the page stops live-reloading with
 * its status dot still green.
 */
describe("keepalive", () => {
  it("pushes a comment frame down an idle stream", async () => {
    // Only the interval is faked: the socket underneath has to stay real, since
    // what is on trial is that the bytes reach the far end of the connection.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const server = await start();
      const abort = new AbortController();
      streams.push(abort);
      const res = await fetch(`${server.url}events`, { signal: abort.signal });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();

      // The opening `retry:` record, so the next read is the idle stream.
      await reader.read();
      vi.advanceTimersByTime(25_000);

      const { value } = await reader.read();
      // A comment, not an event: `data:`-less records are exactly what EventSource
      // discards, which is the point — the connection stays warm and the page is
      // told nothing it would have to act on.
      expect(decoder.decode(value)).toBe(": ping\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops pinging a stream the server has closed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const server = await start();
      const abort = new AbortController();
      streams.push(abort);
      const res = await fetch(`${server.url}events`, { signal: abort.signal });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      await reader.read(); // the opening `retry:` record

      await server.close();
      vi.advanceTimersByTime(120_000);

      // The stream is over, not idle: a ping written after the response ended
      // would be a write on a socket nobody is holding open any more.
      expect((await reader.read()).done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
