/**
 * The changeset gate, run against real git history (ZAB-80).
 *
 * The gate is a decision about a diff, so a fixture that fakes the diff would be
 * testing the fake. Each case builds a throwaway repository — a base commit, a
 * branch, some edits — and runs the script the way CI runs it, with `--repo`
 * pointing at the fixture and `--since` at the base.
 *
 * The case worth having is "declared on the base branch": that is the one that
 * used to pass and now must not, and no amount of reading the script tells you
 * which way it goes.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GATE = fileURLToPath(new URL("./changeset-gate.mjs", import.meta.url));

/** A published package, as the gate recognises one: `packages/<dir>/package.json`, not private. */
const PACKAGE = JSON.stringify({ name: "@zabloo/renderer-web", version: "0.1.0" });

const CHANGESET = (pkg) => `---\n"${pkg}": patch\n---\n\nSomething worth a changelog line.\n`;

function git(repo, ...args) {
  execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
}

function write(repo, path, content) {
  const file = join(repo, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * A repository with `base` committed on `main`, then `branch` committed on top of
 * it. Returns the fixture root; the gate is asked about `main...HEAD`.
 */
function repository(base, branch) {
  const repo = mkdtempSync(join(tmpdir(), "changeset-gate-"));
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.email", "gate@example.com");
  git(repo, "config", "user.name", "Gate");

  write(repo, "packages/renderer-web/package.json", PACKAGE);
  write(repo, ".changeset/README.md", "# Changesets\n");
  for (const [path, content] of Object.entries(base)) write(repo, path, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "base");

  git(repo, "checkout", "-b", "feature");
  for (const [path, content] of Object.entries(branch)) write(repo, path, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "branch");
  return repo;
}

/** Runs the gate over the fixture, as CI does. */
function gate(repo) {
  const result = execFileSync(process.execPath, [GATE, "--repo", repo, "--since", "main"], {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
  });
  return { passed: true, output: result };
}

/** Same, but for the runs that are supposed to fail. */
function gateFails(repo) {
  try {
    gate(repo);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  throw new Error("the gate passed, and this case expects it to fail");
}

describe("changeset-gate", () => {
  it("passes a PR whose changeset declares what it touched", () => {
    const repo = repository(
      {},
      {
        "packages/renderer-web/src/perf/scenes.ts": "export const scenes = [1];\n",
        ".changeset/zab-99-the-fix.md": CHANGESET("@zabloo/renderer-web"),
      },
    );

    expect(gate(repo).output).toContain("changed and declared");
  });

  /**
   * The ZAB-77 hole. A changeset sitting on the base branch named the package, so
   * the gate saw it declared and waved the change through with no changelog entry
   * of its own.
   */
  it("fails a PR that leans on a changeset already on the base branch", () => {
    const repo = repository(
      { ".changeset/zab-73-perf-pass-2.md": CHANGESET("@zabloo/renderer-web") },
      { "packages/renderer-web/src/perf/scenes.ts": "export const scenes = [1];\n" },
    );

    const output = gateFails(repo);

    expect(output).toContain("@zabloo/renderer-web");
    expect(output).toContain("packages/renderer-web/src/perf/scenes.ts");
    expect(output).toContain("already on the base branch does not count");
  });

  // Declaring by amending someone's pending changeset is still declaring: the
  // changelog gets the line either way, which is the whole point.
  it("accepts a changeset the PR edited rather than added", () => {
    const repo = repository(
      { ".changeset/zab-73-perf-pass-2.md": CHANGESET("@zabloo/format") },
      {
        "packages/renderer-web/src/perf/scenes.ts": "export const scenes = [1];\n",
        ".changeset/zab-73-perf-pass-2.md": `---\n"@zabloo/format": patch\n"@zabloo/renderer-web": patch\n---\n\nBoth.\n`,
      },
    );

    expect(gate(repo).output).toContain("changed and declared");
  });

  // Unchanged from before, and worth pinning: what cannot reach a tarball cannot
  // need a changelog entry, so a test-only PR needs no changeset at all.
  it("asks nothing of a PR that only changed what does not ship", () => {
    const repo = repository({}, { "packages/renderer-web/src/perf/scenes.test.ts": "// tests\n" });

    expect(gate(repo).output).toContain("nothing to declare");
  });
});
