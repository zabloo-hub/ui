/**
 * "Exports go at the end of the file" (CONTRIBUTING), for the case Biome cannot
 * see.
 *
 * `style/useExportsLast` fires on a declaration that comes AFTER an export
 * statement — so a file that mixes the two styles is caught, and a file where
 * EVERY declaration wears an inline `export` is not, because there is no
 * trailing block for anything to come after. That second shape is most of what
 * the rule is meant to stop, and it went unnoticed across ~31 files (ZAB-106).
 *
 * It is not a Biome plugin because it cannot be one. GritQL in Biome 2.5 reaches
 * twenty node kinds — `variable_declaration`, `function_declaration`, the
 * `jsx_*` family and a handful of expressions — and none of them is an export:
 * in `export const a = 1` the matched node starts at `const`, with the keyword
 * outside anything a pattern can bind. Snippet patterns do see the keyword, but
 * they miss `export interface`, `export enum` and every generic form
 * (`export type J<T>`, `export function f<T>()`), which is most of what this
 * codebase exports. Half a rule is worse than none, so this is thirty lines of
 * Node instead.
 *
 * `PENDING` is the backlog, not an exemption list. Everything on it predates the
 * check and lives in a package another batch is holding; entries only ever come
 * OUT, and the check fails if one names a file that is already clean.
 */

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, cwd, exit } from "node:process";

/** `export` on a declaration — never `export { … }`, `export * from`, `export default`. */
const INLINE =
  /^export\s+(?:declare\s+)?(?:abstract\s+|async\s+)?(?:const|let|var|function|class|interface|enum|type)\s+[A-Za-z_$]/gm;

const SOURCES = "**/*.{ts,tsx,mts,cts}";
const SKIP = ["**/node_modules/**", "**/dist/**", "sdk/**", "wip/**", "**/generated/**"];

/**
 * Files that carried the old style before the check existed. Each one is a file
 * some other branch is currently holding — sweeping them from here would be a
 * merge conflict in someone else's zone. Delete the line when you sweep the file.
 */
const PENDING = new Set([
  "examples/hello-button/src/theme.ts",
  "examples/inventory-demo/src/theme.ts",
  "examples/settings-screen/src/theme.ts",
  "examples/showcase/src/components/Frame.tsx",
  "examples/showcase/src/theme.ts",
  "packages/cli/src/image-fixtures.ts",
  "packages/cli/src/open.ts",
  "packages/cli/src/preview.ts",
  "packages/cli/src/version.ts",
  "packages/create-zabloo-app/src/scaffold.ts",
  "packages/create-zabloo-app/templates/default/src/components/GoldRow.tsx",
  "packages/create-zabloo-app/templates/default/src/theme.ts",
  "packages/react/src/reconciler.ts",
  "packages/renderer-web/src/clip.ts",
  "packages/renderer-web/src/collapse.ts",
  "packages/renderer-web/src/data.ts",
  "packages/renderer-web/src/envelope.ts",
  "packages/renderer-web/src/hit.ts",
  "packages/renderer-web/src/input/pointer.ts",
  "packages/renderer-web/src/overlays/layer.ts",
  "packages/renderer-web/src/progress.ts",
  "packages/renderer-web/src/scroll.ts",
  "packages/renderer-web/src/select.ts",
  "packages/renderer-web/src/toggle.ts",
]);

const root = resolve(argv[2] ?? cwd());
const offenders = [];
const swept = new Set(PENDING);

for await (const entry of glob(SOURCES, { cwd: root, exclude: SKIP })) {
  const file = entry.split("\\").join("/");
  const hits = [...readFileSync(resolve(root, entry), "utf8").matchAll(INLINE)];
  if (hits.length === 0) continue;
  if (PENDING.has(file)) {
    swept.delete(file);
    continue;
  }
  offenders.push(`${file}: ${hits.length} inline export${hits.length === 1 ? "" : "s"}`);
}

if (offenders.length > 0) {
  console.error("Exports go at the end of the file, in one `export { … }` block.\n");
  console.error(
    offenders
      .sort()
      .map((line) => `  ${line}`)
      .join("\n"),
  );
  console.error("\nDeclare above, export below — see CONTRIBUTING.md.");
}

if (swept.size > 0) {
  console.error(
    `\nThese are clean now and must come out of PENDING in scripts/lint/exports-last.mjs:\n${[
      ...swept,
    ]
      .sort()
      .map((file) => `  ${file}`)
      .join("\n")}`,
  );
}

exit(offenders.length + swept.size > 0 ? 1 : 0);
