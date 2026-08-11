import { describe, expect, it } from "vitest";
import { splitEnvelope } from "./preview-assets.js";

const entry = (hash: string, data: string) => ({
  hash,
  mime: "image/png",
  size: 3,
  data,
});

describe("splitEnvelope", () => {
  it("pulls the bytes out of the manifest and indexes them by hash", () => {
    const json = JSON.stringify({
      v: 1,
      tokens: {},
      assets: { "hero.png": entry("aaa", "QUJD") },
      views: { main: { type: "Image", src: "asset:hero.png" } },
    });

    const { thin, blobs } = splitEnvelope(json);

    expect(blobs.get("aaa")).toEqual({ mime: "image/png", base64: "QUJD" });
    const parsed = JSON.parse(thin);
    expect(parsed.assets["hero.png"]).toEqual({ hash: "aaa", mime: "image/png", size: 3 });
    expect(thin).not.toContain("QUJD");
    // Everything but the bytes survives untouched.
    expect(parsed.views).toEqual({ main: { type: "Image", src: "asset:hero.png" } });
  });

  it("shares one blob between ids with the same content hash", () => {
    const json = JSON.stringify({
      v: 1,
      tokens: {},
      assets: { "a.png": entry("same", "QUJD"), "b.png": entry("same", "QUJD") },
      views: {},
    });

    const { blobs } = splitEnvelope(json);

    expect(blobs.size).toBe(1);
  });

  it("leaves an envelope without assets exactly as it came", () => {
    const json = JSON.stringify({ v: 1, tokens: {}, views: { main: { type: "Container" } } });

    const { thin, blobs } = splitEnvelope(json);

    expect(thin).toBe(json);
    expect(blobs.size).toBe(0);
  });

  it("keeps entries that carry no bytes (already resolved by hash)", () => {
    const json = JSON.stringify({
      v: 1,
      tokens: {},
      assets: { "hero.png": { hash: "aaa", mime: "image/png", size: 3 } },
      views: {},
    });

    const { thin, blobs } = splitEnvelope(json);

    expect(thin).toBe(json);
    expect(blobs.size).toBe(0);
  });

  it("passes unparseable content through instead of breaking the preview", () => {
    const { thin, blobs } = splitEnvelope("not json");

    expect(thin).toBe("not json");
    expect(blobs.size).toBe(0);
  });
});
