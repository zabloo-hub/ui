/**
 * The asset bytes an envelope arrived without.
 *
 * Ported unchanged from `packages/cli/src/preview-client.ts` (ZAB-14), down to
 * the cache being the caller's: it has to outlive a reload, which is the entire
 * point of keying it by hash. The only addition is the injected `fetch`, so a
 * test can program the server side without stubbing a global.
 */

import type { AssetEntry, Envelope } from "@zabloo/format";

/** How the bytes behind a hash are fetched — `globalThis.fetch` in the browser. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Puts the asset bytes back into the manifest. They travel apart from the tree
 * (ZAB-14): the page keeps everything it has already fetched, keyed by content
 * hash — the bytes behind a hash never change — so a save only re-transfers what
 * actually changed, and the renderer still receives a COMPLETE envelope.
 *
 * An asset the server cannot serve is reported and left without bytes rather
 * than failing the reload: the rest of the view is still worth showing.
 */
export async function hydrateAssets(
  envelope: Envelope,
  cache: Map<string, string>,
  report: (message: string) => void,
  fetchImpl: FetchLike = (url) => fetch(url),
): Promise<Envelope> {
  const entries: AssetEntry[] = Object.values(envelope.assets ?? {});
  await Promise.all(
    entries.map(async (entry) => {
      if (typeof entry.data === "string") {
        cache.set(entry.hash, entry.data);
        return;
      }
      let data = cache.get(entry.hash);
      if (data === undefined) {
        const res = await fetchImpl(`/asset/${entry.hash}`);
        if (!res.ok) {
          report(`asset unavailable: ${entry.hash.slice(0, 8)}`);
          return;
        }
        data = await res.text();
        cache.set(entry.hash, data);
      }
      entry.data = data;
    }),
  );
  return envelope;
}
