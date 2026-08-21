/**
 * The store of the preview chrome (V4). Everything the rest of the app is meant
 * to touch comes out of here: `useStore` for the state itself, a selector hook
 * per slice, and the pure selectors behind them.
 *
 * The rule this package keeps: NOTHING in `store/` imports React, the DOM or the
 * renderer. It is the logic of the chrome, and it is tested as such.
 */

export {
  ACTION_LOG_CAP,
  type ActionEntry,
  type ActionKind,
} from "./actions";
export {
  type Binding,
  type BindingType,
  type Declaration,
  inferType,
  type WriteSource,
} from "./bindings";
export type { ConnectionState } from "./connection";
export * from "./hooks";
export { type ConsoleTab, DEFAULT_LAYOUT, type Layout, type PanelPos } from "./layout";
export {
  DEFAULT_CUSTOM,
  type Dpr,
  fitScale,
  isDpr,
  isPresetId,
  PRESETS,
  type Preset,
  type PresetId,
  parseSize,
  preset,
  presetOfSize,
  type Size,
} from "./presets";
export { EXPORT_FAILED, type Problem, type Severity } from "./problems";
export {
  bindingCount,
  type CaptionParts,
  captionParts,
  fatalCount,
  hasFatal,
  logicalSize,
  orderedProblems,
  type ProblemSummary,
  problemSummary,
  warnCount,
  zoom,
} from "./selectors";
export type { PreviewState } from "./state";
export { FPS_WINDOW_MS, type FrameSample } from "./stats";
export {
  browserStorage,
  memoryStorage,
  NAMESPACE,
  type PreviewStorage,
  STORE_KEY,
  viewKey,
} from "./storage";
export {
  createPreviewStore,
  type PersistedState,
  type PreviewStore,
  type PreviewStoreOptions,
  useStore,
} from "./store";
export type { Theme } from "./theme";
