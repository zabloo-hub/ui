/**
 * The questions the chrome asks that no single field answers.
 *
 * They are plain functions of the state, which is what makes them usable three
 * ways without a hook in sight: `useStore(zoom)` in a component, `zoom(store.getState())`
 * in the session, and `zoom(state)` in a test with no React at all.
 */

import { fitScale, preset, type Size } from "./presets";
import type { Problem, Severity } from "./problems";
import type { PreviewState } from "./state";

/**
 * The size the view is LAID OUT at — which is not the size it is shown at. Under
 * a preset the canvas keeps its declared pixel size and only a transform shrinks
 * it, so the renderer goes on measuring the full 1920 while the screen shows it
 * smaller (ZAB-78). Under `fit` the two are the same thing: the stage itself.
 */
function logicalSize(state: PreviewState): Size {
  const id = state.viewport.preset;
  if (id === "fit") return state.stageSize;
  if (id === "custom") return state.custom;
  return preset(id).size ?? state.stageSize;
}

/** How much of the logical size fits on the stage. Never above 1 — see `fitScale`. */
function zoom(state: PreviewState): number {
  if (state.viewport.preset === "fit") return 1;
  const { width, height } = logicalSize(state);
  return fitScale(width, height, state.stageSize.width, state.stageSize.height);
}

/**
 * The stage caption, in pieces: `Steam Deck · 1280×800 · @1× · 60%`. The Stage
 * joins them, and `zoom` is null under `fit` — there is nothing being scaled to
 * report, and printing "100%" there would suggest otherwise.
 */
interface CaptionParts {
  preset: string;
  size: string;
  dpr: string;
  zoom: string | null;
}

function captionParts(state: PreviewState): CaptionParts {
  const { width, height } = logicalSize(state);
  const fit = state.viewport.preset === "fit";
  return {
    preset: preset(state.viewport.preset).label,
    size: `${width}×${height}`,
    dpr: state.dpr === "auto" ? "@auto" : `@${state.dpr}×`,
    zoom: fit ? null : `${Math.round(zoom(state) * 100)}%`,
  };
}

/** How many paths the panel is showing — the "6 paths" of its header. */
function bindingCount(state: PreviewState): number {
  return state.bindings.order.length;
}

/**
 * The three questions asked about `problems`, answered in one pass and kept.
 *
 * They are read from the statusbar, the console's badge, the panel and the
 * stage's veil, and — because a hook's selector runs on EVERY notification, not
 * only the ones it re-renders for — that used to be three full scans of the
 * array per `recordFrame`, which arrives at frame rate. The list itself moves
 * once per load: it is REPLACED, never mutated (see `problems.ts`), so its
 * identity is a perfect cache key and a `WeakMap` lets the entry die with the
 * array it describes.
 */
interface ProblemSummary {
  fatal: number;
  warn: number;
  /** The sort the Problems tab shows: fatals first, arrival order within a level. */
  ordered: readonly Problem[];
}

const summaries = new WeakMap<readonly Problem[], ProblemSummary>();

/** Fatals first. Two problems of the same severity keep the order they arrived in. */
const RANK: Record<Severity, number> = { fatal: 0, warn: 1 };

function problemSummary(state: PreviewState): ProblemSummary {
  const problems = state.problems;
  const cached = summaries.get(problems);
  if (cached !== undefined) return cached;
  const summary: ProblemSummary = {
    fatal: problems.filter((problem) => problem.severity === "fatal").length,
    warn: problems.filter((problem) => problem.severity === "warn").length,
    // A copy: the store's order is the validator's, which is the order inside
    // the file, and losing it would make two warns on one node impossible to place.
    ordered: [...problems].sort((a, b) => RANK[a.severity] - RANK[b.severity]),
  };
  summaries.set(problems, summary);
  return summary;
}

function fatalCount(state: PreviewState): number {
  return problemSummary(state).fatal;
}

function warnCount(state: PreviewState): number {
  return problemSummary(state).warn;
}

/** Any fatal at all ⇒ what is on the canvas is stale (the veil, the red badge). */
function hasFatal(state: PreviewState): boolean {
  return problemSummary(state).fatal > 0;
}

/**
 * The list the Problems tab renders, sorted once per load rather than once per
 * render. Stable across renders, which is what lets the tab read it through
 * `useStore` without handing itself a fresh array every notification.
 */
function orderedProblems(state: PreviewState): readonly Problem[] {
  return problemSummary(state).ordered;
}

export type { CaptionParts, ProblemSummary };
export {
  bindingCount,
  captionParts,
  fatalCount,
  hasFatal,
  logicalSize,
  orderedProblems,
  problemSummary,
  warnCount,
  zoom,
};
