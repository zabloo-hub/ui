import { describe, expect, it } from "vitest";
import {
  type Envelope,
  IR_VERSION,
  parseEnvelope,
  type ScrollViewNode,
  supportsVersion,
} from "./index.js";

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

describe("scroll & clipping (ZAB-5)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const scrollEnvelope: Envelope = {
    v: IR_VERSION,
    tokens: {},
    views: {
      settings: {
        type: "ScrollView",
        axis: "horizontal",
        scrollbar: false,
        layout: { grow: 1 },
        children: [
          {
            type: "Container",
            clip: true,
            children: [{ type: "Text", text: "row" }],
          },
        ],
      },
    },
  };

  it("accepts a ScrollView view with clipped children", () => {
    const env = parseEnvelope(scrollEnvelope);
    expect(env.views.settings?.type).toBe("ScrollView");
  });

  it("axis and scrollbar are optional (defaults live in the SDK)", () => {
    const bare: ScrollViewNode = { type: "ScrollView" };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { s: bare } });
    expect(env.views.s?.type).toBe("ScrollView");
  });

  it("unknown node types pass through parse with their subtree intact", () => {
    // What lets an old SDK apply the normative fallback (render as Container
    // preserving children) instead of losing the content.
    const env = parseEnvelope({
      v: IR_VERSION,
      tokens: {},
      views: {
        f: {
          type: "FutureThing",
          futureProp: 1,
          children: [{ type: "Text", text: "kept" }],
        },
      },
    });
    const node = env.views.f as unknown as {
      children: Array<{ text: string }>;
    };
    expect(node.children[0]?.text).toBe("kept");
  });

  // Type assertions: clip placement and axis/clip type safety
  it("rejects non-boolean clip values at type-check time", () => {
    const invalidClip: ScrollViewNode = {
      type: "ScrollView",
      // @ts-expect-error — clip must be boolean, not string
      clip: "yes",
    };
    expect(invalidClip).toBeDefined();
  });

  it("rejects invalid axis values at type-check time", () => {
    const node: ScrollViewNode = {
      type: "ScrollView",
      // @ts-expect-error — "diagonal" is not a valid ScrollAxis
      axis: "diagonal",
    };
    expect(node).toBeDefined();
  });

  it("accepts clip on all NodeBase-derived primitives (positive assertion)", () => {
    // Positive: clip belongs on NodeBase and is available on any primitive
    const withClip: Envelope = {
      v: IR_VERSION,
      tokens: {},
      views: {
        button: { type: "Button", clip: true },
        text: { type: "Text", text: "clipped", clip: false },
        container: { type: "Container", clip: true },
      },
    };
    expect(withClip.views.button?.type).toBe("Button");
  });
});
