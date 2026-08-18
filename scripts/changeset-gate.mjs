/**
 * changeset-gate — every change that reaches a tarball carries a changeset (ZAB-78).
 *
 * The pipeline landed with `.changeset/` holding nothing but its README, and ~10
 * commits went by touching publishable packages — including a behavior change in
 * format/react/renderer-web. The first changelog would have come out EMPTY, and
 * nothing anywhere would have said so. This is what says so, on the PR that does it.
 *
 * It is deliberately narrower than `changeset status --since`, which asks changesets
 * itself which packages moved: that answer counts a `*.test.ts` edit as a change, so
 * a PR that adds a test to one package and a real fix (with its changeset) to another
 * would be told to write a changeset for the tests. What ships is `dist/`, built from
 * `src/`, so a file that cannot reach a tarball cannot need a changelog entry.
 *
 * Usage: `node scripts/changeset-gate.mjs [--since <ref>]` (default `origin/main`).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const sinceIndex = process.argv.indexOf("--since");
const since = sinceIndex === -1 ? "origin/main" : process.argv[sinceIndex + 1];

/**
 * Files under a package that never reach its tarball. `files: ["dist"]` everywhere, and
 * `dist/` is what tsup builds out of `src/` — so tests, their config and the changelog
 * the release itself writes are all outside the blast radius.
 */
const NOT_SHIPPED = [/\.test\.ts$/, /(^|\/)vitest\.config\.ts$/, /(^|\/)CHANGELOG\.md$/];

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** The publishable workspace packages, by the directory they live in. */
const packages = new Map();
for (const dir of readdirSync(join(repo, "packages"))) {
  try {
    const pkg = JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8"));
    if (pkg.private !== true) packages.set(dir, pkg.name);
  } catch {} // not a package
}

let changed;
try {
  // Three dots: what THIS branch added, not whatever main did meanwhile.
  changed = git("diff", "--name-only", `${since}...HEAD`).split("\n").filter(Boolean);
} catch {
  console.error(
    `changeset-gate: cannot diff against ${since} — is the history deep enough (fetch-depth: 0)?`,
  );
  process.exit(1);
}

/** Package name → the files in it that a consumer would actually receive. */
const touched = new Map();
for (const file of changed) {
  const match = /^packages\/([^/]+)\//.exec(file);
  const name = match && packages.get(match[1]);
  if (!name) continue;
  if (NOT_SHIPPED.some((pattern) => pattern.test(file))) continue;
  const files = touched.get(name) ?? [];
  files.push(file);
  touched.set(name, files);
}

if (touched.size === 0) {
  console.log(`changeset-gate: no shipped file changed since ${since} — nothing to declare. ✔`);
  process.exit(0);
}

/** Every package named by the frontmatter of a pending changeset. */
const declared = new Set();
for (const file of readdirSync(join(repo, ".changeset"))) {
  if (!file.endsWith(".md") || file === "README.md") continue;
  const body = readFileSync(join(repo, ".changeset", file), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!frontmatter) continue;
  for (const line of frontmatter[1].split("\n")) {
    const entry = /^\s*"?([^":]+)"?\s*:\s*(patch|minor|major)\s*$/.exec(line);
    if (entry) declared.add(entry[1]);
  }
}

const missing = [...touched.keys()].filter((name) => !declared.has(name)).sort();
if (missing.length === 0) {
  console.log(`changeset-gate: ${[...touched.keys()].sort().join(", ")} changed and declared. ✔`);
  process.exit(0);
}

console.error("changeset-gate: a published package changed with no changeset declaring it.\n");
for (const name of missing) {
  console.error(`  ${name}`);
  for (const file of touched.get(name)) console.error(`    ${file}`);
}
console.error(
  "\nRun `pnpm changeset`, pick these packages and the bump, and commit the file it writes." +
    "\nWithout it the release publishes them with an empty changelog — see docs/releasing.md.",
);
process.exit(1);
