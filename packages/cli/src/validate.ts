/**
 * `zabloo validate` — run the loading contract against an envelope on disk and
 * say, in exit-code terms, whether an SDK would load it (ZAB-78).
 *
 * The check already existed and was reachable by exactly one route: writing a
 * script against `@zabloo/format`. So a studio wanting its CI to refuse a broken
 * committed envelope — the artifact that ships to live games, where a bad load
 * costs a player their session — had to build the tool first. This is that tool.
 *
 * It reports what `readEnvelope` reports and adds nothing of its own: same codes,
 * same paths, same warn/fatal split (decision 2026-08-12, ZAB-37). `--json` is the
 * same report as a value, because a CI step that wants to annotate a diff needs
 * the path, not a rendered line.
 */

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { type Diagnostic, readEnvelope } from "@zabloo/format";
import { loadConfig, resolveOutFile } from "./config.js";

/** A problem with the invocation itself, not with the envelope's contents. */
export class ValidateError extends Error {}

export interface ValidateReport {
  /** Absolute path of the envelope that was read. */
  file: string;
  /** No `fatal` diagnostic: an SDK would load this payload. */
  ok: boolean;
  /** The views that survived validation — what an SDK would actually be able to show. */
  views: string[];
  diagnostics: Diagnostic[];
}

/**
 * Reads and validates an envelope. `file` is relative to the project root; without
 * one, the project's own `<outDir>/zabloo.ir.json` is used, so `zabloo validate`
 * with no arguments checks what `zabloo export` just wrote — including when
 * `zabloo.config.ts` moved `outDir`.
 */
export async function validateEnvelope(rootDir: string, file?: string): Promise<ValidateReport> {
  const root = resolve(rootDir);
  const path =
    file === undefined ? resolveOutFile(root, await loadConfig(root)) : resolve(root, file);

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new ValidateError(
      `no envelope at ${path}` +
        (file === undefined ? " — run `zabloo export` first, or pass a path" : ""),
    );
  }

  // The raw text, not a parsed value: invalid JSON is a diagnostic of the contract
  // (`invalid-json`), and parsing it here would turn it into a thrown SyntaxError.
  const { envelope, diagnostics } = readEnvelope(text);
  return {
    file: path,
    ok: envelope !== null,
    views: Object.keys(envelope?.views ?? {}),
    diagnostics,
  };
}

/** `true` when the report should fail the command — see `--strict`. */
export function failed(report: ValidateReport, strict: boolean): boolean {
  return !report.ok || (strict && report.diagnostics.length > 0);
}

/**
 * The report as a person reads it, from the directory they ran the command in.
 * Pure, so the tests assert the text a studio will paste into an issue rather
 * than a spy on `console.log`.
 */
export function formatReport(report: ValidateReport, strict: boolean, cwd: string): string {
  const lines: string[] = [`zabloo validate: ${relative(cwd, report.file) || report.file}`];

  for (const diagnostic of report.diagnostics) {
    const mark = diagnostic.level === "fatal" ? "✗ fatal" : "⚠ warn ";
    lines.push("", `  ${mark}  ${diagnostic.code}  ${diagnostic.path || "<envelope>"}`);
    lines.push(`          ${diagnostic.message}`);
  }

  const fatals = report.diagnostics.filter((d) => d.level === "fatal").length;
  const warnings = report.diagnostics.length - fatals;
  const counts = [count(fatals, "fatal"), count(warnings, "warning")].filter(Boolean).join(", ");

  lines.push("");
  if (!report.ok) {
    lines.push(`zabloo validate: ${counts} — no SDK would load this envelope ✗`);
  } else {
    // A warning was REPAIRED: the envelope loads, minus the broken part. Saying
    // "ok" and nothing else would hide that a node the author wrote is not there.
    const views = `${report.views.length} view(s) [${report.views.join(", ")}]`;
    const verdict = warnings === 0 ? "✔" : strict ? "✗ (--strict)" : "✔ (loads without them)";
    lines.push(`zabloo validate: ${views}${counts ? `, ${counts}` : ""} ${verdict}`);
  }
  return lines.join("\n");
}

function count(n: number, noun: string): string {
  return n === 0 ? "" : `${n} ${noun}${n === 1 ? "" : "s"}`;
}
