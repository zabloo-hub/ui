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
 * these tests read `@zabloo/react`'s build output — like the preview-client test,
 * they need `pnpm build` first, which CI runs before `pnpm test`.
 */

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
