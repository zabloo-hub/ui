#!/usr/bin/env node
/**
 * The adoption funnel, run for real: `npx create-zabloo-app` → install →
 * typecheck → `zabloo export`, from OUTSIDE the monorepo.
 *
 * Why outside: inside the repo, pnpm resolves `@zabloo/*` through the workspace,
 * so a package that reaches for something only the workspace provides (a file
 * left out of `files`, a devDependency hoisted from the root, a `workspace:*`
 * that never got rewritten) still works. Here the only zabloo code that exists
 * is what `pnpm pack` put in the tarballs, in a directory with no workspace
 * above it — which is exactly what a user gets.
 *
 * The one thing this cannot reproduce is the registry: the packed tarballs
 * depend on `@zabloo/format@0.1.0` etc., which is not published yet, so the
 * scaffolded project's zabloo deps are rewritten to `file:` tarball paths. The
 * versions are faked; the package CONTENTS are not, which is what we are testing.
 *
 * Usage: pnpm smoke:external [--keep]
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Everything that would be published. `create-zabloo-app` is both the scaffolder and a dependency source. */
const PACKAGES = ["format", "react", "renderer-web", "cli", "create-zabloo-app"];

/** The project name to scaffold — also the directory name, per the scaffolder's contract. */
const PROJECT = "smoke-ui";

const keep = process.argv.includes("--keep");

function step(message) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

/** Runs a command, streaming its output; throws with the command in the message on failure. */
function run(command, args, cwd) {
  console.log(`  $ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env });
}

/**
 * Packs every publishable package into `dest` and returns `{name: tarballPath}`.
 * `pnpm pack` applies the publish-time rewrites (notably `workspace:*` → the
 * real version), so these tarballs are byte-identical to what npm would get.
 */
async function packAll(dest) {
  const tarballs = {};
  for (const dir of PACKAGES) {
    const cwd = join(REPO, "packages", dir);
    const { name } = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    const out = execFileSync("pnpm", ["pack", "--pack-destination", dest], {
      cwd,
      encoding: "utf8",
    });
    // pnpm prints the tarball path as the last non-empty line.
    const tarball = out.trim().split("\n").filter(Boolean).at(-1).trim();
    tarballs[name] = tarball;
    console.log(`  packed ${name} → ${tarball}`);
  }
  return tarballs;
}

/**
 * Points every `@zabloo/*` dependency at a local tarball — the direct ones the
 * scaffolder wrote, and via `pnpm.overrides` the transitive ones the tarballs
 * declare against a registry that has nothing under the scope yet.
 */
async function useLocalTarballs(projectDir, tarballs) {
  const path = join(projectDir, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8"));

  for (const field of ["dependencies", "devDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (tarballs[dep]) pkg[field][dep] = `file:${tarballs[dep]}`;
    }
  }

  // The scaffolded project only gets `@zabloo/format` transitively, and pnpm
  // (rightly) does not put transitive packages within import reach. The
  // validation step below needs it by name, so ask for it the way a user who
  // wanted to validate their own envelope would: as a direct dependency.
  pkg.devDependencies["@zabloo/format"] = `file:${tarballs["@zabloo/format"]}`;

  pkg.pnpm = {
    ...pkg.pnpm,
    overrides: Object.fromEntries(
      Object.entries(tarballs)
        .filter(([name]) => name.startsWith("@zabloo/"))
        .map(([name, tarball]) => [name, `file:${tarball}`]),
    ),
  };

  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * Reads the exported envelope through the `@zabloo/format` INSTALLED IN THE
 * SCAFFOLDED PROJECT — not the repo's. A validator that only passes when
 * imported from the workspace would prove nothing about what we ship.
 */
function assertValidEnvelope(projectDir) {
  const script = `
    const { readFile } = await import("node:fs/promises");
    const { readEnvelope, IR_VERSION } = await import("@zabloo/format");
    const raw = await readFile("dist/zabloo.ir.json", "utf8");

    // The string form, so the JSON parsing path is exercised too.
    const { envelope, diagnostics } = readEnvelope(raw);
    for (const d of diagnostics) console.log(\`  [\${d.level}] \${d.code} \${d.path}: \${d.message}\`);
    if (envelope === null) throw new Error("the envelope did not load");

    const views = Object.keys(envelope.views);
    if (views.length === 0) throw new Error("the envelope has no views");
    console.log(\`  valid envelope: ir v\${envelope.v} (this SDK speaks v\${IR_VERSION}), views: \${views.join(", ")}\`);
  `;
  run("node", ["--input-type=module", "-e", script], projectDir);
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "zabloo-smoke-"));
  const projectDir = join(work, PROJECT);
  console.log(`Working outside the repo, in ${work}`);

  try {
    step("Building the workspace");
    run("pnpm", ["-r", "build"], REPO);

    step("Packing the publishable packages");
    const tarballs = await packAll(work);

    step("Scaffolding from the create-zabloo-app tarball");
    // `npm exec --package=<tarball>` is the closest thing to what `npx
    // create-zabloo-app` will do once published: it installs the tarball and
    // runs its bin, so a missing shebang, a lost exec bit or a `templates/`
    // left out of `files` fails right here.
    run(
      "npm",
      [
        "exec",
        "--yes",
        `--package=file:${tarballs["create-zabloo-app"]}`,
        "--",
        "create-zabloo-app",
        PROJECT,
      ],
      work,
    );

    step("Pointing the zabloo deps at the local tarballs");
    await useLocalTarballs(projectDir, tarballs);

    step("Installing (no workspace above this directory)");
    run("pnpm", ["install", "--ignore-workspace"], projectDir);

    step("Typechecking the scaffolded project");
    run("pnpm", ["typecheck"], projectDir);

    step("Exporting the IR envelope");
    run("pnpm", ["build"], projectDir);

    step("Validating the envelope");
    assertValidEnvelope(projectDir);

    console.log("\n\x1b[32m✓ external smoke test passed\x1b[0m");
  } finally {
    if (keep) {
      console.log(`\nKept ${work} (--keep)`);
    } else {
      await rm(work, { recursive: true, force: true });
    }
  }
}

await main();
