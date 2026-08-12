import { type ContainerNode, IR_VERSION } from "@zabloo/format";
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
