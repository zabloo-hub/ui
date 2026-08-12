import { describe, expect, it } from "vitest";
import {
  type ActionContext,
  assetIdFromRef,
  type ContainerNode,
  clampProgress,
  decodeAssetData,
  type Easing,
  type Envelope,
  easeProgress,
  IR_VERSION,
  type ItemScope,
  isAssetRef,
  itemIdentity,
  itemKey,
  itemPath,
  type OverlayNode,
  type ProgressBarNode,
  parseEnvelope,
  type RepeatNode,
  readEnvelope,
  readPath,
  resolveBinding,
  type ScrollViewNode,
  type SpinnerNode,
  spinnerPulse,
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

  it("refuses an envelope without a views map", () => {
    expect(() => parseEnvelope({ v: IR_VERSION, tokens: {} })).toThrow("`views`");
  });

  // A dictionary is repairable (every token ref simply resolves to nothing); a
  // views map is not — there would be no tree at all (ZAB-37).
  it("degrades a missing tokens dictionary instead of refusing", () => {
    const { envelope, diagnostics } = readEnvelope({
      v: IR_VERSION,
      views: validEnvelope.views,
    });
    expect(envelope?.tokens).toEqual({});
    expect(diagnostics.map((d) => d.code)).toContain("invalid-tokens");
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

  // A broken manifest costs its own entries a texture, never the UI its load
  // (ZAB-37 — it used to throw). `dropped` asserts both halves of that policy.
  const dropped = (entry: unknown, field: string) => {
    const { envelope, diagnostics } = readEnvelope({ ...validEnvelope, assets: { x: entry } });
    expect(envelope?.assets).toBeUndefined();
    const warning = diagnostics.find((d) => d.code === "invalid-asset");
    expect(warning?.level).toBe("warn");
    expect(warning?.message).toContain(field);
    expect(warning?.path).toBe('assets["x"]');
  };

  it("drops a non-object assets section", () => {
    const { envelope, diagnostics } = readEnvelope({ ...validEnvelope, assets: [] });
    expect(envelope?.assets).toBeUndefined();
    expect(diagnostics.map((d) => d.code)).toContain("invalid-assets");
  });

  it("drops entries missing hash, mime or size", () => {
    dropped({ mime: "image/png", size: 3 }, "`hash`");
    dropped({ hash: "h", size: 3 }, "`mime`");
    dropped({ ...asset, size: "3" }, "`size`");
  });

  it("drops data that is not base64-shaped (without decoding it)", () => {
    dropped({ ...asset, data: "!!" }, "base64");
    dropped({ ...asset, data: "AAA" }, "base64");
  });

  it("drops non-finite size", () => {
    dropped({ ...asset, size: Number.NaN }, "`size`");
    dropped({ ...asset, size: Number.POSITIVE_INFINITY }, "`size`");
  });

  it("drops non-finite width/height", () => {
    dropped({ ...asset, width: Number.NaN }, "`width`");
    dropped({ ...asset, height: Number.POSITIVE_INFINITY }, "`height`");
  });

  it("keeps the good entries when one is dropped", () => {
    const { envelope } = readEnvelope({
      ...validEnvelope,
      assets: { "hero.png": asset, broken: { mime: "image/png" } },
    });
    expect(Object.keys(envelope?.assets ?? {})).toEqual(["hero.png"]);
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

describe("array bindings: Repeat (ZAB-29)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const shop: Envelope = {
    v: IR_VERSION,
    tokens: {},
    views: {
      shop: {
        type: "Repeat",
        items: { bind: "shop.items" },
        key: "sku",
        layout: { direction: "column", gap: 8 },
        children: [
          {
            // [0] item template: relative bindings + an action that must say WHICH.
            type: "Container",
            layout: { direction: "row" },
            children: [
              { type: "Text", text: { bind: "item.name" } },
              { type: "Text", text: { bind: "item.price" } },
              // An absolute path still works inside a template — the game's gold
              // is not part of the item.
              { type: "Text", text: { bind: "player.gold" } },
              {
                type: "Button",
                onClick: "buy",
                visible: { bind: "item.inStock" },
                children: [{ type: "Text", text: "Comprar" }],
              },
            ],
          },
          // [1..] empty state.
          { type: "Text", text: "La tienda está vacía" },
        ],
      },
    },
  };

  it("accepts a repeated list with a template and an empty state", () => {
    const env = parseEnvelope(shop);
    const node = env.views.shop as RepeatNode;
    expect(node.type).toBe("Repeat");
    expect(node.children).toHaveLength(2);
  });

  it("only `items` is required (alias, key and slots default in the SDK)", () => {
    const bare: RepeatNode = { type: "Repeat", items: { bind: "shop.items" } };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { r: bare } });
    expect(env.views.r?.type).toBe("Repeat");
  });

  it("takes NodeBase props like any other node", () => {
    const node: RepeatNode = {
      type: "Repeat",
      id: "inventory",
      items: { bind: "player.bag" },
      visible: { bind: "ui.bagOpen" },
      clip: true,
      transition: { duration: 120 },
      style: { background: "#111827" },
    };
    expect(node.clip).toBe(true);
  });

  it("nests, with one alias per level", () => {
    const nested: RepeatNode = {
      type: "Repeat",
      items: { bind: "shop.cats" },
      as: "cat",
      children: [
        {
          type: "Repeat",
          items: { bind: "cat.items" },
          as: "it",
          children: [{ type: "Text", text: { bind: "it.name" } }],
        },
      ],
    };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { n: nested } });
    expect(env.views.n?.type).toBe("Repeat");
  });

  it("rejects a literal array of items at type-check time (data lives in the game)", () => {
    const node: RepeatNode = {
      type: "Repeat",
      // @ts-expect-error — items is always a binding, never inline data
      items: [{ name: "Poción" }],
    };
    expect(node).toBeDefined();
  });

  it("rejects a non-string key at type-check time", () => {
    const node: RepeatNode = {
      type: "Repeat",
      items: { bind: "shop.items" },
      // @ts-expect-error — key is a path relative to the item, not a boolean
      key: true,
    };
    expect(node).toBeDefined();
  });

  it("degrades on an old SDK: the type is unknown but the subtree survives", () => {
    // The normative fallback (unknown type → Container preserving children) turns
    // a pre-F6 render into one static, unresolved copy of the template.
    const env = parseEnvelope(shop);
    const node = env.views.shop as unknown as { children: Array<{ type: string }> };
    expect(node.children[0]?.type).toBe("Container");
  });
});

