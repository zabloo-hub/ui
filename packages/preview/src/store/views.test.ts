/**
 * Keeping your place. Two rules with history behind them: a hot-update that
 * rewrites the view list must not move you (the old `syncViewOptions`), and the
 * selection belongs to the ENVELOPE, not to the tab.
 */

import { memoryStorage, viewKey } from "./storage";
import { createPreviewStore } from "./store";

function store(entries: Record<string, string> = {}) {
  return createPreviewStore({ storage: memoryStorage(entries) });
}

describe("setViews", () => {
  it("selects the first view when there is nothing to keep", () => {
    const preview = store();

    preview.getState().setViews(["layout", "controls"]);

    expect(preview.getState().activeView).toBe("layout");
  });

  it("keeps the view you were on across a reload that still has it", () => {
    const preview = store();
    preview.getState().setViews(["layout", "controls"]);
    preview.getState().selectView("controls");

    preview.getState().setViews(["layout", "controls", "lists"]);

    expect(preview.getState().activeView).toBe("controls");
  });

  it("falls back to the first when the save dropped the view you were on", () => {
    const preview = store();
    preview.getState().setViews(["layout", "controls"]);
    preview.getState().selectView("controls");

    preview.getState().setViews(["hud", "layout"]);

    expect(preview.getState().activeView).toBe("hud");
  });

  it("leaves nothing selected for an envelope with no views", () => {
    const preview = store();

    preview.getState().setViews([]);

    expect(preview.getState().activeView).toBeNull();
  });
});

describe("per-envelope memory", () => {
  it("remembers the selection under the envelope's own key", () => {
    const storage = memoryStorage();
    const preview = createPreviewStore({ storage });
    preview.getState().setIdentity("zabloo.ir.json");
    preview.getState().setViews(["layout", "hud"]);

    preview.getState().selectView("hud");

    expect(storage.read(viewKey("zabloo.ir.json"))).toBe("hud");
  });

  it("restores it when the same envelope loads again", () => {
    const preview = store({ [viewKey("zabloo.ir.json")]: "hud" });
    preview.getState().setIdentity("zabloo.ir.json");

    preview.getState().setViews(["layout", "hud"]);

    expect(preview.getState().activeView).toBe("hud");
  });

  it("ignores a remembered view the envelope no longer declares", () => {
    const preview = store({ [viewKey("zabloo.ir.json")]: "hud" });
    preview.getState().setIdentity("zabloo.ir.json");

    preview.getState().setViews(["layout"]);

    expect(preview.getState().activeView).toBe("layout");
  });

  it("leaves you where you are when the same envelope is announced again", () => {
    const preview = store();
    preview.getState().setIdentity("zabloo.ir.json");
    preview.getState().setViews(["layout", "hud"]);
    preview.getState().selectView("hud");

    preview.getState().setIdentity("zabloo.ir.json");

    expect(preview.getState().activeView).toBe("hud");
  });

  it("does not carry a selection over to a different envelope", () => {
    const preview = store({ [viewKey("one.ir.json")]: "hud" });
    preview.getState().setIdentity("one.ir.json");
    preview.getState().setViews(["layout", "hud"]);

    preview.getState().setIdentity("other.ir.json");

    expect(preview.getState().envelope.name).toBe("other.ir.json");
    expect(preview.getState().activeView).toBe("layout");
  });
});

describe("fatalViews", () => {
  it("marks a view once and drops it when the view is gone", () => {
    const preview = store();
    preview.getState().setViews(["layout", "hud"]);

    preview.getState().markFatalView("hud");
    preview.getState().markFatalView("hud");
    expect([...preview.getState().fatalViews]).toEqual(["hud"]);

    preview.getState().setViews(["layout"]);
    expect(preview.getState().fatalViews.size).toBe(0);
  });

  it("keeps the marks of the views that survive a reload", () => {
    const preview = store();
    preview.getState().setViews(["layout", "hud"]);
    preview.getState().markFatalView("hud");

    preview.getState().setViews(["hud", "layout", "lists"]);

    expect([...preview.getState().fatalViews]).toEqual(["hud"]);
  });

  it("clears them when a load starts", () => {
    const preview = store();
    preview.getState().setViews(["hud"]);
    preview.getState().markFatalView("hud");

    preview.getState().clearFatalViews();

    expect(preview.getState().fatalViews.size).toBe(0);
  });
});
