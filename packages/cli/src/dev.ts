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
import { isAbsolute, join, relative, sep } from "node:path";
import { openBrowser } from "./open.js";
import { startPreviewServer } from "./preview-server.js";

interface DevOptions {
  /** Extra `Host` values the preview answers to — see `PreviewOptions`. */
  allowedHosts?: readonly string[];
  /** Open the preview in the browser once it is up. */
  open?: boolean;
}

async function devLoop(
  root: string,
  previewPort: number,
  unity: { port: number } | null,
  options: DevOptions = {},
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
  const preview = await startPreviewServer(previewPort, { allowedHosts: options.allowedHosts });

  console.log(`zabloo dev: watching ${root}`);
  console.log(`           web preview → ${preview.url}`);
  if (options.open) openBrowser(preview.url);
  if (unityUrl) {
    console.log(`           engine push → ${unityUrl} (Unity: menu Zabloo → Dev Mode)`);
  } else {
    console.log(
      "           tip: zabloo dev --unity pushes each save to the Unity editor (Zabloo → Dev Mode)",
    );
  }

  // One export at a time; saves that land during a run collapse into one rerun.
  const state = { running: false, queued: false };

  const run = async () => {
    if (state.running) {
      state.queued = true;
      return;
    }
    state.running = true;
    try {
      const { outFile, error } = await exportInChild(root);
      if (outFile) {
        const envelope = await readFile(outFile, "utf8");
        // Named by where it sits in the project, not by its absolute path: the
        // page prints this in the statusbar (ZAB-99), and `dist/zabloo.ir.json`
        // is the answer to "which file am I looking at" — `/Users/…/dist/…` is
        // the same answer with the part you already knew in front of it.
        preview.setEnvelope(envelope, projectRelative(root, outFile)); // tree and bytes apart
        preview.notify(); // browser preview reloads via SSE
        await pushToEngine(envelope); // engine dev mode (no-op without --unity)
      } else {
        // The failure goes where you are looking: the page keeps the last good
        // render, so without this the only report is a terminal line, and "I
        // saved and nothing happened" is the most confusing state of all (ZAB-67).
        preview.notifyError(error);
      }
    } finally {
      state.running = false;
      if (state.queued) {
        state.queued = false;
        void run();
      }
    }
  };

  const debounce: { timer?: ReturnType<typeof setTimeout> } = {};
  const schedule = () => {
    clearTimeout(debounce.timer);
    debounce.timer = setTimeout(() => void run(), 150);
  };

  watch(srcDir, { recursive: true }, schedule);
  watch(root, (_event, filename) => {
    if (filename === "zabloo.config.ts") schedule();
  });

  await run(); // initial export + push
  await new Promise<never>(() => {}); // keep watching until Ctrl+C
}

/**
 * Where the exported envelope sits inside the project, in POSIX separators.
 *
 * The separators are normalized because this is a LABEL, shown in a browser and
 * used as a storage key: `dist\\zabloo.ir.json` on Windows and `dist/zabloo.ir.json`
 * everywhere else would be two different envelopes to the page's memory, for the
 * same file in the same project.
 *
 * A path that does not live under the root (`--out ../elsewhere.json`) keeps its
 * absolute form: a relative path climbing out with `..` says less than the path
 * itself.
 */
function projectRelative(root: string, outFile: string): string {
  const inside = relative(root, outFile);
  // Also covers the Windows case of two different drives, where `relative` gives
  // up and hands back the absolute path it was asked about.
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return outFile;
  }
  return inside.split(sep).join("/");
}

/** Push an envelope to the engine editor's dev mode; no-op when there is no target. */
function createPusher(url: string | null): (body: string) => Promise<void> {
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
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
      process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) {
        const outFile = stdout.join("").trim().split("\n").at(-1)?.trim();
        resolvePromise(
          outFile
            ? { outFile, error: "" }
            : { outFile: null, error: "export printed no envelope path" },
        );
      } else {
        console.error("zabloo dev: export failed — fix the error above and save again.");
        resolvePromise({
          outFile: null,
          error: stderr.join("").trim() || `export failed (exit ${code})`,
        });
      }
    });
  });
}

export type { DevOptions };
export { createPusher, devLoop, projectRelative };
