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
});
