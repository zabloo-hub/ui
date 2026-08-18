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
 * The filename `createProjectJiti` resolves from. It does not exist and never
 * will: it is an address inside the project, not a file. Nobody outside this
 * module should see the name — a person who never wrote it cannot act on it —
 * which is why it is a constant `sanitize` can look for (ZAB-80).
 */
const RESOLUTION_BASE = "__zabloo_export__.mjs";

/**
 * A jiti bound to the PROJECT: its resolution base sits inside `root`, so the
 * project's own `node_modules` win and user components share one React instance
 * with the reconciler.
 */
export function createProjectJiti(root: string): Jiti {
  return createJiti(pathToFileURL(join(root, RESOLUTION_BASE)).href, {
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

/**
 * Imports one of the project's REQUIRED dependencies (`react`, `@zabloo/react`)
 * and, when it is simply not installed, says so in words the person can act on.
 *
 * `export` runs the project's own components, so it resolves both FROM THE
 * PROJECT — which means a directory that is not a zabloo project, or one that
 * never got its `pnpm install`, failed with node's raw `Cannot find module` plus
 * a `Require stack` naming the internal resolution base (ZAB-80). The name meant
 * nothing to whoever read it: they never wrote that file.
 *
 * The translation is deliberately narrow — this exact specifier, missing, and
 * nothing else. A `@zabloo/react` that IS installed but cannot load because
 * something inside it is missing is a broken install, not an absent dependency,
 * and telling that person to run `pnpm install` again would send them in a
 * circle. Those errors travel on untouched.
 */
export async function importProjectDependency(
  jiti: Jiti,
  specifier: string,
  root: string,
): Promise<unknown> {
  try {
    return await jiti.import(specifier);
  } catch (error) {
    const missing =
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" &&
      error.message.split("\n")[0] === `Cannot find module '${specifier}'`;
    if (!missing) throw error;
    throw new Error(
      `${specifier} is not installed in ${root} — a zabloo project runs its own views, so it ` +
        "needs react and @zabloo/react as dependencies. Run `pnpm install` there, or point " +
        "--cwd at a zabloo project.",
    );
  }
}

/**
 * Drops any mention of the internal resolution base from a message on its way
 * out (ZAB-80).
 *
 * `importProjectDependency` covers the failure that actually happens, and this
 * covers the rest of them: whatever a project's code manages to throw, it is not
 * going to hand the reader a filename that exists in no repository. A
 * `Require stack:` left with nothing under it goes too — a header over an empty
 * list reads like something got lost, which is worse than not printing it.
 */
export function sanitize(message: string): string {
  const lines = message.split("\n").filter((line) => !line.includes(RESOLUTION_BASE));
  return lines
    .filter((line, i) => line.trim() !== "Require stack:" || lines[i + 1]?.startsWith("- "))
    .join("\n")
    .trimEnd();
}