describe("resolveBinding (ZAB-29)", () => {
  const item: ItemScope = { alias: "item", path: "shop.items.3", index: 3 };

  it("rebases a relative path onto the item's absolute path", () => {
    expect(resolveBinding("item.name", [item])).toEqual({
      kind: "path",
      path: "shop.items.3.name",
    });
  });

  it("resolves the bare alias to the item itself", () => {
    expect(resolveBinding("item", [item])).toEqual({ kind: "path", path: "shop.items.3" });
  });

  it("resolves the reserved $index leaf to the position, not to a path", () => {
    expect(resolveBinding("item.$index", [item])).toEqual({ kind: "index", index: 3 });
  });

  it("treats $index deeper in the path as an ordinary segment", () => {
    expect(resolveBinding("item.a.$index", [item])).toEqual({
      kind: "path",
      path: "shop.items.3.a.$index",
    });
  });

  it("leaves absolute paths untouched inside a template", () => {
    expect(resolveBinding("player.gold", [item])).toEqual({ kind: "path", path: "player.gold" });
  });

  it("passes paths through unchanged with no scopes at all", () => {
    expect(resolveBinding("item.name", [])).toEqual({ kind: "path", path: "item.name" });
  });

  it("lets an inner template reach the outer item (the point of `as`)", () => {
    const scopes: ItemScope[] = [
      { alias: "cat", path: "shop.cats.2", index: 2 },
      { alias: "it", path: "shop.cats.2.items.5", index: 5 },
    ];
    expect(resolveBinding("it.name", scopes)).toEqual({
      kind: "path",
      path: "shop.cats.2.items.5.name",
    });
    expect(resolveBinding("cat.id", scopes)).toEqual({ kind: "path", path: "shop.cats.2.id" });
    expect(resolveBinding("cat.$index", scopes)).toEqual({ kind: "index", index: 2 });
  });

  it("innermost scope wins when two levels share an alias", () => {
    const scopes: ItemScope[] = [
      { alias: "item", path: "a.0", index: 0 },
      { alias: "item", path: "a.0.kids.1", index: 1 },
    ];
    expect(resolveBinding("item.name", scopes)).toEqual({ kind: "path", path: "a.0.kids.1.name" });
  });

  it("an alias shadows an absolute root of the same name (documented hazard)", () => {
    const shadowing: ItemScope = { alias: "player", path: "party.1", index: 1 };
    expect(resolveBinding("player.gold", [shadowing])).toEqual({
      kind: "path",
      path: "party.1.gold",
    });
  });

  it("ignores an empty alias instead of matching every path", () => {
    const broken: ItemScope = { alias: "", path: "a.0", index: 0 };
    expect(resolveBinding("player.gold", [broken])).toEqual({ kind: "path", path: "player.gold" });
  });
});

