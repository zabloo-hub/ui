import { describe, expect, it } from "vitest";
import {
  type ContainerNode,
  type Diagnostic,
  EnvelopeError,
  IR_VERSION,
  type OverlayNode,
  parseEnvelope,
  type RepeatNode,
  readEnvelope,
  type SliderNode,
  type TextNode,
  type ZNode,
} from "./index.js";

/** The smallest envelope that loads — every case below deforms a copy of it. */
const base = {
  v: IR_VERSION,
  tokens: { "color.primary": "#4f46e5", "space.2": 8 },
  views: { hud: { type: "Container", children: [{ type: "Text", text: "Gold" }] } },
};

/** An envelope whose `hud` view is exactly this node. */
function withView(view: unknown): Record<string, unknown> {
  return { ...base, views: { hud: view } };
}

function read(value: unknown) {
  const { envelope, diagnostics } = readEnvelope(value);
  return { envelope, diagnostics, codes: diagnostics.map((d) => d.code) };
}

/** The `hud` view after a repair pass — the shape a consumer actually receives. */
function view(value: unknown): Record<string, unknown> {
  const { envelope } = readEnvelope(withView(value));
  return envelope?.views.hud as unknown as Record<string, unknown>;
}

function fatalOf(diagnostics: Diagnostic[]): Diagnostic | undefined {
  return diagnostics.find((d) => d.level === "fatal");
}

