/**
 * Shared Vitest config: workspace deps resolve to their SOURCES (ZAB-62).
 *
 * The counterpart of the `paths` in `tsconfig.base.json`, for the same reason —
 * on a fresh clone `dist/` does not exist yet, and without this every test file
 * that imports `@zabloo/format` dies on import until someone runs `pnpm build`.
 * CI builds first, so the trap springs only on whoever clones the repo.
 *
 * The aliases are anchored (`^…$`) on purpose: `@zabloo/renderer-web/global` is
 * the built IIFE bundle the preview server serves to the browser, and a prefix
 * match would rewrite it into a path inside `src/index.ts`.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@zabloo\/format$/, replacement: src("format") },
      { find: /^@zabloo\/react$/, replacement: src("react") },
      { find: /^@zabloo\/renderer-web$/, replacement: src("renderer-web") },
    ],
  },
  // Vitest's 5s default is not a budget for the work a test does — it is that
  // work plus whatever the other workers are doing on the same machine. The
  // renderer's suite mounts and disposes real views by the hundred, and under
  // load a different handful of them goes amber on every run while every one of
  // them passes alone. Raised rather than worked around per test, because a
  // timeout is only there to catch a HUNG test and none of these is one (ZAB-105).
  test: { testTimeout: 20_000 },
});
