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

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Envelope, IR_VERSION, type TokenValue, type ZNode } from "@zabloo/format";
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
  /** Size warnings from the asset pass, for the CLI summary. */
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
    | { tokens?: Record<string, TokenValue>; variants?: unknown }
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
    // Views render inside the project theme so variants resolve at emit time.
    const element = react.createElement(
      zablooReact.ThemeProvider,
      { theme: { variants: theme?.variants } },
      react.createElement(mod.default),
    );
    views[id] = zablooReact.renderToIR(element);
  }

  const collected = await collectAssets(views, join(root, "src", "assets"));
  const envelope: Envelope = { v: IR_VERSION, tokens, views };
  if (Object.keys(collected.assets).length > 0) {
    envelope.assets = collected.assets;
  }
  const outDir = resolve(root, config.outDir ?? "dist");
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "zabloo.ir.json");
  await writeFile(outFile, `${JSON.stringify(envelope, null, 2)}\n`);
  return {
    outFile,
    viewIds: Object.keys(views),
    assets: Object.entries(collected.assets).map(([id, entry]) => ({ id, bytes: entry.size })),
    assetBytes: collected.totalBytes,
    warnings: collected.warnings,
  };
}

async function tryImport(jiti: Jiti, path: string): Promise<unknown> {
  try {
    return await jiti.import(path);
  } catch (error) {
    if (isModuleNotFound(error, path)) return undefined;
    throw error;
  }
}

function isModuleNotFound(error: unknown, path: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_MODULE_NOT_FOUND" &&
    error.message.includes(basename(path))
  );
}
