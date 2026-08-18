/**
 * `scripts/` is not a workspace package — it has no `package.json` and nothing
 * imports it — so `pnpm -r test` cannot reach it. The root `test` script runs
 * Vitest here as a second project instead, which is enough for what lives here:
 * standalone `.mjs` tools with no workspace dependencies to alias.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({});
