/**
 * `zabloo dev` — the authoring dev loop (decision 2026-08-02, implemented
 * 2026-08-03, web-first since 2026-08-10): watch the project, re-export on
 * change and serve the live web preview. With `--unity`, each export is also
 * pushed to the Unity editor's dev mode over localhost — through the SAME
 * payload/loader path as a manual import or a production hot-update.
 *
 * Each export runs in a child process: user code executes with a clean module
 * graph every time (no stale-module cache, single React instance per run).
 *
 * Watching `src/` covers `src/assets/` too, so replacing an image re-exports and
 * reloads like any other save; the preview only re-transfers the bytes whose
 * content hash changed (ZAB-14). The engine push still carries the whole envelope
 * — deduping it against the editor's cache belongs to the Unity asset work.
 */

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startPreviewServer } from "./preview-server.js";

export async function devLoop(
  root: string,
  previewPort: number,
  unity: { port: number } | null,
): Promise<void> {
  const unityUrl = unity ? `http://127.0.0.1:${unity.port}/zabloo/envelope` : null;
  const pushToEngine = createPusher(unityUrl);
  const preview = await startPreviewServer(previewPort);

  console.log(`zabloo dev: watching ${root}`);
  console.log(`           web preview → ${preview.url}`);
  if (unityUrl) {
    console.log(`           engine push → ${unityUrl} (Unity: menu Zabloo → Dev Mode)`);
  } else {
    console.log(
      "           tip: zabloo dev --unity pushes each save to the Unity editor (Zabloo → Dev Mode)",
    );
  }

  let running = false;
  let queued = false;

  const run = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const outFile = await exportInChild(root);
      if (outFile) {
        const envelope = await readFile(outFile, "utf8");
        preview.setEnvelope(envelope); // tree and asset bytes served apart
        preview.notify(); // browser preview reloads via SSE
        await pushToEngine(envelope); // engine dev mode (no-op without --unity)
      }
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void run();
      }
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 150);
  };

  watch(join(root, "src"), { recursive: true }, schedule);
  watch(root, (_event, filename) => {
    if (filename === "zabloo.config.ts") schedule();
  });

  await run(); // initial export + push
  await new Promise<never>(() => {}); // keep watching until Ctrl+C
}

/** Push an envelope to the engine editor's dev mode; no-op when there is no target. */
export function createPusher(url: string | null): (body: string) => Promise<void> {
  if (!url) return async () => {};
  return async (body) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.ok) {
        console.log(`zabloo dev: pushed ${new Date().toLocaleTimeString()} ✔`);
      } else {
        console.error(`zabloo dev: engine rejected the push (${res.status}): ${await res.text()}`);
      }
    } catch {
      console.warn(
        "zabloo dev: exported, but the engine dev mode is not reachable — " +
          "is the Unity editor open with Zabloo → Dev Mode enabled?",
      );
    }
  };
}

/** Runs `zabloo export --porcelain` in a child process; resolves to the outFile. */
function exportInChild(root: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [process.argv[1], "export", "--cwd", root, "--porcelain"],
      {
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        const lines = stdout.trim().split("\n");
        resolvePromise(lines[lines.length - 1]?.trim() || null);
      } else {
        console.error("zabloo dev: export failed — fix the error above and save again.");
        resolvePromise(null);
      }
    });
  });
}
