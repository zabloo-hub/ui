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
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startPreviewServer } from "./preview-server.js";

export async function devLoop(
  root: string,
  previewPort: number,
  unity: { port: number } | null,
): Promise<void> {
  // Before anything is announced: `watch()` on a missing directory throws from
  // libuv, and it used to do it AFTER the banner claimed everything was up — a
  // raw UVException under a success message (ZAB-67).
  const srcDir = join(root, "src");
  try {
    await access(srcDir);
  } catch {
    throw new Error(
      `no src/ directory in ${root} — is this a zabloo project? ` +
        `(scaffold one: npx create-zabloo-app)`,
    );
  }

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
      const { outFile, error } = await exportInChild(root);
      if (outFile) {
        const envelope = await readFile(outFile, "utf8");
        preview.setEnvelope(envelope); // tree and asset bytes served apart
        preview.notify(); // browser preview reloads via SSE
        await pushToEngine(envelope); // engine dev mode (no-op without --unity)
      } else {
        // The failure goes where you are looking: the page keeps the last good
        // render, so without this the only report is a terminal line, and "I
        // saved and nothing happened" is the most confusing state of all (ZAB-67).
        preview.notifyError(error);
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

  watch(srcDir, { recursive: true }, schedule);
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

/** What one export attempt produced: the envelope's path, or the message to show. */
interface ChildExport {
  outFile: string | null;
  /** The child's stderr, for the preview overlay; empty while `outFile` is set. */
  error: string;
}

/**
 * Runs `zabloo export --porcelain` in a child process.
 *
 * stderr is piped rather than inherited so a failure can be REPORTED (the page's
 * overlay needs the text), and mirrored to ours as it arrives so the terminal
 * behaves exactly as before.
 */
function exportInChild(root: string): Promise<ChildExport> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [process.argv[1], "export", "--cwd", root, "--porcelain"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) {
        const outFile = stdout.trim().split("\n").at(-1)?.trim();
        resolvePromise(
          outFile
            ? { outFile, error: "" }
            : { outFile: null, error: "export printed no envelope path" },
        );
      } else {
        console.error("zabloo dev: export failed — fix the error above and save again.");
        resolvePromise({ outFile: null, error: stderr.trim() || `export failed (exit ${code})` });
      }
    });
  });
}
