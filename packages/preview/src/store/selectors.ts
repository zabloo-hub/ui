/**
 * The questions the chrome asks that no single field answers.
 *
 * They are plain functions of the state, which is what makes them usable three
 * ways without a hook in sight: `useStore(zoom)` in a component, `zoom(store.getState())`
 * in the session, and `zoom(state)` in a test with no React at all.
 */

import { fitScale, preset, type Size } from "./presets";
import type { PreviewState } from "./state";

/**
 * The size the view is LAID OUT at — which is not the size it is shown at. Under
 * a preset the canvas keeps its declared pixel size and only a transform shrinks
 * it, so the renderer goes on measuring the full 1920 while the screen shows it
 * smaller (ZAB-78). Under `fit` the two are the same thing: the stage itself.
 */
export function logicalSize(state: PreviewState): Size {
  const id = state.viewport.preset;
  if (id === "fit") return state.stageSize;
  if (id === "custom") return state.custom;
  return preset(id).size ?? state.stageSize;
}

/** How much of the logical size fits on the stage. Never above 1 — see `fitScale`. */
export function zoom(state: PreviewState): number {
  if (state.viewport.preset === "fit") return 1;
  const { width, height } = logicalSize(state);
  return fitScale(width, height, state.stageSize.width, state.stageSize.height);
}

/**
 * The stage caption, in pieces: `Steam Deck · 1280×800 · @1× · 60%`. The Stage
 * joins them, and `zoom` is null under `fit` — there is nothing being scaled to
 * report, and printing "100%" there would suggest otherwise.
 */
export interface CaptionParts {
  preset: string;
  size: string;
  dpr: string;
  zoom: string | null;
}

export function captionParts(state: PreviewState): CaptionParts {
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
export function bindingCount(state: PreviewState): number {
  return state.bindings.order.length;
}

export function fatalCount(state: PreviewState): number {
  return state.problems.filter((problem) => problem.severity === "fatal").length;
}

export function warnCount(state: PreviewState): number {
  return state.problems.filter((problem) => problem.severity === "warn").length;
}

/** Any fatal at all ⇒ what is on the canvas is stale (the veil, the red badge). */
export function hasFatal(state: PreviewState): boolean {
  return state.problems.some((problem) => problem.severity === "fatal");
}
