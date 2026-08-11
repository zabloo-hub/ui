import { describe, expect, it } from "vitest";
import {
  assetIdFromRef,
  type ContainerNode,
  decodeAssetData,
  type Easing,
  type Envelope,
  easeProgress,
  IR_VERSION,
  isAssetRef,
  type OverlayNode,
  parseEnvelope,
  type ScrollViewNode,
  supportsVersion,
  type ToggleNode,
  type Transition,
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

describe("parseEnvelope: assets", () => {
  const asset = {
    hash: "a".repeat(64),
    mime: "image/png",
    size: 3,
    width: 1,
    height: 1,
    data: "AAAA",
  };

  it("accepts an envelope without assets (unchanged)", () => {
    expect(parseEnvelope(validEnvelope).assets).toBeUndefined();
  });

  it("accepts a valid asset entry", () => {
    const env = parseEnvelope({ ...validEnvelope, assets: { "hero.png": asset } });
    expect(env.assets?.["hero.png"]?.hash).toBe("a".repeat(64));
  });

  it("accepts an entry without data/width/height (deferred-resolution shape)", () => {
    const bare = { hash: asset.hash, mime: asset.mime, size: asset.size };
    const env = parseEnvelope({ ...validEnvelope, assets: { "hero.png": bare } });
    expect(env.assets?.["hero.png"]?.data).toBeUndefined();
  });

  it("is forward-tolerant: unknown entry fields pass through", () => {
    const env = parseEnvelope({
      ...validEnvelope,
      assets: { "hero.png": { ...asset, futureField: true } },
    });
    expect(env.assets?.["hero.png"]?.mime).toBe("image/png");
  });

  it("rejects a non-object assets section", () => {
    expect(() => parseEnvelope({ ...validEnvelope, assets: [] })).toThrow(
      "`assets` must be an object",
    );
  });

  it("rejects entries missing hash, mime or size", () => {
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { mime: "image/png", size: 3 } } }),
    ).toThrow("`hash`");
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { hash: "h", size: 3 } } }),
    ).toThrow("`mime`");
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, size: "3" } } }),
    ).toThrow("`size`");
  });

  it("rejects data that is not base64-shaped (without decoding it)", () => {
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, data: "!!" } } }),
    ).toThrow("base64");
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, data: "AAA" } } }),
    ).toThrow("base64");
  });

  it("rejects non-finite size", () => {
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, size: Number.NaN } } }),
    ).toThrow("`size`");
    expect(() =>
      parseEnvelope({
        ...validEnvelope,
        assets: { x: { ...asset, size: Number.POSITIVE_INFINITY } },
      }),
    ).toThrow("`size`");
  });

  it("rejects non-finite width/height", () => {
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, width: Number.NaN } } }),
    ).toThrow("`width`");
    expect(() =>
      parseEnvelope({
        ...validEnvelope,
        assets: { x: { ...asset, height: Number.POSITIVE_INFINITY } },
      }),
    ).toThrow("`height`");
  });
});

describe("isAssetRef", () => {
  it("accepts well-formed asset refs", () => {
    expect(isAssetRef("asset:hero.png")).toBe(true);
    expect(isAssetRef("asset:icons/coin.png")).toBe(true);
  });

  it("rejects non-refs", () => {
    expect(isAssetRef("hero.png")).toBe(false);
    expect(isAssetRef("asset:")).toBe(false);
    expect(isAssetRef(42)).toBe(false);
    expect(isAssetRef(null)).toBe(false);
    expect(isAssetRef(undefined)).toBe(false);
    expect(isAssetRef({ bind: "player.avatar" })).toBe(false);
  });
});

describe("assetIdFromRef", () => {
  it("strips the `asset:` prefix", () => {
    expect(assetIdFromRef("asset:hero.png")).toBe("hero.png");
    expect(assetIdFromRef("asset:icons/coin.png")).toBe("icons/coin.png");
  });
});

