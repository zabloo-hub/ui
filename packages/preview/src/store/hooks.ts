/**
 * One selector hook per slice, so a component says what it depends on and
 * re-renders for that alone.
 *
 * Each returns its slice's state AND its actions, through `useShallow`: the
 * actions are created once and never change identity, the state fields are
 * primitives, so a shallow compare is exactly the right equality — without it,
 * a hook returning a fresh object every call would re-render on every unrelated
 * write, and under React 19's `useSyncExternalStore` it would loop.
 *
 * Anything these do not cover is `useStore(someSelector)` with a selector from
 * `selectors.ts`, which is the same thing without the wrapper.
 */

import { useShallow } from "zustand/react/shallow";
import {
  bindingCount,
  type CaptionParts,
  captionParts,
  fatalCount,
  hasFatal,
  logicalSize,
  warnCount,
  zoom,
} from "./selectors";
import { useStore } from "./store";

export const useTheme = () =>
  useStore(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      toggleTheme: state.toggleTheme,
    })),
  );

export const useViews = () =>
  useStore(
    useShallow((state) => ({
      views: state.views,
      activeView: state.activeView,
      fatalViews: state.fatalViews,
      setViews: state.setViews,
      selectView: state.selectView,
      markFatalView: state.markFatalView,
      clearFatalViews: state.clearFatalViews,
    })),
  );

export const useViewport = () =>
  useStore(
    useShallow((state) => ({
      preset: state.viewport.preset,
      custom: state.custom,
      dpr: state.dpr,
      stageSize: state.stageSize,
      setPreset: state.setPreset,
      setCustom: state.setCustom,
      setDpr: state.setDpr,
      setStageSize: state.setStageSize,
    })),
  );

export const useConnection = () =>
  useStore(
    useShallow((state) => ({
      connection: state.connection,
      lastError: state.lastError,
      streamOpened: state.streamOpened,
      streamLost: state.streamLost,
      exportFailed: state.exportFailed,
      exportLoaded: state.exportLoaded,
    })),
  );

export const useBindings = () =>
  useStore(
    useShallow((state) => ({
      byPath: state.bindings.byPath,
      order: state.bindings.order,
      count: state.bindings.order.length,
      declare: state.declare,
      setFromEditor: state.setFromEditor,
      setFromUI: state.setFromUI,
      clearUIMark: state.clearUIMark,
    })),
  );

export const useActions = () =>
  useStore(
    useShallow((state) => ({
      entries: state.actions,
      append: state.appendAction,
      clear: state.clearActions,
    })),
  );

export const useProblems = () =>
  useStore(
    useShallow((state) => ({
      entries: state.problems,
      fatalCount: fatalCount(state),
      warnCount: warnCount(state),
      hasFatal: hasFatal(state),
      replace: state.replaceProblems,
      addExportFailure: state.addExportFailure,
    })),
  );

export const useStats = () =>
  useStore(
    useShallow((state) => ({
      last: state.stats.last,
      fps: state.stats.fps,
      recordFrame: state.recordFrame,
      tick: state.tickStats,
    })),
  );

export const useLayout = () =>
  useStore(
    useShallow((state) => ({
      ...state.layout,
      setPanelOpen: state.setPanelOpen,
      togglePanel: state.togglePanel,
      setPanelPos: state.setPanelPos,
      setConsoleOpen: state.setConsoleOpen,
      toggleConsole: state.toggleConsole,
      setConsoleTab: state.setConsoleTab,
      setZen: state.setZen,
      toggleZen: state.toggleZen,
    })),
  );

export const useEnvelope = () =>
  useStore(useShallow((state) => ({ name: state.envelope.name, setIdentity: state.setIdentity })));

export const useRuntime = () =>
  useStore(useShallow((state) => ({ canvas: state.runtime.canvas, setCanvas: state.setCanvas })));

/** The derived handful the Stage asks for by name. */
export const useZoom = (): number => useStore(zoom);
export const useLogicalSize = () => useStore(useShallow(logicalSize));
export const useCaptionParts = (): CaptionParts => useStore(useShallow(captionParts));
export const useBindingCount = (): number => useStore(bindingCount);
