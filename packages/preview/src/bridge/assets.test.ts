/** The asset cache (ported from `preview-client.test.ts`, ZAB-14). */

import type { Envelope } from "@zabloo/format";
import { hydrateAssets } from "@/bridge/assets";

/**
 * The server side, as this module consumes it: a URL in, bytes out. A factory
 * rather than two module-level slots reset in a `beforeEach`, so each test owns
 * its own server and the fixture reads as a `const` next to the test using it.
 */
function fakeServer() {
  const served = new Map<string, string>();
  const fetched: string[] = [];
  const fetchImpl = async (url: string) => {
    fetched.push(url);
    const body = served.get(url);
    return { ok: body !== undefined, text: async () => body ?? "" };
  };
  return { served, fetched, fetchImpl };
}

const withAsset = (data?: string): Envelope => ({
  v: 1,
  tokens: {},
  views: {},
  assets: {
    "hero.png": { hash: "abcdef01", mime: "image/png", size: 3, ...(data ? { data } : {}) },
  },
});

describe("hydrateAssets", () => {
  it("fetches the bytes an envelope arrived without", async () => {
    const { served, fetchImpl } = fakeServer();
    served.set("/asset/abcdef01", "QUJD");

    const envelope = await hydrateAssets(withAsset(), new Map(), () => {}, fetchImpl);

    expect(envelope.assets?.["hero.png"].data).toBe("QUJD");
  });

  it("re-fetches nothing on the next reload — the bytes behind a hash never change", async () => {
    const { served, fetched, fetchImpl } = fakeServer();
    served.set("/asset/abcdef01", "QUJD");
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset(), cache, () => {}, fetchImpl);
    const second = await hydrateAssets(withAsset(), cache, () => {}, fetchImpl);

    expect(second.assets?.["hero.png"].data).toBe("QUJD");
    expect(fetched).toEqual(["/asset/abcdef01"]);
  });

  it("caches the bytes of an envelope that did inline them", async () => {
    const { fetched, fetchImpl } = fakeServer();
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset("QUJD"), cache, () => {}, fetchImpl);

    expect(cache.get("abcdef01")).toBe("QUJD");
    expect(fetched).toEqual([]);
  });

  it("reports an asset the server cannot serve and renders the rest", async () => {
    const { fetchImpl } = fakeServer();
    const reported: string[] = [];

    const envelope = await hydrateAssets(
      withAsset(),
      new Map(),
      (message) => reported.push(message),
      fetchImpl,
    );

    expect(reported).toEqual(["asset unavailable: abcdef01"]);
    expect(envelope.assets?.["hero.png"].data).toBeUndefined();
  });

  it("has nothing to do for an envelope without a manifest", async () => {
    const { fetched, fetchImpl } = fakeServer();
    const envelope: Envelope = { v: 1, tokens: {}, views: {} };

    expect(await hydrateAssets(envelope, new Map(), () => {}, fetchImpl)).toBe(envelope);
    expect(fetched).toEqual([]);
  });
});
