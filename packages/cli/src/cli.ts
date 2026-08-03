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
  .action(async (options: { cwd: string }) => {
    const { exportProject } = await import("./export.js");
    try {
      const { outFile, viewIds } = await exportProject(options.cwd);
      console.log(`zabloo export: wrote ${viewIds.length} view(s) [${viewIds.join(", ")}]`);
      console.log(`  → ${outFile}`);
    } catch (error) {
      console.error(`zabloo export: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  });

program.parse();
