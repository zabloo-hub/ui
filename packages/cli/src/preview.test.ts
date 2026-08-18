/**
 * `zabloo preview <envelope.json>` (ZAB-78) — looking at an artifact with no
 * project around it.
 *
 * `previewFile` itself never returns (it serves until Ctrl+C), so what is on trial
 * here is the judgement it makes before the server ever comes up: which files are
 * worth serving. The rule is the SDK's, not a stricter one — a repaired warning
 * still renders, and refusing it would make this useless for the case it exists
 * for, which is opening someone else's envelope to see what is wrong with it.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPreviewEnvelope } from "./preview.js";

async function envelopeFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zabloo-preview-"));
  const path = join(dir, "zabloo.ir.json");
  await writeFile(path, content);
  return path;
}

describe("readPreviewEnvelope", () => {
  it("serves a valid envelope verbatim", async () => {
    const json = JSON.stringify({ v: 1, tokens: {}, views: { hud: { type: "Text", text: "hi" } } });
    const source = await readPreviewEnvelope(await envelopeFile(json));
    expect(source.error).toBeNull();
    // Verbatim, not the repaired copy: the page validates it again and reports
    // through `onDiagnostic`, so re-serializing here would hide what it found.
    expect(source.json).toBe(json);
  });

  it("still serves an envelope whose warnings were repaired", async () => {
    const json = JSON.stringify({
      v: 1,
      tokens: {},
      views: { hud: { type: "Text", text: "hi", style: { color: "{color.nope}" } } },
    });
    const source = await readPreviewEnvelope(await envelopeFile(json));
    expect(source.error).toBeNull();
  });

  it("refuses a fatal one, naming what the validator said", async () => {
    const path = await envelopeFile(JSON.stringify({ v: 99, tokens: {}, views: {} }));
    const source = await readPreviewEnvelope(path);
    expect(source.json).toBeUndefined();
    expect(source.error).toContain("not a loadable envelope");
  });

  it("refuses text that is not JSON", async () => {
    const source = await readPreviewEnvelope(await envelopeFile("nope"));
    expect(source.error).toContain("not a loadable envelope");
  });

  it("says it cannot read a file that is not there, before any server is up", async () => {
    const source = await readPreviewEnvelope(join(tmpdir(), "zabloo-does-not-exist.json"));
    expect(source.error).toContain("cannot read");
  });
});