describe("itemPath & readPath (ZAB-29)", () => {
  const data = {
    shop: {
      items: [{ sku: "potion", name: "Poción", price: 10, meta: { tier: 1 } }, { name: "Sin sku" }],
    },
  };

  it("addresses one element of an array", () => {
    expect(itemPath("shop.items", 3)).toBe("shop.items.3");
  });

  it("walks objects and arrays with the same dot syntax", () => {
    expect(readPath(data, "shop.items.0.name")).toBe("Poción");
    expect(readPath(data, "shop.items.0.meta.tier")).toBe(1);
    expect(readPath(data, "shop.items")).toHaveLength(2);
  });

  it("yields undefined for anything missing instead of throwing", () => {
    expect(readPath(data, "shop.items.9.name")).toBeUndefined();
    expect(readPath(data, "shop.nope.deep")).toBeUndefined();
    expect(readPath(data, "shop.items.1.price")).toBeUndefined();
    expect(readPath(undefined, "shop")).toBeUndefined();
    expect(readPath(data, "")).toBeUndefined();
    expect(readPath(data, "shop..items")).toBeUndefined();
  });

  it("indexes arrays only with numeric segments — `length` is not a field", () => {
    expect(readPath(data, "shop.items.length")).toBeUndefined();
    expect(readPath(data, "shop.items.-1")).toBeUndefined();
  });

  it("does not walk through primitives", () => {
    expect(readPath(data, "shop.items.0.name.length")).toBeUndefined();
  });
});

describe("item identity (ZAB-29)", () => {
  const keyed = { sku: "potion", id: 7, tags: ["a"], blank: "" };

  it("reads the key from a path relative to the item", () => {
    expect(itemKey(keyed, "sku")).toBe("potion");
    expect(itemKey({ meta: { sku: "elixir" } }, "meta.sku")).toBe("elixir");
  });

  it("accepts a finite number as a key", () => {
    expect(itemKey(keyed, "id")).toBe(7);
  });

  it("has no key without a key path (identity is positional)", () => {
    expect(itemKey(keyed, undefined)).toBeUndefined();
    expect(itemKey(keyed, "")).toBeUndefined();
  });

  it("refuses anything that does not identify: missing, empty, object", () => {
    expect(itemKey(keyed, "missing")).toBeUndefined();
    expect(itemKey(keyed, "blank")).toBeUndefined();
    expect(itemKey(keyed, "tags")).toBeUndefined();
  });

  it("keeps keyed and positional identities in disjoint spaces", () => {
    // Without the prefix, `{id: "0"}` and the unkeyed element at position 0 would
    // share an identity and inherit each other's per-item SDK state.
    expect(itemIdentity("0", 1)).not.toBe(itemIdentity(undefined, 0));
    expect(itemIdentity(undefined, 3)).toBe("3");
    expect(itemIdentity("potion", 3)).toBe("k:potion");
    expect(itemIdentity(7, 3)).toBe("k:7");
  });

  it("gives a keyed item the same identity after a reorder (why keys exist)", () => {
    const before = ["a", "b", "c"].map((sku, i) => itemIdentity(itemKey({ sku }, "sku"), i));
    const after = ["c", "a", "b"].map((sku, i) => itemIdentity(itemKey({ sku }, "sku"), i));
    expect(after).toEqual([before[2], before[0], before[1]]);
  });

  it("falls back to the position for an element whose key does not resolve", () => {
    expect(itemIdentity(itemKey({ name: "sin sku" }, "sku"), 2)).toBe("2");
  });
});

describe("ActionContext (ZAB-29)", () => {
  it("carries the absolute path, the raw key and the position", () => {
    const ctx: ActionContext = { path: "shop.items.3", key: "potion", index: 3 };
    expect(ctx.path).toBe(itemPath("shop.items", 3));
  });

  it("omits the key when the list is positional", () => {
    const ctx: ActionContext = { path: "shop.items.3", index: 3 };
    expect(ctx.key).toBeUndefined();
  });

  it("describes the innermost item, with the outer indices inside the path", () => {
    const ctx: ActionContext = { path: itemPath("shop.cats.2.items", 5), key: 42, index: 5 };
    expect(ctx.path).toBe("shop.cats.2.items.5");
  });
});

