import type { Envelope } from "@zabloo/format";
import { afterEach, describe, expect, it } from "vitest";
import { type PreviewServer, startPreviewServer } from "./preview-server.js";

const ENVELOPE = JSON.stringify({
  v: 1,
  tokens: {},
  assets: { "hero.png": { hash: "aaa", mime: "image/png", size: 3, data: "QUJD" } },
  views: { main: { type: "Image", src: "asset:hero.png" } },
});

let preview: PreviewServer | undefined;

afterEach(async () => {
  await preview?.close();
  preview = undefined;
});

/** Port 0: the OS picks a free one, so tests never fight over 5078. */
async function start(): Promise<PreviewServer> {
  preview = await startPreviewServer(0);
  return preview;
}

describe("preview server", () => {
  it("serves the envelope without the asset bytes", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    const res = await fetch(`${server.url}envelope`);
    const envelope = (await res.json()) as Envelope;

    expect(res.status).toBe(200);
    expect(envelope.assets?.["hero.png"]).toEqual({ hash: "aaa", mime: "image/png", size: 3 });
    expect(envelope.views).toEqual({ main: { type: "Image", src: "asset:hero.png" } });
  });

  it("serves each asset by content hash, cacheable forever", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    const res = await fetch(`${server.url}asset/aaa`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("QUJD");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("404s an unknown hash", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);

    const res = await fetch(`${server.url}asset/nope`);

    expect(res.status).toBe(404);
  });

  it("drops the blobs of an export that no longer has assets", async () => {
    const server = await start();
    server.setEnvelope(ENVELOPE);
    server.setEnvelope(JSON.stringify({ v: 1, tokens: {}, views: {} }));

    const res = await fetch(`${server.url}asset/aaa`);

    expect(res.status).toBe(404);
  });

  // The page loads its own code from here (ZAB-57). Like `/renderer.js`, it
  // serves a build artifact, so it needs `pnpm build` first — CI runs it before
  // the tests, and an unbuilt tree gets a message that says exactly that.
  it("serves the preview client the page imports", async () => {
    const server = await start();

    const res = await fetch(`${server.url}preview.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(await res.text()).toContain("collectBindPaths");
  });

  it("answers 503 until the first export lands", async () => {
    const server = await start();

    const res = await fetch(`${server.url}envelope`);

    expect(res.status).toBe(503);
  });
});
