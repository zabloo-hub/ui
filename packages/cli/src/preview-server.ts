/**
 * The `zabloo dev` web preview: serves the chrome that renders the current
 * envelope with @zabloo/renderer-web (the self-renderer — the browser is just
 * another engine target) and live-reloads over SSE on every export. No Unity
 * required.
 *
 * Assets travel apart from the tree (ZAB-14): `/envelope` serves the envelope
 * without the inlined bytes and `/asset/<hash>` serves each blob once, so a save
 * only re-transfers what actually changed. The page re-inserts the bytes before
 * mounting — the renderer always receives a complete envelope.
 *
 * This is the server half only. The page itself is `@zabloo/preview`, a private
 * React app built by Vite and copied into `dist/preview/` at build time (ZAB-99);
 * everything below is routes. The renderer no longer has a route of its own — the
 * bundle imports it as ESM — and neither does the page's script, which is one of
 * the hashed files under `/assets/`.
 */

import { access, readFile } from "node:fs/promises";
import { createServer, type RequestListener, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type AssetBlob, splitEnvelope } from "./preview-assets.js";

/**
 * What travels down the SSE stream. It carries a kind because a save can fail:
 * the page has to tell "a new envelope is ready" from "the export just broke",
 * and the second one is the whole point of the channel being typed (ZAB-67).
 */
type PreviewEvent = { kind: "reload" } | { kind: "error"; message: string };

interface PreviewServer {
  url: string;
  /**
   * Publishes the envelope exported last; splits its assets out for `/asset/<hash>`.
   *
   * `name` is WHICH file this is — `dist/zabloo.ir.json` under `dev`, the path as
   * typed under `preview <file>`. The page prints it in the statusbar and keys its
   * per-envelope memory (the remembered view) by it, so it travels with the
   * envelope rather than being fixed when the server starts: `dev` learns it from
   * the export that just finished.
   */
  setEnvelope(json: string, name?: string): void;
  /** Notifies connected browsers that a new envelope is available. */
  notify(): void;
  /**
   * Tells the browsers the last export FAILED, with the message to show. Held
   * until the next `setEnvelope`, so a page opened after the failure is told too
   * instead of trusting the stale view it fetches.
   */
  notifyError(message: string): void;
  /** Closes the server and drops connected browsers (tests / shutdown). */
  close(): Promise<void>;
}

interface PreviewOptions {
  /**
   * Extra hostnames the preview answers to, beyond the loopback names. Needed
   * whenever something in front of the server rewrites `Host` — a Codespace, an
   * SSH tunnel with a name, `ngrok`. `"*"` turns the guard off entirely.
   */
  allowedHosts?: readonly string[];
}

/**
 * The names a request may address the preview by. A browser sends the hostname the
 * PAGE was loaded from, so an attacker page on `evil.example` whose DNS points at
 * 127.0.0.1 arrives with `Host: evil.example` — and reads the envelope of whatever
 * a developer had running (DNS rebinding). This is the residual hole Vite closed
 * with `allowedHosts` (ZAB-78); binding to loopback does not close it, because the
 * victim's own browser is inside the loopback.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * The hostname out of a `Host` header, port dropped. `[::1]:5078` keeps its
 * brackets — that IS the hostname in a URL authority.
 */
