/**
 * The CLI's own version, read from the package.json it ships inside.
 *
 * It used to be the literal `"0.1.0"` in `cli.ts`, which `verify-pack` asserts
 * `zabloo --version` against — so the first `changeset version` bump would have
 * turned CI red on the Version Packages PR until somebody edited it back by hand
 * (ZAB-78). A release must not need a human to remember a string.
 *
 * `../package.json` resolves from both places this module runs: bundled as
 * `dist/cli.js`, and straight from `src/` under vitest. `files: ["dist"]` never
 * excludes it — npm packs `package.json` into every tarball unconditionally.
 */

import { readFileSync } from "node:fs";

export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
