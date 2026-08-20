/**
 * TextInput wiring (ZAB-26, extracted from `view.ts` in ZAB-54): the buffer,
 * the caret and the hidden field the browser types into. `textinput.ts` owns
 * the pure editing model (caret math, `maxLength`, the single-line rule); this
 * owns the state that runs it — the focused field's text, its selection, the
 * off-screen `<textarea>` and its IME composition.
 *
 * A canvas receives keystrokes but not TEXT: IME composition, the clipboard and
 * the mobile keyboard all belong to a real editable element. So one lives
 * off-screen, mirroring the focused field both ways — we push our buffer into it
 * and fold whatever the browser did back into ours. It is the same trick Figma
 * and Docs use, and it stays entirely inside the web renderer (the Unity SDK
 * will have its own answer).
 */

import type { LayoutNode, Rect } from "../layout.js";
import type { Point } from "../overlay.js";
import type { TextMetrics } from "../text.js";
import {
  caretXOf,
  chars,
  clampSelection,
  codePointIndex,
  type Edit,
  indexAtXOf,
  insert,
  length,
  remove,
  type Selection,
  scrollFor,
  selectAll,
  span,
  utf16Offset,
} from "../textinput.js";

/**
 * The caret and the selection highlight a focused TextInput paints (ZAB-26).
 * Both derive from the field's own `style.color` — the "color of this node's
 * content" that already tints glyphs and images — so nothing new enters `Style`.
 * The blink is renderer behavior, like the Spinner's loop: it is not authored,
 * and styling either of them is a compatible extension, exactly as it is for the
 * ScrollView's scrollbar.
 */
const CARET = { width: 2, blinkMs: 1060, selectionAlpha: 0.3 };

/**
 * What the field asks of the view: where the focus is, what the text measures
 * with, and the return leg of the data channel when an edit settles.
 */
interface FieldHost {
  /** The node that owns the keyboard, if any. */
  focused(): LayoutNode | null;
  /** The metrics this field measures with — the caret and the paint share them. */
  metrics(node: LayoutNode): TextMetrics;
  /** The box a node's content lives in: its rect minus its padding. */
  contentBox(node: LayoutNode): Rect;
  /**
   * An edit settled into the buffer: write the new value into the bound path —
   * the return leg of the data channel — and fire the live `onChange`.
   */
  textEdited(node: LayoutNode): void;
  /** Puts the hidden field into the DOM, next to the canvas. */
  attachEditor(editor: HTMLTextAreaElement): void;
  /** Registers the hidden field's cleanup with the view's disposers. */
  addDisposer(dispose: () => void): void;
  render(): void;
}

/** The caret's blink clock — the same monotonic source the view renders against. */
function now(): number {
  return performance.now();
}

/** The slice of a node's IR the field reads. */
interface FieldIR {
  maxLength?: number;
}

/** The buffer, the caret and the hidden `<textarea>` of the focused TextInput. */
class FieldEditor {
  /**
   * The hidden field the browser types into while a TextInput has the focus. It is
   * what buys real IME composition, the clipboard and the mobile keyboard — none of
   * which a canvas can get from raw `keydown` (decision 2026-08-11, ZAB-26).
   */
  private editor: HTMLTextAreaElement | null = null;
  /** TextInput with an IME composition in flight — its text is not final yet. */
  private composing: LayoutNode | null = null;

  constructor(private readonly host: FieldHost) {}

  /**
   * A rebuild: the tree is new, so the node this was editing is gone (ZAB-57).
   *
   * The hidden field OUTLIVES the tree — it belongs to the canvas, not to the
   * document on it — so without this a `compositionend` arriving after a hot
   * reload would commit half a syllable into a node nobody is showing any more.
   * It also gives the keyboard back: a rebuild focuses nothing until the first
   * render settles `autofocus`, and the field must not be holding it meanwhile.
   */
  reset(): void {
    this.composing = null;
    this.editor?.blur();
  }

  /** The buffer and the state derived from it — `empty` is what styles the placeholder. */
  setNodeText(node: LayoutNode, text: string): void {
    node.text = text;
    // The split is a function of the buffer, so it dies with it (ZAB-73).
    node.textChars = null;
    node.empty = text.length === 0;
  }

  /**
   * The field's buffer in code points, split once per edit (ZAB-73).
   *
   * The caret, the highlight and the field's own scroll each need the same
   * split, several times per frame, and `Array.from` over the buffer for every
   * one of them was six to eight arrays a frame for a string nobody had touched.
   * Public because paint asks the same question the editor does.
   */
  charsOf(node: LayoutNode): readonly string[] {
    let glyphs = node.textChars;
    if (glyphs === null) {
      glyphs = chars(node.text);
      node.textChars = glyphs;
    }
    return glyphs;
  }

  /**
   * Single state-mutation path for the text (typing, IME, paste, delete,
   * `setText`): writes the buffer, hands the new value to the host — the
   * return leg of the data channel — and fires the live `onChange`. The caret moves
   * with it, and its blink restarts so it stays solid while the player types.
   */
  applyEdit(node: LayoutNode, edit: Edit, silent = false, commit = false): void {
    const changed = edit.text !== node.text;
    this.setNodeText(node, edit.text);
    node.selection = clampSelection(edit.selection, length(edit.text));
    node.caretSince = now();
    // `silent` is a composition in flight (the field shows it, the game is not told
    // yet); `commit` is the end of one, where the settled text must go out even
    // though the silent frames already put it in the buffer.
    if ((changed || commit) && !silent) this.host.textEdited(node);
    this.host.render();
  }

