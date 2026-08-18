/**
 * Which `@zabloo/*` range a scaffolded project depends on (ZAB-78).
 *
 * This was the literal `"^0.1.0"` in `scaffold.ts` and nothing anywhere guarded
 * it: after the first `changeset version` bump, `npx create-zabloo-app` would have
 * gone on pinning every new user to `^0.1.0` in silence — and the external smoke
 * test cannot see it, because it rewrites those deps to `file:` tarballs before
 * installing. So the guard has to be here and in `verify-pack`, and both look at
 * what was WRITTEN rather than at what installed.
 *
 * The fixtures are directory trees, because the two branches are distinguished by
 * a fact about the filesystem: whether the sibling package is next to us.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { scaffoldedVersion } from "./versions.js";

/**
 * A `packages/` layout: our own package.json with `specs` as its devDependencies,
 * and a sibling per entry of `siblings`. Returns the URL of our package.json,
 * which is what `scaffoldedVersion` resolves everything from.
 */
async function layout(
  specs: Record<string, string>,
  siblings: Record<string, string> = {},
): Promise<URL> {
  const root = await mkdtemp(join(tmpdir(), "zabloo-versions-"));
  const own = join(root, "create-zabloo-app");
  await mkdir(own, { recursive: true });
  await writeFile(
    join(own, "package.json"),
    JSON.stringify({ name: "create-zabloo-app", version: "0.1.1", devDependencies: specs }),
  );
  for (const [dir, version] of Object.entries(siblings)) {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "package.json"), JSON.stringify({ name: dir, version }));
  }
  return pathToFileURL(join(own, "package.json"));
}

describe("scaffoldedVersion", () => {
  it("hands back the range pack already resolved, in a published copy", async () => {
    // `pnpm pack` rewrites `workspace:^` into the real range when it builds the
    // tarball, so by the time a user runs `npx create-zabloo-app` the answer has
    // been decided by the release itself.
    const base = await layout({ "@zabloo/react": "^0.2.0", "@zabloo/cli": "^0.2.0" });

    expect(scaffoldedVersion("@zabloo/react", base)).toBe("^0.2.0");
    expect(scaffoldedVersion("@zabloo/cli", base)).toBe("^0.2.0");
  });

  it("reads the sibling's version in the monorepo, where the spec is still workspace:", async () => {
    const base = await layout(
      { "@zabloo/react": "workspace:^", "@zabloo/cli": "workspace:^" },
      { react: "0.4.2", cli: "0.3.1" },
    );

    expect(scaffoldedVersion("@zabloo/react", base)).toBe("^0.4.2");
    expect(scaffoldedVersion("@zabloo/cli", base)).toBe("^0.3.1");
  });

  it("never derives the range from create-zabloo-app's OWN version", async () => {
    // changesets bumps each package on its own evidence: the scaffolder sitting
    // at 0.1.1 while it scaffolds @zabloo/react@^0.2.0 is the normal case, and it
    // is exactly the case a self-derived version would get wrong.
    const base = await layout({ "@zabloo/react": "workspace:^" }, { react: "0.2.0" });

    expect(scaffoldedVersion("@zabloo/react", base)).toBe("^0.2.0");
  });

  it("refuses to guess when the package is not declared at all", async () => {
    const base = await layout({});

    expect(() => scaffoldedVersion("@zabloo/react", base)).toThrow(/not a devDependency/);
  });
});
