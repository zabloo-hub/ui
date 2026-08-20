/**
 * The asset bytes an envelope arrived without. Unchanged from
 * `packages/cli/src/preview-client.ts` (ZAB-14) but for the injected `fetch`.
 */

import type { AssetEntry, Envelope } from "@zabloo/format";

/** How the bytes behind a hash are fetched — `globalThis.fetch` in the browser. */
type FetchLike = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Puts the asset bytes back into the manifest. They travel apart from the tree
 * (ZAB-14): the page keeps everything it has already fetched, keyed by content
 * hash — the bytes behind a hash never change — so a save only re-transfers what
 * actually changed, and the renderer still receives a COMPLETE envelope.
 *
 * An asset the server cannot serve is reported and left without bytes rather
 * than failing the reload: the rest of the view is still worth showing.
 */
async function hydrateAssets(
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
      const cached = cache.get(entry.hash);
      const data = cached ?? (await download(entry.hash, fetchImpl));
      if (data === undefined) {
        report(`asset unavailable: ${entry.hash.slice(0, 8)}`);
        return;
      }
      if (cached === undefined) cache.set(entry.hash, data);
      entry.data = data;
    }),
  );
  return envelope;
}

/** The bytes behind a hash, or undefined if the server has none. */
async function download(hash: string, fetchImpl: FetchLike): Promise<string | undefined> {
  const res = await fetchImpl(`/asset/${hash}`);
  return res.ok ? await res.text() : undefined;
}

export type { FetchLike };
export { hydrateAssets };
