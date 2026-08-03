/**
 * `zabloo dev` — the authoring dev loop (decision 2026-08-02, implemented
 * 2026-08-03): watch the project, re-export on change, and push the envelope to
 * the engine editor's dev mode over localhost. The push goes through the SAME
 * payload/loader path as a manual import or a production hot-update — the dev
 * loop dogfoods hot-update.
 *
 * Each export runs in a child process: user code executes with a clean module
 * graph every time (no stale-module cache, single React instance per run).
 */

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startPreviewServer } from "./preview-server.js";

export async function devLoop(root: string, port: number, previewPort: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/zabloo/envelope`;
  let lastEnvelope: string | null = null;
  const preview = startPreviewServer(previewPort, () => lastEnvelope);

  console.log(`zabloo dev: watching ${root}`);
  console.log(`           engine push → ${url} (Unity: menu Zabloo → Dev Mode)`);
  console.log(`           web preview → ${preview.url}`);

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
        lastEnvelope = await readFile(outFile, "utf8");
        preview.notify(); // browser preview reloads via SSE
        await push(lastEnvelope, url); // engine dev mode (if open)
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

async function push(body: string, url: string): Promise<void> {
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
}
