#!/usr/bin/env node
/**
 * create-zabloo-app — scaffolds a zabloo/ui project (decision 2026-08-02: the
 * Flutter/RN-style project DX). The generated project ships the full loop out
 * of the box: `pnpm dev` (web preview + engine push) and `pnpm build` (export
 * the versioned IR envelope).
 *
 * This is the command: argv in, messages out. What it writes to disk lives in
 * `scaffold.ts`, which is where the tests get at it.
 */

import { resolve } from "node:path";
import { ScaffoldError, scaffold } from "./scaffold.js";

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
  let name: string;
  try {
    name = await scaffold(dir, { workspace });
  } catch (error) {
    // Anything that is not a ScaffoldError is a bug, and keeps its stack.
    if (!(error instanceof ScaffoldError)) throw error;
    console.error(`create-zabloo-app: ${error.message}`);
    process.exitCode = 1;
    return;
  }

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

await main();
