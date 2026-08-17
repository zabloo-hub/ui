import { type ContainerNode, type Diagnostic, IR_VERSION } from "@zabloo/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnvelope } from "./envelope.js";

const valid = {
  v: IR_VERSION,
  tokens: {},
  views: { hud: { type: "Container", children: [{ type: "Text", text: "Gold" }] } },
};

/** Captures the `[zabloo]` lines a load emits. */
function captureWarnings(): { lines: string[] } {
  const lines: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return { lines };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadEnvelope", () => {
  it("loads JSON text and parsed values alike", () => {
    expect(loadEnvelope(JSON.stringify(valid)).views.hud?.type).toBe("Container");
    expect(loadEnvelope(valid).views.hud?.type).toBe("Container");
  });

  it("returns the repaired envelope, so the renderer never sees the broken parts", () => {
    const { lines } = captureWarnings();
    const envelope = loadEnvelope({
      ...valid,
      views: { hud: { type: "Container", children: [{ type: "Text" }, valid.views.hud] } },
    });
    expect((envelope.views.hud as ContainerNode).children?.length).toBe(1);
    expect(lines[0]).toContain("[zabloo]");
    expect(lines[0]).toContain('views["hud"].children[0].text');
  });

  it("reports every warning and still loads", () => {
    const { lines } = captureWarnings();
    loadEnvelope({
      ...valid,
      views: { hud: { type: "Container", clip: "yes", style: { color: "{color.ghost}" } } },
    });
    expect(lines.length).toBe(2);
  });

  it("throws a legible error on a truncated payload", () => {
    expect(() => loadEnvelope(JSON.stringify(valid).slice(0, 30))).toThrow("not valid JSON");
  });

  it("throws a legible error on an incompatible major version", () => {
    expect(() => loadEnvelope({ ...valid, v: IR_VERSION + 1 })).toThrow(
      `unsupported major version ${IR_VERSION + 1}`,
    );
  });

  it("throws when no view survived", () => {
    expect(() => loadEnvelope({ ...valid, views: { hud: { type: "Text" } } })).toThrow(
      "no usable views",
    );
  });
});

/**
 * The diagnostics are STRUCTURED — stable codes, a path into the envelope — and the
 * console is where that structure died (ZAB-72). A sink gets the objects; the
 * console lines stay exactly as they were for whoever installs none.
 */
describe("loadEnvelope with a diagnostic sink", () => {
  it("hands over the warnings instead of printing them", () => {
    const { lines } = captureWarnings();
    const seen: Diagnostic[] = [];
    loadEnvelope(
      { ...valid, views: { hud: { type: "Container", children: [{ type: "Text" }] } } },
      (diagnostic) => seen.push(diagnostic),
    );
    expect(seen.map((d) => d.code)).toEqual(["invalid-node"]);
    expect(seen[0].level).toBe("warn");
    expect(seen[0].path).toBe('views["hud"].children[0].text');
    expect(lines).toEqual([]);
  });

  it("reports the fatal one BEFORE throwing, with its code and path", () => {
    const seen: Diagnostic[] = [];
    expect(() =>
      loadEnvelope({ ...valid, v: IR_VERSION + 1 }, (diagnostic) => seen.push(diagnostic)),
    ).toThrow("unsupported major version");
    expect(seen.map((d) => [d.level, d.code])).toEqual([["fatal", "unsupported-version"]]);
  });

  it("carries the warnings that led to a fatal, in order", () => {
    const seen: Diagnostic[] = [];
    expect(() =>
      loadEnvelope({ ...valid, views: { hud: { type: "Text" } } }, (diagnostic) =>
        seen.push(diagnostic),
      ),
    ).toThrow("no usable views");
    expect(seen.map((d) => d.level)).toEqual(["warn", "fatal"]);
    expect(seen.at(-1)?.code).toBe("no-usable-views");
  });
});
