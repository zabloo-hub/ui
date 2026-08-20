/** The asset cache (ported from `preview-client.test.ts`, ZAB-14). */

import type { Envelope } from "@zabloo/format";
import { hydrateAssets } from "@/bridge/assets";

let served: Map<string, string>;
let fetched: string[];

/** The server side, as this module consumes it: a URL in, bytes out. */
const fetchImpl = async (url: string) => {
  fetched.push(url);
  const body = served.get(url);
  return { ok: body !== undefined, text: async () => body ?? "" };
};

const withAsset = (data?: string): Envelope => ({
  v: 1,
  tokens: {},
  views: {},
  assets: {
    "hero.png": { hash: "abcdef01", mime: "image/png", size: 3, ...(data ? { data } : {}) },
  },
});

beforeEach(() => {
  served = new Map();
  fetched = [];
});

describe("hydrateAssets", () => {
  it("fetches the bytes an envelope arrived without", async () => {
    served.set("/asset/abcdef01", "QUJD");

    const envelope = await hydrateAssets(withAsset(), new Map(), () => {}, fetchImpl);

    expect(envelope.assets?.["hero.png"].data).toBe("QUJD");
  });

  it("re-fetches nothing on the next reload — the bytes behind a hash never change", async () => {
    served.set("/asset/abcdef01", "QUJD");
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset(), cache, () => {}, fetchImpl);
    const second = await hydrateAssets(withAsset(), cache, () => {}, fetchImpl);

    expect(second.assets?.["hero.png"].data).toBe("QUJD");
    expect(fetched).toEqual(["/asset/abcdef01"]);
  });

  it("caches the bytes of an envelope that did inline them", async () => {
    const cache = new Map<string, string>();

    await hydrateAssets(withAsset("QUJD"), cache, () => {}, fetchImpl);

    expect(cache.get("abcdef01")).toBe("QUJD");
    expect(fetched).toEqual([]);
  });

  it("reports an asset the server cannot serve and renders the rest", async () => {
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
    const envelope: Envelope = { v: 1, tokens: {}, views: {} };

    expect(await hydrateAssets(envelope, new Map(), () => {}, fetchImpl)).toBe(envelope);
    expect(fetched).toEqual([]);
  });
});
