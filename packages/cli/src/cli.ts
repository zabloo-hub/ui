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
  .action(() => {
    console.error("zabloo export: not implemented yet — lands with the vertical slice.");
    process.exitCode = 1;
  });

program.parse();
