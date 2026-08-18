/**
 * Where a project's files are, as `export` and `validate` both need to know.
 *
 * `zabloo validate` has to open the envelope the project last wrote, and the only
 * thing that knows where that is, is `zabloo.config.ts` — so the config reading
 * that used to live inside `export.ts` is shared from here rather than guessed at
 * a second time (ZAB-78). A project with `outDir: "build"` would otherwise be
 * validating a path that never exists.
 */

import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti, type Jiti } from "jiti";

export interface ZablooConfig {
  outDir?: string;
}

/** Where the envelope goes when `zabloo.config.ts` does not say otherwise. */
export const DEFAULT_OUT_DIR = "dist";

/** The envelope's filename inside `outDir` — the name every SDK example loads. */
export const ENVELOPE_FILENAME = "zabloo.ir.json";

/**
 * A jiti bound to the PROJECT: its resolution base sits inside `root`, so the
 * project's own `node_modules` win and user components share one React instance
 * with the reconciler.
 */
export function createProjectJiti(root: string): Jiti {
  return createJiti(pathToFileURL(join(root, "__zabloo_export__.mjs")).href, {
    interopDefault: true,
    jsx: { runtime: "automatic" },
  });
}

/** The project's `zabloo.config.ts`, or an empty config when it has none. */
export async function loadConfig(
  root: string,
  jiti: Jiti = createProjectJiti(root),
): Promise<ZablooConfig> {
  return ((await tryImport(jiti, join(root, "zabloo.config.ts"))) ?? {}) as ZablooConfig;
}

/**
 * The absolute path of the envelope: `--out` if it was given (relative to the
 * project root, like every other path the CLI takes), otherwise
 * `<outDir>/zabloo.ir.json`.
 */
export function resolveOutFile(root: string, config: ZablooConfig, out?: string): string {
  if (out !== undefined) return resolve(root, out);
  return join(resolve(root, config.outDir ?? DEFAULT_OUT_DIR), ENVELOPE_FILENAME);
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
export async function tryImport(jiti: Jiti, path: string): Promise<unknown> {
  try {
    await access(path);
  } catch {
    return undefined;
  }
  return await jiti.import(path);
}
