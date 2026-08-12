import { afterEach, describe, expect, it } from "vitest";
import {
  envelopeFiles,
  type GoldenCase,
  metricsPath,
  mountCase,
  readCorpus,
  readEnvelope,
} from "./golden.js";
import type { GoldenView } from "./harness.js";
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
  for (const [name, golden] of Object.entries(CORPUS)) {
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
    for (const golden of Object.values(CORPUS)) {
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
    for (const golden of Object.values(CORPUS)) {
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
    for (const [name, golden] of Object.entries(CORPUS)) {
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
 * The types a case's envelope declares, read straight from the JSON — the
 * independent side of the comparison above.
 */
function declaredTypes(golden: GoldenCase): Set<string> {
  const source = JSON.stringify(readEnvelope(golden.envelope));
  return new Set(CATALOG.filter((type) => source.includes(`"type":"${type}"`)));
}
