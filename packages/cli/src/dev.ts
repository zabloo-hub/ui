/**
 * `zabloo dev` — the authoring dev loop (decision 2026-08-02, implemented
 * 2026-08-03, web-first since 2026-08-10): watch the project, re-export on
 * change and serve the live web preview. One flag per engine adds a push to that
 * engine's dev mode over localhost — `--godot` (G14) and `--unity`, combinable —
 * through the SAME payload/loader path as a manual import or a production
 * hot-update.
 *
 * Each export runs in a child process: user code executes with a clean module
 * graph every time (no stale-module cache, single React instance per run).
 *
 * Watching `src/` covers `src/assets/` too, so replacing an image re-exports and
 * reloads like any other save. What travels then is only what changed: the Godot
 * push carries the THIN envelope (no inlined `data`) plus the address of the
 * preview's `/asset/<hash>` route, and the game fetches the hashes it does not
 * already hold — the ZAB-14 transport, with the engine as its second consumer.
 * The Unity push still carries the whole envelope: its receiver knows nothing
 * about deferred bytes.
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

/**
 * Which engine dev modes to push to, and on which port each listens.
 *
 * One entry per engine rather than one target, because that is the shape of the
 * decision (2026-08-10, the React Native model): the web preview always runs, an
 * engine is an explicit opt-in, and two engines open at once is a normal day.
 */
interface DevEngines {
  /** The dev-mode port of the Godot game's addon autoload (`--godot`). */
  godot?: { port: number };
  /** The dev-mode port of the Unity editor (`--unity`). */
  unity?: { port: number };
}

async function devLoop(
  root: string,
  previewPort: number,
  engines: DevEngines,
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

  const preview = await startPreviewServer(previewPort, { allowedHosts: options.allowedHosts });

  const godotUrl = engines.godot ? `http://127.0.0.1:${engines.godot.port}/zabloo/envelope` : null;
  const unityUrl = engines.unity ? `http://127.0.0.1:${engines.unity.port}/zabloo/envelope` : null;
  // The Godot push is thin, so it has to say where the bytes it left out live.
  // The preview server is already serving them, content-addressed: one asset
  // store, two consumers (ZAB-14).
  const pushToGodot = createPusher(godotUrl, "Godot", { assetsBase: `${preview.url}asset/` });
  const pushToUnity = createPusher(unityUrl, "Unity");

  console.log(`zabloo dev: watching ${root}`);
  console.log(`           web preview → ${preview.url}`);
  if (options.open) openBrowser(preview.url);
  if (godotUrl)
    console.log(`           engine push → ${godotUrl} (Godot: enable the Zabloo addon)`);
  if (unityUrl) console.log(`           engine push → ${unityUrl} (Unity: menu Zabloo → Dev Mode)`);
  if (godotUrl === null && unityUrl === null) {
    console.log("           tip: zabloo dev --godot pushes each save to the running Godot game");
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
        // Tree and bytes apart; the thin half is what the Godot dev mode gets too.
        const thin = preview.setEnvelope(envelope, projectRelative(root, outFile));
        preview.notify(); // browser preview reloads via SSE
        await pushToGodot(thin); // no-op without --godot
        await pushToUnity(envelope); // no-op without --unity
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

/** How a push is shaped for one engine, beyond where it goes. */
interface PusherOptions {
  /**
   * Where the receiver fetches the asset bytes this push leaves out, sent as
   * `x-zabloo-assets`. Set for an engine that speaks the deferred-resolution
   * transport (Godot); absent means the body carries its `data` inlined (Unity).
   */
  assetsBase?: string;
}

/**
 * Push an envelope to an engine's dev mode; no-op when there is no target.
 *
 * The unreachable warning is said ONCE and then held until the receiver answers
 * again. A game that is simply not running is the normal state of an afternoon
 * spent in the browser, and a line per save about it is the noise that made the
 * engine push opt-in in the first place (2026-08-10) — while a line that never
 * comes back would leave "I pressed Play" indistinguishable from "it broke".
 */
function createPusher(
  url: string | null,
  engine: string,
  options: PusherOptions = {},
): (body: string) => Promise<void> {
  if (!url) return async () => {};
  const assetsBase = options.assetsBase;
  // `null` until something has been tried: the first save must be able to warn.
  const state: { reachable: boolean | null } = { reachable: null };
  return async (body) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(assetsBase === undefined ? {} : { "x-zabloo-assets": assetsBase }),
        },
        body,
      });
      if (res.ok) {
        // What the receiver did with it, when it says: a game that took the push
        // into no view at all looks exactly like one that took it into three.
        const took = reloadedViews(await res.text());
        const views = took === null ? "" : ` (${took} view${took === 1 ? "" : "s"})`;
        const back = state.reachable === false ? " — back" : "";
        console.log(
          `zabloo dev: pushed to ${engine} ${new Date().toLocaleTimeString()} ✔${views}${back}`,
        );
      } else {
        console.error(
          `zabloo dev: ${engine} rejected the push (${res.status}): ${await res.text()}`,
        );
      }
      state.reachable = true;
    } catch {
      if (state.reachable !== false) {
        console.warn(
          `zabloo dev: exported, but the ${engine} dev mode is not reachable at ${url} — ` +
            "saves keep exporting, and this says so once until it answers again.",
        );
      }
      state.reachable = false;
    }
  };
}

/**
 * How many views the receiver reloaded, out of its reply. Null when it did not
 * say — an older dev mode, or one that answers with something else entirely.
 */
function reloadedViews(text: string): number | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const views = (parsed as { views?: unknown } | null)?.views;
    return typeof views === "number" ? views : null;
  } catch {
    return null;
  }
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

export type { DevEngines, DevOptions };
export { createPusher, devLoop, projectRelative };
