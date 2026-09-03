#!/usr/bin/env node
import { IR_VERSION } from "@zabloo/format";
import { Command } from "commander";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("zabloo")
  .description(`zabloo/ui CLI — authoring tooling for the zabloo IR (v${IR_VERSION})`)
  .version(VERSION);

program
  .command("export")
  .description("Export the project's views (src/views/*.tsx) as a versioned IR envelope")
  .option("--cwd <dir>", "project root", ".")
  .option("--out <file>", "write the envelope here instead of <outDir>/zabloo.ir.json")
  .option("--porcelain", "machine-readable output (prints only the output file path)")
  .action(async (options: { cwd: string; out?: string; porcelain?: boolean }) => {
    const { exportProject } = await import("./export.js");
    try {
      const { outFile, viewIds, assets, assetBytes, warnings } = await exportProject(options.cwd, {
        out: options.out,
      });
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
    "Watch the project, re-export on change and serve the web preview; add --godot (or --unity) to also push each save to that engine's dev mode",
  )
  .option("--cwd <dir>", "project root", ".")
  .option("--godot", "also push each export to the running Godot game's dev mode")
  .option("--godot-port <port>", "dev-mode port of the Godot game (with --godot)", "5079")
  .option("--unity", "also push each export to the Unity editor's dev mode")
  .option("--port <port>", "dev-mode port of the Unity editor (with --unity)", "5077")
  .option("--preview-port <port>", "port of the web preview", "5078")
  .option("--open", "open the preview in the browser")
  .option("--allow-host <host>", "extra Host the preview answers to (repeatable)", collect, [])
  .action(
    async (options: {
      cwd: string;
      godot?: boolean;
      godotPort: string;
      unity?: boolean;
      port: string;
      previewPort: string;
      open?: boolean;
      allowHost: string[];
    }) => {
      const { resolve } = await import("node:path");
      const { devLoop } = await import("./dev.js");
      // `dev` only ever returns by failing (it watches until Ctrl+C), so what a
      // person sees when the loop cannot start is this message — not a stack.
      try {
        await devLoop(
          resolve(options.cwd),
          Number(options.previewPort),
          {
            ...(options.godot ? { godot: { port: Number(options.godotPort) } } : {}),
            ...(options.unity ? { unity: { port: Number(options.port) } } : {}),
          },
          { open: options.open, allowedHosts: options.allowHost },
        );
      } catch (error) {
        console.error(`zabloo dev: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
      }
    },
  );

program
  .command("validate")
  .argument("[file]", "envelope to validate (default: the project's <outDir>/zabloo.ir.json)")
  .description("Check an IR envelope against the loading contract every SDK shares")
  .option("--cwd <dir>", "project root", ".")
  .option("--json", "machine-readable report on stdout")
  .option("--strict", "fail on warnings too, not only on fatals")
  .action(
    async (
      file: string | undefined,
      options: { cwd: string; json?: boolean; strict?: boolean },
    ) => {
      const { failed, formatReport, validateEnvelope, ValidateError } = await import(
        "./validate.js"
      );
      try {
        const report = await validateEnvelope(options.cwd, file);
        const strict = options.strict === true;
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          // Diagnostics are the answer, not an aside: on stdout, where a person
          // piping the command still sees them.
          console.log(formatReport(report, strict, process.cwd()));
        }
        if (failed(report, strict)) process.exitCode = 1;
      } catch (error) {
        const message = error instanceof ValidateError ? error.message : String(error);
        console.error(`zabloo validate: ${message}`);
        process.exitCode = 1;
      }
    },
  );

program
  .command("preview")
  .argument("<envelope>", "path to an exported IR envelope (zabloo.ir.json)")
  .description("Serve the web preview for an envelope on disk — no project required")
  .option("--preview-port <port>", "port of the web preview", "5078")
  .option("--open", "open the preview in the browser")
  .option("--allow-host <host>", "extra Host the preview answers to (repeatable)", collect, [])
  .action(
    async (
      envelope: string,
      options: { previewPort: string; open?: boolean; allowHost: string[] },
    ) => {
      const { previewFile } = await import("./preview.js");
      // Like `dev`, this only returns by failing: it serves until Ctrl+C.
      try {
        await previewFile(envelope, {
          port: Number(options.previewPort),
          open: options.open,
          allowedHosts: options.allowHost,
        });
      } catch (error) {
        console.error(`zabloo preview: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
      }
    },
  );

/** Commander's accumulator for a repeatable option. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program.parse();
