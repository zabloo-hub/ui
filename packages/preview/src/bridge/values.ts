/**
 * Reading what the bindings panel holds as the value the game would have pushed,
 * and showing what a control wrote back.
 *
 * `coerce` and `show` are ported unchanged from `packages/cli/src/preview-client.ts`
 * (ZAB-57): the CLI panel is one text box per path, so everything went through
 * text. `coerceTyped` is what the typed panel of this milestone needs instead —
 * a checkbox already holds a boolean, and making it stringify itself so this
 * module can parse it back would be inventing an error case for nothing.
 */

import type { BindingType } from "./bindings.js";

/**
 * Reads a panel field as the value the game would have pushed. Arrays and
 * objects are values like any other since ZAB-29 — a list is fed by pushing its
 * array — so JSON is parsed; anything that does not parse stays the text the
 * person typed, because a half-written array is not an error worth shouting about.
 */
export function coerce(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return text;
    }
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

/**
 * Reads an editor that already knows what it is editing (V7's typed panel).
 *
 * The type comes from the binding site, so guessing is over: `"true"` in a field
 * bound to a `Text` is the WORD true, and `coerce` — which has to guess, because
 * a single text box is all the CLI panel ever had — would have pushed a boolean
 * into it. The editors that hold a real value (a checkbox, a number spinner) pass
 * it through untouched.
 *
 * A field mid-edit keeps the same treatment it gets in `coerce`: `"1."` or a
 * half-typed array stays text rather than becoming `NaN` or an exception. It is a
 * box someone is still typing in, not a report worth making.
 */
export function coerceTyped(type: BindingType, raw: unknown): unknown {
  switch (type) {
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "number") return raw !== 0;
      return String(raw) === "true";
    case "number": {
      if (typeof raw === "number") return raw;
      const text = String(raw);
      const value = Number(text.trim());
      return text.trim() !== "" && !Number.isNaN(value) ? value : text;
    }
    case "array":
    case "object": {
      if (typeof raw !== "string") return raw;
      try {
        return JSON.parse(raw.trim());
      } catch {
        return raw;
      }
    }
    default:
      return typeof raw === "string" ? raw : show(raw);
  }
}

/** How a value written back by a control is shown in its field and in the log. */
export function show(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