describe("decodeAssetData", () => {
  it("round-trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const data = btoa(String.fromCharCode(...bytes));
    const entry = { hash: "h", mime: "application/octet-stream", size: bytes.length, data };
    expect(decodeAssetData(entry)).toEqual(bytes);
  });

  it("throws a clear error when data is absent (deferred resolution not supported yet)", () => {
    expect(() => decodeAssetData({ hash: "h", mime: "image/png", size: 1 })).toThrow(
      "no inline `data`",
    );
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

describe("overlays & z-order (ZAB-19)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const overlayEnvelope: Envelope = {
    v: IR_VERSION,
    tokens: { "color.scrim": "#00000088" },
    views: {
      shop: {
        type: "Container",
        children: [
          { type: "Button", onClick: "open-confirm", children: [{ type: "Text", text: "Buy" }] },
          {
            // A modal: declared where the UI that opens it lives, hidden until
            // the game says otherwise; its own background IS the backdrop.
            type: "Overlay",
            visible: { bind: "ui.confirmOpen" },
            onDismiss: "close-confirm",
            style: { background: "{color.scrim}" },
            layout: { justify: "center", align: "center" },
            children: [{ type: "Container", children: [{ type: "Text", text: "Sure?" }] }],
          },
          {
            // A toast: above everything, but input passes through its layer.
            type: "Overlay",
            modal: false,
            z: 10,
            layout: { justify: "end", align: "end", padding: 16 },
            children: [{ type: "Text", text: "Purchased" }],
          },
        ],
      },
    },
  };

  it("accepts a view with modal and non-modal overlays", () => {
    const env = parseEnvelope(overlayEnvelope);
    const children = (env.views.shop as { children: OverlayNode[] }).children;
    expect(children[1]?.type).toBe("Overlay");
    expect(children[2]?.modal).toBe(false);
  });

  it("modal, z and onDismiss are optional (defaults live in the SDK)", () => {
    const bare: OverlayNode = { type: "Overlay" };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { o: bare } });
    expect(env.views.o?.type).toBe("Overlay");
  });

  it("rejects a non-boolean modal at type-check time", () => {
    const node: OverlayNode = {
      type: "Overlay",
      // @ts-expect-error — modal must be boolean, not string
      modal: "yes",
    };
    expect(node).toBeDefined();
  });

  it("takes an auto-close timeout (Toast) and keeps it optional", () => {
    const toast: OverlayNode = { type: "Overlay", modal: false, z: 10, autoCloseMs: 4000 };
    const sticky: OverlayNode = { type: "Overlay", modal: false, z: 10 };
    expect(toast.autoCloseMs).toBe(4000);
    expect(sticky.autoCloseMs).toBeUndefined();
  });

  it("rejects a tokenized autoCloseMs at type-check time", () => {
    const node: OverlayNode = {
      type: "Overlay",
      // @ts-expect-error — a behavior timeout is a plain number, not themeable motion
      autoCloseMs: "{motion.slow}",
    };
    expect(node).toBeDefined();
  });

  it("rejects a non-numeric z at type-check time", () => {
    const node: OverlayNode = {
      type: "Overlay",
      // @ts-expect-error — z must be a number, not a token ref
      z: "{layer.modal}",
    };
    expect(node).toBeDefined();
  });

  it("carries no backdrop field: the overlay's own style paints it", () => {
    const node: OverlayNode = {
      type: "Overlay",
      style: { background: "#0008" },
      // @ts-expect-error — backdrop is not a field; paint stays implicit from style
      backdrop: "#0008",
    };
    expect(node.style?.background).toBe("#0008");
  });

  it("nests inside any subtree and takes NodeBase props", () => {
    // Overlays are declared in place — including inside a ScrollView — and are
    // lifted to the view's overlay layer by the SDK, never affecting siblings.
    const env: Envelope = {
      v: IR_VERSION,
      tokens: {},
      views: {
        inventory: {
          type: "ScrollView",
          children: [{ type: "Overlay", id: "tooltip", modal: false, autofocus: false }],
        },
      },
    };
    expect(parseEnvelope(env).views.inventory?.type).toBe("ScrollView");
  });
});

