import type { AssetEntry } from "@zabloo/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ImageAsset, ImageLibrary } from "./assets.js";

/** A decoded bitmap stand-in: Node has no ImageBitmap, and the GL layer is elsewhere. */
function bitmap(width: number, height: number, onClose?: () => void): TexImageSource {
  return { width, height, close: onClose ?? (() => {}) } as unknown as TexImageSource;
}

function entry(hash: string, over: Partial<AssetEntry> = {}): AssetEntry {
  return { hash, mime: "image/png", size: 4, width: 32, height: 16, data: "AAAA", ...over };
}

/** Lets a test await the microtasks the decode promise chain runs on. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImageLibrary.get", () => {
  it("resolves a ref through the manifest and decodes it once", async () => {
    const decode = vi.fn(async () => bitmap(32, 16));
    const library = new ImageLibrary({ "icons/coin.png": entry("h1") }, { decode });

    const asset = library.get("asset:icons/coin.png");
    expect(asset).not.toBeNull();
    // Intrinsic size comes from the manifest, before any decode lands.
    expect(asset).toMatchObject({ hash: "h1", width: 32, height: 16, bitmap: null });

    await settle();
    expect(asset?.bitmap).not.toBeNull();
    expect(asset?.version).toBe(1);

    library.get("asset:icons/coin.png");
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("dedups by content hash: two ids, one decode, one shared asset", async () => {
    const decode = vi.fn(async () => bitmap(32, 16));
    const library = new ImageLibrary(
      { "icons/coin.png": entry("same"), "icons/copy.png": entry("same") },
      { decode },
    );

    const first = library.get("asset:icons/coin.png");
    const second = library.get("asset:icons/copy.png");
    expect(second).toBe(first);
    await settle();
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bitmap's size when the manifest omits dimensions", async () => {
    const library = new ImageLibrary(
      { "a.png": entry("h1", { width: undefined, height: undefined }) },
      { decode: async () => bitmap(8, 4) },
    );
    const asset = library.get("asset:a.png");
    expect(asset).toMatchObject({ width: 0, height: 0 });
    await settle();
    expect(asset).toMatchObject({ width: 8, height: 4 });
  });

  it("warns once per broken ref and never retries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const library = new ImageLibrary({}, { decode: async () => bitmap(1, 1) });

    expect(library.get("asset:missing.png")).toBeNull();
    expect(library.get("asset:missing.png")).toBeNull();
    expect(library.get("not-a-ref")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed decode cached so it is not retried every frame", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const decode = vi.fn(async () => {
      throw new Error("corrupt");
    });
    const library = new ImageLibrary({ "a.png": entry("h1") }, { decode });

    library.get("asset:a.png");
    await settle();
    expect(library.get("asset:a.png")?.bitmap).toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("notifies on ready so the view can repaint", async () => {
    const onReady = vi.fn();
    const library = new ImageLibrary(
      { "a.png": entry("h1") },
      { decode: async () => bitmap(1, 1), onReady },
    );
    library.get("asset:a.png");
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe("ImageLibrary.swap", () => {
  it("keeps assets the new manifest still references and evicts the rest", async () => {
    const onEvict = vi.fn<(asset: ImageAsset) => void>();
    const library = new ImageLibrary(
      { "keep.png": entry("keep"), "drop.png": entry("drop") },
      { decode: async () => bitmap(1, 1), onEvict },
    );
    const kept = library.get("asset:keep.png");
    const dropped = library.get("asset:drop.png");
    await settle();

    // Same content re-exported under a new id: still a hit, still no re-decode.
    library.swap({ "renamed.png": entry("keep") });

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict.mock.calls[0][0]).toBe(dropped);
    expect(dropped?.bitmap).toBeNull();
    expect(library.get("asset:renamed.png")).toBe(kept);
    expect(kept?.bitmap).not.toBeNull();
  });

  it("closes the bitmap of an evicted asset", async () => {
    const close = vi.fn();
    const library = new ImageLibrary(
      { "a.png": entry("h1") },
      { decode: async () => bitmap(1, 1, close) },
    );
    library.get("asset:a.png");
    await settle();
    library.swap({});
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drops a decode that lands after its asset was evicted", async () => {
    const close = vi.fn();
    const onReady = vi.fn();
    const library = new ImageLibrary(
      { "a.png": entry("h1") },
      { decode: async () => bitmap(1, 1, close), onReady },
    );
    const asset = library.get("asset:a.png");
    library.swap({}); // evicted mid-decode

    await settle();
    expect(asset?.bitmap).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("ImageLibrary.dispose", () => {
  it("evicts everything and silences in-flight decodes", async () => {
    const onReady = vi.fn();
    const onEvict = vi.fn();
    const library = new ImageLibrary(
      { "a.png": entry("h1") },
      { decode: async () => bitmap(1, 1), onReady, onEvict },
    );
    library.get("asset:a.png");
    library.dispose();

    await settle();
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
