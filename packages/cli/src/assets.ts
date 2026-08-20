/**
 * Asset collection pass of `zabloo export` (decision 2026-08-11, ZAB-10): walks the
 * emitted views, resolves authoring paths against `src/assets/`, hashes and inlines
 * the bytes (base64 — v1 always ships everything with the envelope) and rewrites the
 * props to `asset:<id>` refs. The logical id IS the path relative to `src/assets/`
 * (stable across exports); `hash` is the content version.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import { type AssetEntry, type AssetRef, isAssetRef, type ZNode } from "@zabloo/format";
import { imageMeta } from "./image-meta.js";

/** Which props carry assets, per node type (grows with the format — F3 adds fonts). */
const ASSET_PROPS: Record<string, string[]> = {
  Image: ["src"],
};

/** MIMEs the export accepts in F2. `".ttf": "font/ttf"` joins in F3 (ZAB-16). */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const ASSET_WARN_BYTES = 2 * 1024 * 1024;
const TOTAL_WARN_BYTES = 15 * 1024 * 1024;
const TOTAL_MAX_BYTES = 50 * 1024 * 1024;

interface CollectedAssets {
  /** Manifest for the envelope; empty when the project uses no assets. */
  assets: Record<string, AssetEntry>;
  /** Size warnings (per-asset > 2 MB, total > 15 MB) for the export summary. */
  warnings: string[];
  /** Decoded bytes across the manifest. */
  totalBytes: number;
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** What the manifest weighs so far. The entries are the running total. */
const sizeOf = (entries: Record<string, AssetEntry>): number =>
  Object.values(entries).reduce((sum, entry) => sum + entry.size, 0);

async function collectAssets(
  views: Record<string, ZNode>,
  assetsDir: string,
): Promise<CollectedAssets> {
  const assets: Record<string, AssetEntry> = {};
  const warnings: string[] = [];

  for (const [viewId, rootNode] of Object.entries(views)) {
    const stack: ZNode[] = [rootNode];
    while (stack.length > 0) {
      const node = stack.pop() as ZNode & { children?: ZNode[] };
      for (const prop of ASSET_PROPS[node.type] ?? []) {
        const where = `view "${viewId}", node "${node.id ?? "?"}" (${node.type})`;
        const record = node as unknown as Record<string, unknown>;
        const value = record[prop];
        if (value === undefined) continue;
        if (typeof value !== "string") {
          throw new Error(
            `${where}: asset prop "${prop}" takes a path string; bindings are not supported for assets`,
          );
        }
        if (isAssetRef(value)) continue;

        const id = normalize(value).replaceAll("\\", "/");
        if (isAbsolute(value) || id === ".." || id.startsWith("../")) {
          throw new Error(`${where}: asset path "${value}" escapes src/assets/`);
        }
        if (!(id in assets)) {
          const entry = await readAsset(id, join(assetsDir, id), where);
          assets[id] = entry;
          // Checked as they are read, not at the end: a project 200 MB over the
          // limit should not have to base64 all of it to be told.
          const soFar = sizeOf(assets);
          if (soFar > TOTAL_MAX_BYTES) {
            throw new Error(
              `assets exceed the 50 MB hot-update limit (total: ${mb(soFar)} MB) — reduce or split the project`,
            );
          }
          if (entry.size > ASSET_WARN_BYTES) {
            warnings.push(
              `asset "${id}" weighs ${mb(entry.size)} MB — consider compressing/rescaling`,
            );
          }
        }
        record[prop] = `asset:${id}` satisfies AssetRef;
      }
      if (node.children) stack.push(...node.children);
    }
  }

  const totalBytes = sizeOf(assets);
  if (totalBytes > TOTAL_WARN_BYTES) {
    warnings.push(`assets total ${mb(totalBytes)} MB (> 15 MB) — hot-updates will be heavy`);
  }
  return { assets, warnings, totalBytes };
}

async function readAsset(id: string, absPath: string, where: string): Promise<AssetEntry> {
  const ext = extname(id).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext];
  if (!mime) {
    const accepted = Object.keys(MIME_BY_EXTENSION).join(", ");
    throw new Error(`${where}: asset "${id}" has an unsupported type (accepted: ${accepted})`);
  }
  const bytes = await readFile(absPath).catch(() => {
    throw new Error(`${where}: asset "${id}" not found at ${absPath}`);
  });
  const meta = imageMeta(mime, bytes);
  if (meta === null && (mime === "image/png" || mime === "image/jpeg")) {
    throw new Error(
      `${where}: asset "${id}" content does not match its extension (or the file is corrupt/truncated)`,
    );
  }
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    mime,
    size: bytes.length,
    ...(meta ?? {}),
    data: bytes.toString("base64"),
  };
}

export type { CollectedAssets };
export { ASSET_WARN_BYTES, collectAssets, TOTAL_MAX_BYTES, TOTAL_WARN_BYTES };
