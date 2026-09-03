/**
 * The scenes the performance work is measured against (ZAB-73) — the ones the
 * golden corpus deliberately is not.
 *
 * The corpus documents BEHAVIOR, so its cases are as small as the rule they
 * record: `repeat.json` is 1,5 KB and every scene fits in 480×320. That makes it
 * a bad budget: draw calls and vertices sat at a third of their ceiling, and a
 * regression in the frame of a real screen — a thousand-row list, a wall of
 * wrapped prose, a panel mid-transition — had nothing in CI to trip over.
 *
 * They live in `golden/perf/` rather than in this package (G15, ZAB-148), and
 * for the same reason the corpus does: the C++ core budgets the very same scenes
 * in `core/tests/test_budgets.cpp`, so the frame CI holds a ceiling on in the
 * browser and the frame it holds one on in Godot are literally the same frame.
 * They are still NOT corpus cases — their metrics are `stats()`, telemetry each
 * target defines for itself, while `golden/metrics/` is the cross-target
 * contract; `golden/perf/README.md` draws that line.
 *
 * Viewport: 960×600, a screen and not a thumbnail. It is the second reason the
 * numbers here are worth holding — the corpus measures what fits in a postcard.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The shared scene directory, from this file — `src/perf` → repo root. */
const PERF_DIR = new URL("../../../../golden/perf/", import.meta.url);

/** A scene to measure: everything `mountGolden` needs, plus what it is for. */
interface PerfScene {
  /** What this scene puts under load — the first thing a reader of a diff needs. */
  about: string;
  envelope: object;
  /** Seeded through `setData` before the first measured frame. */
  data?: Record<string, unknown>;
  width: number;
  height: number;
}

interface SceneEntry {
  about: string;
  /** File under `golden/perf/`, the way a corpus case names its envelope. */
  envelope: string;
  width: number;
  height: number;
  /** File under `golden/perf/`. Absent when the scene seeds nothing. */
  data?: string;
}

function read(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, PERF_DIR)), "utf8"));
}

const index = read("scenes.json") as {
  motionMs: number;
  scenes: Record<string, SceneEntry>;
};

/** Duration every transition in `motion` runs at — the tests step to its middle. */
const MOTION_MS = index.motionMs;

/**
 * The scenes, by name. `budgets.test.ts` walks them for the geometry budgets and
 * then drives the ones with motion in them; `bench.test.ts` times the same set.
 */
const PERF_SCENES: Record<string, PerfScene> = Object.fromEntries(
  Object.entries(index.scenes).map(([name, entry]) => [
    name,
    {
      about: entry.about,
      width: entry.width,
      height: entry.height,
      envelope: read(entry.envelope) as object,
      data: entry.data ? (read(entry.data) as Record<string, unknown>) : undefined,
    },
  ]),
);

export type { PerfScene };
export { MOTION_MS, PERF_SCENES };
