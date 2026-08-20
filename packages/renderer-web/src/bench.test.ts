/**
 * Performance bench (ZAB-55, widened in ZAB-73). NOT part of the regular suite:
 * it runs only with
 * `BENCH=1` (`pnpm bench`), because its numbers are for a human comparing a
 * before and an after on one machine — CI asserting on wall-clock would flake.
 *
 * It rides the golden harness, so the whole pipeline runs for real except the
 * GPU submission — which is exactly the split the hotspots live on the CPU side
 * of. The scenes are the ones `budgets.test.ts` asserts against (`perf/scenes.ts`,
 * ZAB-73), so the frame CI holds a budget on and the frame timed here are the
 * same frame. Two caveats the numbers must be read with:
 *
 * - The harness fakes `performance.now` (the frame CLOCK), so wall time is
 *   measured with `process.hrtime.bigint()`, which nothing fakes.
 * - "KB/frame" comes from V8's sampling heap profiler: an estimate of bytes
 *   ALLOCATED during the loop (`process.memoryUsage` deltas turned out to
 *   track arena growth, not garbage — they overstated by orders of magnitude).
 */

import { Session } from "node:inspector";
import { describe, expect, it } from "vitest";
import { CARET } from "./controls/field.js";
import { metricCases, mountCase, readCorpus } from "./golden.js";
import { type GoldenView, mountGolden } from "./harness.js";
import { PERF_SCENES, type PerfScene } from "./perf/scenes.js";
import { findNode } from "./snapshot.js";

const FRAMES = 1000;

interface SamplingProfileNode {
  selfSize: number;
  children: SamplingProfileNode[];
}

/**
 * Wall-clock + allocation cost of `frames` ticks, after a warmup. Two separate
 * loops on purpose: the sampling profiler slows the code it watches, so the
 * timed loop runs bare and a second, profiled loop counts the allocations.
 */
