import { describe, expect, it } from "vitest";
import { IR_VERSION, parseEnvelope, supportsVersion } from "./index.js";

const validEnvelope = {
  v: IR_VERSION,
  tokens: { "color.primary": "#4f46e5" },
  views: {
    "main-menu": {
      type: "Button",
      onClick: "buy",
      style: { background: "{color.primary}" },
      children: [{ type: "Text", text: "Buy" }],
    },
  },
};

describe("parseEnvelope", () => {
  it("accepts a valid v1 envelope", () => {
    const env = parseEnvelope(validEnvelope);
    expect(env.views["main-menu"]?.type).toBe("Button");
  });

  it("is forward-tolerant: unknown props pass through", () => {
    const env = parseEnvelope({ ...validEnvelope, futureProp: true });
    expect(env.v).toBe(IR_VERSION);
  });

  it("rejects non-objects", () => {
    expect(() => parseEnvelope(null)).toThrow("expected a JSON object");
    expect(() => parseEnvelope([])).toThrow("expected a JSON object");
    expect(() => parseEnvelope("{}")).toThrow("expected a JSON object");
  });

  it("rejects a missing or non-numeric version", () => {
    expect(() => parseEnvelope({ tokens: {}, views: {} })).toThrow("missing numeric `v`");
  });

  it("refuses on a major-version mismatch", () => {
    expect(() => parseEnvelope({ v: IR_VERSION + 1, tokens: {}, views: {} })).toThrow(
      "unsupported major version",
    );
  });

  it("rejects envelopes without tokens or views", () => {
    expect(() => parseEnvelope({ v: IR_VERSION, views: {} })).toThrow("`tokens`");
    expect(() => parseEnvelope({ v: IR_VERSION, tokens: {} })).toThrow("`views`");
  });
});

describe("supportsVersion", () => {
  it("supports exactly the implemented major version", () => {
    expect(supportsVersion(IR_VERSION)).toBe(true);
    expect(supportsVersion(IR_VERSION + 1)).toBe(false);
    expect(supportsVersion(1.5)).toBe(false);
  });
});
