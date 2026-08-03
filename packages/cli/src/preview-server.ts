/**
 * The `zabloo dev` web preview: serves a page that renders the current envelope
 * with @zabloo/renderer-web (the self-renderer — the browser is just another
 * engine target) and live-reloads over SSE on every export. No Unity required.
 */

import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";

export interface PreviewServer {
  url: string;
  /** Notifies connected browsers that a new envelope is available. */
  notify(): void;
}

export function startPreviewServer(port: number, getEnvelope: () => string | null): PreviewServer {
  const clients = new Set<ServerResponse>();
  const require = createRequire(import.meta.url);

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url.startsWith("/?")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
    } else if (url === "/renderer.js") {
      const path = require.resolve("@zabloo/renderer-web/global");
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(await readFile(path));
    } else if (url === "/envelope") {
      const envelope = getEnvelope();
      if (envelope === null) {
        res.writeHead(503);
        res.end("no envelope exported yet");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(envelope);
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
  server.listen(port, "127.0.0.1");

  return {
    url: `http://localhost:${port}/`,
    notify() {
      for (const client of clients) client.write("data: reload\n\n");
    },
  };
}

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
<header>
  <b>zabloo</b> preview
  <select id="views"></select>
  <span id="status" title="live connection"></span>
  <span id="hint">console: <code>zabloo.setData("player.gold", 900)</code></span>
</header>
<canvas id="canvas"></canvas>
<div id="log"></div>
<div id="data" class="empty"><h3>data bindings</h3><div id="fields"></div></div>
<script src="/renderer.js"></script>
<script>
  const canvas = document.getElementById("canvas");
  const views = document.getElementById("views");
  const status = document.getElementById("status");
  const logBox = document.getElementById("log");
  let handle = null;

  function log(message) {
    const line = document.createElement("div");
    line.textContent = message;
    logBox.prepend(line);
    setTimeout(() => line.remove(), 6000);
  }

  // The preview page plays the role of "the game": it discovers the envelope's
  // data-path bindings and offers inputs to push values (zabloo.setData).
  const dataValues = new Map();

  function collectBindPaths(node, paths) {
    if (node === null || typeof node !== "object") return;
    if (typeof node.bind === "string") paths.add(node.bind);
    for (const value of Object.values(node)) collectBindPaths(value, paths);
  }

  function coerce(text) {
    if (text === "true") return true;
    if (text === "false") return false;
    if (text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
    return text;
  }

  function buildDataPanel(envelope) {
    const paths = new Set();
    collectBindPaths(envelope, paths);
    const panel = document.getElementById("data");
    const fields = document.getElementById("fields");
    panel.classList.toggle("empty", paths.size === 0);
    fields.innerHTML = "";
    for (const path of [...paths].sort()) {
      const label = document.createElement("label");
      label.textContent = path;
      const input = document.createElement("input");
      input.placeholder = "value…";
      if (dataValues.has(path)) input.value = dataValues.get(path);
      input.addEventListener("input", () => {
        dataValues.set(path, input.value);
        handle.setData(path, coerce(input.value));
      });
      fields.append(label, input);
    }
  }

  function replayData() {
    for (const [path, value] of dataValues) handle.setData(path, coerce(value));
  }

  async function load(viewId) {
    const res = await fetch("/envelope");
    if (!res.ok) return;
    const json = await res.text();
    buildDataPanel(JSON.parse(json));
    if (handle && viewId === undefined) {
      handle.reload(json);
      replayData();
      return;
    }
    if (handle) handle.dispose();
    handle = ZablooRenderer.mount(canvas, json, {
      view: viewId,
      onAction: (action) => log("action: " + action),
    });
    window.zabloo = handle;
    replayData();
    if (views.options.length !== handle.viewIds.length) {
      views.innerHTML = "";
      for (const id of handle.viewIds) {
        const option = document.createElement("option");
        option.value = option.textContent = id;
        views.append(option);
      }
    }
  }

  views.addEventListener("change", () => load(views.value));

  const events = new EventSource("/events");
  events.onopen = () => status.classList.add("ok");
  events.onerror = () => status.classList.remove("ok");
  events.onmessage = () => load();

  load();
</script>
</body>
</html>
`;