async function measure(frames: number, tick: () => void): Promise<{ ms: number; kb: number }> {
  for (const i of Array(30).keys()) tick();

  const start = process.hrtime.bigint();
  for (let i = 0; i < frames; i++) tick();
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

  const session = new Session();
  session.connect();
  const post = (method: string, params?: object): Promise<unknown> =>
    new Promise((resolve, reject) =>
      session.post(method, params, (err, result) => (err ? reject(err) : resolve(result))),
    );
  await post("HeapProfiler.enable");
  // The two flags make this a CHURN measure: without them the profiler drops
  // the samples the GC collects, and only the retained bytes would show.
  await post("HeapProfiler.startSampling", {
    samplingInterval: 2048,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  for (let i = 0; i < frames; i++) tick();
  const { profile } = (await post("HeapProfiler.stopSampling")) as {
    profile: { head: SamplingProfileNode };
  };
  session.disconnect();
  let allocated = 0;
  const walk = (node: SamplingProfileNode): void => {
    allocated += node.selfSize;
    for (const child of node.children) walk(child);
  };
  walk(profile.head);

  return { ms: elapsed / frames, kb: allocated / 1024 / frames };
}

function report(name: string, cost: { ms: number; kb: number }, extra = ""): void {
  const line = `${cost.ms.toFixed(3)} ms/frame, ${cost.kb.toFixed(1)} KB/frame allocated`;
  console.log(`[bench] ${name}: ${line}${extra ? ` — ${extra}` : ""}`);
}

/** Mounts a perf scene settled, the way `budgets.test.ts` measures it. */
async function mountScene(scene: PerfScene): Promise<GoldenView> {
  const view = await mountGolden(scene.envelope, {
    width: scene.width,
    height: scene.height,
    data: scene.data,
  });
  view.settle();
  view.settle();
  return view;
}

describe.runIf(process.env.BENCH)("performance bench (ZAB-55, ZAB-73)", () => {
  it("relayout: full pipeline frame on the settings scene", async () => {
    const view = await mountCase(readCorpus().settings);
    // `settle` re-renders without moving the clock: the cost of one whole
    // sync → resolve → measure → arrange → tessellate pass, nothing animating.
    report("settings full relayout", await measure(FRAMES, () => view.settle()));
    view.dispose();
  });

  it("relayout: full pipeline frame on a populated screen", async () => {
    const view = await mountScene(PERF_SCENES["dense-loop"]);
    report("dense screen full relayout", await measure(FRAMES, () => view.settle()));
    view.dispose();
  });

  it("focused field: what 16 ms of a blinking caret costs", async () => {
    const view = await mountScene(PERF_SCENES["dense-caret"]);
    const field = findNode(view.snapshot(), "message")?.rect;
    if (!field) throw new Error("bench: the composer field is not on screen");
    view.pointer.click(field.x + 20, field.y + field.height / 2);
    view.type("Zabloo");
    expect(view.snapshot().focus).toBe("message");
    // Since ZAB-73 most of these ticks render NOTHING: the blink asks for the
    // frame it flips on, twice a period, and each of those is a repaint. So this
    // is the honest "what does leaving a field focused cost per 16 ms".
    const cost = await measure(FRAMES, () => view.advance(16));
    report("caret, per 16ms tick", cost, JSON.stringify(view.handle.stats()));
    view.dispose();
  });

  it("focused field: the flip frame itself, against a full frame of the same scene", async () => {
    const view = await mountScene(PERF_SCENES["dense-caret"]);
    const field = findNode(view.snapshot(), "message")?.rect;
    if (!field) throw new Error("bench: the composer field is not on screen");
    view.pointer.click(field.x + 20, field.y + field.height / 2);
    view.type("Zabloo");
    // One tick per half period lands exactly on the flips, so every iteration
    // renders one caret repaint and nothing else.
    const flip = await measure(FRAMES, () => view.advance(CARET.blinkMs / 2));
    expect(view.handle.stats().repaintOnly).toBe(true);
    report("caret flip repaint", flip, JSON.stringify(view.handle.stats()));
    const full = await measure(FRAMES, () => view.settle());
    report("same scene, full frame", full);
    console.log(`[bench] caret flip is ${((flip.ms / full.ms) * 100).toFixed(1)}% of a full frame`);
    view.dispose();
  });

  it("animation frame: a Spinner running over a populated screen", async () => {
    const view = await mountScene(PERF_SCENES["dense-loop"]);
    // The wave must actually be running, or the loop measures skipped frames.
    const opacityOf = () => findNode(view.snapshot(), "bead-0")?.style?.opacity;
    const before = opacityOf();
    view.advance(160);
    expect(opacityOf()).not.toBe(before);
    const cost = await measure(FRAMES, () => view.advance(16));
    report("spinner animation frame", cost, JSON.stringify(view.handle.stats()));
    view.dispose();
  });

  it("repeat: 1.000 unequal rows — mount, scroll, window shape", async () => {
    const view = await mountScene(PERF_SCENES.list);
    const windowOf = () => findNode(view.snapshot(), "rows")?.window;
    console.log(`[bench] rows window after settle: ${JSON.stringify(windowOf())}`);

    // Steady-state scrolling: every wheel renders (plus any window re-plan the
    // drifted check schedules — that cost belongs to the number).
    const cost = await measure(FRAMES, () => {
      view.pointer.wheel(400, 300, 0, 40);
      view.advance(16);
    });
    report("1000-row scroll frame", cost, `window ${JSON.stringify(windowOf())}`);

    // Scroll back to the top: does the window recover, or did "biggest wins" pin it?
    for (const i of Array(400).keys()) {
      view.pointer.wheel(400, 300, 0, -400);
      view.advance(16);
    }
    console.log(`[bench] rows window back at top: ${JSON.stringify(windowOf())}`);
    view.dispose();
  });

  it("text: a wall of wrapped prose, relaid out every frame", async () => {
    const view = await mountScene(PERF_SCENES.text);
    report("wrapped prose full relayout", await measure(FRAMES, () => view.settle()));
    view.dispose();
  });

  it("draw calls and atlas cost per golden scene", async () => {
    for (const [name, golden] of metricCases(readCorpus())) {
      const view = await mountCase(golden);
      console.log(`[bench] ${name}: ${JSON.stringify(view.handle.stats())}`);
      view.dispose();
    }
  });

  it("draw calls and atlas cost per realistic scene", async () => {
    for (const [name, scene] of Object.entries(PERF_SCENES)) {
      const view = await mountScene(scene);
      console.log(`[bench] ${name}: ${JSON.stringify(view.handle.stats())}`);
      view.dispose();
    }
  });
});
