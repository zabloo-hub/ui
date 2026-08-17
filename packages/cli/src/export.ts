/**
 * `zabloo export` — executes the project's authoring code (React + @zabloo/react)
 * in Node and serializes the resulting tree into a versioned IR envelope.
 *
 * There is no bundler and nothing ships to the device but JSON: "build" = run the
 * user's components at authoring time, emit primitives, write the envelope
 * (decision 2026-08-02, project DX).
 *
 * Convention: every `src/views/*.tsx` is one document of the multi-view envelope;
 * the filename is the view ID unless the file pins one via `export const id`.
 * `react` and `@zabloo/react` are resolved FROM THE PROJECT so user components and
 * the reconciler share a single React instance.
 */

import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Envelope,
  EnvelopeError,
  IR_VERSION,
  readEnvelope,
  type TokenValue,
  type ZNode,
} from "@zabloo/format";
import { createJiti, type Jiti } from "jiti";
import { collectAssets } from "./assets.js";

interface ZablooConfig {
  outDir?: string;
}

/** Shapes we need from the project's own copies of react / @zabloo/react. */
interface ProjectReact {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
}
interface ProjectZablooReact {
  renderToIR: (element: unknown) => ZNode;
  ThemeProvider: unknown;
}

export interface ExportResult {
  outFile: string;
  viewIds: string[];
  /** Per-asset breakdown for the CLI summary (decision: el resumen imprime el desglose). */
  assets: Array<{ id: string; bytes: number }>;
  /** Decoded bytes across the asset manifest. */
  assetBytes: number;
  /**
   * What the CLI summary prints as `⚠`: the asset pass's size warnings and every
   * `warn` the envelope validation found (dangling tokens, dropped props, …).
   */
  warnings: string[];
}

export async function exportProject(rootDir: string): Promise<ExportResult> {
  const root = resolve(rootDir);
  // Resolution base inside the project → its node_modules win.
  const jiti = createJiti(pathToFileURL(join(root, "__zabloo_export__.mjs")).href, {
    interopDefault: true,
    jsx: { runtime: "automatic" },
  });

  const config = ((await tryImport(jiti, join(root, "zabloo.config.ts"))) ?? {}) as ZablooConfig;
  const theme = (await tryImport(jiti, join(root, "src", "theme.ts"))) as
    | { tokens?: Record<string, TokenValue>; variants?: unknown; transitions?: unknown }
    | undefined;
  const tokens = theme?.tokens ?? {};

  const react = (await jiti.import("react")) as ProjectReact;
  const zablooReact = (await jiti.import("@zabloo/react")) as ProjectZablooReact;

  const viewsDir = join(root, "src", "views");
  let files: string[];
  try {
    files = (await readdir(viewsDir)).filter((f) => /\.tsx?$/.test(f));
  } catch {
    throw new Error(`No views directory found at ${viewsDir}`);
  }
  if (files.length === 0) {
    throw new Error(`No view files (*.tsx) found in ${viewsDir}`);
  }

  const views: Record<string, ZNode> = {};
  for (const file of files.sort()) {
    const mod = (await jiti.import(join(viewsDir, file))) as {
      default?: unknown;
      id?: unknown;
    };
    if (typeof mod.default !== "function") {
      throw new Error(`${file}: a view must default-export a component`);
    }
    // File-based convention; `export const id` pins a stable ID across renames.
    const id = typeof mod.id === "string" ? mod.id : basename(file).replace(/\.tsx?$/, "");
    if (id in views) {
      throw new Error(`Duplicate view id "${id}" (from ${file})`);
    }
    // Views render inside the project theme so variants — and the motion
    // defaults, which are the same kind of authoring-time answer — resolve at
    // emit time. What reaches the IR is the resolved node, never the theme.
    const element = react.createElement(
      zablooReact.ThemeProvider,
      { theme: { variants: theme?.variants, transitions: theme?.transitions } },
      react.createElement(mod.default),
    );
    views[id] = zablooReact.renderToIR(element);
  }

  const collected = await collectAssets(views, join(root, "src", "assets"));
  const envelope: Envelope = { v: IR_VERSION, tokens, views };
  if (Object.keys(collected.assets).length > 0) {
    envelope.assets = collected.assets;
  }

  // The export is the last place an authoring error is cheap to fix, so the
  // envelope is validated BEFORE it is written (ZAB-37). What is written is the
  // tree the author's components produced, never the repaired one: silently
  // dropping a node from the artifact would hide the bug the warning just named.
  const { envelope: loadable, diagnostics } = readEnvelope(envelope);
  const warnings = [...collected.warnings];
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "warn") warnings.push(diagnostic.message);
  }
  if (loadable === null) throw new EnvelopeError(diagnostics);

  const outDir = resolve(root, config.outDir ?? "dist");
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "zabloo.ir.json");
  await writeFile(outFile, `${JSON.stringify(envelope, null, 2)}\n`);
  return {
    outFile,
    viewIds: Object.keys(views),
    assets: Object.entries(collected.assets).map(([id, entry]) => ({ id, bytes: entry.size })),
    assetBytes: collected.totalBytes,
    warnings,
  };
}

/**
 * Imports one of the project's OPTIONAL files (`zabloo.config.ts`, `src/theme.ts`),
 * or resolves to undefined when it is simply not there — both have defaults
 * (`outDir ?? "dist"`, `tokens ?? {}`) and a project needs neither to export.
 *
 * The absence is decided by looking at the filesystem, not by pattern-matching the
 * failure: this used to test `code === "ERR_MODULE_NOT_FOUND"`, which jiti's `.ts`
 * path never throws (it transforms to CJS and throws `MODULE_NOT_FOUND`), so the
 * fallback was dead code and a project without a config died on a raw stack that
 * even leaked the internal `__zabloo_export__.mjs` resolution base (ZAB-67).
 * Asking first also keeps a REAL error inside the file — a broken import, a typo —
 * from being swallowed as "not there", whatever code it arrives with.
 */
async function tryImport(jiti: Jiti, path: string): Promise<unknown> {
  try {
    await access(path);
  } catch {
    return undefined;
  }
  return await jiti.import(path);
}
