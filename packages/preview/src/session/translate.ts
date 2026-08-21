/**
 * The vocabulary the two halves do not share: what the renderer says, in the
 * words the store keeps.
 *
 * It is here rather than inside the wiring because every one of these is a pure
 * function of one value — a diagnostic, an action, a ratio — and the wiring is
 * the one part of this package that cannot be tested without a canvas, a fetch
 * and a fake renderer. Nothing here knows there is a store.
 */

import type { ActionContext, Diagnostic } from "@zabloo/format";
import { show } from "@/bridge";
import type { Dpr, Problem } from "@/store";

/**
 * The name the statusbar shows and the per-envelope memory is keyed by, until
 * the CLI publishes the real one in the `/envelope` response (V18, ZAB-99). It is
 * what `zabloo dev` writes, so it is right far more often than not.
 */
const DEFAULT_ENVELOPE_NAME = "zabloo.ir.json";

/** The header V18 answers `/envelope` with. */
const NAME_HEADER = "x-zabloo-envelope-name";

/**
 * The name as the server sent it. Encoded on the wire because a header value is
 * Latin-1 and the name is user data — a path typed by whoever ran the CLI, in
 * whatever alphabet. Tolerant on the way back: a value that was never encoded
 * (an older server, a hand-written one) reads as itself instead of throwing.
 */
function decodeEnvelopeName(header: string | null): string | null {
  if (header === null) return null;
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

/** A diagnostic's path when it is about one view: `views["hud"].children[2]`. */
const VIEW_PATH = /^views\["([^"]+)"\]/;

/**
 * Which view a diagnostic is about, when it is about one. The validator brackets
 * map keys precisely because a view id may contain dots of its own, which is what
 * makes this readable with one expression instead of a parser.
 */
function viewOf(path: string): string | undefined {
  return VIEW_PATH.exec(path)?.[1];
}

/**
 * A diagnostic as the Problems tab holds it. The two vocabularies line up field
 * for field — `level` and `severity` even have the same two values — except for
 * the view, which the validator states as a path and the picker needs as an id.
 */
function problemOf(diagnostic: Diagnostic): Problem {
  const view = viewOf(diagnostic.path);
  return {
    severity: diagnostic.level,
    code: diagnostic.code,
    path: diagnostic.path,
    reason: diagnostic.message,
    ...(view === undefined ? {} : { view }),
  };
}

/**
 * An action, as the log prints it. An action fired from inside a repeated row
 * carries the item it came from (ZAB-29) and that is the whole interest of the
 * line; one fired from a plain button is just its name, since the log already
 * says the line IS an action.
 */
function actionLine(action: string, context?: ActionContext): string {
  return context === undefined ? action : `${action} → ${context.path} (#${context.index})`;
}

/** A value a control wrote back, as the log prints it. */
function writeLine(path: string, value: unknown): string {
  return `${path} = ${show(value)}`;
}

/** A view that reached the canvas, as the log prints it. */
function viewLine(id: string): string {
  return `loaded → ${id}`;
}

/** The picker's DPR as the renderer takes it: a ratio to force, or its own. */
function dprOf(dpr: Dpr): number | undefined {
  return dpr === "auto" ? undefined : dpr;
}

export {
  actionLine,
  DEFAULT_ENVELOPE_NAME,
  decodeEnvelopeName,
  dprOf,
  NAME_HEADER,
  problemOf,
  viewLine,
  viewOf,
  writeLine,
};
