/**
 * `zabloo validate` (ZAB-78) — the command a studio's CI runs against a committed
 * envelope. Its contract is almost entirely the EXIT CODE and the text next to it,
 * so that is what these assert: a warning must not fail the build, a fatal must,
 * and `--strict` must move that line without moving anything else.
 *
 * The envelopes are hand-written rather than exported, because what is on trial is
 * the reporting of a broken payload — and `zabloo export` refuses to write one.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failed, formatReport, ValidateError, validateEnvelope } from "./validate.js";

/** A project root holding `files`, keyed by path relative to it. */
async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zabloo-validate-"));
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

const GOOD = JSON.stringify({
  v: 1,
  tokens: { "color.primary": "#4f46e5" },
  views: { hud: { type: "Text", text: "hi", style: { color: "{color.primary}" } } },
});

/** Loads, but a token nobody declared went missing on the way — a repaired warn. */
const WARNING = JSON.stringify({
  v: 1,
  tokens: {},
  views: { hud: { type: "Text", text: "hi", style: { color: "{color.nope}" } } },
});

describe("validateEnvelope", () => {
  it("validates the project's own envelope when given no path", async () => {
    const root = await project({ "dist/zabloo.ir.json": GOOD });
    const report = await validateEnvelope(root);
    expect(report.ok).toBe(true);
    expect(report.views).toEqual(["hud"]);
    expect(report.diagnostics).toEqual([]);
    expect(report.file).toBe(join(root, "dist", "zabloo.ir.json"));
  });

  it("follows outDir, so a project that moved its output still validates itself", async () => {
    const root = await project({
      "zabloo.config.ts": `export const outDir = "build";\nexport default { outDir: "build" };\n`,
      "build/zabloo.ir.json": GOOD,
    });
    const report = await validateEnvelope(root);
    expect(report.file).toBe(join(root, "build", "zabloo.ir.json"));
    expect(report.ok).toBe(true);
  });

  it("validates an explicit path, relative to the project root", async () => {
    const root = await project({ "artifacts/ui.json": GOOD });
    const report = await validateEnvelope(root, "artifacts/ui.json");
    expect(report.file).toBe(join(root, "artifacts", "ui.json"));
    expect(report.ok).toBe(true);
  });

  it("says what to run when there is no envelope where it looked", async () => {
    const root = await project({});
    await expect(validateEnvelope(root)).rejects.toBeInstanceOf(ValidateError);
    await expect(validateEnvelope(root)).rejects.toThrow(/run `zabloo export` first/);
  });

  it("reports invalid JSON as the contract's own diagnostic, not a SyntaxError", async () => {
    const root = await project({ "dist/zabloo.ir.json": "{ not json" });
    const report = await validateEnvelope(root);
    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toContain("invalid-json");
  });

  it("refuses a version this reader does not implement", async () => {
    const root = await project({
      "dist/zabloo.ir.json": JSON.stringify({ v: 99, tokens: {}, views: { hud: {} } }),
    });
    const report = await validateEnvelope(root);
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((d) => d.level === "fatal")).toBe(true);
  });

  it("loads with a warning when something was repaired", async () => {
    const root = await project({ "dist/zabloo.ir.json": WARNING });
    const report = await validateEnvelope(root);
    expect(report.ok).toBe(true);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0].level).toBe("warn");
  });
});

describe("failed", () => {
  const report = (level: "warn" | "fatal" | null) => ({
    file: "/tmp/zabloo.ir.json",
    ok: level !== "fatal",
    views: level === "fatal" ? [] : ["hud"],
    diagnostics:
      level === null ? [] : [{ level, code: "unknown-token" as const, path: "", message: "x" }],
  });

  it("passes a clean envelope", () => {
    expect(failed(report(null), false)).toBe(false);
    expect(failed(report(null), true)).toBe(false);
  });

  it("passes a warning by default — the envelope loads without the broken part", () => {
    expect(failed(report("warn"), false)).toBe(false);
  });

  it("fails a warning under --strict", () => {
    expect(failed(report("warn"), true)).toBe(true);
  });

  it("fails a fatal either way", () => {
    expect(failed(report("fatal"), false)).toBe(true);
    expect(failed(report("fatal"), true)).toBe(true);
  });
});

describe("formatReport", () => {
  it("names the file relative to where the command was run", () => {
    const text = formatReport(
      { file: "/repo/dist/zabloo.ir.json", ok: true, views: ["hud"], diagnostics: [] },
      false,
      "/repo",
    );
    expect(text).toContain("zabloo validate: dist/zabloo.ir.json");
    expect(text).toContain("1 view(s) [hud] ✔");
  });

  it("prints each diagnostic with its code and its path into the envelope", () => {
    const text = formatReport(
      {
        file: "/repo/dist/zabloo.ir.json",
        ok: true,
        views: ["hud"],
        diagnostics: [
          {
            level: "warn",
            code: "unknown-token",
            path: 'views["hud"].style.color',
            message: "dangling token",
          },
        ],
      },
      false,
      "/repo",
    );
    expect(text).toContain("⚠ warn");
    expect(text).toContain("unknown-token");
    expect(text).toContain('views["hud"].style.color');
    expect(text).toContain("dangling token");
    // The verdict has to say the envelope still loads, or a repaired warning
    // reads like a failure and a real failure reads like a warning.
    expect(text).toContain("1 warning ✔ (loads without them)");
  });

  it("says the same warning fails the build under --strict", () => {
    const text = formatReport(
      {
        file: "/repo/dist/zabloo.ir.json",
        ok: true,
        views: ["hud"],
        diagnostics: [{ level: "warn", code: "unknown-token", path: "", message: "x" }],
      },
      true,
      "/repo",
    );
    expect(text).toContain("✗ (--strict)");
  });

  it("says outright that a fatal envelope would not load anywhere", () => {
    const text = formatReport(
      {
        file: "/repo/dist/zabloo.ir.json",
        ok: false,
        views: [],
        diagnostics: [{ level: "fatal", code: "missing-views", path: "", message: "no views" }],
      },
      false,
      "/repo",
    );
    expect(text).toContain("✗ fatal");
    expect(text).toContain("1 fatal — no SDK would load this envelope ✗");
  });
});
