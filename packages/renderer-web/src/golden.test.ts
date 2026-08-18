import { EnvelopeError } from "@zabloo/format";
import { afterEach, describe, expect, it } from "vitest";
import {
  envelopeFiles,
  type GoldenCase,
  metricCases,
  metricsPath,
  mountCase,
  readCorpus,
  readEnvelope,
} from "./golden.js";
import type { GoldenView } from "./harness.js";
import { mountGolden } from "./harness.js";
import { serializeSnapshot, typesIn } from "./snapshot.js";

/**
 * The regression net (ZAB-48): every capability of the catalog renders through
 * the REAL view — `view.ts` included, which was the one module of the renderer
 * without a suite — and its metrics are compared against a file in `golden/`.
 *
 * A failure here is a rect, a break point, a baseline, a clip or a layer order
 * that moved. When the move is intended, `pnpm test -u` rewrites the files and
 * the DIFF is the review: that is the point of keeping them versioned next to
 * the envelopes rather than inline in a test.
 *
 * The invariants a careless `-u` could bless away do not live here — they are
 * hand-written in `view.test.ts`.
 */

const CORPUS = readCorpus();

/** Every node type of the v1 vocabulary. The corpus must reach all of them. */
const CATALOG = [
  "Container",
  "Text",
  "Button",
  "Collapse",
  "ScrollView",
  "Image",
  "Overlay",
  "Toggle",
  "Repeat",
  "ProgressBar",
  "Spinner",
  "Slider",
  "TextInput",
] as const;

let view: GoldenView | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
});

describe("golden metrics", () => {
  for (const [name, golden] of metricCases(CORPUS)) {
    it(`${name} — ${golden.about}`, async () => {
      view = await mountCase(golden);
      await expect(serializeSnapshot(view.snapshot())).toMatchFileSnapshot(metricsPath(name));
    });
  }
});

describe("the corpus itself", () => {
  it("has a case for every envelope on disk", () => {
    const declared = Object.values(CORPUS).map((golden: GoldenCase) => golden.envelope);
    expect([...declared].sort()).toEqual(envelopeFiles());
  });

  it("renders every case without a single renderer warning", async () => {
    for (const [, golden] of metricCases(CORPUS)) {
      const mounted = await mountCase(golden);
      const warnings = [...mounted.warnings];
      mounted.dispose();
      // A warning is the renderer reporting AUTHORING error — a corpus envelope
      // that provokes one is a broken fixture, and it would also mean the
      // metrics below were measured on a degraded render.
      expect(warnings).toEqual([]);
    }
  });
});

describe("dispatch coverage of view.ts", () => {
  it("instantiates every node type of the catalog somewhere in the corpus", async () => {
    const seen = new Set<string>();
    for (const [, golden] of metricCases(CORPUS)) {
      const mounted = await mountCase(golden);
      for (const type of typesIn(mounted.snapshot())) seen.add(type);
      mounted.dispose();
    }
    // Not "the JSON mentions them": these are the types the view BUILT and laid
    // out. A type that silently degraded to a Container would be missing here.
    expect([...CATALOG].filter((type) => !seen.has(type))).toEqual([]);
  });

  it("routes each type to its own module instead of degrading to a Container", async () => {
    // The normative fallback for an UNKNOWN type is "render as a Container"
    // (decision 2026-08-11). That is exactly what a type this renderer forgot to
    // dispatch would look like, so the check is that every catalog type keeps
    // its identity in the tree the view built.
    for (const [name, golden] of metricCases(CORPUS)) {
      const mounted = await mountCase(golden);
      const built = typesIn(mounted.snapshot());
      mounted.dispose();
      for (const type of declaredTypes(golden)) {
        expect(built, `${name} lost the ${type} it declares`).toContain(type);
      }
    }
  });
});

/**
 * The two normative rules of forward-tolerance (`docs/format/loading.md`,
 * `docs/format/versioning.md`) — the ones a SECOND target is likeliest to get
 * wrong, because they are about content it was never built for. The corpus has
 * to hold a case for each, exactly as it has to reach all 13 node types (ZAB-74),
 * and these two cases are the embryo of the forward-compat corpus of ZAB-39.
 */
