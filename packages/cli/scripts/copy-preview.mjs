/**
 * copy-preview — the preview chrome, into the tarball (ZAB-99).
 *
 * `@zabloo/preview` is a private package: it is never published, and the CLI does
 * not depend on it at runtime. What ships is its BUILD OUTPUT, copied into
 * `dist/preview/` here so `files: ["dist"]` carries it and `preview-server.ts`
 * can serve it as static files next to `cli.js`.
 *
 * It runs after tsup because tsup builds with `--clean`, and it uses `fs.cp`
 * rather than `cp -r` because CI has a Windows leg (ZAB-77). The ordering with
 * respect to the preview's OWN build is pnpm's job: `@zabloo/preview` is a
 * devDependency of this package, so `pnpm --filter ./packages/** build` reaches
 * it first.
 */

import { cp, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../preview/dist", import.meta.url));
const to = fileURLToPath(new URL("../dist/preview", import.meta.url));

// Checked explicitly so an unbuilt preview reads as one sentence rather than as
// an ENOENT on a path nobody recognizes.
try {
  await stat(new URL("../../preview/dist/index.html", import.meta.url));
} catch {
  console.error(
    `@zabloo/cli: no preview build at ${from} — run \`pnpm --filter @zabloo/preview build\` ` +
      "(or `pnpm build` from the repository root, which orders the two).",
  );
  process.exit(1);
}

await cp(from, to, { recursive: true });
