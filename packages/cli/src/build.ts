import { transform } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createElement, type ReactElement, type FunctionComponent } from "react";
import { renderToIR } from "@zabloo/react";
import { resolve as resolveTokens, buildDocument, theme } from "@zabloo/core";

// Transforma app.tsx a ESM (JSX automático) y devuelve createElement(default).
export async function loadAuthoring(absPath: string): Promise<ReactElement> {
  const src = await readFile(absPath, "utf8");
  const { code } = await transform(src, {
    loader: "tsx",
    jsx: "automatic",
    format: "esm",
    sourcefile: absPath,
  });
  const tmp = absPath.replace(/\.tsx$/, ".tmp.mjs");
  await writeFile(tmp, code, "utf8");
  try {
    const mod = await import(pathToFileURL(tmp).href + `?t=${process.hrtime.bigint()}`);
    const App = mod.default as FunctionComponent;
    return createElement(App);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function buildToFile(srcPath: string): Promise<string> {
  const element = await loadAuthoring(srcPath);
  const doc = buildDocument(resolveTokens(renderToIR(element), theme));
  const outDir = join(dirname(srcPath), "out");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "button.ir.json");
  await writeFile(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return outPath;
}
