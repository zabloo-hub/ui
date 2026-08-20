/**
 * The Problems tab. The list belongs to ONE export, and the failure that never
 * becomes a diagnostic still has to reach it (ZAB-67).
 */

import { EXPORT_FAILED } from "./problems";
import { fatalCount, hasFatal, warnCount } from "./selectors";
import { memoryStorage } from "./storage";
import { createPreviewStore } from "./store";

const store = () => createPreviewStore({ storage: memoryStorage() });

const WARN = {
  severity: "warn",
  code: "invalid-node",
  path: 'views["hud"].children[2].text',
  reason: "missing",
  view: "hud",
} as const;

const FATAL = {
  severity: "fatal",
  code: "unknown-type",
  path: 'views["hud"]',
  reason: "?",
} as const;

describe("problems", () => {
  it("replaces the list per load instead of piling exports up", () => {
    const preview = store();
    preview.getState().replaceProblems([WARN, FATAL]);

    preview.getState().replaceProblems([WARN]);

    expect(preview.getState().problems).toEqual([WARN]);
  });

  it("reports a save that never became an envelope as a fatal of our own", () => {
    const preview = store();
    preview.getState().replaceProblems([WARN]);

    preview.getState().addExportFailure("envelope error: Unexpected end of JSON input");

    expect(preview.getState().problems).toHaveLength(2);
    expect(preview.getState().problems[1]).toEqual({
      severity: "fatal",
      code: EXPORT_FAILED,
      path: "",
      reason: "envelope error: Unexpected end of JSON input",
    });
  });

  it("counts the two levels apart", () => {
    const preview = store();

    preview.getState().replaceProblems([WARN, WARN, FATAL]);

    const state = preview.getState();
    expect(fatalCount(state)).toBe(1);
    expect(warnCount(state)).toBe(2);
    expect(hasFatal(state)).toBe(true);
  });

  it("says nothing is stale when every problem was repaired", () => {
    const preview = store();

    preview.getState().replaceProblems([WARN]);

    expect(hasFatal(preview.getState())).toBe(false);
  });
});
