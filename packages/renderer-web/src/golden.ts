/**
 * Reads the golden corpus (`golden/` at the repo root) and replays one case.
 *
 * The corpus is deliberately OUTSIDE this package: from ZAB-38 on, the Unity SDK
 * loads these very files and must produce the same metrics, so an envelope, its
 * seed data and the clock it is measured at are cross-target inputs — not
 * fixtures of the web renderer's test suite.
 *
 * A case is `(envelope, data, viewport, clock, pad)` and nothing else.
 * Everything a golden file records has to be derivable from those five, or the
 * other target could not reproduce it. The pad joined them in ZAB-74 and belongs
 * for the same reason the clock does: it is a STATE the view polls, not an event
 * of any one platform, so a declarative script of it replays anywhere.
 *
 * A case with `refuses` records a LOAD instead of a frame: some of the format's
 * normative rules are refusals, and they need a home in the corpus too.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type GoldenOptions, type GoldenView, mountGolden } from "./harness.js";

/** The corpus root, from this file — `packages/renderer-web/src` → repo root. */
const GOLDEN_DIR = new URL("../../../golden/", import.meta.url);

export interface GoldenCase {
  /** File under `golden/envelopes/`. */
  envelope: string;
  /** What this case is a record of — the first thing a reader of a diff needs. */
  about: string;
  /** Pushed through `setData` before the frame is measured. */
  data?: Record<string, unknown>;
  width?: number;
  height?: number;
  /** Milliseconds run before measuring — how a case records settled motion. */
  advanceMs?: number;
  /**
   * A case of LOADING, not of metrics (ZAB-74): the envelope must be refused
   * with this diagnostic code and nothing must render. It has no file under
   * `metrics/` — there is no frame to measure — and it is how the corpus records
   * the one forward-tolerance rule that is a refusal rather than a degradation.
   */
  refuses?: { code: string };
  /**
   * Gamepad input replayed before the frame is measured (ZAB-74). The pad is a
   * STATE the view polls, not a stream of events, so a step is either a change
   * to that state or a span of time for the poll loop to see it in — which is
   * exactly what a second target can reproduce without a browser.
   */
  pad?: PadStep[];
}

/**
 * One step of a case's `pad` script. Indices are the standard mapping
 * (0=A, 1=B, 12–15=d-pad, axes 0/1 left stick, 2/3 right stick), the same
 * numbers `gamepad.ts` documents.
 */
export type PadStep =
  | { press: number }
  | { release: number }
  | { axis: number; value: number }
  | { advanceMs: number };

export type Corpus = Record<string, GoldenCase>;

export function readCorpus(): Corpus {
  return readJson("cases.json") as Corpus;
}

export function readEnvelope(file: string): object {
  return readJson(`envelopes/${file}`) as object;
}

/** Path of a case's golden metrics, for `toMatchFileSnapshot`. */
export function metricsPath(name: string): string {
  return fileURLToPath(new URL(`metrics/${name}.json`, GOLDEN_DIR));
}

/** Envelope files on disk — what the corpus is checked for gaps against. */
export function envelopeFiles(): string[] {
  return readdirSync(fileURLToPath(new URL("envelopes/", GOLDEN_DIR)))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

/**
 * Mounts a case exactly as its record was produced: data seeded, one frame let
 * through to settle the structure the data drives, then the clock run.
 *
 * The settling frame is part of the contract, not a rig detail — the frame a
 * bound array arrives on is the one that MEASURES its items, and the window over
 * them is computed from those measurements on the next. Unity's side of ZAB-38
 * has to give itself the same second frame, or the two targets would be
 * comparing a transient against a settled list.
 */
export async function mountCase(
  golden: GoldenCase,
  extra: GoldenOptions = {},
): Promise<GoldenView> {
  const view = await mountGolden(readEnvelope(golden.envelope), {
    width: golden.width,
    height: golden.height,
    data: golden.data,
    ...extra,
  });
  view.settle();
  if (golden.advanceMs) view.advance(golden.advanceMs);
  if (golden.pad) replayPad(view, golden.pad);
  return view;
}

/**
 * Replays a case's pad script. The pad is polled, never pushed: a `press` only
 * becomes an intention on a frame that reads it, so a step that changes the
 * state does nothing until an `advanceMs` gives the loop one.
 */
function replayPad(view: GoldenView, steps: readonly PadStep[]): void {
  const pad = view.connectGamepad();
  for (const step of steps) {
    if ("press" in step) pad.press(step.press);
    else if ("release" in step) pad.release(step.release);
    else if ("axis" in step) pad.axis(step.axis, step.value);
    else view.advance(step.advanceMs);
  }
}

/** The cases that produce metrics — every one that is not a refusal. */
export function metricCases(corpus: Corpus): Array<[string, GoldenCase]> {
  return Object.entries(corpus).filter(([, golden]) => golden.refuses === undefined);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, GOLDEN_DIR)), "utf8"));
}