  /** Moves the caret (or the selection) without touching the text. */
  setSelection(node: LayoutNode, selection: Selection): void {
    node.selection = clampSelection(selection, length(node.text));
    node.caretSince = now();
    this.syncEditor(node);
    this.host.render();
  }

  deleteText(node: LayoutNode, forward: boolean): void {
    this.applyEdit(node, remove(node.text, node.selection, forward));
    this.syncEditor(node);
  }

  /** The caret index a point selects, in the field's own content coordinates. */
  textIndexAt(node: LayoutNode, point: Point): number {
    const box = this.host.contentBox(node);
    return indexAtXOf(
      this.charsOf(node),
      point.x - box.x + node.textScroll,
      this.host.metrics(node),
    );
  }

  /**
   * Keeps the caret inside the box after a change — the field's own horizontal
   * scroll, the counterpart of the ScrollView's offset (never authored). It runs
   * after arrange, where the rect is final, and it is idempotent.
   */
  syncTextScroll(node: LayoutNode): void {
    const metrics = this.host.metrics(node);
    const box = this.host.contentBox(node);
    const glyphs = this.charsOf(node);
    node.textScroll = scrollFor(
      node.textScroll,
      caretXOf(glyphs, node.selection.focus, metrics),
      box.width,
      caretXOf(glyphs, glyphs.length, metrics),
      CARET.width,
    );
  }

  private ensureEditor(): HTMLTextAreaElement | null {
    if (this.editor) return this.editor;
    if (typeof document === "undefined") return null;
    const editor = document.createElement("textarea");
    // Off-screen but REAL: `display:none` or `visibility:hidden` would take no
    // focus, and without focus there is no composition and no virtual keyboard.
    Object.assign(editor.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      border: "0",
      outline: "none",
      resize: "none",
      opacity: "0",
      zIndex: "-1",
      pointerEvents: "none",
    });
    editor.setAttribute("autocomplete", "off");
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocorrect", "off");
    editor.setAttribute("aria-hidden", "true");
    editor.spellcheck = false;
    editor.tabIndex = -1;

    const input = () => {
      const node = this.host.focused();
      if (node?.ir.type !== "TextInput") return;
      // Mid-composition the field shows what is being composed but the game is not
      // told yet: half a syllable is not a value. `compositionend` commits it.
      this.readEditor(node, this.composing === node);
    };
    const compositionstart = () => {
      const node = this.host.focused();
      if (node?.ir.type === "TextInput") this.composing = node;
    };
    const compositionend = () => {
      const node = this.composing;
      this.composing = null;
      if (node) this.readEditor(node, false, true);
    };
    editor.addEventListener("input", input);
    editor.addEventListener("compositionstart", compositionstart);
    editor.addEventListener("compositionupdate", input);
    editor.addEventListener("compositionend", compositionend);

    this.host.attachEditor(editor);
    this.editor = editor;
    this.host.addDisposer(() => {
      editor.removeEventListener("input", input);
      editor.removeEventListener("compositionstart", compositionstart);
      editor.removeEventListener("compositionupdate", input);
      editor.removeEventListener("compositionend", compositionend);
      editor.remove();
      this.editor = null;
    });
    return editor;
  }

  /** Pushes our buffer and caret into the hidden field, so the browser edits THIS. */
  syncEditor(node: LayoutNode): void {
    const editor = this.editor;
    if (!editor || this.host.focused() !== node || this.composing === node) return;
    if (editor.value !== node.text) editor.value = node.text;
    const { start, end } = span(node.selection, length(node.text));
    const backward = node.selection.anchor > node.selection.focus;
    editor.setSelectionRange(
      utf16Offset(node.text, start),
      utf16Offset(node.text, end),
      backward ? "backward" : "forward",
    );
  }

  /**
   * Folds the hidden field back into ours. Everything the browser can do to text —
   * typing, composing, pasting, cutting, autocorrect — arrives here as "this is the
   * new value and this is where the caret is", so the whole value is run through the
   * editing model as one replacement: that is what applies `maxLength` and the
   * single-line rule here exactly as it applies them to a keystroke on a target that
   * feeds characters in one at a time.
   */
  private readEditor(node: LayoutNode, silent: boolean, commit = false): void {
    const editor = this.editor;
    if (!editor) return;
    const limited = insert(
      node.text,
      selectAll(node.text),
      editor.value,
      (node.ir as FieldIR).maxLength,
    ).text;
    // The caret is the browser's, not the model's: it knows where the edit landed.
    const backward = editor.selectionDirection === "backward";
    const start = codePointIndex(limited, editor.selectionStart ?? 0);
    const end = codePointIndex(limited, editor.selectionEnd ?? 0);
    this.applyEdit(
      node,
      {
        text: limited,
        selection: backward ? { anchor: end, focus: start } : { anchor: start, focus: end },
      },
      silent,
      commit,
    );
    // Truncated, or a newline folded away: the browser's copy is no longer ours.
    if (limited !== editor.value) this.syncEditor(node);
  }

  /** Hands the keyboard to the hidden field, or takes it back when focus leaves. */
  focusEditor(node: LayoutNode | null): void {
    if (node?.ir.type !== "TextInput") {
      this.composing = null;
      this.editor?.blur();
      return;
    }
    const editor = this.ensureEditor();
    if (!editor) return;
    this.syncEditor(node);
    if (document.activeElement !== editor) editor.focus({ preventScroll: true });
  }
}

export type { FieldHost };
export { CARET, FieldEditor };
