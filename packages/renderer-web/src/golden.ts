/**
 * Reads the golden corpus (`golden/` at the repo root) and replays one case.
 *
 * The corpus is deliberately OUTSIDE this package: from ZAB-38 on, the Unity SDK
 * loads these very files and must produce the same metrics, so an envelope, its
 * seed data and the clock it is measured at are cross-target inputs — not
 * fixtures of the web renderer's test suite.
 *
 * A case is `(envelope, data, viewport, clock)` and nothing else. Everything a
 * golden file records has to be derivable from those four, or the other target
 * could not reproduce it.
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
}

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
  return view;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, GOLDEN_DIR)), "utf8"));
}