describe("ProgressBar (ZAB-35)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const bar: ProgressBarNode = {
    type: "ProgressBar",
    value: { bind: "player.hp" },
    transition: { duration: "{motion.fast}" },
    layout: { direction: "row", width: 200, height: 12, padding: 2 },
    style: { background: "#2f3446", radius: 6 },
    children: [{ type: "Container", style: { background: "#4f46e5", radius: 4 } }],
  };

  it("parses a bar whose value is a binding and whose child is the fill", () => {
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { hud: bar } });
    const node = env.views.hud as ProgressBarNode;
    expect(node.type).toBe("ProgressBar");
    expect(node.value).toEqual({ bind: "player.hp" });
    expect(node.children?.[0]?.style?.background).toBe("#4f46e5");
  });

  it("accepts a static value and no children at all", () => {
    const node: ProgressBarNode = { type: "ProgressBar", value: 0.5 };
    expect(node.value).toBe(0.5);
  });

  it("rejects a non-numeric value at type-check time", () => {
    const node: ProgressBarNode = {
      type: "ProgressBar",
      // @ts-expect-error — the fraction is a number (or a binding to one), not a string
      value: "50%",
    };
    expect(node).toBeDefined();
  });
});

describe("Spinner (ZAB-35)", () => {
  const spinner: SpinnerNode = {
    type: "Spinner",
    period: "{motion.loop}",
    min: 0.2,
    easing: "ease-in-out",
    layout: { direction: "row", gap: 6 },
    children: [
      { type: "Container", layout: { width: 8, height: 8 }, style: { background: "#ffffff" } },
      { type: "Container", layout: { width: 8, height: 8 }, style: { background: "#ffffff" } },
    ],
  };

  it("parses a spinner with a tokenized period", () => {
    const env = parseEnvelope({
      v: IR_VERSION,
      tokens: { "motion.loop": 900 },
      views: { s: spinner },
    });
    const node = env.views.s as SpinnerNode;
    expect(node.period).toBe("{motion.loop}");
    expect(node.children).toHaveLength(2);
  });

  it("takes every knob as optional (the defaults live in the SDK)", () => {
    const bare: SpinnerNode = { type: "Spinner" };
    expect(bare.period).toBeUndefined();
    expect(bare.min).toBeUndefined();
    expect(bare.easing).toBeUndefined();
  });

  it("rejects an easing outside the closed set at type-check time", () => {
    const node: SpinnerNode = {
      type: "Spinner",
      // @ts-expect-error — same closed curve set as `transition`
      easing: "bounce",
    };
    expect(node).toBeDefined();
  });
});

describe("spinnerPulse", () => {
  it("pins the trough at the ends of the cycle and the crest at its middle", () => {
    expect(spinnerPulse(0)).toBe(0);
    expect(spinnerPulse(0.5)).toBe(1);
    // The loop is seamless: the phase completing behaves like it starting over.
    expect(spinnerPulse(0.999)).toBeLessThan(0.01);
    expect(spinnerPulse(1)).toBe(0);
  });

  it("is symmetric around the crest", () => {
    for (const easing of ["linear", "ease-in", "ease-out", "ease-in-out"] as Easing[]) {
      for (let i = 1; i < 10; i++) {
        const p = i / 20;
        expect(spinnerPulse(p, easing)).toBeCloseTo(spinnerPulse(1 - p, easing), 10);
      }
    }
  });

  it("wraps phases outside 0..1, negative offsets included", () => {
    // A bead's phase arrives as `elapsed/period - i/n`, which is negative early on.
    expect(spinnerPulse(-0.25)).toBeCloseTo(spinnerPulse(0.75), 10);
    expect(spinnerPulse(2.5)).toBeCloseTo(spinnerPulse(0.5), 10);
    expect(spinnerPulse(Number.NaN)).toBe(0);
    expect(spinnerPulse(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("stays within 0..1 and matches the closed-form ramp (the cross-target contract)", () => {
    for (let i = 0; i <= 40; i++) {
      const value = spinnerPulse(i / 40);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // Up ramp: the first half is `easeProgress(easing, 2p)` exactly.
    expect(spinnerPulse(0.25, "linear")).toBeCloseTo(0.5, 10);
    expect(spinnerPulse(0.25, "ease-in")).toBeCloseTo(0.125, 10);
    expect(spinnerPulse(0.75, "ease-in")).toBeCloseTo(0.125, 10);
  });
});

describe("clampProgress", () => {
  it("clamps to 0..1", () => {
    expect(clampProgress(0.42)).toBe(0.42);
    expect(clampProgress(-3)).toBe(0);
    expect(clampProgress(7)).toBe(1);
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(1)).toBe(1);
  });

  it("reads anything that is not a finite number as an empty bar", () => {
    // A broken binding shows 0%, never 100% and never a crash.
    expect(clampProgress(undefined)).toBe(0);
    expect(clampProgress(null)).toBe(0);
    expect(clampProgress("0.5")).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
