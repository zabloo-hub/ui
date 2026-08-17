import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPusher, devLoop } from "./dev.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// `watch()` on a missing directory throws from libuv, and it used to do it after
// the banner had already announced the watch and the preview URL: a UVException
// under a success message, from an unhandled rejection nothing was catching (ZAB-67).
describe("devLoop", () => {
  it("refuses to start without a src/ directory, and says what to do", async () => {
    const root = await mkdtemp(join(tmpdir(), "zabloo-dev-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(devLoop(root, 0, null)).rejects.toThrow(
      /no src\/ directory in .* — is this a zabloo project\? \(scaffold one: npx create-zabloo-app\)/,
    );
    // Nothing was announced, and nothing was left listening: the check comes first.
    expect(log).not.toHaveBeenCalled();
  });
});

describe("createPusher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never touches the network without a target url", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await createPusher(null)('{"v":1}');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the envelope to the target url", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await createPusher("http://127.0.0.1:5077/zabloo/envelope")('{"v":1}');

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:5077/zabloo/envelope", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"v":1}',
    });
  });
});
