/**
 * The Problems tab: what the validator said about the envelope on screen.
 *
 * The preview had no access to these at all until ZAB-72 — they were console
 * lines, and a page cannot read its own console, so the export you were looking
 * at could be missing half its nodes with nothing on screen admitting it.
 *
 * The two levels mean different things and the chrome shows them differently: a
 * `warn` was REPAIRED (what is on the canvas is correct, minus the broken node),
 * while a `fatal` means the view did not load and what you see is stale. A fatal
 * raises the veil and the count badge — never a blocking overlay.
 *
 * The list is REPLACED per load rather than appended to: a diagnostic is a
 * statement about one export, and keeping the previous export's fatals around
 * would report a file that no longer exists.
 */

import type { Getter, Setter } from "./state";

type Severity = "fatal" | "warn";

interface Problem {
  severity: Severity;
  /** The validator's stable code — the identity you can search for. */
  code: string;
  path: string;
  reason: string;
  /** The view it belongs to, when the path names one. Feeds the picker's red dot. */
  view?: string;
}

/** The code of the synthetic fatal below — not a validator code. */
const EXPORT_FAILED = "export-failed";

interface ProblemsSlice {
  problems: Problem[];
  replaceProblems(entries: Problem[]): void;
  addExportFailure(message: string): void;
}

function createProblemsSlice(set: Setter, get: Getter): ProblemsSlice {
  return {
    problems: [],
    replaceProblems: (entries) => set({ problems: entries }),
    /**
     * A save that never became an envelope — the fetch, its JSON, the asset
     * hydration — has no diagnostic to show, and it is the exact case where the
     * canvas goes stale (ZAB-67). It is reported as a fatal of our own so the
     * tab, the badge and the veil all learn about it through one channel.
     */
    addExportFailure: (message) =>
      set({
        problems: [
          ...get().problems,
          { severity: "fatal", code: EXPORT_FAILED, path: "", reason: message },
        ],
      }),
  };
}

export type { Problem, ProblemsSlice, Severity };
export { createProblemsSlice, EXPORT_FAILED };