describe("the forward-tolerance rules the corpus must record", () => {
  it("has a case whose envelope declares a node type outside the v1 catalog", () => {
    const cases = metricCases(CORPUS).filter(([, golden]) => unknownTypes(golden).size > 0);

    expect(cases.map(([name]) => name)).not.toEqual([]);
  });

  it("degrades that type to a box preserving layout, style and children", async () => {
    for (const [name, golden] of metricCases(CORPUS)) {
      const unknown = unknownTypes(golden);
      if (unknown.size === 0) continue;
      const mounted = await mountCase(golden);
      const snapshot = mounted.snapshot();
      mounted.dispose();

      for (const type of unknown) {
        const node = findByType(snapshot.tree, type);
        // It kept its own identity in the tree — degrading is about BEHAVIOR, not
        // about rewriting the document into something the author did not write.
        expect(node, `${name} dropped the unknown ${type} entirely`).toBeTruthy();
        if (!node) continue;
        // `visible` is preserved too, so an unknown type the data hides leaves
        // layout exactly as a known one would — and nothing else is measured of it.
        if (node.out) continue;
        // In layout with a rect of its own, laid out from its own `layout`.
        expect(node.rect, `${name}: the unknown ${type} was not laid out`).toBeTruthy();
        expect(node.style, `${name}: the unknown ${type} lost its style`).toBeTruthy();
        // And its children are still there, still participating: a new primitive
        // lands in an old SDK as a plain box HOLDING ITS CHILDREN.
        expect(node.children?.length, `${name}: the unknown ${type} lost its children`).toBe(
          declaredChildren(golden, type),
        );
      }
    }
  });

  it("has a case that refuses an incompatible major version", () => {
    const refusals = Object.values(CORPUS).filter(
      (golden) => golden.refuses?.code === "unsupported-version",
    );

    expect(refusals).not.toEqual([]);
  });
});

/**
 * The load-only cases: an envelope the format refuses. There is no frame to
 * measure — the point IS that nothing rendered — so they are asserted here
 * instead of against a file in `metrics/`.
 */
describe("refusals", () => {
  for (const [name, golden] of Object.entries(CORPUS)) {
    const refuses = golden.refuses;
    if (!refuses) continue;

    it(`${name} — ${golden.about}`, async () => {
      const envelope = readEnvelope(golden.envelope);

      // Fatal, and it says so with its stable CODE — the contract a second
      // target implements against, not the wording of a message.
      await expect(mountGolden(envelope)).rejects.toThrow(EnvelopeError);
      await expect(mountGolden(envelope)).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ level: "fatal", code: refuses.code }),
        ]),
      });
    });

    it(`${name} — reports the refusal through onDiagnostic, and renders nothing`, async () => {
      const seen: Array<{ level: string; code: string }> = [];

      await expect(
        mountGolden(readEnvelope(golden.envelope), {
          onDiagnostic: (diagnostic) => seen.push(diagnostic),
        }),
      ).rejects.toThrow();

      // The sink hears it BEFORE the throw: whoever is going to show the failure
      // needs the code and the path, not just the message on the exception.
      expect(seen.map((diagnostic) => [diagnostic.level, diagnostic.code])).toContainEqual([
        "fatal",
        refuses.code,
      ]);
    });
  }
});

/**
 * The types a case's envelope declares, read straight from the JSON — the
 * independent side of the comparison above.
 */
function declaredTypes(golden: GoldenCase): Set<string> {
  const source = JSON.stringify(readEnvelope(golden.envelope));
  return new Set(CATALOG.filter((type) => source.includes(`"type":"${type}"`)));
}

/** Types a case declares that are NOT in the v1 catalog — the forward-compat half. */
function unknownTypes(golden: GoldenCase): Set<string> {
  const found = new Set<string>();
  walk(readEnvelope(golden.envelope), (node) => {
    if (!CATALOG.includes(node.type as (typeof CATALOG)[number])) found.add(node.type);
  });
  return found;
}

/** How many children the envelope gives the first node of that type. */
function declaredChildren(golden: GoldenCase, type: string): number {
  let count = 0;
  let seen = false;
  walk(readEnvelope(golden.envelope), (node) => {
    if (seen || node.type !== type) return;
    seen = true;
    count = node.children?.length ?? 0;
  });
  return count;
}

interface RawNode {
  type: string;
  children?: RawNode[];
}

/** Every node of an envelope's views, as it was written. */
function walk(envelope: object, visit: (node: RawNode) => void): void {
  const views = (envelope as { views?: Record<string, RawNode> }).views ?? {};
  const stack = Object.values(views);
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    visit(node);
    for (const child of node.children ?? []) stack.push(child);
  }
}

interface TreeNode {
  type: string;
  /** Set only when the node is out of layout — everything else is then omitted. */
  out?: string;
  rect?: unknown;
  style?: unknown;
  children?: TreeNode[];
}

function findByType(node: TreeNode, type: string): TreeNode | null {
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return null;
}
