/**
 * What every typed editor is handed, and nothing else.
 *
 * The editors are deliberately dumb: they show a value and hand back what the
 * person did to it. Which store the value came from, whether the canvas wrote it
 * back, when the `← UI` mark expires and how a raw edit becomes a typed value
 * are all `BindingField`'s business — so an editor is a pure function of these
 * six props and is tested as one.
 */

import { show } from "@/bridge";

interface EditorProps {
  /** The control's own id: the field's `<label for>` points at it. */
  id: string;
  path: string;
  /** What to show. NOT necessarily of the binding's type — see `NumberEditor`. */
  value: unknown;
  /** The panel holds values but stops editing them while an export is broken. */
  disabled?: boolean;
  /** The id of the type tag, for `aria-describedby`. */
  describedBy: string;
  /** Raw, as the control produced it; the field coerces it to the bound type. */
  onCommit: (raw: unknown) => void;
}

/**
 * A held value as the text an editor shows. `show` is the bridge's own formatter
 * — the same one the action log uses — with one addition: a path that has been
 * declared but never written holds `undefined`, and an empty field says that
 * better than the word "undefined" does.
 */
function displayText(value: unknown): string {
  return value === undefined ? "" : show(value);
}

export type { EditorProps };
export { displayText };