function hostnameOf(header: string): string {
  const trimmed = header.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * Whether a request addressed to `header` may be served.
 *
 * A request with NO `Host` at all is allowed: rebinding works by a browser sending
 * an attacker's hostname, and every browser sends one, so a missing header is a
 * script talking to localhost on purpose — not the attack this guard is for.
 */
function hostAllowed(header: string | undefined, allowed: readonly string[]): boolean {
  if (header === undefined) return true;
  if (allowed.includes("*")) return true;
  const hostname = hostnameOf(header);
  return LOOPBACK_HOSTS.has(hostname) || allowed.some((name) => name.toLowerCase() === hostname);
}

/**
 * How often a comment frame is pushed down an idle SSE stream. On localhost it
 * changes nothing; through any proxy — a Codespace, a tunnel, a corporate box —
 * an idle connection is dropped after a minute or so and the page silently stops
 * live-reloading, with the status dot still green (ZAB-78).
 */
const PING_MS = 25_000;

async function startPreviewServer(
  port: number,
  options: PreviewOptions = {},
): Promise<PreviewServer> {
  const clients = new Set<ServerResponse>();
  const allowedHosts = [...(options.allowedHosts ?? [])];
  /**
   * What the server is currently serving: the envelope without its asset bytes,
   * those bytes by hash, which file it came from, and the failure the last export
   * reported (until one succeeds).
   */
  const served: {
    thin: string | null;
    blobs: Map<string, AssetBlob>;
    name: string | null;
    failure: string | null;
  } = {
    thin: null,
    blobs: new Map(),
    name: null,
    failure: null,
  };

  const handler: RequestListener = async (req, res) => {
    const url = req.url ?? "/";
    if (!hostAllowed(req.headers.host, allowedHosts)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end(
        `zabloo preview refuses requests for host "${req.headers.host}" — ` +
          "it answers to localhost only. Behind a proxy or a Codespace, pass " +
          "--allow-host <host>.\n",
      );
      return;
    }
    const path = pathOf(url);
    if (PAGE_PATHS.has(path)) {
      // `no-cache` and not `no-store`: the file is revalidated on every load — it
      // names the hashed bundle, and a stale copy would point at an asset that a
      // rebuild has already renamed — but a 304 is still allowed to answer.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(await readFile(join(await previewBundlePath(), "index.html")));
    } else if (path.startsWith("/assets/")) {
      await serveAsset(res, await previewBundlePath(), path);
    } else if (path === "/envelope") {
      if (served.thin === null) {
        res.writeHead(503);
        res.end("no envelope exported yet");
      } else {
        res.writeHead(200, {
          "content-type": "application/json",
          // Which file this is, for the statusbar and the per-envelope memory
          // (ZAB-99). Omitted rather than guessed when nobody said: the page has
          // its own fallback, and inventing a name here would key someone's
          // remembered view to a file that does not exist.
          ...(served.name === null ? {} : { "x-zabloo-envelope-name": served.name }),
        });
        res.end(served.thin);
      }
    } else if (path.startsWith("/asset/")) {
      // Content-addressed: the bytes behind a hash never change, so the browser
      // may keep them forever. The payload is the entry's `data` field verbatim
      // (base64) — the page pastes it back in without re-encoding.
      const blob = served.blobs.get(path.slice("/asset/".length));
      if (blob === undefined) {
        res.writeHead(404);
        res.end("unknown asset hash");
      } else {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
          "x-zabloo-mime": blob.mime,
        });
        res.end(blob.base64);
      }
    } else if (path === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 500\n\n");
      // A page that connects while the export is broken hears about it right
      // away: what it just fetched from `/envelope` is the last GOOD export, and
      // nothing else on the page would say so.
      if (served.failure !== null) {
        res.write(frame({ kind: "error", message: served.failure }));
      }
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else {
      res.writeHead(404);
      res.end();
    }
  };

  const { server, port: boundPort } = await listen(handler, port);
  // `unref` so the ping never becomes the reason the process stays alive: `dev`
  // is kept up by the watcher, and a test that closes the server must be able to
  // let the event loop drain.
  const ping = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, PING_MS);
  ping.unref();

  // Only runtime failures reach here: binding is over, and an unhandled `error`
  // event on the server would take the whole dev loop down with it.
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`zabloo dev: preview server error — ${error.message}`);
  });

  return {
    url: `http://localhost:${boundPort}/`,
    setEnvelope(json, name) {
      const split = splitEnvelope(json);
      served.thin = split.thin;
      served.blobs = split.blobs;
      served.name = name ?? null;
      served.failure = null;
    },
    notify() {
      for (const client of clients) client.write(frame({ kind: "reload" }));
    },
    notifyError(message) {
      served.failure = message;
      for (const client of clients) client.write(frame({ kind: "error", message }));
    },
    close() {
      clearInterval(ping);
      for (const client of clients) client.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * One SSE frame. `JSON.stringify` is also what keeps the frame single-line — an
 * export error is a multi-line stack, and a raw newline would cut the message in
 * half (SSE splits records on blank lines).
 */
function frame(event: PreviewEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** How many ports after the requested one the preview will try before giving up. */
const PORT_ATTEMPTS = 10;

/**
 * Serves `handler` on the requested port, walking forward while that one is taken,
 * and returns the socket together with the port it ACTUALLY got (port 0 = let the
 * OS pick, so it binds on the first try).
 *
 * The walk is what keeps `zabloo dev` honest (ZAB-67). The old code let a failed
 * bind through — it settled the promise on `error` and carried on — so a second
 * `dev` printed `web preview → http://localhost:5078/` and exited 0 while that URL
 * served ANOTHER project's preview: you would edit here and watch a page that
 * never changed. Reporting `address().port` after a bind that really happened
 * makes that state unreachable; if every candidate is taken we refuse to start.
 *
 * Each attempt gets its OWN server: an `http.Server` whose first `listen` failed
 * answers the next one's requests by echoing them back, so retrying on the same
 * object trades a wrong URL for a port that speaks no HTTP.
 */
async function listen(
  handler: RequestListener,
  first: number,
): Promise<{ server: Server; port: number }> {
  for (const port of Array.from({ length: PORT_ATTEMPTS }, (_, i) => first + i)) {
    const server = createServer(handler);
    try {
      await bind(server, port);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      continue; // nothing was bound: drop this one and try the next port
    }
    const address = server.address();
    const bound = typeof address === "object" && address !== null ? address.port : port;
    if (port !== first) {
      console.warn(
        `zabloo dev: preview port ${first} is already in use (another zabloo dev?) — ` +
          `using ${bound} instead`,
      );
    }
    return { server, port: bound };
  }
  throw new Error(
    `preview ports ${first}-${first + PORT_ATTEMPTS - 1} are all in use — ` +
      `free one or pick another with --preview-port`,
  );
}

/** One `listen` attempt: resolves once bound, rejects with the socket's error. */
function bind(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * The pathname of a request, without the query string and percent-decoded.
 *
 * Decoding matters before anything is compared or joined: `/assets/%2e%2e/` is
 * the same traversal as `/assets/../`, and a route table that only ever saw the
 * raw form would hand it straight to `join`. A URL that will not decode is
 * answered as itself, which matches nothing and 404s.
 */
function pathOf(url: string): string {
  const raw = url.split("?")[0] ?? "/";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The paths the chrome's `index.html` answers. `/kit` is the UI kit (ZAB-98):
 * the same bundle, which picks its page from `location.pathname`, so there is no
 * router here — there are exactly two pages and this is the whole route table.
 */
const PAGE_PATHS = new Set(["/", "/index.html", "/kit", "/kit/"]);

/** What Vite emits under `assets/`, by extension. */
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".map": "application/json",
};

/**
 * One of the bundle's static files.
 *
 * Everything under `assets/` is content-hashed by Vite, so it may be cached
 * forever — the same bargain `/asset/<hash>` makes, for the same reason: a
 * rebuild renames the file rather than changing it.
 *
 * The resolved path is checked to be INSIDE the bundle before it is opened.
 * `join` collapses `..` happily, and the one thing a static route must never do
 * is read a file the URL walked out to — this server also holds the envelope of
 * whatever project is running.
 */
async function serveAsset(res: ServerResponse, bundle: string, path: string): Promise<void> {
  const assets = join(bundle, "assets");
  const file = resolve(bundle, `.${path}`);
  if (file !== assets && !file.startsWith(assets + sep)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const body = await readFile(file).catch(() => null);
  if (body === null) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
  });
  res.end(body);
}

/**
 * The preview chrome's build output (`@zabloo/preview`), copied here by the CLI's
 * own build. Bundled it sits beside `cli.js` in `dist/preview`; running from `src`
 * (the tests) it is one directory over, in the `dist/` of the same package.
 */
async function previewBundlePath(): Promise<string> {
  const candidates = ["./preview/", "../dist/preview/"];
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    try {
      await access(join(path, "index.html"));
      return path;
    } catch {}
  }
  throw new Error("zabloo dev: preview UI not built — run `pnpm build` in @zabloo/cli");
}

export type { PreviewEvent, PreviewOptions, PreviewServer };
export { hostAllowed, hostnameOf, startPreviewServer };
