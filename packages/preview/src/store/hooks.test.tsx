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
  useStore.setState({ theme: "light", problems: [], actions: [] });
});

describe("selector hooks", () => {
  it("hands a slice its state and its actions", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
  });

  it("does not re-render for a write to another slice", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useViewport();
    });
    const before = renders;

    act(() => useStore.getState().appendAction("action", "buy"));

    expect(renders).toBe(before);
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
      result.current.viewport.setStageSize({ width: 900, height: 600 });
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
