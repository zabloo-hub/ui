/**
 * Which parts of the chrome are showing, plus the merge that lets a remembered
 * layout land on the running one without dragging `zen` (or garbage) in with it.
 */

import { DEFAULT_LAYOUT, mergeLayout } from "./layout";
import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

describe("layout", () => {
  it("opens with the panel and the console showing", () => {
    expect(store().getState().layout).toEqual(DEFAULT_LAYOUT);
  });

  it("toggles each region on its own", () => {
    const preview = store();

    preview.getState().togglePanel();
    preview.getState().toggleConsole();
    preview.getState().toggleZen();

    expect(preview.getState().layout).toMatchObject({
      panelOpen: false,
      consoleOpen: false,
      zen: true,
    });
  });

  it("remembers where the panel was dragged, and that it never was", () => {
    const preview = store();

    preview.getState().setPanelPos({ x: 120, y: 48 });
    expect(preview.getState().layout.panelPos).toEqual({ x: 120, y: 48 });

    preview.getState().setPanelPos(null);
    expect(preview.getState().layout.panelPos).toBeNull();
  });

  it("switches console tab", () => {
    const preview = store();

    preview.getState().setConsoleTab("problems");

    expect(preview.getState().layout.consoleTab).toBe("problems");
  });
});

describe("mergeLayout", () => {
  it("takes the remembered fields and leaves zen where it is", () => {
    const current = { ...DEFAULT_LAYOUT, zen: true };

    const merged = mergeLayout(current, {
      panelOpen: false,
      consoleOpen: false,
      consoleTab: "stats",
      panelPos: { x: 10, y: 20 },
    });

    expect(merged).toEqual({
      panelOpen: false,
      panelPos: { x: 10, y: 20 },
      consoleOpen: false,
      consoleTab: "stats",
      zen: true,
    });
  });

  it("ignores whatever it does not recognize", () => {
    const merged = mergeLayout(DEFAULT_LAYOUT, {
      panelOpen: "yes",
      consoleTab: "nope",
      panelPos: { x: "left" },
    } as never);

    expect(merged).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps the running layout when nothing was remembered", () => {
    expect(mergeLayout(DEFAULT_LAYOUT, undefined)).toBe(DEFAULT_LAYOUT);
  });
});
