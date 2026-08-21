/**
 * `scripts/` is not a workspace package — it has no `package.json` and nothing
 * imports it — so `pnpm -r test` cannot reach it. The root `test` script runs
 * Vitest here as a second project instead, which is enough for what lives here:
 * standalone `.mjs` tools with no workspace dependencies to alias.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Every case here builds a throwaway git repository and spawns the gate as a
  // process, which is seconds of real work before an assertion is even reached —
  // comfortably past Vitest's 5s default on a loaded machine, and the reason
  // these four went amber during ZAB-105 without anything under `scripts/`
  // changing. The budget is sized for what they actually do.
  test: { testTimeout: 60_000 },
});
