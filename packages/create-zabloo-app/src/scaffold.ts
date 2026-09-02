/**
 * What `create-zabloo-app` actually does to the disk, apart from the argv
 * parsing that drives it (`index.ts`). The split is what makes the scaffolder
 * testable: importing this runs nothing, so a test can scaffold into a tmpdir
 * and read what came out.
 */

import { cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldedVersion } from "./versions.js";

/**
 * A problem the person running the command can fix (a bad name, a directory
 * with something in it). It is reported as one line, never as a stack — an
 * `ENOENT` from the template copy is a bug and must keep looking like one.
 */
export class ScaffoldError extends Error {}

export interface ScaffoldOptions {
  /** Depend on `workspace:*` instead of the published range (the monorepo's own smoke test). */
  workspace?: boolean;
}

/**
 * The subset of npm package names we scaffold into: the directory name becomes
 * the package name verbatim, so anything npm would reject has to be rejected
 * here, while the directory is still empty.
 */
export function isValidProjectName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(name);
}

/**
 * Scaffolds a project into `dir` (created if missing, required to be empty) and
 * returns its package name — the directory's own basename.
 */
export async function scaffold(dir: string, options: ScaffoldOptions = {}): Promise<string> {
  const name = basename(dir);
  if (!isValidProjectName(name)) {
    throw new ScaffoldError(
      `"${name}" is not a valid package name (lowercase letters, digits, ".", "_", "-").`,
    );
  }

  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) {
    throw new ScaffoldError(`Directory ${dir} is not empty.`);
  }

  // Copy the template, then materialize the generated bits.
  const templates = fileURLToPath(new URL("../templates/default", import.meta.url));
  await cp(templates, dir, { recursive: true });
  // Shipped without the dot: npm drops a `.gitignore` from a published tarball.
  await rename(join(dir, "gitignore"), join(dir, ".gitignore"));

  // Never a literal: the ranges come from the versions this copy of the scaffolder
  // was released alongside, so a `changeset version` bump cannot leave new users
  // pinned to a range nobody updated (ZAB-78). See `versions.ts`.
  const react = options.workspace ? "workspace:*" : scaffoldedVersion("@zabloo/react");
  const cli = options.workspace ? "workspace:*" : scaffoldedVersion("@zabloo/cli");
  const pkg = {
    name,
    private: true,
    type: "module",
    scripts: {
      dev: "zabloo dev",
      "dev:godot": "zabloo dev --godot",
      "dev:unity": "zabloo dev --unity",
      build: "zabloo export",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@zabloo/react": react,
      react: "^19.0.0",
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@zabloo/cli": cli,
      typescript: "^5.6.0",
    },
  };
  await writeFile(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  const readmePath = join(dir, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, readme.replace(/__PROJECT_NAME__/g, name));

  return name;
}
