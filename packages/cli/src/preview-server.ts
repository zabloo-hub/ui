/**
 * The `zabloo dev` web preview: serves a page that renders the current envelope
 * with @zabloo/renderer-web (the self-renderer — the browser is just another
 * engine target) and live-reloads over SSE on every export. No Unity required.
 *
 * Assets travel apart from the tree (ZAB-14): `/envelope` serves the envelope
 * without the inlined bytes and `/asset/<hash>` serves each blob once, so a save
 * only re-transfers what actually changed. The page re-inserts the bytes before
 * mounting — the renderer always receives a complete envelope.
 *
 * This is the server half only: what the page DOES lives in `preview-client.ts`,
 * served here as `/preview.js` (ZAB-57). Everything left below is HTML, CSS and
 * routes.
 */

import { access, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { type AssetBlob, splitEnvelope } from "./preview-assets.js";

export interface PreviewServer {
  url: string;
  /** Publishes the envelope exported last; splits its assets out for `/asset/<hash>`. */
  setEnvelope(json: string): void;
  /** Notifies connected browsers that a new envelope is available. */
  notify(): void;
  /** Closes the server and drops connected browsers (tests / shutdown). */
  close(): Promise<void>;
}

export async function startPreviewServer(port: number): Promise<PreviewServer> {
  const clients = new Set<ServerResponse>();
  const require = createRequire(import.meta.url);
  let thin: string | null = null;
  let blobs = new Map<string, AssetBlob>();

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url.startsWith("/?")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
    } else if (url === "/renderer.js") {
      const path = require.resolve("@zabloo/renderer-web/global");
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(await readFile(path));
    } else if (url === "/preview.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(await readFile(await previewClientPath()));
    } else if (url === "/envelope") {
      if (thin === null) {
        res.writeHead(503);
        res.end("no envelope exported yet");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(thin);
      }
    } else if (url.startsWith("/asset/")) {
      // Content-addressed: the bytes behind a hash never change, so the browser
      // may keep them forever. The payload is the entry's `data` field verbatim
      // (base64) — the page pastes it back in without re-encoding.
      const blob = blobs.get(url.slice("/asset/".length));
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
    } else if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 500\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `zabloo dev: preview port ${port} is already in use — is another zabloo dev running? ` +
          `(kill it or use --preview-port)`,
      );
    } else {
      console.error(`zabloo dev: preview server error — ${error.message}`);
    }
  });

  // Wait for the socket so the announced URL carries the port actually bound
  // (port 0 = pick a free one). A failure to listen is already reported above;
  // dev keeps running with the preview down instead of dying.
  await new Promise<void>((settle) => {
    server.once("listening", settle);
    server.once("error", () => settle());
    server.listen(port, "127.0.0.1");
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    url: `http://localhost:${boundPort}/`,
    setEnvelope(json) {
      const split = splitEnvelope(json);
      thin = split.thin;
      blobs = split.blobs;
    },
    notify() {
      for (const client of clients) client.write("data: reload\n\n");
    },
    close() {
      for (const client of clients) client.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The page's own script (`preview-client.ts`), built by tsup next to this file.
 * Bundled it sits beside `cli.js` in `dist/`; running from `src` (the tests) it
 * is one directory over, in the `dist/` of the same package.
 */
async function previewClientPath(): Promise<string> {
  const candidates = ["./preview-client.js", "../dist/preview-client.js"];
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error("zabloo dev: preview client not built — run `pnpm build` in @zabloo/cli");
}

/**
 * The page's markup. Exported so the client's tests wire themselves to the SAME
 * ids the page serves: `start()` looks these up by name, and a rename that only
 * happened on one side has to fail somewhere.
 */
export const PREVIEW_BODY = /* html */ `<header>
  <b>zabloo</b> preview
  <select id="views"></select>
  <span id="status" title="live connection"></span>
  <span id="pad" class="off" title="d-pad/stick: focus · A: press · B: back · right stick: scroll">🎮 gamepad</span>
  <span id="hint">console: <code>zabloo.setData("player.gold", 900)</code></span>
</header>
<canvas id="canvas"></canvas>
<div id="log"></div>
<div id="data" class="empty"><h3>data bindings</h3><div id="fields"></div></div>`;

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>zabloo preview</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; background: #0b0d12; color: #e5e7eb;
         font: 13px/1.4 system-ui, sans-serif; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 14px;
           background: #14161f; border-bottom: 1px solid #232633; }
  header b { color: #818cf8; }
  select { background: #1f2430; color: inherit; border: 1px solid #2f3446;
           border-radius: 6px; padding: 3px 8px; }
  #status { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
  #status.ok { background: #4ade80; }
  #pad { color: #818cf8; letter-spacing: .04em; }
  #pad.off { display: none; }
  #hint { margin-left: auto; color: #6b7280; }
  canvas { flex: 1; width: 100%; display: block; }
  #log { position: fixed; left: 12px; bottom: 12px; max-height: 30%; overflow: auto;
         display: flex; flex-direction: column-reverse; gap: 2px; pointer-events: none; }
  #log div { background: #14161fd9; border: 1px solid #232633; border-radius: 6px;
             padding: 3px 10px; color: #4ade80; }
  #data { position: fixed; right: 12px; top: 48px; width: 230px; background: #14161fd9;
          border: 1px solid #232633; border-radius: 8px; padding: 10px; }
  #data h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
             color: #6b7280; margin-bottom: 8px; }
  #data label { display: block; color: #9aa4b2; margin: 6px 0 2px; font-size: 12px; }
  #data input { width: 100%; background: #1f2430; color: #e5e7eb; border: 1px solid #2f3446;
                border-radius: 6px; padding: 4px 8px; font: inherit; }
  #data.empty { display: none; }
</style>
</head>
<body>
${PREVIEW_BODY}
<script src="/renderer.js"></script>
<script type="module">
  import { start } from "/preview.js";
  start();
</script>
</body>
</html>
`;
