import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPusher, devLoop, projectRelative } from "./dev.js";

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

    await expect(devLoop(root, 0, {})).rejects.toThrow(
      /no src\/ directory in .* — is this a zabloo project\? \(scaffold one: npx create-zabloo-app\)/,
    );
    // Nothing was announced, and nothing was left listening: the check comes first.
    expect(log).not.toHaveBeenCalled();
  });
});

describe("createPusher", () => {
  const ok = (body = "{}") => ({ ok: true, text: async () => body });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never touches the network without a target url", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await createPusher(null, "Godot")('{"v":1}');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the envelope to the target url", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createPusher("http://127.0.0.1:5077/zabloo/envelope", "Unity")('{"v":1}');

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:5077/zabloo/envelope", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"v":1}',
    });
  });

  // The half of ZAB-14's transport the engine was missing: the body the CLI sends
  // has no `data` in it, so what it has to carry instead is where the bytes are.
  it("tells a deferred-bytes receiver where its assets live", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await createPusher("http://127.0.0.1:5079/zabloo/envelope", "Godot", {
      assetsBase: "http://localhost:5078/asset/",
    })('{"v":1}');

    expect(fetchSpy.mock.calls[0][1].headers).toEqual({
      "content-type": "application/json",
      "x-zabloo-assets": "http://localhost:5078/asset/",
    });
  });

  it("reports how many views took the push", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok('{"views":2}')));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createPusher("http://127.0.0.1:5079/zabloo/envelope", "Godot")('{"v":1}');

    expect(log.mock.calls[0][0]).toMatch(/pushed to Godot .* \(2 views\)/);
  });

  // A game that is simply not running is the normal state of an afternoon spent
  // in the browser: saying so once is a report, saying so every save is the noise
  // that made the engine push opt-in in the first place (2026-08-10).
  it("warns once while the dev mode is unreachable, and says when it is back", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchSpy);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const push = createPusher("http://127.0.0.1:5079/zabloo/envelope", "Godot");

    await push('{"v":1}');
    await push('{"v":1}');
    await push('{"v":1}');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/the Godot dev mode is not reachable/);

    fetchSpy.mockResolvedValue(ok());
    await push('{"v":1}');

    expect(log.mock.calls.at(-1)?.[0]).toMatch(/— back$/);

    // And it warns again once it has gone quiet a second time — the state is
    // "reachable or not", not "already said".
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    await push('{"v":1}');

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// The name the page shows in its statusbar and keys its remembered view by
// (ZAB-99) — which is why the separators are normalized: the same file in the
// same project must not be two envelopes depending on the OS.
describe("projectRelative", () => {
  it("names the envelope by where it sits in the project", () => {
    expect(
      projectRelative(
        join(sep, "work", "game"),
        join(sep, "work", "game", "dist", "zabloo.ir.json"),
      ),
    ).toBe("dist/zabloo.ir.json");
  });

  it("keeps the absolute path for an --out that escaped the project", () => {
    const outside = join(sep, "tmp", "elsewhere.json");

    expect(projectRelative(join(sep, "work", "game"), outside)).toBe(outside);
  });
});
