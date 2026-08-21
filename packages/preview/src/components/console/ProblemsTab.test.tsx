/**
 * The Problems tab, against the real store.
 *
 * What is worth testing here is not that a list renders: it is the three things
 * the tab promises about a diagnostic — that a fatal is above the warns no
 * matter what order the validator reported in, that the message keeps its three
 * parts (`[code]`, path, reason) instead of being one string, and that
 * `export-failed` — which is stderr and not a diagnostic — keeps its newlines.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { EXPORT_FAILED, type Problem } from "@/store/problems";
import { useStore } from "@/store/store";
import { ProblemsTab } from "./ProblemsTab";

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    severity: "warn",
    code: "unknown-prop",
    path: 'views["controls"].children[0].glow',
    reason: "removed (repaired)",
    ...overrides,
  };
}

function seed(problems: Problem[], activeView: string | null = "hud"): void {
  useStore.setState({ problems, views: ["hud", "controls"], activeView });
}

beforeEach(() => {
  seed([]);
});

/** The rows in the order they are painted in — the order is what is under test. */
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="problem"]'));
}

test("says so when there is nothing to say", () => {
  render(<ProblemsTab />);

  expect(screen.getByText("No problems")).toBeInTheDocument();
  expect(rows()).toHaveLength(0);
});

test("puts the fatals above the warns, and keeps the arrival order inside each", () => {
  seed([
    problem({ code: "unknown-prop" }),
    problem({ severity: "fatal", code: "invalid-node" }),
    problem({ code: "missing-binding" }),
  ]);

  render(<ProblemsTab />);

  expect(rows().map((row) => row.dataset.severity)).toEqual(["fatal", "warn", "warn"]);
  expect(
    rows().map((row) => row.textContent?.match(/\[([\w-]+)\]/)?.[1]),
    // A fatal buried under twenty warns is a fatal nobody read; two warns that
    // swapped places are two nodes you can no longer tell apart.
  ).toEqual(["invalid-node", "unknown-prop", "missing-binding"]);
});

test("chips each row with its severity", () => {
  seed([problem({ severity: "fatal", code: "invalid-node" }), problem()]);

  render(<ProblemsTab />);

  const badges = document.querySelectorAll('[data-slot="badge"]');
  expect(Array.from(badges).map((badge) => badge.textContent)).toEqual(["FATAL", "WARN"]);
  expect(badges[0]).toHaveAttribute("data-variant", "severity-fatal");
  expect(badges[1]).toHaveAttribute("data-variant", "severity-warn");
});

test("writes the message as `[code] path — reason`, one colour per part", () => {
  seed([
    problem({
      severity: "fatal",
      code: "invalid-node",
      path: 'views["hud"].children[2].text',
      reason: "missing",
    }),
  ]);

  render(<ProblemsTab />);

  const code = screen.getByText("[invalid-node]");
  expect(code).toHaveClass("text-danger-fg");
  expect(screen.getByText("— missing")).toHaveClass("text-muted-foreground");
  // The path is neither of the two: it wears the row's own colour, so it is
  // there in the message and in no span of its own.
  expect(code.parentElement?.textContent).toBe(
    '[invalid-node] views["hud"].children[2].text — missing',
  );
});

test("colours a warn's code amber", () => {
  seed([problem()]);

  render(<ProblemsTab />);

  expect(screen.getByText("[unknown-prop]")).toHaveClass("text-warn-fg");
});

test("keeps the export's stderr in a pre, line breaks and all", () => {
  const stderr = "zabloo export failed\n  at build/scene.ts:12\n  Unexpected token";
  seed([problem({ severity: "fatal", code: EXPORT_FAILED, path: "", reason: stderr })]);

  const { container } = render(<ProblemsTab />);

  const pre = container.querySelector("pre");
  expect(pre).not.toBeNull();
  expect(pre).toHaveClass("whitespace-pre-wrap");
  expect(pre?.textContent).toContain("at build/scene.ts:12");
  expect(pre?.textContent).toContain("Unexpected token");
});

test("a row about another view takes you to it", () => {
  seed([problem({ code: "unknown-prop", view: "controls" })], "hud");

  render(<ProblemsTab />);
  fireEvent.click(screen.getByRole("button"));

  expect(useStore.getState().activeView).toBe("controls");
});

test("a row about the view you are on is not a button", () => {
  seed([problem({ view: "hud" }), problem({ code: "orphan-binding" })], "hud");

  render(<ProblemsTab />);

  // One is already active, the other names no view at all.
  expect(screen.queryByRole("button")).toBeNull();
});
