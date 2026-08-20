/**
 * Image assets for the web renderer — the browser half of F2 B2: resolves
 * `asset:<id>` refs against the envelope's manifest, decodes the inlined bytes
 * and caches the result **by content hash**, the same shape the Unity SDK uses
 * for its Texture2D cache.
 *
 * Keying by hash (not by id) means two ids with identical bytes decode once, and
 * a hot-update that re-exports the same image keeps its texture. Entries whose
 * hash the new manifest no longer references are evicted on `swap` — the GL
 * layer deletes their textures through `onEvict`.
 *
 * Decoding is async (the browser gives us no sync path from bytes to pixels), so
 * a node paints nothing until its bitmap lands; the manifest's `width`/`height`
 * let layout reserve the space in the meantime.
 */

import { type AssetEntry, assetIdFromRef, decodeAssetData, isAssetRef } from "@zabloo/format";

/**
 * A manifest image, cached by hash. Structurally a `TextureSource`, so the GL
 * layer uploads it through the very same path as a glyph atlas.
 */
interface ImageAsset {
  readonly hash: string;
  /** Intrinsic size in px: the manifest's, or the bitmap's if the manifest omitted it. */
  width: number;
  height: number;
  /** Decoded pixels — null until the decode lands, and forever if it failed. */
  bitmap: TexImageSource | null;
  /** Bumped when `bitmap` changes (the GL layer re-uploads on version change). */
  version: number;
}

/** Bytes → pixels. Injectable because Node (where the tests run) has no decoder. */
type ImageDecoder = (entry: AssetEntry) => Promise<TexImageSource>;

interface ImageLibraryOptions {
  /** A decode landed — the view re-renders. */
  onReady?: () => void;
  /** An asset left the cache — the GL layer deletes its texture. */
  onEvict?: (asset: ImageAsset) => void;
  decode?: ImageDecoder;
}

class ImageLibrary {
  private manifest: Record<string, AssetEntry>;
  private readonly byHash = new Map<string, ImageAsset>();
  /** Refs already reported as broken — one warning per envelope, not per frame. */
  private readonly warned = new Set<string>();
  private readonly onReady?: () => void;
  private readonly onEvict?: (asset: ImageAsset) => void;
  private readonly decode: ImageDecoder;

  constructor(manifest: Record<string, AssetEntry>, options: ImageLibraryOptions = {}) {
    this.manifest = manifest;
    this.onReady = options.onReady;
    this.onEvict = options.onEvict;
    this.decode = options.decode ?? decodeToBitmap;
  }

  /**
   * The asset behind a node's `src`, starting its decode on first sight. Called
   * from measure and paint, so it must stay cheap and idempotent: everything
   * after the first call is a map lookup.
   */
  get(ref: unknown): ImageAsset | null {
    if (!isAssetRef(ref)) {
      this.warnOnce(String(ref), `Image src ${JSON.stringify(ref)} is not an "asset:<id>" ref`);
      return null;
    }
    const id = assetIdFromRef(ref);
    const entry = this.manifest[id];
    if (entry === undefined) {
      this.warnOnce(ref, `Image references "${ref}", which is not in the asset manifest`);
      return null;
    }
    const cached = this.byHash.get(entry.hash);
    if (cached) return cached;

    const asset: ImageAsset = {
      hash: entry.hash,
      width: entry.width ?? 0,
      height: entry.height ?? 0,
      bitmap: null,
      version: 0,
    };
    this.byHash.set(entry.hash, asset);
    this.start(asset, entry, id);
    return asset;
  }

  /** Swaps in a new manifest (hot-update), evicting assets it no longer references. */
  swap(manifest: Record<string, AssetEntry>): void {
    const kept = new Set<string>();
    for (const entry of Object.values(manifest)) kept.add(entry.hash);
    for (const [hash, asset] of this.byHash) {
      if (kept.has(hash)) continue;
      this.byHash.delete(hash);
      this.evict(asset);
    }
    this.manifest = manifest;
    this.warned.clear();
  }

  dispose(): void {
    for (const asset of this.byHash.values()) this.evict(asset);
    this.byHash.clear();
    this.warned.clear();
  }

  private start(asset: ImageAsset, entry: AssetEntry, id: string): void {
    this.decode(entry).then(
      (bitmap) => {
        // Evicted (or the library disposed) while decoding — drop it on the floor.
        if (this.byHash.get(asset.hash) !== asset) {
          closeBitmap(bitmap);
          return;
        }
        asset.bitmap = bitmap;
        // The manifest's dimensions win: they are what layout already reserved.
        if (!(asset.width > 0) || !(asset.height > 0)) {
          asset.width = bitmapWidth(bitmap);
          asset.height = bitmapHeight(bitmap);
        }
        asset.version++;
        this.onReady?.();
      },
      (error: unknown) => {
        // The asset stays in the cache with a null bitmap: nothing paints, and
        // the failed decode is never retried frame after frame.
        console.warn(`[zabloo] Could not decode asset "${id}" — ${describe(error)}`);
      },
    );
  }

  private evict(asset: ImageAsset): void {
    this.onEvict?.(asset);
    closeBitmap(asset.bitmap);
    asset.bitmap = null;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[zabloo] ${message}`);
  }
}

/**
 * The browser decoder: manifest bytes → `ImageBitmap`. Non-premultiplied to match
 * the renderer's blend mode (`SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA` with
 * `UNPACK_PREMULTIPLY_ALPHA_WEBGL` off).
 */
async function decodeToBitmap(entry: AssetEntry): Promise<TexImageSource> {
  // Cast: TS 5.9 types the array as Uint8Array<ArrayBufferLike>, which lib.dom's
  // BlobPart (ArrayBufferView over a plain ArrayBuffer) does not accept.
  const blob = new Blob([decodeAssetData(entry) as BlobPart], { type: entry.mime });
  return await createImageBitmap(blob, { premultiplyAlpha: "none" });
}

function bitmapWidth(bitmap: TexImageSource): number {
  return (bitmap as { width?: number }).width ?? 0;
}

function bitmapHeight(bitmap: TexImageSource): number {
  return (bitmap as { height?: number }).height ?? 0;
}

/** `ImageBitmap` holds memory until closed; other sources have nothing to release. */
function closeBitmap(bitmap: TexImageSource | null): void {
  const closable = bitmap as { close?: () => void } | null;
  if (typeof closable?.close === "function") closable.close();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { ImageAsset, ImageDecoder, ImageLibraryOptions };
export { ImageLibrary };
