/**
 * The Actions log: append-only, oldest first, capped. The cap is the point — a
 * repeating action can write a line per frame for as long as the tab is open.
 */

import { ACTION_LOG_CAP } from "./actions";
import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

describe("action log", () => {
  it("keeps the lines in the order they happened and stamps them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
    const preview = store();

    preview.getState().appendAction("view", "loaded → controls");
    preview.getState().appendAction("write", "settings.sfx = true");

    expect(preview.getState().actions).toEqual([
      { ts: Date.now(), kind: "view", text: "loaded → controls" },
      { ts: Date.now(), kind: "write", text: "settings.sfx = true" },
    ]);
    vi.useRealTimers();
  });

  it("drops the oldest once the cap is reached", () => {
    const preview = store();

    for (let i = 0; i < ACTION_LOG_CAP + 20; i++) {
      preview.getState().appendAction("action", `buy #${i}`);
    }

    const entries = preview.getState().actions;
    expect(entries).toHaveLength(ACTION_LOG_CAP);
    expect(entries[0]?.text).toBe("buy #20");
    expect(entries[entries.length - 1]?.text).toBe(`buy #${ACTION_LOG_CAP + 19}`);
  });

  it("empties on Clear", () => {
    const preview = store();
    preview.getState().appendAction("action", "buy");

    preview.getState().clearActions();

    expect(preview.getState().actions).toEqual([]);
  });
});
