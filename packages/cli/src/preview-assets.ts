/**
 * Splits an envelope into the tree (JSON) and its asset bytes, so the dev preview
 * can transfer each on its own cadence (ZAB-14): saving a `.tsx` re-sends only the
 * tree, and the bytes of an image are fetched once per content hash.
 *
 * This is the deferred-resolution path the format already allows (`data` optional +
 * `hash` as content identity, decision 2026-08-11): the preview page re-inserts the
 * bytes before handing the envelope to the renderer, so what reaches the loader is
 * ALWAYS a complete envelope — one loading path, as always.
 */

interface AssetBlob {
  mime: string;
  /** The entry's `data` field, verbatim (base64). */
  base64: string;
}

interface SplitEnvelope {
  /** The envelope without the inlined `data` fields. */
  thin: string;
  /** Asset bytes keyed by content hash; two ids with the same hash share one blob. */
  blobs: Map<string, AssetBlob>;
}

interface RawEntry {
  hash?: unknown;
  mime?: unknown;
  data?: unknown;
}

/** `JSON.parse` without the throw — `null` when the text is not JSON. */
function parseOrNull(json: string): { assets?: Record<string, RawEntry> } | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function splitEnvelope(json: string): SplitEnvelope {
  const blobs = new Map<string, AssetBlob>();

  // The export already validated it; unparseable here means never break the preview.
  const envelope = parseOrNull(json);
  if (envelope === null) return { thin: json, blobs };
  const assets = envelope?.assets;
  if (typeof assets !== "object" || assets === null) {
    return { thin: json, blobs };
  }

  for (const entry of Object.values(assets)) {
    if (typeof entry?.data !== "string" || typeof entry.hash !== "string") continue;
    blobs.set(entry.hash, {
      mime: typeof entry.mime === "string" ? entry.mime : "application/octet-stream",
      base64: entry.data,
    });
    entry.data = undefined; // dropped by JSON.stringify
  }

  return { thin: blobs.size > 0 ? JSON.stringify(envelope) : json, blobs };
}

export type { AssetBlob, SplitEnvelope };
export { splitEnvelope };
