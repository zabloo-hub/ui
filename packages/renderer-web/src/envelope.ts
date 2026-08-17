/**
 * The renderer's end of the loading contract (decision 2026-08-12, ZAB-37).
 *
 * `@zabloo/format` owns the policy — what is repaired, what is warned about, what
 * refuses to load — and this module is the target-specific half of it: where the
 * diagnostics GO on the web. A fatal one still becomes the exception the two entry
 * points treat differently (`mount` lets it through, `reload` swallows it and keeps
 * the envelope on screen).
 *
 * **Where they go is the caller's call (ZAB-72).** `@zabloo/format` produces
 * STRUCTURED diagnostics — stable codes, a path into the envelope — and the console
 * is where that structure died: the dev server's error overlay, the preview and the
 * future editor would have had to scrape console lines to show an authoring error.
 * With an `onDiagnostic` they receive the objects; without one the console lines are
 * exactly the ones this module has always printed.
 */

import { type Diagnostic, type Envelope, EnvelopeError, readEnvelope } from "@zabloo/format";

/** Where a load's diagnostics go — see `MountOptions.onDiagnostic`. */
export type DiagnosticSink = (diagnostic: Diagnostic) => void;

/**
 * Validates a payload — JSON text or a parsed value — reporting every diagnostic and
 * throwing an `EnvelopeError` if nothing loadable is left. The returned envelope is
 * the REPAIRED one: the broken nodes are already gone, which is what lets the rest
 * of the renderer read it without defending itself at every node, every frame.
 *
 * A sink hears about the fatal ones too, BEFORE the throw: the caller that is going
 * to show the failure needs the code and the path, not just the message the
 * exception carries.
 */
export function loadEnvelope(input: string | object, onDiagnostic?: DiagnosticSink): Envelope {
  const { envelope, diagnostics } = readEnvelope(input);
  for (const diagnostic of diagnostics) {
    if (onDiagnostic) onDiagnostic(diagnostic);
    else if (diagnostic.level === "warn") console.warn(`[zabloo] ${diagnostic.message}`);
  }
  if (envelope === null) throw new EnvelopeError(diagnostics);
  return envelope;
}