/** What a call threw, or `undefined` if it returned — for asserting ON the error. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("readEnvelope: fatal cases", () => {
  it("never throws — a fatal comes back as a diagnostic", () => {
    for (const input of [undefined, null, 42, "{", [], {}, Number.NaN]) {
      const { envelope, diagnostics } = readEnvelope(input);
      expect(envelope).toBeNull();
      expect(fatalOf(diagnostics)).toBeDefined();
    }
  });

  it("reports truncated JSON as invalid JSON, not as a parser stack trace", () => {
    const truncated = JSON.stringify(base).slice(0, 40);
    const { envelope, diagnostics } = readEnvelope(truncated);
    expect(envelope).toBeNull();
    expect(fatalOf(diagnostics)?.code).toBe("invalid-json");
    expect(fatalOf(diagnostics)?.message).toContain("not valid JSON");
  });

  it("accepts JSON text as well as a parsed value", () => {
    expect(read(JSON.stringify(base)).envelope?.views.hud?.type).toBe("Container");
    expect(read(base).envelope?.views.hud?.type).toBe("Container");
  });

  it("names the version it implements on a major mismatch", () => {
    const { diagnostics } = read({ ...base, v: IR_VERSION + 1 });
    const fatal = fatalOf(diagnostics);
    expect(fatal?.code).toBe("unsupported-version");
    expect(fatal?.message).toContain(`v${IR_VERSION}`);
    expect(fatal?.message).toContain(String(IR_VERSION + 1));
  });

  it("refuses a missing, non-numeric or non-integer version", () => {
    expect(read({ tokens: {}, views: base.views }).codes).toContain("missing-version");
    expect(read({ ...base, v: "1" }).codes).toContain("missing-version");
    expect(read({ ...base, v: Number.NaN }).codes).toContain("missing-version");
    expect(read({ ...base, v: 1.5 }).codes).toContain("unsupported-version");
  });

  it("refuses a views map that is missing or not an object", () => {
    for (const views of [undefined, null, [], "hud"]) {
      expect(read({ ...base, views }).codes).toContain("missing-views");
    }
  });

  it("refuses an empty views map, and one whose every view was dropped", () => {
    const empty = read({ ...base, views: {} });
    expect(fatalOf(empty.diagnostics)?.message).toContain("empty");
    const allBroken = read({ ...base, views: { a: 42, b: { type: "" } } });
    expect(fatalOf(allBroken.diagnostics)?.code).toBe("no-usable-views");
    expect(allBroken.envelope).toBeNull();
  });
});

describe("readEnvelope: forward-tolerance", () => {
  it("passes unknown envelope and node properties through untouched", () => {
    const { envelope, diagnostics } = readEnvelope({
      ...withView({ type: "Container", futureProp: { deep: true } }),
      futureSection: [1, 2],
    });
    expect((envelope as unknown as Record<string, unknown>).futureSection).toEqual([1, 2]);
    expect((envelope?.views.hud as unknown as Record<string, unknown>)?.futureProp).toEqual({
      deep: true,
    });
    expect(diagnostics).toEqual([]);
  });

  it("keeps an unknown node type and its base props (rendered as a Container)", () => {
    const node = view({
      type: "Hologram",
      style: { background: "{color.primary}" },
      children: [{ type: "Text", text: "hi" }],
      spin: 3,
    });
    expect(node.type).toBe("Hologram");
    expect(node.spin).toBe(3);
    expect((node.children as ZNode[]).length).toBe(1);
  });

  it("checks shapes, never vocabularies: a future enum value is not an error", () => {
    const { envelope, diagnostics } = readEnvelope(
      withView({
        type: "ScrollView",
        axis: "diagonal",
        style: { overflow: "fade" },
        transition: { duration: 100, easing: "ease-in-back" },
      }),
    );
    const node = envelope?.views.hud as unknown as Record<string, unknown>;
    expect(node.axis).toBe("diagonal");
    expect(diagnostics).toEqual([]);
  });
});

describe("readEnvelope: views and nodes", () => {
  it("drops a view that is not a node, keeping the others", () => {
    const { envelope, diagnostics } = readEnvelope({
      ...base,
      views: { hud: base.views.hud, broken: 42 },
    });
    expect(Object.keys(envelope?.views ?? {})).toEqual(["hud"]);
    const warning = diagnostics.find((d) => d.code === "invalid-node");
    expect(warning?.message).toContain("view dropped");
    expect(warning?.path).toBe('views["broken"]');
  });

  it("addresses a node by path, field and reason", () => {
    const { diagnostics } = readEnvelope(
      withView({ type: "Container", children: [{ type: "Text" }, { type: "Text", text: "ok" }] }),
    );
    const warning = diagnostics[0];
    expect(warning?.path).toBe('views["hud"].children[0].text');
    expect(warning?.message).toContain("Text has no usable `text`");
    expect(warning?.message).toContain("node dropped");
  });

  it('keeps a Text whose content is empty — `""` is content, not a broken node', () => {
    // What `@zabloo/react` emits routinely: a <Select> with no value yet, a <Badge>
    // with no count, a <Text> with no children. Dropping those left a row missing a
    // slot and re-spaced around the hole.
    const { envelope, diagnostics } = readEnvelope(
      withView({ type: "Container", children: [{ type: "Text", text: "" }] }),
    );
    const children = ((envelope?.views.hud as ContainerNode | undefined)?.children ??
      []) as TextNode[];
    expect(children.length).toBe(1);
    expect(children[0]?.text).toBe("");
    expect(diagnostics).toEqual([]);
  });

  it("still drops a Text whose `text` is absent — never authored is not the same as empty", () => {
    const { diagnostics } = read(withView({ type: "Text" }));
    expect(diagnostics[0]?.code).toBe("invalid-node");
    expect(diagnostics[0]?.message).toContain("(nothing)");
  });

  it("drops a node whose required field is missing, keeping its siblings", () => {
    const node = view({
      type: "Container",
      children: [
        { type: "Text" },
        { type: "Image", src: "hero.png" },
        { type: "Repeat", items: "shop.items" },
        { type: "Text", text: "survivor" },
      ],
    });
    const children = node.children as TextNode[];
    expect(children.length).toBe(1);
    expect(children[0]?.text).toBe("survivor");
  });

  it("keeps a node whose optional property is malformed, minus that property", () => {
    const node = view({
      type: "Button",
      onClick: 42,
      clip: "yes",
      layout: { direction: "row", gap: "8px", grow: Number.NaN },
      style: { radius: {}, background: "#fff" },
    });
    expect(node.type).toBe("Button");
    expect("onClick" in node).toBe(false);
    expect("clip" in node).toBe(false);
    expect(node.layout).toEqual({ direction: "row" });
    expect(node.style).toEqual({ background: "#fff" });
  });

  it("keeps a group's onChange, and drops it when it is not a name", () => {
    const good = view({ type: "Container", group: "exclusive-check", onChange: "quality-changed" });
    expect(good.onChange).toBe("quality-changed");
    // A hook that is not a string is no hook: the group selects as before.
    const bad = view({ type: "Container", group: "exclusive-check", onChange: 42 });
    expect("onChange" in bad).toBe(false);
    expect(bad.group).toBe("exclusive-check");
  });

  it("drops a whole malformed layout/style/states/transition block", () => {
    const node = view({
      type: "Container",
      layout: "row",
      style: [],
      states: 3,
      transition: { easing: "linear" },
    });
    expect(Object.keys(node)).toEqual(["type"]);
  });

  it("keeps the good states and drops the broken ones", () => {
    const node = view({
      type: "Button",
      states: { hover: { style: { color: "#fff" } }, pressed: 1, focused: { style: "big" } },
    });
    expect(node.states).toEqual({ hover: { style: { color: "#fff" } }, focused: {} });
  });

  it("ignores a children property that is not an array", () => {
    const node = view({ type: "Container", children: { type: "Text", text: "hi" } });
    expect("children" in node).toBe(false);
  });

  it("reports a duplicate id — the SDK can only address one of them", () => {
    const { codes } = read(
      withView({
        type: "Container",
        id: "row",
        children: [{ type: "Text", id: "row", text: "hi" }],
      }),
    );
    expect(codes).toContain("duplicate-id");
  });

  it("repairs a copy: the caller's own object is never mutated", () => {
    const input = withView({ type: "Container", clip: "yes" });
    readEnvelope(input);
    expect((input.views as Record<string, Record<string, unknown>>).hud?.clip).toBe("yes");
  });
});

describe("readEnvelope: positional slots", () => {
  it("replaces a dropped slot with an empty Container so the others keep their index", () => {
    const node = view({
      type: "Toggle",
      children: [{ type: "Text" }, { type: "Text", text: "off" }, { type: "Text", text: "label" }],
    });
    const children = node.children as ZNode[];
    expect(children.map((c) => c.type)).toEqual(["Container", "Text", "Text"]);
    expect((children[1] as TextNode).text).toBe("off");
  });

  it("says so in the diagnostic", () => {
    const { diagnostics } = readEnvelope(withView({ type: "Slider", children: [null] }));
    expect(diagnostics[0]?.message).toContain("slot replaced by an empty Container");
  });

  it("covers the Tabs contract, whose slots come from the group behavior", () => {
    const node = view({
      type: "Container",
      group: "exclusive-select",
      children: [{ type: "Text" }, { type: "Text", text: "panel" }],
    });
    expect((node.children as ZNode[]).map((c) => c.type)).toEqual(["Container", "Text"]);
  });

  it("removes — not replaces — a dropped child of an ordinary flow node", () => {
    const node = view({
      type: "Container",
      children: [{ type: "Text" }, { type: "Text", text: "b" }],
    });
    expect((node.children as ZNode[]).length).toBe(1);
  });
});

describe("readEnvelope: dangling references", () => {
  it("warns about a token the dictionary does not define, and keeps the node", () => {
    const { envelope, diagnostics } = readEnvelope(
      withView({ type: "Container", style: { background: "{color.ghost}" }, layout: { gap: 4 } }),
    );
    const warning = diagnostics.find((d) => d.code === "unknown-token");
    expect(warning?.level).toBe("warn");
    expect(warning?.path).toBe('views["hud"].style.background');
    expect(warning?.message).toContain("{color.ghost}");
    expect(envelope?.views.hud?.style?.background).toBe("{color.ghost}");
  });

  it("says nothing about a token that IS defined", () => {
    const { diagnostics } = readEnvelope(
      withView({ type: "Container", style: { background: "{color.primary}" } }),
    );
    expect(diagnostics).toEqual([]);
  });

  it("warns about an asset ref that is not in the manifest, and keeps the Image", () => {
    const { envelope, codes } = read(withView({ type: "Image", src: "asset:icons/coin.png" }));
    expect(codes).toContain("unknown-asset");
    expect(envelope?.views.hud?.type).toBe("Image");
  });

  it("warns about an anchor id that matches no node in the view", () => {
    const { envelope, diagnostics } = readEnvelope(
      withView({
        type: "Container",
        children: [
          { type: "Button", id: "buy" },
          { type: "Overlay", anchor: { id: "sell", at: "top" } },
        ],
      }),
    );
    const warning = diagnostics.find((d) => d.code === "unknown-anchor");
    expect(warning?.message).toContain('"sell"');
    const overlay = (envelope?.views.hud as ContainerNode)?.children?.[1] as OverlayNode;
    expect(overlay.anchor?.id).toBe("sell");
  });

  it("resolves an anchor declared before the node it points at", () => {
    const { diagnostics } = readEnvelope(
      withView({
        type: "Container",
        children: [
          { type: "Overlay", anchor: { id: "buy" } },
          { type: "Button", id: "buy" },
        ],
      }),
    );
    expect(diagnostics).toEqual([]);
  });

  it("scopes anchors to their own view", () => {
    const { codes } = read({
      ...base,
      views: {
        hud: { type: "Overlay", anchor: { id: "buy" } },
        shop: { type: "Button", id: "buy" },
      },
    });
    expect(codes).toContain("unknown-anchor");
  });

  it("drops an unusable anchor without dropping the overlay (pre-ZAB-46 rendering)", () => {
    const node = view({ type: "Overlay", anchor: { at: "top" }, layout: { justify: "center" } });
    expect(node.type).toBe("Overlay");
    expect("anchor" in node).toBe(false);
  });
});

describe("readEnvelope: bindings", () => {
  it("accepts a binding wherever a static value is accepted", () => {
    const { diagnostics } = readEnvelope(
      withView({
        type: "Container",
        visible: { bind: "ui.hud" },
        disabled: { bind: "ui.busy" },
        children: [
          { type: "Text", text: { bind: "player.gold" } },
          { type: "Slider", value: { bind: "audio.volume" }, min: 0, max: 1 },
          { type: "Repeat", items: { bind: "shop.items" }, as: "item" },
        ],
      }),
    );
    expect(diagnostics).toEqual([]);
  });

  it("warns about a malformed data path without dropping anything", () => {
    const { envelope, codes } = read(withView({ type: "Text", text: { bind: "player..gold" } }));
    expect(codes).toContain("invalid-binding");
    expect(envelope?.views.hud?.type).toBe("Text");
  });

  it("drops a binding-shaped value that is not one", () => {
    const node = view({ type: "Toggle", checked: { bind: 3 } });
    expect("checked" in node).toBe(false);
  });

  it("drops a `disabled` that is not a boolean, leaving the control live", () => {
    // Never the other way round: a repair that guessed `true` would silently
    // switch off a control the author never disabled (ZAB-63).
    const node = view({ type: "Button", disabled: "yes" });
    expect(node.type).toBe("Button");
    expect("disabled" in node).toBe(false);
  });

  it("keeps `disabled` on an unknown node type, which degrades to a Container", () => {
    // A control the author switched off must not come back to life on an SDK that
    // does not know its type — `disabled` is NodeBase, so it survives the fallback.
    const node = view({ type: "RadialMenu", disabled: true, layout: { gap: 4 } }) as {
      type: string;
      disabled?: unknown;
    };
    expect(node.type).toBe("RadialMenu");
    expect(node.disabled).toBe(true);
  });
});

describe("readEnvelope: numeric coherence", () => {
  it("falls back to the default range when min is not below max", () => {
    const node = view({ type: "Slider", min: 10, max: 10, step: 1 }) as unknown as SliderNode;
    expect(node.min).toBeUndefined();
    expect(node.max).toBeUndefined();
    expect(node.step).toBe(1);
  });

  it("catches a lone bound that crosses the default it is paired with", () => {
    // `{min: 5}` is `5..1` at runtime — as inverted as declaring both, and it
    // used to pass because only ONE of the two was a number.
    for (const declared of [{ min: 5 }, { max: -3 }, { min: 1 }] as const) {
      const { codes } = read(withView({ type: "Slider", ...declared }));
      const node = view({ type: "Slider", ...declared }) as unknown as SliderNode;
      expect(codes, JSON.stringify(declared)).toEqual(["invalid-prop"]);
      expect(node.min, JSON.stringify(declared)).toBeUndefined();
      expect(node.max, JSON.stringify(declared)).toBeUndefined();
    }
  });

  it("names the default in the warning, so the crossing bound reads honestly", () => {
    const { diagnostics } = readEnvelope(withView({ type: "Slider", min: 5 }));
    expect(diagnostics[0].message).toContain("`min` (5) is not below `max` (1 by default)");
  });

  it("keeps a legitimate range", () => {
    const { diagnostics } = readEnvelope(withView({ type: "Slider", min: 0, max: 100 }));
    expect(diagnostics).toEqual([]);
  });

  it("keeps a lone bound that still fits inside the defaults", () => {
    for (const declared of [{ min: 0.2 }, { max: 0.8 }] as const) {
      const { diagnostics } = readEnvelope(withView({ type: "Slider", ...declared }));
      expect(diagnostics, JSON.stringify(declared)).toEqual([]);
    }
  });

  it("drops non-finite numbers", () => {
    const node = view({
      type: "Overlay",
      z: Number.POSITIVE_INFINITY,
      autoCloseMs: Number.NaN,
      modal: false,
    });
    expect(Object.keys(node).sort()).toEqual(["modal", "type"]);
  });
});

describe("readEnvelope: repeat", () => {
  it("drops a Repeat with nothing to repeat", () => {
    const { envelope, diagnostics } = readEnvelope(
      withView({
        type: "Container",
        children: [
          { type: "Repeat", items: { bind: "" }, children: [{ type: "Text", text: "x" }] },
        ],
      }),
    );
    expect((envelope?.views.hud as ContainerNode)?.children).toEqual([]);
    expect(diagnostics[0]?.message).toContain("Repeat has no usable `items`");
  });

  it("keeps the template as slot 0 when the empty state is dropped", () => {
    const node = view({
      type: "Repeat",
      items: { bind: "shop.items" },
      children: [{ type: "Text", text: { bind: "item.name" } }, { type: "Text" }],
    }) as unknown as RepeatNode;
    expect(node.children?.map((c) => c.type)).toEqual(["Text", "Container"]);
  });
});

describe("parseEnvelope", () => {
  it("throws an EnvelopeError carrying every diagnostic found", () => {
    const thrown = thrownBy(() => parseEnvelope({ ...base, views: { hud: { type: "Text" } } }));
    expect(thrown).toBeInstanceOf(EnvelopeError);
    const error = thrown as EnvelopeError;
    expect(error.message).toContain("no usable views");
    expect(error.diagnostics.map((d) => d.code)).toEqual(["invalid-node", "no-usable-views"]);
  });

  it("does not parse JSON text — a string is simply not an object", () => {
    expect(() => parseEnvelope(JSON.stringify(base))).toThrow("expected a JSON object");
    expect(readEnvelope(JSON.stringify(base)).envelope).not.toBeNull();
  });

  it("returns the repaired envelope when only warnings were found", () => {
    const env = parseEnvelope(withView({ type: "Container", clip: "yes" }));
    expect("clip" in (env.views.hud as ZNode)).toBe(false);
  });
});

describe("readEnvelope: hostile payloads", () => {
  /** A chain of nested Containers `depth` levels deep. */
  function nest(depth: number): Record<string, unknown> {
    return Array.from({ length: depth }).reduce<Record<string, unknown>>(
      (node) => ({ type: "Container", children: [node] }),
      { type: "Text", text: "bottom" },
    );
  }

  it("walks a deep but sane tree", () => {
    const { envelope, diagnostics } = readEnvelope(withView(nest(200)));
    expect(envelope).not.toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it("cuts a tree deep enough to overflow the stack, instead of throwing", () => {
    const { envelope, diagnostics } = readEnvelope(withView(nest(20_000)));
    expect(envelope).not.toBeNull();
    expect(diagnostics.at(-1)?.code).toBe("too-deep");
  });
});
