/**
 * Which version of `@zabloo/*` a scaffolded project depends on.
 *
 * This was the literal `"^0.1.0"` in `scaffold.ts`, and nothing guarded it: after
 * the first `changeset version` bump, `npx create-zabloo-app` would have gone on
 * pinning every new user to `^0.1.0` in silence — and the external smoke test
 * cannot see it, because it rewrites those deps to `file:` tarballs before
 * installing (ZAB-78).
 *
 * It cannot be derived from THIS package's own version either: changesets bumps
 * each package on its own evidence, so `create-zabloo-app@0.1.1` scaffolding
 * `@zabloo/react@^0.2.0` is the normal case, not the broken one.
 *
 * So the specs live in our own `devDependencies`, declared as `workspace:^`, and
 * the answer comes from wherever this copy is running:
 *
 * - **Published:** `pnpm pack` already rewrote `workspace:^` into the real range
 *   (`^0.2.0`) when it built the tarball. We hand that back verbatim — the version
 *   the release itself decided.
 * - **In the monorepo:** the spec still says `workspace:`, which is only true when
 *   the sibling package is right there on disk, so we read its version instead.
 */

import { readFileSync } from "node:fs";

/** The zabloo packages a scaffolded project depends on. */
type ScaffoldedPackage = "@zabloo/react" | "@zabloo/cli";

interface PackageJson {
  version?: string;
  devDependencies?: Record<string, string>;
}

function read(url: URL): PackageJson {
  return JSON.parse(readFileSync(url, "utf8")) as PackageJson;
}

/**
 * The dependency range to write into the scaffolded `package.json`, e.g. `"^0.2.0"`.
 *
 * `base` is where to resolve from — this module's own location in production, and
 * a fixture directory in the tests, which is what lets both branches be exercised
 * without publishing anything.
 */
function scaffoldedVersion(
  name: ScaffoldedPackage,
  base: URL = new URL("../package.json", import.meta.url),
): string {
  const spec = read(base).devDependencies?.[name];
  if (spec === undefined) {
    throw new Error(`${name} is not a devDependency of create-zabloo-app — cannot scaffold it`);
  }
  if (!spec.startsWith("workspace:")) return spec;

  // `packages/create-zabloo-app/package.json` → `packages/<dir>/package.json`:
  // one `..` because the base names a FILE, so it already resolves from its
  // directory.
  const dir = name.slice("@zabloo/".length);
  const sibling = read(new URL(`../${dir}/package.json`, base));
  if (sibling.version === undefined) {
    throw new Error(`${name} has no version — the workspace copy is not readable`);
  }
  return `^${sibling.version}`;
}

export type { ScaffoldedPackage };
export { scaffoldedVersion };
