/**
 * What the validator said about the export on screen, as a list you can read.
 *
 * These diagnostics existed long before this tab (ZAB-37/72) and went to the
 * browser console, where a page cannot read its own output: the view you were
 * looking at could be missing half its nodes with nothing on screen admitting
 * it. Giving them a surface is the whole point of the tab.
 *
 * The two severities are not two shades of the same thing, and the tab is
 * written so you can tell them apart at a glance:
 *
 * - A **warn** was REPAIRED. What is on the canvas is correct minus the broken
 *   node, so it is information, not an alarm.
 * - A **fatal** means the view did not load and the canvas is STALE. Fatals sort
 *   to the top for that reason — a fatal buried under twenty warns is a fatal
 *   nobody read.
 *
 * The sort is stable and made on a COPY: the store's order is the order the
 * validator reported in, which is the order inside the file, and losing it would
 * make two warns on the same node impossible to place.
 *
 * `export-failed` is the one row that does not fit `[code] path — reason`: it is
 * not a diagnostic but the export's stderr (see `store/problems.ts`), so it gets
 * a `<pre>` and keeps its own line breaks.
 */

import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useProblems, useViews } from "@/store/hooks";
import { EXPORT_FAILED, type Problem, type Severity } from "@/store/problems";

/** Fatals first. Two problems of the same severity keep the order they arrived in. */
const RANK: Record<Severity, number> = { fatal: 0, warn: 1 };

function ProblemsTab() {
  const { entries } = useProblems();
  const { activeView, selectView } = useViews();
  const ordered = [...entries].sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  return (
    <div
      data-slot="problems-tab"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[14px] py-[10px]",
        "font-mono text-log leading-[1.7] text-subtle",
      )}
    >
      {ordered.length === 0 ? (
        <span className="text-muted-foreground">No problems</span>
      ) : (
        ordered.map((problem, index) => {
          // A row about the view you are already on has nowhere to take you.
          const { view } = problem;
          const jump =
            view !== undefined && view !== activeView ? () => selectView(view) : undefined;
          return (
            <ProblemRow
              // The list is replaced whole on every load and has no ids in it —
              // two identical warns on two nodes are two rows, and only the
              // position tells them apart.
              // biome-ignore lint/suspicious/noArrayIndexKey: a diagnostic has no identity
              key={`${problem.severity}:${problem.code}:${problem.path}:${index}`}
              problem={problem}
              onSelect={jump}
            />
          );
        })
      )}
    </div>
  );
}

interface ProblemRowProps {
  problem: Problem;
  /** Set only when the row names a view other than the active one. */
  onSelect?: () => void;
}

function ProblemRow({ problem, onSelect }: ProblemRowProps) {
  const content = (
    <>
      <Badge variant={problem.severity === "fatal" ? "severity-fatal" : "severity-warn"}>
        {problem.severity === "fatal" ? "FATAL" : "WARN"}
      </Badge>
      <ProblemMessage problem={problem} />
    </>
  );
  const className = "flex items-baseline gap-[10px] text-left";

  if (onSelect === undefined) {
    return (
      <div data-slot="problem" data-severity={problem.severity} className={className}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-slot="problem"
      data-severity={problem.severity}
      onClick={onSelect}
      className={cn(className, "rounded-xs hover:text-foreground focus-visible:focus-ring")}
    >
      {content}
    </button>
  );
}

/** `[code] path — reason`, each part coloured for what it is. */
function ProblemMessage({ problem }: { problem: Problem }) {
  const code = (
    <span className={problem.severity === "fatal" ? "text-danger-fg" : "text-warn-fg"}>
      [{problem.code}]
    </span>
  );

  // The stderr of a save that never became an envelope. It is already several
  // lines long and formatted by whatever printed it, so it is shown as printed.
  if (problem.code === EXPORT_FAILED) {
    return (
      <pre data-slot="problem-message" className="m-0 min-w-0 font-mono whitespace-pre-wrap">
        {code} {problem.reason}
      </pre>
    );
  }

  return (
    <span data-slot="problem-message">
      {code} {problem.path} <span className="text-muted-foreground">&mdash; {problem.reason}</span>
    </span>
  );
}

export { ProblemsTab };
