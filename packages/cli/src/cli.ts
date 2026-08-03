#!/usr/bin/env node
import { IR_VERSION } from "@zabloo/format";
import { Command } from "commander";

const program = new Command();

program
  .name("zabloo")
  .description(`zabloo/ui CLI — authoring tooling for the zabloo IR (v${IR_VERSION})`)
  .version("0.1.0");

program
  .command("export")
  .description("Export the project's views (src/views/*.tsx) as a versioned IR envelope")
  .option("--cwd <dir>", "project root", ".")
  .option("--porcelain", "machine-readable output (prints only the output file path)")
  .action(async (options: { cwd: string; porcelain?: boolean }) => {
    const { exportProject } = await import("./export.js");
    try {
      const { outFile, viewIds } = await exportProject(options.cwd);
      if (options.porcelain) {
        console.log(outFile);
      } else {
        console.log(`zabloo export: wrote ${viewIds.length} view(s) [${viewIds.join(", ")}]`);
        console.log(`  → ${outFile}`);
      }
    } catch (error) {
      console.error(`zabloo export: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  });

program
  .command("dev")
  .description("Watch the project, re-export on change and push to the engine editor's dev mode")
  .option("--cwd <dir>", "project root", ".")
  .option("--port <port>", "dev-mode port of the engine editor", "5077")
  .action(async (options: { cwd: string; port: string }) => {
    const { resolve } = await import("node:path");
    const { devLoop } = await import("./dev.js");
    await devLoop(resolve(options.cwd), Number(options.port));
  });

program.parse();
