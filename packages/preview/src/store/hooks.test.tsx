/**
 * The selector hooks. There is one thing worth proving here and it is not that a
 * getter returns a value: it is that a hook returning a fresh object every call
 * does NOT re-render on every unrelated write — which under React 19's
 * `useSyncExternalStore` is the difference between a chrome and an infinite loop.
 */

import { act, renderHook } from "@testing-library/react";
import {
  useActions,
  useBindingCount,
  useBindings,
  useCaptionParts,
  useConnection,
  useEnvelope,
  useLayout,
  useLogicalSize,
  useProblems,
  useRuntime,
  useStats,
  useTheme,
  useViewport,
  useViews,
  useZoom,
} from "./hooks";
import { useStore } from "./store";

beforeEach(() => {
  useStore.setState({ theme: "light", problems: [], actions: [], stats: { last: null, fps: 0 } });
});

describe("selector hooks", () => {
  it("hands a slice its state and its actions", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
  });

  it("does not re-render for a write to another slice", () => {
    const renders: string[] = [];
    renderHook(() => {
      renders.push("render");
      return useViewport();
    });
    const before = renders.length;

    act(() => useStore.getState().appendAction("action", "buy"));

    expect(renders).toHaveLength(before);
  });

  /**
   * The two hooks a frame used to reach. `recordFrame` notifies the store several
   * times a second, and a selector that scanned an array or carried an object
   * rebuilt on every measurement turned that into work — or into a render — for
   * components that print neither.
   */
  it("does not re-render the viewport controls while the stage is being measured", () => {
    const renders: string[] = [];
    renderHook(() => {
      renders.push("render");
      return useViewport();
    });
    const before = renders.length;

    act(() => {
      useStore.getState().setStageSize({ width: 900, height: 600 });
      useStore.getState().setStageSize({ width: 901, height: 600 });
      useStore.getState().setStageSize({ width: 902, height: 600 });
    });

    expect(renders).toHaveLength(before);
  });

  it("does not re-render the problem readers while frames are arriving", () => {
    const renders: string[] = [];
    renderHook(() => {
      renders.push("render");
      return useProblems();
    });
    const before = renders.length;

    // Written straight into the slice rather than through `recordFrame`: the
    // notification is what this is about, and the singleton's fps window is
    // shared with every other case in this file. That `recordFrame` itself does
    // not re-scan is `selectors.test.ts`, on a store of its own.
    act(() => {
      for (const frame of Array.from({ length: 30 }, (_, index) => index)) {
        useStore.setState({
          stats: {
            last: {
              frameMs: 1.9,
              drawCalls: frame,
              vertices: 120,
              atlases: 1,
              atlasBytes: 2048,
              resolved: 0,
              repaintOnly: true,
              textLayouts: 0,
              bufferGrowths: 0,
            },
            fps: 0,
          },
        });
      }
    });

    expect(renders).toHaveLength(before);
  });

  it("re-renders for a write to its own slice", () => {
    const { result } = renderHook(() => useLayout());

    act(() => useStore.getState().toggleConsole());

    expect(result.current.consoleOpen).toBe(false);
  });

  it("exposes the derived counts next to the list", () => {
    const { result } = renderHook(() => useProblems());

    act(() =>
      result.current.replace([
        { severity: "fatal", code: "unknown-type", path: 'views["hud"]', reason: "?" },
        { severity: "warn", code: "invalid-node", path: "x", reason: "missing" },
      ]),
    );

    expect(result.current).toMatchObject({ fatalCount: 1, warnCount: 1, hasFatal: true });
  });

  it("covers every slice, and the derived handful next to them", () => {
    const { result } = renderHook(() => ({
      views: useViews(),
      viewport: useViewport(),
      connection: useConnection(),
      bindings: useBindings(),
      actions: useActions(),
      stats: useStats(),
      envelope: useEnvelope(),
      runtime: useRuntime(),
      zoom: useZoom(),
      logicalSize: useLogicalSize(),
      caption: useCaptionParts(),
      count: useBindingCount(),
    }));

    act(() => {
      result.current.envelope.setIdentity("zabloo.ir.json");
      result.current.views.setViews(["layout", "hud"]);
      result.current.bindings.declare([{ path: "player.gold", type: "number" }]);
      result.current.connection.streamOpened();
      result.current.actions.append("view", "loaded → layout");
      result.current.stats.tick();
      useStore.getState().setStageSize({ width: 900, height: 600 });
    });

    expect(result.current).toMatchObject({
      views: { views: ["layout", "hud"], activeView: "layout" },
      connection: { connection: "live" },
      envelope: { name: "zabloo.ir.json" },
      runtime: { canvas: null },
      zoom: 1,
      logicalSize: { width: 900, height: 600 },
      caption: { preset: "Fit window", size: "900×600", zoom: null },
      count: 1,
    });
    expect(result.current.actions.entries).toHaveLength(1);
    expect(result.current.stats.fps).toBe(0);
  });
});
