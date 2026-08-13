/**
 * Performance bench (ZAB-55). NOT part of the regular suite: it runs only with
 * `BENCH=1` (`pnpm bench`), because its numbers are for a human comparing a
 * before and an after on one machine — CI asserting on wall-clock would flake.
 *
 * It rides the golden harness, so the whole pipeline runs for real except the
 * GPU submission — which is exactly the split the three ZAB-55 hotspots live
 * on the CPU side of. Two caveats the numbers must be read with:
 *
 * - The harness fakes `performance.now` (the frame CLOCK), so wall time is
 *   measured with `process.hrtime.bigint()`, which nothing fakes.
 * - "KB/frame" comes from V8's sampling heap profiler: an estimate of bytes
 *   ALLOCATED during the loop (`process.memoryUsage` deltas turned out to
 *   track arena growth, not garbage — they overstated by orders of magnitude).
 */

import { Session } from "node:inspector";
import { describe, expect, it } from "vitest";
import { mountCase, readCorpus } from "./golden.js";
import { type GoldenView, mountGolden } from "./harness.js";
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
  for (let i = 0; i < 30; i++) tick();

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

/**
 * Clicks the named control (navigation is spatial — there is no Tab), wheeling
 * the scene down until the control is on screen if a scroller hides it.
 */
function focusByClick(view: GoldenView, ref: string): void {
  for (let i = 0; i < 40; i++) {
    const snapshot = view.snapshot();
    const rect = findNode(snapshot, ref)?.rect;
    if (rect && rect.y >= 0 && rect.y + rect.height <= snapshot.size.height) {
      view.pointer.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (view.snapshot().focus === ref) return;
    }
    view.pointer.wheel(snapshot.size.width / 2, snapshot.size.height / 2, 0, 40);
  }
  throw new Error(`bench: could not focus "${ref}"`);
}

// --- the 1.000-unequal-rows list (focus 3) ---

/** Deterministic label lengths → rows wrapping to 1..4 lines in a 200px column. */
function unequalItems(count: number): Array<{ id: string; label: string }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `it-${i}`,
    label: `Item ${i} — ${"palabra ".repeat(1 + ((i * 7) % 9))}`,
  }));
}

const ROWS_ENVELOPE = {
  v: 1,
  views: {
    main: {
      type: "Container",
      id: "root",
      layout: { direction: "column", padding: 8 },
      style: { background: "#101218" },
      children: [
        {
          type: "ScrollView",
          id: "scroller",
          axis: "vertical",
          layout: { direction: "column", width: 240, height: 300, padding: 8 },
          style: { background: "#1e293b" },
          children: [
            {
              type: "Repeat",
              id: "rows",
              items: { bind: "list.items" },
              as: "item",
              key: "id",
              layout: { direction: "column", gap: 6 },
              children: [
                {
                  type: "Container",
                  id: "row",
                  layout: { direction: "column", width: 208, padding: 6 },
                  style: { background: "#334155", radius: 4 },
                  children: [
                    {
                      type: "Text",
                      id: "row-label",
                      text: { bind: "item.label" },
                      style: { color: "#e2e8f0" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

const SPINNER_ENVELOPE = {
  v: 1,
  views: {
    main: {
      type: "Container",
      id: "root",
      layout: { direction: "column", padding: 16, gap: 8 },
      style: { background: "#101218" },
      children: [
        ...Array.from({ length: 12 }, (_, i) => ({
          type: "Container",
          id: `panel-${i}`,
          layout: { direction: "row", width: 300, height: 18, padding: 4 },
          style: { background: "#1e293b", radius: 4 },
          children: [
            { type: "Text", id: `label-${i}`, text: `Fila ${i}`, style: { color: "#e2e8f0" } },
          ],
        })),
        {
          type: "Spinner",
          id: "spin",
          layout: { direction: "row", gap: 6, align: "center", height: 12 },
          children: [0, 1, 2].map((i) => ({
            type: "Container",
            id: `bead-${i}`,
            layout: { width: 8, height: 8 },
            style: { background: "#e2e8f0", radius: 4 },
          })),
        },
      ],
    },
  },
};

describe.runIf(process.env.BENCH)("performance bench (ZAB-55)", () => {
  it("relayout: full pipeline frame on the settings scene", async () => {
    const view = await mountCase(readCorpus().settings);
    // `settle` re-renders without moving the clock: the cost of one whole
    // sync → resolve → measure → arrange → tessellate pass, nothing animating.
    report("settings full relayout", await measure(FRAMES, () => view.settle()));
    view.dispose();
  });

  it("animation frame: blinking caret on the settings scene", async () => {
    const view = await mountCase(readCorpus().settings);
    focusByClick(view, "player-name");
    view.type("Zabloo");
    // The focused field owns the clock: every 16ms step renders one frame.
    const cost = await measure(FRAMES, () => view.advance(16));
    expect(view.snapshot().focus).toBe("player-name");
    report("caret animation frame", cost, JSON.stringify(view.handle.stats()));
    view.dispose();
  });

  it("animation frame: spinner over a static scene", async () => {
    const view = await mountGolden(SPINNER_ENVELOPE);
    view.settle();
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
    const view = await mountGolden(ROWS_ENVELOPE, {
      data: { "list.items": unequalItems(1000) },
    });
    view.settle();
    view.settle();

    const windowOf = () => findNode(view.snapshot(), "rows")?.window;
    console.log(`[bench] rows window after settle: ${JSON.stringify(windowOf())}`);

    // Steady-state scrolling: every wheel renders (plus any window re-plan the
    // drifted check schedules — that cost belongs to the number).
    const cost = await measure(FRAMES, () => {
      view.pointer.wheel(120, 150, 0, 40);
      view.advance(16);
    });
    report("1000-row scroll frame", cost, `window ${JSON.stringify(windowOf())}`);

    // Scroll back to the top: does the window recover, or did "biggest wins" pin it?
    for (let i = 0; i < 400; i++) {
      view.pointer.wheel(120, 150, 0, -400);
      view.advance(16);
    }
    console.log(`[bench] rows window back at top: ${JSON.stringify(windowOf())}`);
    view.dispose();
  });

  it("draw calls and atlas cost per golden scene", async () => {
    for (const [name, golden] of Object.entries(readCorpus())) {
      const view = await mountCase(golden);
      console.log(`[bench] ${name}: ${JSON.stringify(view.handle.stats())}`);
      view.dispose();
    }
  });
});
