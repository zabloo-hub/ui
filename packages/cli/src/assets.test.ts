import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZNode } from "@zabloo/format";
import { beforeEach, describe, expect, it } from "vitest";
import { ASSET_WARN_BYTES, collectAssets, TOTAL_MAX_BYTES, TOTAL_WARN_BYTES } from "./assets.js";
import { fakeJpeg, fakePng } from "./image-fixtures.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zabloo-assets-"));
});

function imageView(src: string): ZNode {
  return {
    type: "Container",
    children: [{ type: "Image", id: "logo", src } as unknown as ZNode],
  } as ZNode;
}

describe("collectAssets", () => {
  it("leaves asset-less views untouched and returns an empty manifest", async () => {
    const views = { main: { type: "Text", text: "hi" } as ZNode };
    const result = await collectAssets(views, dir);
    expect(result.assets).toEqual({});
    expect(result.totalBytes).toBe(0);
  });

  it("packages an image: hash, mime, dims, base64 data, ref rewritten", async () => {
    const png = fakePng(640, 480);
    await mkdir(join(dir, "icons"), { recursive: true });
    await writeFile(join(dir, "icons", "coin.png"), png);
    const views = { main: imageView("icons/coin.png") };

    const { assets, totalBytes } = await collectAssets(views, dir);

    const entry = assets["icons/coin.png"];
    expect(entry).toBeDefined();
    expect(entry?.hash).toBe(createHash("sha256").update(png).digest("hex"));
    expect(entry?.mime).toBe("image/png");
    expect(entry?.size).toBe(png.length);
    expect(entry?.width).toBe(640);
    expect(entry?.height).toBe(480);
    expect(entry?.data).toBe(png.toString("base64"));
    expect(totalBytes).toBe(png.length);
    const node = (views.main as { children?: unknown[] }).children?.[0] as { src: string };
    expect(node.src).toBe("asset:icons/coin.png");
  });

  it("dedups by id: same path from two views → one entry, both refs rewritten", async () => {
    await writeFile(join(dir, "hero.png"), fakePng(2, 2));
    const views = { a: imageView("hero.png"), b: imageView("hero.png") };

    const { assets, totalBytes } = await collectAssets(views, dir);

    expect(Object.keys(assets)).toEqual(["hero.png"]);
    expect(totalBytes).toBe(fakePng(2, 2).length);
    for (const view of Object.values(views)) {
      const node = (view as { children?: unknown[] }).children?.[0] as { src: string };
      expect(node.src).toBe("asset:hero.png");
    }
  });

  it("leaves already-rewritten asset: refs alone", async () => {
    const views = { main: imageView("asset:hero.png") };
    const { assets } = await collectAssets(views, dir);
    expect(assets).toEqual({});
  });

  it("errors with view/node context when the file does not exist", async () => {
    await expect(collectAssets({ shop: imageView("nope.png") }, dir)).rejects.toThrow(
      /view "shop".*"logo".*nope\.png/s,
    );
  });

  it("errors on extensions without a known MIME", async () => {
    await writeFile(join(dir, "logo.svg"), "<svg/>");
    await expect(collectAssets({ main: imageView("logo.svg") }, dir)).rejects.toThrow(
      /unsupported.*\.png/s,
    );
  });

  it("rejects paths escaping src/assets", async () => {
    await expect(collectAssets({ main: imageView("../secret.png") }, dir)).rejects.toThrow(
      /escapes/,
    );
  });

  it("rejects absolute paths", async () => {
    await expect(collectAssets({ main: imageView("/etc/passwd.png") }, dir)).rejects.toThrow(
      /escapes/,
    );
  });

  it("errors when an asset prop is a binding, not a path string", async () => {
    const views = {
      main: {
        type: "Container",
        children: [
          { type: "Image", id: "logo", src: { bind: "player.avatar" } } as unknown as ZNode,
        ],
      } as ZNode,
    };
    await expect(collectAssets(views, dir)).rejects.toThrow(
      /path string.*bindings are not supported/s,
    );
  });

  it("errors when a file's content does not match its extension", async () => {
    await writeFile(join(dir, "fake.png"), fakeJpeg(4, 4));
    await expect(collectAssets({ main: imageView("fake.png") }, dir)).rejects.toThrow(
      /does not match its extension/,
    );
  });

  it("errors on truncated/corrupt image content", async () => {
    await writeFile(join(dir, "broken.png"), fakePng(1, 1).subarray(0, 10));
    await expect(collectAssets({ main: imageView("broken.png") }, dir)).rejects.toThrow(
      /does not match its extension/,
    );
  });

  it("warns on a single asset above 2 MB", async () => {
    const big = Buffer.concat([fakePng(1, 1), Buffer.alloc(ASSET_WARN_BYTES)]);
    await writeFile(join(dir, "big.png"), big);
    const { warnings } = await collectAssets({ main: imageView("big.png") }, dir);
    expect(warnings.some((w) => w.includes("big.png"))).toBe(true);
  });

  it("warns (without erroring) when the total is between 15 MB and 50 MB", async () => {
    const warn = Buffer.concat([fakePng(1, 1), Buffer.alloc(TOTAL_WARN_BYTES)]);
    await writeFile(join(dir, "warn.png"), warn);
    const { warnings, totalBytes } = await collectAssets({ main: imageView("warn.png") }, dir);
    expect(totalBytes).toBeGreaterThan(TOTAL_WARN_BYTES);
    expect(totalBytes).toBeLessThan(TOTAL_MAX_BYTES);
    expect(warnings.some((w) => w.includes("15 MB"))).toBe(true);
  });

  it("hard-errors when the total exceeds 50 MB", async () => {
    const huge = Buffer.concat([fakePng(1, 1), Buffer.alloc(TOTAL_MAX_BYTES)]);
    await writeFile(join(dir, "huge.png"), huge);
    await expect(collectAssets({ main: imageView("huge.png") }, dir)).rejects.toThrow(/50 MB/);
  });
});
