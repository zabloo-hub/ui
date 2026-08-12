/**
 * The renderer's end of the loading contract (decision 2026-08-12, ZAB-37).
 *
 * `@zabloo/format` owns the policy — what is repaired, what is warned about, what
 * refuses to load — and this module is the target-specific half of it: where the
 * diagnostics GO on the web. Warnings become `[zabloo]` console lines, like every
 * other authoring error the renderer reports; a fatal one becomes the exception the
 * two entry points treat differently (`mount` lets it through, `reload` swallows it
 * and keeps the envelope on screen).
 */

import { type Envelope, EnvelopeError, readEnvelope } from "@zabloo/format";

/**
 * Validates a payload — JSON text or a parsed value — reporting every warning and
 * throwing an `EnvelopeError` if nothing loadable is left. The returned envelope is
 * the REPAIRED one: the broken nodes are already gone, which is what lets the rest
 * of the renderer read it without defending itself at every node, every frame.
 */
export function loadEnvelope(input: string | object): Envelope {
  const { envelope, diagnostics } = readEnvelope(input);
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "warn") console.warn(`[zabloo] ${diagnostic.message}`);
  }
  if (envelope === null) throw new EnvelopeError(diagnostics);
  return envelope;
}
