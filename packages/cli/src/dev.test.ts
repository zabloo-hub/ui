import { afterEach, describe, expect, it, vi } from "vitest";
import { createPusher } from "./dev.js";

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
