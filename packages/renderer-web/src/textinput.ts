/**
 * Pure TextInput editing model and caret geometry (ZAB-26) — the text buffer, the
 * caret, the selection and the horizontal scroll of the content, with no DOM and no
 * IR. Kept apart so the rules are unit testable without a canvas and so the Unity
 * SDK has an unambiguous reference for the same behavior (the role `slider.ts`
 * plays for the continuous control).
 *
 * Two invariants run through the whole file:
 *
 * - **Positions are counted in CODE POINTS, not in UTF-16 units.** A caret that can
 *   land between the two halves of an emoji is a caret that can cut it in half, so
 *   the model indexes `Array.from(text)` and every public function takes and returns
 *   those indices. (Grapheme clusters — a flag, a family, a combining accent — are a
 *   finer step still and stay deferred: they need a segmentation table, which is the
 *   same reason shaping is v2.)
 * - **The x of a character is measured exactly as it is painted**, advance plus the
 *   kerning against the glyph before it, so the caret sits on the seam the player
 *   sees rather than near it.
 */

import type { TextMetrics } from "./text.js";

/**
 * A caret and, when the two ends differ, a selection. `anchor` is where the gesture
 * started and `focus` where it is now — the order between them is what makes
 * shift+arrow grow AND shrink a selection instead of always growing it.
 */
interface Selection {
  anchor: number;
  focus: number;
}

/** The selection as an ordered span. `start === end` means "just a caret". */
interface Span {
  start: number;
  end: number;
}

/** The result of an edit: the new text and where the caret ended up. */
interface Edit {
  text: string;
  selection: Selection;
}

/** Code points of `text` — the unit every index in this module counts in. */
function chars(text: string): string[] {
  return Array.from(text);
}

/** Number of code points in `text`. */
function length(text: string): number {
  return chars(text).length;
}

/** A caret with no selection at `index`. */
function caretAt(index: number): Selection {
  return { anchor: index, focus: index };
}

/** The selection as an ordered, clamped span. */
function span(selection: Selection, max: number): Span {
  const anchor = clampIndex(selection.anchor, max);
  const focus = clampIndex(selection.focus, max);
  return anchor <= focus ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

function hasSelection(selection: Selection): boolean {
  return selection.anchor !== selection.focus;
}

/** Keeps a selection inside a text that changed under it (a `SetData` from the game). */
function clampSelection(selection: Selection, max: number): Selection {
  return { anchor: clampIndex(selection.anchor, max), focus: clampIndex(selection.focus, max) };
}

/** The selected substring — what a copy or a cut puts on the clipboard. */
function selectedText(text: string, selection: Selection): string {
  const glyphs = chars(text);
  const { start, end } = span(selection, glyphs.length);
  return glyphs.slice(start, end).join("");
}

/**
 * Replaces the selection (or inserts at the caret) with `input`, honoring
 * `maxLength` — which counts the WHOLE field, not the insertion: a paste into a full
 * field lands the prefix that fits and drops the rest, which is what every text field
 * does and what keeps a limit meaningful when the text also arrives whole.
 *
 * Newlines are stripped rather than rejected: v1 is a single line (the multiline
 * field is deferred), and pasting a two-line address should leave the first line in
 * the box instead of failing silently.
 */
function insert(text: string, selection: Selection, input: string, maxLength?: number): Edit {
  const glyphs = chars(text);
  const { start, end } = span(selection, glyphs.length);
  const inserted = chars(sanitizeLine(input));
  const limit = maxLength !== undefined && maxLength > 0 ? maxLength : null;
  const room = limit === null ? inserted.length : limit - (glyphs.length - (end - start));
  const kept = room >= inserted.length ? inserted : inserted.slice(0, Math.max(0, room));
  const next = [...glyphs.slice(0, start), ...kept, ...glyphs.slice(end)];
  return { text: next.join(""), selection: caretAt(start + kept.length) };
}

/**
 * Backspace / Delete. With a selection, either key deletes it and nothing else —
 * the direction only decides which side a bare caret eats.
 */
function remove(text: string, selection: Selection, forward: boolean): Edit {
  const glyphs = chars(text);
  const { start, end } = span(selection, glyphs.length);
  if (start !== end) {
    return {
      text: [...glyphs.slice(0, start), ...glyphs.slice(end)].join(""),
      selection: caretAt(start),
    };
  }
  const from = forward ? start : start - 1;
  const to = forward ? start + 1 : start;
  if (from < 0 || to > glyphs.length) return { text, selection: caretAt(start) };
  return {
    text: [...glyphs.slice(0, from), ...glyphs.slice(to)].join(""),
    selection: caretAt(from),
  };
}

/** Where a caret movement lands. `extend` is the shift key: it drags `focus` alone. */
interface Move {
  selection: Selection;
  /**
   * True when the movement had nowhere to go — the caret was already against that
   * end with nothing selected. It is what lets the arrow keys fall through to
   * spatial navigation at the edges instead of trapping the player in the field
   * (decision 2026-08-11, ZAB-26).
   */
  atBoundary: boolean;
}

/**
 * One arrow-key step, `direction` being -1 (left) or +1 (right).
 *
 * Without shift, a collapsed selection moves one character and a non-empty one
 * COLLAPSES to the edge it was pushed against — it does not also step, which is what
 * makes "select a word, press left, keep typing" behave.
 */
function moveCaret(text: string, selection: Selection, direction: number, extend: boolean): Move {
  const max = length(text);
  const ordered = span(selection, max);
  if (!extend && ordered.start !== ordered.end) {
    return { selection: caretAt(direction < 0 ? ordered.start : ordered.end), atBoundary: false };
  }
  const from = clampIndex(selection.focus, max);
  const to = clampIndex(from + (direction < 0 ? -1 : 1), max);
  const atBoundary = to === from && ordered.start === ordered.end;
  return { selection: place(selection, to, extend), atBoundary };
}

/** Home / End (and what Escape-less gamepad navigation would need): jump to an edge. */
function moveToEdge(text: string, selection: Selection, end: boolean, extend: boolean): Move {
  const max = length(text);
  const to = end ? max : 0;
  const atBoundary = clampIndex(selection.focus, max) === to && !hasSelection(selection);
  return { selection: place(selection, to, extend), atBoundary };
}

/** Select everything (Ctrl/Cmd+A), anchored at the start so shift+left shrinks it. */
function selectAll(text: string): Selection {
  return { anchor: 0, focus: length(text) };
}

/**
 * Distance from the start of the run to the seam BEFORE character `index`, kerning
 * included — the same width the paint loop accumulates, so the caret lands on the
 * boundary the player sees.
 */
function caretX(text: string, index: number, metrics: TextMetrics): number {
  return caretXOf(chars(text), index, metrics);
}

/**
 * The same measurement over code points that are already split (ZAB-73). The
 * caret, the selection highlight and the field's own scroll all want it in the
 * same frame, and splitting the buffer once per question made a focused field
 * allocate six or eight arrays a frame for one string that had not changed. The
 * renderer caches the split per node (`FieldEditor.charsOf`); this is the entry
 * point that lets it.
 */
function caretXOf(glyphs: readonly string[], index: number, metrics: TextMetrics): number {
  const upto = clampIndex(index, glyphs.length);
  let x = 0;
  for (let i = 0; i < upto; i++) {
    if (i > 0) x += metrics.kern(glyphs[i - 1], glyphs[i]);
    x += metrics.advance(glyphs[i]);
  }
  return x;
}

/**
 * The caret position a pointer at `x` (relative to the start of the run) selects:
 * the nearest seam, so clicking on the left half of a character puts the caret
 * before it and on the right half after it — the behavior every text field has, and
 * the one that makes a drag select what it looks like it selects.
 */
function indexAtX(text: string, x: number, metrics: TextMetrics): number {
  return indexAtXOf(chars(text), x, metrics);
}

/** `indexAtX` over code points that are already split — see `caretXOf`. */
function indexAtXOf(glyphs: readonly string[], x: number, metrics: TextMetrics): number {
  let left = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const step = (i > 0 ? metrics.kern(glyphs[i - 1], glyphs[i]) : 0) + metrics.advance(glyphs[i]);
    const right = left + step;
    if (x < left + step / 2) return i;
    left = right;
  }
  return glyphs.length;
}

