/**
 * Minimal image header readers for `zabloo export` — width/height without decoding
 * and without native deps (decision 2026-08-11, ZAB-10: no sharp). Readers parse
 * headers only; they do NOT validate the whole file.
 */

interface ImageMeta {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: signature + IHDR (always the first chunk) → width/height at bytes 16..23. */
function pngMeta(bytes: Buffer): ImageMeta | null {
  if (bytes.length < 24) return null;
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** JPEG: walk marker segments to the first SOFn frame header. */
function jpegMeta(bytes: Buffer): ImageMeta | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return sofFrom(bytes, 2);
}

/**
 * The first SOFn frame header at or after `offset`, or null if the markers run
 * out first. Tail-recursive rather than a cursor loop; a JPEG header is a
 * handful of segments, not a stream.
 */
function sofFrom(bytes: Buffer, offset: number): ImageMeta | null {
  if (offset + 4 > bytes.length) return null;
  if (bytes[offset] !== 0xff) return null;

  const marker = bytes[offset + 1];
  if (marker === 0xff) return sofFrom(bytes, offset + 1); // padding byte
  // Standalone marker (TEM/RSTn/SOI/EOI): no length field.
  if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) return sofFrom(bytes, offset + 2);

  const isSof =
    marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
  if (!isSof) return sofFrom(bytes, offset + 2 + bytes.readUInt16BE(offset + 2));
  if (offset + 9 > bytes.length) return null;
  return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
}

/** Dispatch by MIME; null when no parser applies (caller decides how strict to be). */
function imageMeta(mime: string, bytes: Buffer): ImageMeta | null {
  if (mime === "image/png") return pngMeta(bytes);
  if (mime === "image/jpeg") return jpegMeta(bytes);
  return null;
}

export type { ImageMeta };
export { imageMeta, jpegMeta, pngMeta };
