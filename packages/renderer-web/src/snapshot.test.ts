import type { ZNode } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { createLayoutNode, type LayoutNode } from "./layout.js";
import {
  findNode,
  hex,
  round,
  type SnapshotInput,
  serializeSnapshot,
  snapshotView,
  typesIn,
} from "./snapshot.js";
import type { ResolvedValues } from "./transition.js";

/**
 * The serializer on its own, over hand-built trees — the rules that make a golden
 * file a readable diff rather than a wall of noise. What it records from a REAL
 * frame is covered by `golden.test.ts`; what is checked here is the shape.
 */

function node(
  ir: Partial<ZNode> & { type: string },
  resolved: ResolvedValues = {},
  children: LayoutNode[] = [],
): LayoutNode {
  const built = createLayoutNode(ir as ZNode);
  built.children = children;
  built.resolved = resolved;
  built.rect = { x: 0, y: 0, width: 10, height: 10 };
  built.measured = { x: 10, y: 10 };
  for (const child of children) child.parent = built;
  return built;
}

function snapshot(root: LayoutNode, input: Partial<SnapshotInput> = {}) {
  return snapshotView({
    view: "test",
    size: { width: 100, height: 100 },
    root,
    layer: [],
    focused: null,
    hovered: null,
    pressed: null,
    radiusOf: (n) => n.resolved.radius ?? 0,
    textOf: () => null,
    ...input,
  });
}

describe("addressing a node", () => {
  it("uses the id when the tree has exactly one node wearing it", () => {
    const child = node({ type: "Text", id: "label", text: "" });
    const result = snapshot(node({ type: "Container", id: "root" }, {}, [child]));

    expect(result.tree.ref).toBe("root");
    expect(result.tree.children?.[0].ref).toBe("label");
  });

  it("falls back to the positional path for an id worn by several nodes", () => {
    // What every instance of a `Repeat` template looks like: the id is unique in
    // the document and repeated in the tree, so it addresses none of them.
    const twins = [0, 1].map(() => node({ type: "Text", id: "row", text: "" }));
    const result = snapshot(node({ type: "Container", id: "root" }, {}, twins));

    expect(result.tree.children?.map((child) => child.ref)).toEqual(["0", "1"]);
  });

  it("addresses an unnamed root without ever colliding with an id", () => {
    const result = snapshot(node({ type: "Container" }));

    expect(result.tree.ref).toBe("$root");
  });
});

describe("what a node records", () => {
  it("omits the defaults every node resolves to", () => {
    const result = snapshot(
      node({ type: "Container", id: "plain" }, { opacity: 1, radius: 0, borderWidth: 0 }),
    );

    // A zero radius and a full opacity say nothing; recording them would bury
    // the values that do.
    expect(result.tree.style).toBeUndefined();
  });

  it("records the values that mean something, colors as hex", () => {
    const result = snapshot(
      node(
        { type: "Container", id: "painted" },
        { background: [1, 0, 0, 1], opacity: 0.5, radius: 4 },
      ),
    );

    expect(result.tree.style).toEqual({ background: "#ff0000", opacity: 0.5, radius: 4 });
  });

  it("records the measured size only when arrange gave the node another one", () => {
    const grown = node({ type: "Container", id: "grown" });
    grown.rect = { x: 0, y: 0, width: 40, height: 10 };

    expect(snapshot(grown).tree.measured).toEqual({ x: 10, y: 10 });
    grown.measured = { x: 40, y: 10 };
    expect(snapshot(grown).tree.measured).toBeUndefined();
  });

  it("stops at a node that is out of layout, and says which mechanism took it", () => {
    const hidden = node({ type: "Container", id: "hidden" }, {}, [
      node({ type: "Text", id: "inside", text: "" }),
    ]);
    hidden.visibleFlag = false;
    const section = node({ type: "Container", id: "section" });
    section.sectionShown = false;
    const result = snapshot(node({ type: "Container", id: "root" }, {}, [hidden, section]));

    // Its rect, its style and its subtree are whatever the last frame that laid
    // it out left behind — recording them would describe a node that is not there.
    expect(result.tree.children?.[0]).toEqual({ type: "Container", ref: "hidden", out: "visible" });
    expect(result.tree.children?.[1].out).toBe("section");
    expect(findNode(result, "inside")).toBeNull();
  });
});

describe("clipping regions", () => {
  it("cuts a subtree by every clipping ancestor", () => {
    const inner = node({ type: "Text", id: "inner", text: "" });
    const clipper = node({ type: "Container", id: "clipper", clip: true }, {}, [inner]);
    clipper.rect = { x: 0, y: 0, width: 20, height: 20 };

    const result = snapshot(node({ type: "Container", id: "root" }, {}, [clipper]));

    expect(result.tree.clip).toBeUndefined();
    expect(findNode(result, "clipper")?.clip).toBeUndefined(); // its OWN rect is uncut
    expect(findNode(result, "inner")?.clip).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      radius: 0,
    });
  });

  it("restarts the region at an Overlay, which is a paint root", () => {
    const inside = node({ type: "Text", id: "inside", text: "" });
    const overlay = node({ type: "Overlay", id: "overlay" }, {}, [inside]);
    const clipper = node({ type: "Container", id: "clipper", clip: true }, {}, [overlay]);
    clipper.rect = { x: 0, y: 0, width: 20, height: 20 };

    const result = snapshot(node({ type: "Container", id: "root" }, {}, [clipper]));

    // An Overlay declared inside a ScrollView is not cut by it: the layer is laid
    // out against the view rect, so the clips of where it was declared never apply.
    expect(findNode(result, "overlay")?.clip).toBeUndefined();
    expect(findNode(result, "inside")?.clip).toBeUndefined();
  });
});

describe("the document as bytes", () => {
  it("is byte-identical for two snapshots of an unchanged tree", () => {
    const root = node({ type: "Container", id: "root" }, { background: [0, 0.5, 1, 1] }, [
      node({ type: "Text", id: "a", text: "" }),
      node({ type: "Text", id: "b", text: "" }),
    ]);

    expect(serializeSnapshot(snapshot(root))).toBe(serializeSnapshot(snapshot(root)));
  });

  it("ends in a newline, so a golden file is a well-formed text file", () => {
    expect(serializeSnapshot(snapshot(node({ type: "Container" })))).toMatch(/}\n$/);
  });

  it("lists every type in the tree, which is what the dispatch check reads", () => {
    const root = node({ type: "Container", id: "root" }, {}, [
      node({ type: "Slider", id: "s" }),
      node({ type: "Text", id: "t", text: "" }),
    ]);

    expect(typesIn(snapshot(root))).toEqual(new Set(["Container", "Slider", "Text"]));
  });
});

describe("numbers", () => {
  it("quantizes to three decimals, so an FMA's last bits never rewrite a file", () => {
    expect(round(18.398437500000004)).toBe(18.398);
    expect(round(0.1 + 0.2)).toBe(0.3);
  });

  it("normalizes negative zero", () => {
    expect(Object.is(round(-0.0001), 0)).toBe(true);
  });

  it("lets a non-finite value through instead of hiding it", () => {
    // A NaN rect is a bug the net exists to catch; rounding it away would be the
    // opposite of the job.
    expect(round(Number.NaN)).toBeNaN();
    expect(round(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("writes alpha only when the color is not opaque", () => {
    expect(hex([1, 1, 1, 1])).toBe("#ffffff");
    expect(hex([0, 0, 0, 0.5])).toBe("#00000080");
    expect(hex([2, -1, 0.5, 1])).toBe("#ff0080"); // clamped, not wrapped
  });
});
