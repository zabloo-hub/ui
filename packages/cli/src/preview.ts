/**
 * `zabloo preview <envelope.json>` — look at an artifact with no project around it
 * (ZAB-78).
 *
 * The preview server existed only as the second half of `zabloo dev`, so seeing an
 * envelope meant having the project that produced it: checked out, installed, and
 * exporting cleanly. That is the wrong shape for the two times people most want to
 * look — QA opening a build artifact, and reviewing the envelope a colleague
 * attached to a ticket.
 *
 * It is the same server and the same page as `dev`, with one thing missing: nothing
 * exports. The file on disk IS the source, and saving over it reloads the browser,
 * so pointing this at a CI artifact and re-downloading it behaves the way the dev
 * loop does.
 */

import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { readEnvelope } from "@zabloo/format";
import { openBrowser } from "./open.js";
import { startPreviewServer } from "./preview-server.js";

export interface PreviewCommandOptions {
  port: number;
  /** Extra `Host` values the server answers to — see `PreviewOptions`. */
  allowedHosts?: readonly string[];
  /** Open the URL in the browser once it is up. */
  open?: boolean;
}

export async function previewFile(file: string, options: PreviewCommandOptions): Promise<void> {
  const path = resolve(file);

  // Refused BEFORE the server is up, because the alternative is a browser tab
  // showing an empty canvas over a terminal that said everything was fine.
  const first = await readPreviewEnvelope(path);
  if (first.error !== null) throw new Error(first.error);

  const preview = await startPreviewServer(options.port, { allowedHosts: options.allowedHosts });
  preview.setEnvelope(first.json);

  console.log(`zabloo preview: ${path}`);
  console.log(`           web preview → ${preview.url}`);
  if (options.open) openBrowser(preview.url);

  const reload = async (): Promise<void> => {
    const next = await readPreviewEnvelope(path);
    if (next.error !== null) {
      preview.notifyError(next.error);
      console.error(`zabloo preview: ${next.error}`);
      return;
    }
    preview.setEnvelope(next.json);
    preview.notify();
    console.log(`zabloo preview: reloaded ${new Date().toLocaleTimeString()} \u2714`);
  };

  // The directory and not the file: saving in most editors REPLACES the file
  // (write to a temp name, rename over it), which silently kills a watcher bound
  // to the old inode — the page would just stop updating.
  const name = basename(path);
  const debounce: { timer?: ReturnType<typeof setTimeout> } = {};
  watch(dirname(path), (_event, filename) => {
    if (filename !== name) return;
    clearTimeout(debounce.timer);
    debounce.timer = setTimeout(() => void reload(), 100);
  });

  await new Promise<never>(() => {}); // serve until Ctrl+C
}

/** What the file on disk is worth serving as: its text, or the one line to show instead. */
export type PreviewSource = { json: string; error: null } | { json?: undefined; error: string };

/**
 * Reads and validates the file. Exported because it is the whole judgement the
 * command makes — everything else is a server and a watcher — and `previewFile`
 * itself never returns, so it cannot be called from a test.
 */
export async function readPreviewEnvelope(path: string): Promise<PreviewSource> {
  const json = await readFile(path, "utf8").catch(() => null);
  if (json === null) return { error: `cannot read ${path}` };
  // The same contract an SDK applies (ZAB-37): a `warn` was repaired and the view
  // is still worth showing, so only a fatal stops us. The page reports the rest
  // through `onDiagnostic` exactly as it does under `dev`.
  const { envelope, diagnostics } = readEnvelope(json);
  if (envelope === null) {
    const fatal = diagnostics.find((d) => d.level === "fatal");
    return {
      error: `${path} is not a loadable envelope — ${fatal?.message ?? "validation failed"}`,
    };
  }
  return { json, error: null };
}
