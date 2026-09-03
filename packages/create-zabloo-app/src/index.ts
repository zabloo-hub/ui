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

/**
 * Scaffolds, or prints the failure and sets the exit code. `null` means the
 * caller has nothing left to say — the message is already out.
 */
async function scaffoldOrReport(dir: string, workspace: boolean): Promise<string | null> {
  try {
    return await scaffold(dir, { workspace });
  } catch (error) {
    // Anything that is not a ScaffoldError is a bug, and keeps its stack.
    if (!(error instanceof ScaffoldError)) throw error;
    console.error(`create-zabloo-app: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
}

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
  const name = await scaffoldOrReport(dir, workspace);
  if (name === null) return;

  console.log(`
  Scaffolded ${name} in ${dir}

  Next steps:
    cd ${target}
    pnpm install
    pnpm dev        # web preview → http://localhost:5078
    pnpm dev:godot  # + hot-swap each save in the running Godot game
    pnpm build      # export → dist/zabloo.ir.json
`);
}

await main();
