/**
 * Web performance budgets (ZAB-55, widened in ZAB-73) — the DETERMINISTIC half.
 * Draw calls, geometry, atlas memory and the frame's own work counters are exact
 * counts of what the renderer does, so CI can hold the line on them; the
 * wall-clock half (ms per frame) lives in `bench.test.ts` and is documented in
 * `docs/internal/`, because asserting time in CI flakes. ZAB-40 consolidates these numbers
 * with Unity's.
 *
 * Two layers, and they measure different things:
 *
 * - **The golden corpus**, below, is a floor: fifteen small scenes that must not
 *   start costing more than they do. It is cheap and it catches the crude
 *   regressions (a clip that stops batching, a leak of atlases).
 * - **The realistic scenes** (`perf/scenes.ts`, ZAB-73) are the ones a real
 *   screen looks like — a thousand-row list, a wall of wrapped prose, a panel
 *   mid-transition, a populated screen with something animating on it — at 960×600
 *   instead of 480×320. The corpus was asserting 17 draw calls against a ceiling
 *   of 24 and only ever measuring the FIRST frame after the mount, so the frames
 *   that ZAB-55's buffer reuse and ZAB-69's wrap cache exist for had nothing
 *   watching them at all.
 *
 * The numbers are budgets, not snapshots: each is comfortably above what the
 * scene uses today (the observed value is next to it), so they fail on a
 * REGRESSION and not on an honest new case.
 */

import { describe, expect, it } from "vitest";
import { CARET } from "./controls/field.js";
import { metricCases, mountCase, readCorpus } from "./golden.js";
import { type GoldenView, mountGolden } from "./harness.js";
import { MOTION_MS, PERF_SCENES, type PerfScene } from "./perf/scenes.js";
import { findNode } from "./snapshot.js";

const BUDGET = {
  /** Solids + one per atlas/image per clip group, and each overlay opens a paint root. */
  drawCalls: 24,
  vertices: 2000,
  /** Point sizes a scene needs at once (the library caps at 8 — see glyphs.ts). */
  atlases: 3,
  /** CPU-side atlas bytes (the GPU mirrors them): 3 × 1024² × RGBA at dpr 1. */
  atlasBytes: 3 * 1024 * 1024 * 4,
};

