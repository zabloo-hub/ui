/**
 * `zabloo export` against real projects on disk (ZAB-67).
 *
 * What this covers that nothing else did: a project that has ONLY views. Both
 * `zabloo.config.ts` and `src/theme.ts` are optional by design, but every project
 * CI exercised — the scaffolded ones in `verify-pack` and `smoke-external`, the
 * examples — ships both, so the fallback path was never run and had been dead for
 * a while: a first-run export in a hand-made project died on a raw stack.
 *
 * The fixture borrows an example's `node_modules`, because that is the one thing a
 * test cannot fake: the export runs the project's code through jiti, which resolves
 * `react` and `@zabloo/react` FROM THE PROJECT so the reconciler and the user's
 * components share a single React instance. The example's link farm is exactly
 * that layout, so the export resolves what a user's project would. It does mean
 * these tests read `@zabloo/react`'s build output — like the preview server's,
 * they need `pnpm build` first, which CI runs before `pnpm test`.
 */

import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope } from "@zabloo/format";
import { beforeAll, describe, expect, it } from "vitest";
import { exportProject } from "./export.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
/** Any example works; this is the smallest one. */
const PROJECT_MODULES = join(REPO, "examples", "hello-button", "node_modules");

const VIEW = `import { Text } from "@zabloo/react";

export default function Main() {
  return <Text>hola</Text>;
}
`;

// The project resolves `@zabloo/react` through its package entry, which points at
// `dist/`. A fresh clone has none, and jiti's failure would not hint at why.
beforeAll(async () => {
  try {
    await access(join(REPO, "packages", "react", "dist"));
  } catch {
    throw new Error("@zabloo/react is not built — run `pnpm build` before these tests");
  }
});

/** A project with views and nothing else: no config, no theme, no assets. */
async function project(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zabloo-export-"));
  await symlink(PROJECT_MODULES, join(root, "node_modules"), "junction");
  for (const [path, content] of Object.entries({ "src/views/main.tsx": VIEW, ...files })) {
    const file = join(root, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

/**
 * A directory with NO `node_modules` — the state every project is in before its
 * first `pnpm install`, and the state every directory that is not a project is
 * in permanently. `project()` cannot express it: the symlink is the whole point
 * of that fixture.
 */
async function directory(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zabloo-export-"));
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

async function readIR(outFile: string): Promise<Envelope> {
  return JSON.parse(await readFile(outFile, "utf8")) as Envelope;
}

describe("exportProject", () => {
  it("exports a project that has neither config nor theme", async () => {
    const root = await project();

    const result = await exportProject(root);

    expect(result.outFile).toBe(join(root, "dist", "zabloo.ir.json"));
    expect(result.viewIds).toEqual(["main"]);
    const envelope = await readIR(result.outFile);
    // The defaults both files stand in for: `dist` and an empty token dictionary.
    expect(envelope.tokens).toEqual({});
    expect(envelope.views.main).toMatchObject({ type: "Text", text: "hola" });
  });

  it("still reads the config and the theme when the project does have them", async () => {
    const root = await project({
      "zabloo.config.ts": `export default { outDir: "build" };\n`,
      "src/theme.ts": `export const tokens = { "color.primary": "#4f46e5" };\n`,
    });

    const result = await exportProject(root);

    expect(result.outFile).toBe(join(root, "build", "zabloo.ir.json"));
    expect((await readIR(result.outFile)).tokens).toEqual({ "color.primary": "#4f46e5" });
  });

  // `--out` (ZAB-78): one project, several artifacts, from a CI matrix that has
  // no place to put a config file per row.
  it("writes where --out says, creating the directory on the way", async () => {
    const root = await project();

    const result = await exportProject(root, { out: "artifacts/en/ui.json" });

    expect(result.outFile).toBe(join(root, "artifacts", "en", "ui.json"));
    expect((await readIR(result.outFile)).views.main).toMatchObject({ type: "Text" });
  });

  it("lets --out win over the config's outDir", async () => {
    const root = await project({ "zabloo.config.ts": `export default { outDir: "build" };\n` });

    const result = await exportProject(root, { out: "elsewhere/ui.json" });

    expect(result.outFile).toBe(join(root, "elsewhere", "ui.json"));
  });

  // "Optional" means absent, never broken: a theme that throws on import is an
  // authoring error, and swallowing it would export a themeless envelope while
  // the author stares at a file full of tokens.
  it("reports an error inside an optional file instead of treating it as missing", async () => {
    const root = await project({
      "src/theme.ts": `import { nope } from "./does-not-exist.js";\nexport const tokens = nope;\n`,
    });

    await expect(exportProject(root)).rejects.toThrow(/does-not-exist/);
  });
});

/**
 * What a person gets for pointing the CLI at a directory that is not a project,
 * or at one they have not installed yet (ZAB-80). Both used to end in node's raw
 * `Cannot find module 'react'` over a `Require stack` naming
 * `__zabloo_export__.mjs` — a file the reader never wrote and cannot find,
 * because it does not exist anywhere.
 *
 * These run the BUILT CLI in a child process, which the rest of the file does
 * not need to do. It is not ceremony: the bug is about how a bare specifier
 * resolves FROM THE PROJECT, and under Vitest bare specifiers resolve through
 * Vite from the repo root instead — so in-process every one of these directories
 * finds the repo's own `react` and the failure never happens. The child process
 * is the only place the real resolution runs, and it is also the literal command
 * the ticket reproduced with.
 */
describe("zabloo export, in a directory it cannot export", () => {
  const CLI = join(REPO, "packages", "cli", "dist", "cli.js");

  beforeAll(async () => {
    try {
      await access(CLI);
    } catch {
      throw new Error("@zabloo/cli is not built — run `pnpm build` before these tests");
    }
  });

  /**
   * stderr of `zabloo export --cwd root`, which must have failed.
   *
   * Without `NODE_PATH`, which the runner puts in this process's environment
   * pointing at pnpm's hoisted store (`node_modules/.pnpm/node_modules`) and a
   * child would inherit. Every bare specifier resolves from there, so the
   * project's empty `node_modules` never gets a say and `react` is found no
   * matter what directory we point at. No user's shell has that variable — it is
   * an artifact of running inside this monorepo, and letting it through would
   * make these tests pass on a CLI that is still broken.
   */
  function exportCli(root: string): string {
    const { NODE_PATH: _, ...env } = process.env;
    const result = spawnSync(process.execPath, [CLI, "export", "--cwd", root], {
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(1);
    return result.stderr;
  }

  it("says the views are missing, not that react is", async () => {
    const root = await directory();

    // The specific answer, and the one that was unreachable: a directory with no
    // `src/views/` has no `node_modules` either, so the dependency import spoke
    // first and drowned it.
    expect(exportCli(root)).toContain(`No views directory found at ${join(root, "src", "views")}`);
  });

  it("names the missing dependency and what to do about it", async () => {
    const root = await directory({ "src/views/main.tsx": VIEW });

    expect(exportCli(root)).toMatch(/react is not installed in .* Run `pnpm install` there/s);
  });

  it("never names the internal resolution base", async () => {
    for (const root of [await directory(), await directory({ "src/views/main.tsx": VIEW })]) {
      const stderr = exportCli(root);

      expect(stderr).not.toContain("__zabloo_export__");
      expect(stderr).not.toContain("Require stack");
    }
  });
});
