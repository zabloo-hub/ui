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
 * Both halves are read from the PR's OWN range (ZAB-80). Counting every pending
 * changeset in `.changeset/` was the same as asking "has anyone declared this package
 * lately", and the answer is almost always yes: ZAB-77 changed
 * `packages/renderer-web/src/perf/scenes.ts` with no changeset and passed, because a
 * changeset from ZAB-73 already named `@zabloo/renderer-web`. That change was harmless
 * and the gate could not have known — a release is not a smaller release for missing an
 * entry, it is a release whose changelog does not mention it.
 *
 * Usage: `node scripts/changeset-gate.mjs [--since <ref>] [--repo <dir>]`
 * (defaults: `origin/main`, and the repository this script lives in).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `--flag <value>`, or `fallback` when it is not there. */
function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const since = flag("since", "origin/main");
// `--repo` exists so the gate can be pointed at a fixture repository and tested
// against real git history; CI and people both leave it alone.
const repo = flag("repo", join(dirname(fileURLToPath(import.meta.url)), ".."));

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

/**
 * Every package named by the frontmatter of a changeset THIS PR wrote.
 *
 * Added or modified, both: amending a pending changeset to add your package is
 * declaring it just as much as writing a new file is. What does not count is a
 * changeset that was already on the base branch — that one belongs to the PR that
 * wrote it, and it is not going to grow a line about a change made after the fact.
 */
const declared = new Set();
const changesets = git(
  "diff",
  "--name-only",
  "--diff-filter=AM",
  `${since}...HEAD`,
  "--",
  ".changeset",
)
  .split("\n")
  .filter((file) => file.endsWith(".md") && !file.endsWith("README.md"));
for (const file of changesets) {
  let body;
  try {
    body = readFileSync(join(repo, file), "utf8");
  } catch {
    continue; // written earlier in the branch and deleted before HEAD
  }
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
    "\nA changeset that was already on the base branch does not count: it declares the change" +
    "\nthat wrote it, not this one." +
    "\nWithout one the release publishes these with an empty changelog — see docs/releasing.md.",
);
process.exit(1);
