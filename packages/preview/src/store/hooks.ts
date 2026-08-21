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
import type { Problem } from "./problems";
import {
  bindingCount,
  type CaptionParts,
  captionParts,
  logicalSize,
  orderedProblems,
  problemSummary,
  zoom,
} from "./selectors";
import { useStore } from "./store";

const useTheme = () =>
  useStore(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      toggleTheme: state.toggleTheme,
    })),
  );

const useViews = () =>
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

/**
 * Deliberately WITHOUT `stageSize`. Nothing that reads this hook wants it — the
 * Stage writes it through its own narrow selector and `logicalSize`/`zoom` take
 * it from the state directly — and it is the one field here that is an object
 * rebuilt on every measurement, so carrying it would re-render both topbar
 * controls through every frame of a window drag-resize.
 */
const useViewport = () =>
  useStore(
    useShallow((state) => ({
      preset: state.viewport.preset,
      custom: state.custom,
      dpr: state.dpr,
      setPreset: state.setPreset,
      setCustom: state.setCustom,
      setDpr: state.setDpr,
    })),
  );

const useConnection = () =>
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

const useBindings = () =>
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

const useActions = () =>
  useStore(
    useShallow((state) => ({
      entries: state.actions,
      append: state.appendAction,
      clear: state.clearActions,
    })),
  );

/**
 * The three counts come from `problemSummary`, which is memoized on the identity
 * of the array (see `selectors.ts`). That matters here and not elsewhere: this
 * selector runs on every notification the store makes — `recordFrame` included,
 * which arrives at frame rate — and scanning the list three times for each one
 * was work done for a render that `useShallow` then correctly refused.
 */
const useProblems = () =>
  useStore(
    useShallow((state) => {
      const summary = problemSummary(state);
      return {
        entries: state.problems,
        fatalCount: summary.fatal,
        warnCount: summary.warn,
        hasFatal: summary.fatal > 0,
        replace: state.replaceProblems,
        addExportFailure: state.addExportFailure,
      };
    }),
  );

const useStats = () =>
  useStore(
    useShallow((state) => ({
      last: state.stats.last,
      fps: state.stats.fps,
      recordFrame: state.recordFrame,
      tick: state.tickStats,
    })),
  );

const useLayout = () =>
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

const useEnvelope = () =>
  useStore(useShallow((state) => ({ name: state.envelope.name, setIdentity: state.setIdentity })));

const useRuntime = () =>
  useStore(useShallow((state) => ({ canvas: state.runtime.canvas, setCanvas: state.setCanvas })));

/** The derived handful the Stage asks for by name. */
const useZoom = (): number => useStore(zoom);
const useLogicalSize = () => useStore(useShallow(logicalSize));
const useCaptionParts = (): CaptionParts => useStore(useShallow(captionParts));
const useBindingCount = (): number => useStore(bindingCount);

/** The Problems tab's list, sorted once per load rather than once per render. */
const useOrderedProblems = (): readonly Problem[] => useStore(orderedProblems);

export {
  useActions,
  useBindingCount,
  useBindings,
  useCaptionParts,
  useConnection,
  useEnvelope,
  useLayout,
  useLogicalSize,
  useOrderedProblems,
  useProblems,
  useRuntime,
  useStats,
  useTheme,
  useViewport,
  useViews,
  useZoom,
};