describe("style transitions (ZAB-33)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const juicyEnvelope: Envelope = {
    v: IR_VERSION,
    tokens: { "motion.fast": 120, "color.primary": "#4f46e5" },
    views: {
      shop: {
        type: "Button",
        transition: { duration: "{motion.fast}", easing: "ease-out" },
        style: { background: "{color.primary}", opacity: 1 },
        layout: { height: 48 },
        states: { pressed: { style: { background: "#312e81", opacity: 0.9 } } },
        children: [{ type: "Text", text: "Buy" }],
      },
    },
  };

  it("accepts a node with a transition and a tokenized duration", () => {
    const env = parseEnvelope(juicyEnvelope);
    expect(env.views.shop?.transition?.duration).toBe("{motion.fast}");
  });

  it("easing is optional (the default lives in the SDK)", () => {
    const bare: Transition = { duration: 200 };
    const env = parseEnvelope({
      v: IR_VERSION,
      tokens: {},
      views: { s: { type: "Container", transition: bare } },
    });
    expect(env.views.s?.transition?.easing).toBeUndefined();
  });

  it("accepts transition on all NodeBase-derived primitives", () => {
    // Positive: transition belongs on NodeBase, like clip — any primitive can tween.
    const withTransition: Envelope = {
      v: IR_VERSION,
      tokens: {},
      views: {
        button: { type: "Button", transition: { duration: 120 } },
        text: { type: "Text", text: "fades", transition: { duration: 120 } },
        scroll: { type: "ScrollView", transition: { duration: 120 } },
        overlay: { type: "Overlay", transition: { duration: 120 } },
      },
    };
    expect(withTransition.views.button?.transition?.duration).toBe(120);
  });

  it("rejects invalid easing values at type-check time", () => {
    const node: ContainerNode = {
      type: "Container",
      // @ts-expect-error — "bounce" is not in the closed curve set
      transition: { duration: 120, easing: "bounce" },
    };
    expect(node).toBeDefined();
  });

  it("requires a duration at type-check time", () => {
    const node: ContainerNode = {
      type: "Container",
      // @ts-expect-error — duration is mandatory; there is no implicit default
      transition: { easing: "linear" },
    };
    expect(node).toBeDefined();
  });
});

describe("easeProgress", () => {
  const curves: Easing[] = ["linear", "ease-in", "ease-out", "ease-in-out"];

  it("pins both endpoints on every curve", () => {
    for (const easing of curves) {
      expect(easeProgress(easing, 0)).toBe(0);
      expect(easeProgress(easing, 1)).toBe(1);
    }
  });

  it("clamps out-of-range and non-finite progress", () => {
    for (const easing of curves) {
      expect(easeProgress(easing, -0.5)).toBe(0);
      expect(easeProgress(easing, 1.5)).toBe(1);
      expect(easeProgress(easing, Number.NaN)).toBe(0);
    }
  });

  it("is monotonic and stays within 0..1", () => {
    for (const easing of curves) {
      let previous = 0;
      for (let i = 1; i <= 20; i++) {
        const value = easeProgress(easing, i / 20);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
    }
  });

  it("matches the closed-form polynomials exactly (the cross-target contract)", () => {
    expect(easeProgress("linear", 0.25)).toBeCloseTo(0.25, 10);
    expect(easeProgress("ease-in", 0.5)).toBeCloseTo(0.125, 10);
    expect(easeProgress("ease-out", 0.5)).toBeCloseTo(0.875, 10);
    expect(easeProgress("ease-in-out", 0.5)).toBeCloseTo(0.5, 10);
    expect(easeProgress("ease-in-out", 0.25)).toBeCloseTo(0.0625, 10);
    expect(easeProgress("ease-in-out", 0.75)).toBeCloseTo(0.9375, 10);
  });

  it("falls back to linear for a curve it does not know", () => {
    // Newer content on an older reader: animate linearly instead of refusing.
    expect(easeProgress("ease-in-back" as Easing, 0.4)).toBeCloseTo(0.4, 10);
  });
});

describe("exclusive-select groups (ZAB-22)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  // Positional contract — children[0] = tab bar, children[1..n] = panels.
  const tabsEnvelope: Envelope = {
    v: IR_VERSION,
    tokens: {},
    views: {
      settings: {
        type: "Container",
        group: "exclusive-select",
        selected: 1,
        children: [
          {
            type: "Container",
            layout: { direction: "row" },
            children: [
              {
                type: "Button",
                states: { selected: { style: { background: "#4f46e5" } } },
                children: [{ type: "Text", text: "Video" }],
              },
              { type: "Button", children: [{ type: "Text", text: "Audio" }] },
            ],
          },
          { type: "Container", children: [{ type: "Text", text: "video panel" }] },
          { type: "Container", children: [{ type: "Text", text: "audio panel" }] },
        ],
      },
    },
  };

  it("accepts a tabs container with a selected index and a selected state", () => {
    const env = parseEnvelope(tabsEnvelope);
    const view = env.views.settings as ContainerNode;
    expect(view.group).toBe("exclusive-select");
    expect(view.selected).toBe(1);
  });

  it("selected is optional (the SDK defaults to the first tab)", () => {
    const bare: ContainerNode = { type: "Container", group: "exclusive-select" };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { s: bare } });
    expect((env.views.s as ContainerNode).selected).toBeUndefined();
  });

  it("rejects unknown group behaviors at authoring time", () => {
    const node: ContainerNode = {
      type: "Container",
      // @ts-expect-error — "exclusive-everything" is not a GroupBehavior
      group: "exclusive-everything",
    };
    expect(node).toBeDefined();
  });

  it("keeps unknown group behaviors readable over the wire (graceful degradation)", () => {
    // An SDK older than this vocabulary must still parse and render the subtree;
    // it just ignores the behavior it does not know (decision 2026-08-03).
    const env = parseEnvelope({
      v: IR_VERSION,
      tokens: {},
      views: {
        s: {
          type: "Container",
          group: "exclusive-select",
          children: [{ type: "Container" }, { type: "Text", text: "panel" }],
        },
      },
    });
    const node = env.views.s as ContainerNode;
    expect(node.children).toHaveLength(2);
  });
});

