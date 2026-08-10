#!/usr/bin/env node
/**
 * create-zabloo-app — scaffolds a zabloo/ui project (decision 2026-08-02: the
 * Flutter/RN-style project DX). The generated project ships the full loop out
 * of the box: `pnpm dev` (web preview + engine push) and `pnpm build` (export
 * the versioned IR envelope).
 */

import { cp, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Usage: create-zabloo-app <project-directory> [--workspace]

  <project-directory>  where to scaffold (also the package name)
  --workspace          use workspace:* versions (for the zabloo monorepo itself)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspace = args.includes("--workspace");
  const target = args.find((arg) => !arg.startsWith("-"));

  if (!target || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exitCode = target ? 0 : 1;
    return;
  }

  const dir = resolve(target);
  const name = basename(dir);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    fail(`"${name}" is not a valid package name (lowercase letters, digits, ".", "_", "-").`);
    return;
  }

  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) {
    fail(`Directory ${dir} is not empty.`);
    return;
  }

  // Copy the template, then materialize the generated bits.
  const templates = fileURLToPath(new URL("../templates/default", import.meta.url));
  await cp(templates, dir, { recursive: true });
  await rename(join(dir, "gitignore"), join(dir, ".gitignore"));

  const zablooVersion = workspace ? "workspace:*" : "^0.1.0";
  const pkg = {
    name,
    private: true,
    type: "module",
    scripts: {
      dev: "zabloo dev",
      "dev:unity": "zabloo dev --unity",
      build: "zabloo export",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@zabloo/react": zablooVersion,
      react: "^19.0.0",
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@zabloo/cli": zablooVersion,
      typescript: "^5.6.0",
    },
  };
  await writeFile(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  const readmePath = join(dir, "README.md");
  const { readFile } = await import("node:fs/promises");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, readme.replace(/__PROJECT_NAME__/g, name));

  console.log(`
  Scaffolded ${name} in ${dir}

  Next steps:
    cd ${target}
    pnpm install
    pnpm dev        # web preview → http://localhost:5078
    pnpm dev:unity  # + push each save to the Unity editor (menu Zabloo → Dev Mode)
    pnpm build      # export → dist/zabloo.ir.json
`);
}

function fail(message: string): void {
  console.error(`create-zabloo-app: ${message}`);
  process.exitCode = 1;
}

await main();