describe("performance budgets per golden scene (ZAB-55)", () => {
  // Refusal cases have no frame to budget: nothing renders, by definition.
  for (const [name, golden] of metricCases(readCorpus())) {
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

/**
 * Per scene, with what it costs today beside it. The margin is deliberate and
 * roughly 2×: these scenes are meant to grow a little as the catalog does, and a
 * budget that has to be edited on every honest change stops being read.
 */
const SCENE_BUDGET: Record<string, { drawCalls: number; vertices: number; resolved: number }> = {
  // observed: 5 draw calls, 3.157 vertices (3.864 scrolled), 49 nodes resolved (58 scrolled)
  list: { drawCalls: 12, vertices: 6000, resolved: 120 },
  // observed: 4 draw calls, 8.947 vertices, 19 nodes resolved
  text: { drawCalls: 12, vertices: 13000, resolved: 60 },
  // observed: 2 draw calls closed / 3 mid-transition, 90 → 1.826 vertices, 4 → 88 resolved
  motion: { drawCalls: 12, vertices: 3000, resolved: 180 },
  // observed: 4 draw calls, 5.365 vertices, 79 nodes resolved
  "dense-loop": { drawCalls: 12, vertices: 8000, resolved: 160 },
  // observed: 3 draw calls, 5.278 vertices, 75 nodes resolved
  "dense-caret": { drawCalls: 12, vertices: 8000, resolved: 160 },
};

/**
 * Shared by every realistic scene: three point sizes is the most any of them
 * asks for (the text wall), and 16 MiB is four 1024² atlases at dpr 1 — the
 * ceiling a fourth size, or an atlas that had to grow, would cross.
 */
const SCENE_ATLAS_BUDGET = { atlases: 4, atlasBytes: 4 * 1024 * 1024 * 4 };

/** Mounts a perf scene and lets it settle, exactly as `mountCase` does a golden. */
async function mountScene(scene: PerfScene): Promise<GoldenView> {
  const view = await mountGolden(scene.envelope, {
    width: scene.width,
    height: scene.height,
    data: scene.data,
  });
  // Two frames, not one: a `Repeat` measures its instances on the frame the data
  // arrives and windows them on the next (see `mountCase`).
  view.settle();
  view.settle();
  return view;
}

describe("performance budgets on realistic scenes (ZAB-73)", () => {
  for (const [name, scene] of Object.entries(PERF_SCENES)) {
    it(`${name} stays inside its budget`, async () => {
      const view = await mountScene(scene);
      const stats = view.handle.stats();
      const budget = SCENE_BUDGET[name];
      expect(stats.drawCalls, "draw calls").toBeLessThanOrEqual(budget.drawCalls);
      expect(stats.vertices, "vertices").toBeLessThanOrEqual(budget.vertices);
      expect(stats.resolved, "nodes resolved").toBeLessThanOrEqual(budget.resolved);
      expect(stats.atlases, "atlases").toBeLessThanOrEqual(SCENE_ATLAS_BUDGET.atlases);
      expect(stats.atlasBytes, "atlas bytes").toBeLessThanOrEqual(SCENE_ATLAS_BUDGET.atlasBytes);
      view.dispose();
    });
  }

  it("a thousand rows cost a screenful, scrolled or not", async () => {
    const view = await mountScene(PERF_SCENES.list);
    // Deep into the list, where a renderer that had quietly stopped windowing
    // would be carrying a thousand realized rows.
    for (const _i of Array(20).keys()) {
      view.pointer.wheel(400, 300, 0, 120);
      view.advance(16);
    }
    const stats = view.handle.stats();
    const budget = SCENE_BUDGET.list;
    expect(stats.drawCalls, "draw calls").toBeLessThanOrEqual(budget.drawCalls);
    expect(stats.vertices, "vertices").toBeLessThanOrEqual(budget.vertices);
    // The whole point of virtualization: the frame's work is bounded by the
    // VIEWPORT, not by the array. 1.000 items, ~58 nodes resolved.
    expect(stats.resolved, "nodes resolved").toBeLessThanOrEqual(budget.resolved);
    // observed: 18 rows realized in a 520px scroller
    expect(findNode(view.snapshot(), "rows")?.window?.count ?? 0).toBeLessThanOrEqual(40);
    view.dispose();
  });

  it("a frame mid-transition stays inside the same budget as one at rest", async () => {
    const view = await mountScene(PERF_SCENES.motion);
    view.handle.setOpen("section", true);
    view.handle.setData("ui.armed", true);
    view.handle.setData("job.progress", 0.9);
    // Half way through: the Collapse's height, twelve toggles' backgrounds and
    // twelve bars' fills are all mid-flight on this frame.
    view.advance(MOTION_MS / 2);

    const fill = findNode(view.snapshot(), "fill-0")?.rect?.height ?? 0;
    expect(fill, "the bar is mid-tween, not settled").toBeGreaterThan(0);
    expect(fill).toBeLessThan(7.2);

    const stats = view.handle.stats();
    expect(stats.drawCalls, "draw calls").toBeLessThanOrEqual(SCENE_BUDGET.motion.drawCalls);
    expect(stats.vertices, "vertices").toBeLessThanOrEqual(SCENE_BUDGET.motion.vertices);
    expect(stats.resolved, "nodes resolved").toBeLessThanOrEqual(SCENE_BUDGET.motion.resolved);
    view.dispose();
  });

  it("a steady animation frame allocates no geometry and re-wraps no text", async () => {
    const view = await mountScene(PERF_SCENES["dense-loop"]);
    // The Spinner keeps the pipeline running, so these are FULL frames — the
    // regime ZAB-55's buffer reuse and ZAB-69's wrap cache were built for.
    for (const _i of Array(10).keys()) view.advance(16);
    const settled = view.handle.stats();
    expect(settled.resolved, "a full frame, not a repaint").toBeGreaterThan(0);

    view.advance(16);
    const next = view.handle.stats();
    // Zero, not "a few": the builder's arrays are the view's and the blocks are
    // the nodes'. Anything above zero here is a frame throwing both away.
    expect(next.bufferGrowths, "geometry reallocations").toBe(0);
    expect(next.textLayouts, "texts re-broken into lines").toBe(0);
    // And the frame is the same frame: same geometry, same draw calls.
    expect(next.drawCalls).toBe(settled.drawCalls);
    expect(next.vertices).toBe(settled.vertices);
    view.dispose();
  });

  it("a blinking caret costs a repaint, not a frame", async () => {
    const view = await mountScene(PERF_SCENES["dense-caret"]);
    const field = findNode(view.snapshot(), "message")?.rect;
    if (!field) throw new Error("the composer field is not on screen");
    view.pointer.click(field.x + 20, field.y + field.height / 2);
    view.type("Hola");
    expect(view.snapshot().focus).toBe("message");
    const full = view.handle.stats();
    expect(full.repaintOnly, "typing renders a full frame").toBe(false);

    // A blink is a closed form of the time since the last edit, so the frames in
    // between change nothing and are never asked for: this used to be sixty full
    // pipelines a second over the whole screen.
    const drawn = view.drawCalls();
    for (const _i of Array(10).keys()) view.advance(16);
    expect(view.drawCalls(), "frames rendered between two flips").toBe(drawn);

    // And the flip itself is a repaint: nothing resolved, nothing re-wrapped,
    // no geometry reallocated — only the caret quad appears and disappears.
    view.advance(CARET.blinkMs / 2);
    const flip = view.handle.stats();
    expect(view.drawCalls(), "the flip painted").toBeGreaterThan(drawn);
    expect(flip.repaintOnly, "repaint-only").toBe(true);
    expect(flip.resolved, "nodes resolved").toBe(0);
    expect(flip.textLayouts, "texts re-broken into lines").toBe(0);
    expect(flip.bufferGrowths, "geometry reallocations").toBe(0);
    // The scene is the same scene: the caret is the only geometry that moved.
    expect(full.vertices - flip.vertices, "the caret quad, and nothing else").toBe(4);
    view.dispose();
  });
});