/**
 * The horizontal scroll of the content after a change: the smallest move that brings
 * the caret back inside the viewport, and never more than the content overflows.
 *
 * Minimal on purpose — the field must not re-centre on every keystroke — and it
 * always keeps the run anchored to the left when it fits, so a short text does not
 * float in a wide box.
 */
function scrollFor(
  scroll: number,
  caret: number,
  viewWidth: number,
  contentWidth: number,
  /** Width of the caret itself: it has to fit at the very end of a full field. */
  caretWidth = 1,
): number {
  const max = Math.max(0, contentWidth + caretWidth - viewWidth);
  let next = Math.min(scroll, max);
  if (caret - next > viewWidth - caretWidth) next = caret - viewWidth + caretWidth;
  if (caret < next) next = caret;
  return Math.min(max, Math.max(0, next));
}

/**
 * The caret's on/off phase of the blink. A closed-form function of the time since
 * the last edit, like `spinnerPulse`, so the caret is not a timer the SDK has to
 * keep: it is on for the first half of every period, and every edit restarts the
 * cycle from ON — a caret that blinks off exactly as you type reads as a dropped
 * keystroke.
 */
function caretVisible(elapsed: number, period: number): boolean {
  if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(elapsed)) return true;
  const phase = elapsed % period;
  return (phase < 0 ? phase + period : phase) < period / 2;
}

/**
 * A newline is not a character this field can hold; a tab is not one it can insert.
 * Exported because the web renderer also mirrors a hidden `<textarea>` back into the
 * model, and that path has to fold text the same way this one does.
 */
function sanitizeLine(input: string): string {
  return input.replace(/[\r\n\t]+/g, " ");
}

/**
 * The two conversions the browser's own text field forces on us: it counts UTF-16
 * units and this model counts code points, so an emoji before the caret makes the
 * two disagree by one. Everywhere else in the renderer, indices are code points.
 */
function codePointIndex(text: string, utf16: number): number {
  return chars(text.slice(0, Math.max(0, utf16))).length;
}

function utf16Offset(text: string, index: number): number {
  return chars(text)
    .slice(0, clampIndex(index, length(text)))
    .join("").length;
}

function place(selection: Selection, index: number, extend: boolean): Selection {
  return extend ? { anchor: selection.anchor, focus: index } : caretAt(index);
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(index)));
}

export type { Edit, Move, Selection, Span };
export {
  caretAt,
  caretVisible,
  caretX,
  caretXOf,
  chars,
  clampSelection,
  codePointIndex,
  hasSelection,
  indexAtX,
  indexAtXOf,
  insert,
  length,
  moveCaret,
  moveToEdge,
  remove,
  sanitizeLine,
  scrollFor,
  selectAll,
  selectedText,
  span,
  utf16Offset,
};
