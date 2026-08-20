import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_FONT_BASE64 } from "./generated/font.js";
import { type GoldenView, mountGolden } from "./harness.js";
import { findNode } from "./snapshot.js";
import { decodeBase64, loadFont } from "./ttf.js";

/**
 * The rig itself. If these fail, every golden file is measuring a stand-in
 * browser rather than the renderer — so they check the two things the corpus
 * silently depends on: that the real rasterizer is in before anything is
 * measured, and that a fake event reaches the very code a browser event would.
 */

const ENVELOPE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../golden/envelopes/flex-layout.json", import.meta.url)),
    "utf8",
  ),
);

/**
 * Mounts for ONE test and disposes it when that test ends. A helper rather than
 * a `let` shared through `afterEach`: the view a test works with is then a
 * `const` the test owns, and nothing survives into the next one.
 */
async function mountForTest(...args: Parameters<typeof mountGolden>): Promise<GoldenView> {
  const view = await mountGolden(...args);
  onTestFinished(() => {
    view.dispose();
  });
  return view;
}

describe("the headless rig", () => {
  it("mounts an envelope and lays it out at the golden viewport", async () => {
    const view = await mountForTest(ENVELOPE);
    const snapshot = view.snapshot();

    expect(snapshot.view).toBe("flex-layout");
    expect(snapshot.size).toEqual({ width: 480, height: 320 });
    expect(findNode(snapshot, "root")?.rect).toEqual({ x: 0, y: 0, width: 480, height: 320 });
  });

  it("measures text with the renderer's OWN rasterizer, never the fallback", async () => {
    const view = await mountForTest({
      v: 1,
      tokens: {},
      views: { probe: { type: "Text", id: "probe", text: "Hola" } },
    });
    const line = findNode(view.snapshot(), "probe")?.text?.lines[0];

    // The width the shipped TTF gives, computed here through the shipped WASM
    // and nothing else. Equality (not a range) is the point: the fallback's
    // numbers are plausible enough that a loose bound would not tell them apart,
    // and every baseline in the corpus rests on this being the real thing.
    const font = await loadFont(decodeBase64(DEFAULT_FONT_BASE64));
    const glyphs = [..."Hola"];
    const expected = glyphs.reduce(
      (width, char, i) =>
        width + font.advance(char, 16) + (i > 0 ? font.kern(glyphs[i - 1], char, 16) : 0),
      0,
    );
    font.dispose();

    expect(line?.text).toBe("Hola");
    expect(line?.width).toBeCloseTo(expected, 3);
  });

  it("leaves no fake globals behind once disposed", async () => {
    const disposable = await mountGolden(ENVELOPE);
    disposable.dispose();

    expect(globalThis.document).toBeUndefined();
    expect(
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame,
    ).toBeUndefined();
    // The real clock is back: two reads in a row are not the same frozen instant.
    expect(typeof performance.now()).toBe("number");
  });

  it("leaves none behind either when the envelope never becomes a view", async () => {
    // A refused payload has no handle to dispose and nobody to take the page
    // down (ZAB-74) — the corpus has cases like that, and they run alongside
    // every other test in the file.
    const warn = console.warn;
    await expect(mountGolden({ ...ENVELOPE, v: 99 })).rejects.toThrow();

    expect(globalThis.document).toBeUndefined();
    // The console is the rig's too: left hijacked, every later test's warnings
    // would go into a `warnings` array nobody is reading.
    expect(console.warn).toBe(warn);
  });
});
