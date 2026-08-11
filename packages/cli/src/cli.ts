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
      const { outFile, viewIds, assets, assetBytes, warnings } = await exportProject(options.cwd);
      if (options.porcelain) {
        console.log(outFile);
      } else {
        console.log(`zabloo export: wrote ${viewIds.length} view(s) [${viewIds.join(", ")}]`);
        if (assets.length > 0) {
          const total = (assetBytes / (1024 * 1024)).toFixed(1);
          console.log(`  assets: ${assets.length} (${total} MB total)`);
          for (const asset of assets) {
            console.log(`    ${asset.id} (${(asset.bytes / 1024).toFixed(0)} KB)`);
          }
        }
        console.log(`  → ${outFile}`);
      }
      for (const warning of warnings) {
        console.warn(`zabloo export: ⚠ ${warning}`);
      }
    } catch (error) {
      console.error(`zabloo export: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  });

program
  .command("dev")
  .description(
    "Watch the project, re-export on change and serve the web preview; add --unity to also push to the Unity editor's dev mode",
  )
  .option("--cwd <dir>", "project root", ".")
  .option("--unity", "also push each export to the Unity editor's dev mode")
  .option("--port <port>", "dev-mode port of the Unity editor (with --unity)", "5077")
  .option("--preview-port <port>", "port of the web preview", "5078")
  .action(async (options: { cwd: string; unity?: boolean; port: string; previewPort: string }) => {
    const { resolve } = await import("node:path");
    const { devLoop } = await import("./dev.js");
    await devLoop(
      resolve(options.cwd),
      Number(options.previewPort),
      options.unity ? { port: Number(options.port) } : null,
    );
  });

program.parse();
