/**
 * Which parts of the chrome are showing. Remembered (★) — except zen.
 *
 * Zen collapses the topbar, the console, the statusbar and the bindings panel to
 * leave the canvas full-bleed. Persisting it would mean opening the preview one
 * morning to a window with no controls in it and no obvious way back, so it is
 * deliberately session-only: you enter zen, and a reload puts the tool back. The
 * other three are the opposite — a collapsed console you re-collapse on every
 * save is the kind of small friction that makes a tool feel broken.
 *
 * `panelPos` is null until the panel is dragged; null means "the default corner"
 * (top-right, 14px in), which is a layout decision the panel itself owns (V14).
 */

import type { Getter, Setter } from "./state";

type ConsoleTab = "actions" | "problems" | "stats";

interface PanelPos {
  x: number;
  y: number;
}

interface Layout {
  panelOpen: boolean;
  panelPos: PanelPos | null;
  consoleOpen: boolean;
  consoleTab: ConsoleTab;
  zen: boolean;
}

interface LayoutSlice {
  layout: Layout;
  setPanelOpen(open: boolean): void;
  togglePanel(): void;
  setPanelPos(pos: PanelPos | null): void;
  setConsoleOpen(open: boolean): void;
  toggleConsole(): void;
  setConsoleTab(tab: ConsoleTab): void;
  setZen(on: boolean): void;
  toggleZen(): void;
}

const DEFAULT_LAYOUT: Layout = {
  panelOpen: true,
  panelPos: null,
  consoleOpen: true,
  consoleTab: "actions",
  zen: false,
};

function createLayoutSlice(set: Setter, get: Getter): LayoutSlice {
  const patch = (change: Partial<Layout>): void => set({ layout: { ...get().layout, ...change } });
  return {
    layout: DEFAULT_LAYOUT,
    setPanelOpen: (panelOpen) => patch({ panelOpen }),
    togglePanel: () => patch({ panelOpen: !get().layout.panelOpen }),
    setPanelPos: (panelPos) => patch({ panelPos }),
    setConsoleOpen: (consoleOpen) => patch({ consoleOpen }),
    toggleConsole: () => patch({ consoleOpen: !get().layout.consoleOpen }),
    setConsoleTab: (consoleTab) => patch({ consoleTab }),
    setZen: (zen) => patch({ zen }),
    toggleZen: () => patch({ zen: !get().layout.zen }),
  };
}

function isConsoleTab(value: unknown): value is ConsoleTab {
  return value === "actions" || value === "problems" || value === "stats";
}

/**
 * A remembered layout on top of the running one, field by field.
 *
 * Every field is checked rather than spread wholesale for two reasons: the blob
 * in storage is a file a human can edit, and `zen` is deliberately absent from it
 * (see above) — a plain spread would set it to `undefined` and leave the chrome
 * in a state that is neither zen nor not.
 */
function mergeLayout(current: Layout, saved: Partial<Layout> | undefined): Layout {
  if (saved === undefined) return current;
  return {
    panelOpen: typeof saved.panelOpen === "boolean" ? saved.panelOpen : current.panelOpen,
    panelPos: isPanelPos(saved.panelPos) ? saved.panelPos : current.panelPos,
    consoleOpen: typeof saved.consoleOpen === "boolean" ? saved.consoleOpen : current.consoleOpen,
    consoleTab: isConsoleTab(saved.consoleTab) ? saved.consoleTab : current.consoleTab,
    zen: current.zen,
  };
}

function isPanelPos(value: unknown): value is PanelPos {
  if (value === null || typeof value !== "object") return false;
  const pos = value as PanelPos;
  return Number.isFinite(pos.x) && Number.isFinite(pos.y);
}

export type { ConsoleTab, Layout, LayoutSlice, PanelPos };
export { createLayoutSlice, DEFAULT_LAYOUT, isConsoleTab, mergeLayout };