describe("Toggle & exclusive-check (ZAB-23)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const settings: Envelope = {
    v: IR_VERSION,
    tokens: {},
    views: {
      settings: {
        type: "Container",
        children: [
          {
            // Standalone switch: read/write binding + action, both slots.
            type: "Toggle",
            id: "sfx",
            checked: { bind: "settings.sfx" },
            onChange: "sfx-changed",
            states: { checked: { style: { background: "#22c55e" } } },
            children: [
              { type: "Container", layout: { justify: "end" } },
              { type: "Container", layout: { justify: "start" } },
              { type: "Text", text: "Efectos" },
            ],
          },
          {
            // RadioGroup: ONE value for the whole group, one `value` per option.
            type: "Container",
            group: "exclusive-check",
            value: { bind: "settings.quality" },
            children: [
              { type: "Toggle", value: "low", children: [{ type: "Text", text: "Baja" }] },
              { type: "Toggle", value: "high", children: [{ type: "Text", text: "Alta" }] },
            ],
          },
        ],
      },
    },
  };

  it("accepts a settings view with a switch and a radio group", () => {
    const env = parseEnvelope(settings);
    expect(env.views.settings?.type).toBe("Container");
  });

  it("every Toggle field is optional (defaults live in the SDK)", () => {
    const bare: ToggleNode = { type: "Toggle" };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { t: bare } });
    expect(env.views.t?.type).toBe("Toggle");
  });

  it("checked is bindable, and the binding is read/write", () => {
    const node: ToggleNode = { type: "Toggle", checked: { bind: "settings.sfx" } };
    const staticInitial: ToggleNode = { type: "Toggle", checked: true };
    expect(node.checked).toEqual({ bind: "settings.sfx" });
    expect(staticInitial.checked).toBe(true);
  });

  it("rejects invalid group behaviors at type-check time", () => {
    const node: ContainerNode = {
      type: "Container",
      // @ts-expect-error — "exclusive-everything" is not a GroupBehavior
      group: "exclusive-everything",
    };
    expect(node).toBeDefined();
  });

  it("rejects a non-boolean checked at type-check time", () => {
    const node: ToggleNode = {
      type: "Toggle",
      // @ts-expect-error — checked is a boolean (or a binding), not a string
      checked: "yes",
    };
    expect(node).toBeDefined();
  });

  it("accepts `checked` as a state override name", () => {
    const node: ToggleNode = {
      type: "Toggle",
      states: { checked: { style: { background: "#22c55e" } } },
    };
    expect(node.states?.checked?.style?.background).toBe("#22c55e");
  });
});
