/**
 * Web performance budgets (ZAB-55) — the DETERMINISTIC half. Draw calls,
 * geometry and atlas memory are exact counts of what the renderer submits, so
 * CI can hold the line on them; the wall-clock half (ms per frame) lives in
 * `bench.test.ts` and is documented in ai-docs, because asserting time in CI
 * flakes. ZAB-40 consolidates these numbers with Unity's.
 *
 * The numbers are budgets, not snapshots: comfortably above what the corpus
 * uses today (max observed: 8 draw calls, 940 vertices, 2 atlases), so they
 * fail on a REGRESSION — a clip that stops batching, a leak of atlases — and
 * not on an honest new golden case.
 */

import { describe, expect, it } from "vitest";
import { mountCase, readCorpus } from "./golden.js";

const BUDGET = {
  /** One scene draws in a handful of calls: solids + one per atlas/image per clip group. */
  drawCalls: 12,
  vertices: 2000,
  /** Point sizes a scene needs at once (the library caps at 8 — see glyphs.ts). */
  atlases: 3,
  /** CPU-side atlas bytes (the GPU mirrors them): 3 × 1024² × RGBA at dpr 1. */
  atlasBytes: 3 * 1024 * 1024 * 4,
};

describe("performance budgets per golden scene (ZAB-55)", () => {
  for (const [name, golden] of Object.entries(readCorpus())) {
    it(`${name} stays inside the web budgets`, async () => {
      const view = await mountCase(golden);
      const stats = view.handle.stats();
      expect(stats.drawCalls, "draw calls").toBeLessThanOrEqual(BUDGET.drawCalls);
      expect(stats.vertices, "vertices").toBeLessThanOrEqual(BUDGET.vertices);
      expect(stats.atlases, "atlases").toBeLessThanOrEqual(BUDGET.atlases);
      expect(stats.atlasBytes, "atlas bytes").toBeLessThanOrEqual(BUDGET.atlasBytes);
      view.dispose();
    });
  }
});
