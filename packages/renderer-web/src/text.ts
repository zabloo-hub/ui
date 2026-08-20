/**
 * Multiline text layout — the normative algorithm of the `Text` spec (decision
 * 2026-08-11, ZAB-17): word wrap to the available width, hard breaks, long-word
 * breaking, `maxLines` truncation with `clip`/`ellipsis`, and the placement of the
 * resulting lines inside a rect (`textAlign`/`textAlignY`/`lineHeight`).
 *
 * It is deliberately free of both the canvas and the IR: it takes the font metrics
 * it needs through `TextMetrics` and plain options, so the break points are a pure
 * function of (text, advances, width) — which is the whole point. Unity ports THIS
 * file, and the same envelope must break in the same places on both targets.
 */

import type { TextAlign, TextOverflow } from "@zabloo/format";
import type { Rect } from "./layout.js";

/** The truncation mark (U+2026), a single glyph rather than three dots. */
const ELLIPSIS = "…";

/** Everything the algorithm needs from a font, in logical px. */
interface TextMetrics {
  /** Horizontal advance of one character. */
  advance(char: string): number;
  /**
   * Kerning between two consecutive characters (0 when the font has none). Every
   * width here includes it, exactly as the tessellator's paint loop does — a line
   * measured without kerning would not be the line that gets painted.
   */
  kern(previous: string, char: string): number;
  /** The font's natural line advance (ascent + descent). */
  readonly lineHeight: number;
  /** Distance from the top of a line box to its baseline. */
  readonly ascent: number;
}

interface TextLayoutOptions {
  /** Word wrap to `maxWidth`. */
  wrap: boolean;
  /** Width to wrap and cut to. `null` (or <= 0) means unconstrained. */
  maxWidth: number | null;
  /** Resolved line advance: `style.lineHeight` or the font's own. */
  lineHeight: number;
  /** Line cap, or `null` for unbounded. */
  maxLines: number | null;
  overflow: TextOverflow;
}

interface TextLine {
  text: string;
  /** Painted width — trailing spaces excluded. */
  width: number;
}

interface TextBlock {
  lines: TextLine[];
  /** The widest line. */
  width: number;
  /** `lines.length * lineHeight`. */
  height: number;
  /** The `lineHeight` used, so placement does not have to resolve it again. */
  lineHeight: number;
  /** True when something was dropped (lines past `maxLines`, or glyphs past the width). */
  truncated: boolean;
}

/** A line ready to paint: the run's top-left, half-leading already applied. */
interface PlacedLine {
  text: string;
  x: number;
  y: number;
}

/**
 * Break opportunities are SPACE and TAB only — never ` ` (a non-breaking space
 * has to hold) nor the whole `\s` class, which would also break on the newlines that
 * hard-break handling already consumed.
 */
function isBreakSpace(char: string): boolean {
  return char === " " || char === "\t";
}

/**
 * Width of a run, kerning included — the pairs of a run that is painted as ONE
 * line, which is why a break has to end the chain: the pair straddling it never
 * applies, on either side of the measurement.
 */
/** What `char` adds after `previous` ("" at the start of a run): kern + advance. */
function stepOf(previous: string, char: string, metrics: TextMetrics): number {
  return (previous === "" ? 0 : metrics.kern(previous, char)) + metrics.advance(char);
}

function widthOf(text: string, metrics: TextMetrics): number {
  // A slot per CALL, not per character: the running width and the left half of
  // the next kerning pair are what the walk carries, and this is the measure
  // pass — an object per glyph is exactly what it must not make.
  const run = { width: 0, previous: "" };
  for (const char of text) {
    run.width += stepOf(run.previous, char, metrics);
    run.previous = char;
  }
  return run.width;
}

/**
 * `widthOf`, abandoned as soon as the run passes `limit` — `null` then. Same sum,
 * in the same order, whenever it does return a number, so a segment that fits is
 * measured exactly as it always was; a segment that does not is not measured to
 * the end, because the only thing anyone asks of it is whether it fits.
 *
 * Like the rest of the wrap, it takes a glyph to be unable to make a run
 * narrower (see `breakWord`).
 */
function widthUpTo(text: string, metrics: TextMetrics, limit: number): number | null {
  const run = { width: 0, previous: "" };
  for (const char of text) {
    run.width += stepOf(run.previous, char, metrics);
    run.previous = char;
    if (run.width > limit) return null;
  }
  return run.width;
}

/** Last code point of a string — the left half of the kerning pair at a junction. */
function lastChar(text: string): string {
  return Array.from(text).at(-1) ?? "";
}

/** Trailing spaces do not paint and do not count — a line's width ends at its last word. */
function trimEnd(text: string): string {
  const cut = { at: text.length };
  while (cut.at > 0 && isBreakSpace(text[cut.at - 1])) cut.at--;
  return text.slice(0, cut.at);
}

function lineOf(text: string, metrics: TextMetrics): TextLine {
  const trimmed = trimEnd(text);
  return { text: trimmed, width: widthOf(trimmed, metrics) };
}

/**
 * Lays out `content` into lines. The result is the node's intrinsic size (`width` ×
 * `height`) as far as the flexbox is concerned, and the input of `placeLines`.
 */
function layoutText(content: string, metrics: TextMetrics, options: TextLayoutOptions): TextBlock {
  const limit = options.maxWidth !== null && options.maxWidth > 0 ? options.maxWidth : null;
  const lines: TextLine[] = [];
  const maxLines = options.maxLines;
  /**
   * Where laying out stops (ZAB-69). ONE line past the cap, not the cap itself:
   * that extra line is what tells `dropped` something was left behind, and it
   * is the only thing beyond the cap anyone needs to know. Without it a capped
   * `Text` still wrapped its whole content — every line of a 50k-char paragraph
   * measured — only to throw all but the first `maxLines` away.
   */
  const budget = maxLines !== null ? Math.max(1, maxLines) + 1 : null;

  // Hard breaks first: they are honored whatever the width is.
  for (const paragraph of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (budget !== null && lines.length >= budget) break;
    if (options.wrap && limit !== null) wrapParagraph(paragraph, metrics, limit, lines, budget);
    else lines.push(lineOf(paragraph, metrics));
  }

  const dropped = maxLines !== null && lines.length > maxLines;
  if (dropped) lines.length = Math.max(1, maxLines as number);

  // Then the horizontal cut — `wrap: false` only, plus the ellipsis that marks the
  // dropped lines. A wrapped line that is still too wide is a single glyph wider
  // than the line: the minimum-one-glyph rule wins, or the text would vanish.
  const canCut = !options.wrap && limit !== null;
  const last = lines.length - 1;
  const wide = lines.map((line) => canCut && line.width > limit);
  for (const [i, tooWide] of wide.entries()) {
    if (options.overflow === "ellipsis" && (tooWide || (dropped && i === last))) {
      lines[i] = ellipsize(lines[i].text, metrics, limit);
    } else if (tooWide) {
      lines[i] = clipLine(lines[i].text, metrics, limit as number);
    }
  }
  const truncated = dropped || wide.includes(true);

  const width = lines.reduce((widest, line) => Math.max(widest, line.width), 0);
  return {
    lines,
    width,
    height: lines.length * options.lineHeight,
    lineHeight: options.lineHeight,
    truncated,
  };
}

/**
 * Greedy first-fit wrap of one hard-break-free paragraph, appended to `out`.
 * `budget`, when set, is the total number of lines `out` is allowed to reach:
 * past it nothing is measured, since nothing past it can be painted.
 */
function wrapParagraph(
  paragraph: string,
  metrics: TextMetrics,
  limit: number,
  out: TextLine[],
  budget: number | null,
): void {
  const chars = Array.from(paragraph);
  const start = out.length;
  // The line being built, and where the scan has got to. Slots, because a greedy
  // wrap IS a fold whose state is three values wide; `last` is the left half of
  // the kerning pair at the next junction.
  const current = { line: "", width: 0, last: "" };
  const scan = { at: 0 };

  while (scan.at < chars.length) {
    if (budget !== null && out.length >= budget) return;
    // A segment is a run of spaces plus the word that follows it. Scanned by
    // index rather than sliced: a paragraph is walked once, start to end.
    const spacesFrom = scan.at;
    while (scan.at < chars.length && isBreakSpace(chars[scan.at])) scan.at++;
    const spaces = chars.slice(spacesFrom, scan.at).join("");

    const wordFrom = scan.at;
    while (scan.at < chars.length && !isBreakSpace(chars[scan.at])) scan.at++;
    const word = chars.slice(wordFrom, scan.at).join("");
    if (word === "") break; // trailing spaces: they neither paint nor break

    const segment = spaces + word;
    // Measured only as far as it takes to know it does NOT fit (ZAB-69): a token
    // wider than the whole column is about to be broken glyph by glyph anyway,
    // and measuring all 50k of it first is the other half of the quadratic.
    const segmentWidth = widthUpTo(segment, metrics, limit);

    if (current.line === "") {
      if (segmentWidth === null) {
        [current.line, current.width] = breakWord(segment, metrics, limit, out, budget);
      } else {
        // Spaces that START a line are indentation: they paint, so they count.
        current.line = segment;
        current.width = segmentWidth;
      }
    } else if (
      segmentWidth !== null &&
      current.width + metrics.kern(current.last, segment[0]) + segmentWidth <= limit
    ) {
      current.width += metrics.kern(current.last, segment[0]) + segmentWidth;
      current.line += segment;
    } else {
      // Break here: the line ends, and with it go the spaces at the break and the
      // kerning pair that straddled it.
      out.push({ text: current.line, width: current.width });
      const wordWidth = widthUpTo(word, metrics, limit);
      if (wordWidth === null) {
        [current.line, current.width] = breakWord(word, metrics, limit, out, budget);
      } else {
        current.line = word;
        current.width = wordWidth;
      }
    }
    current.last = lastChar(current.line);
  }

  // Past the budget the line in hand is one nobody will paint — and, when a long
  // word ran out of budget mid-break, one whose width was never measured.
  if (budget !== null && out.length >= budget) return;
  // An empty paragraph still owns a line, so a blank line takes vertical space.
  if (current.line !== "" || out.length === start) {
    out.push({ text: current.line, width: current.width });
  }
}

/**
 * Splits a word too long for a line of its own between glyphs, emitting the full
 * lines and returning the remainder as the caller's current line. At least one glyph
 * per line, so a `limit` narrower than a single glyph still terminates.
 *
 * ONE pass over the word (ZAB-69): each glyph is measured exactly once, in the
 * same order and from the same starting point as before — every emitted width is
 * still a fresh left-to-right sum from its own first glyph, never a subtraction —
 * so the break points and the widths are what they always were. What is gone is
 * the re-measure of the ENTIRE remainder per line, which made a long token
 * quadratic: 50k chars in a narrow column was ~10⁹ metric lookups, each one a
 * call across the WASM boundary.
 *
 * The one thing this reads differently is a font where a glyph can make a run
 * NARROWER (kerning below minus the advance): the old code compared the whole
 * remainder against the limit, this compares the running prefix. Every real font
 * — and `clipLine` and `ellipsize` right below, which have always scanned this
 * way — takes the width of a run to grow with its glyphs.
 */
function breakWord(
  word: string,
  metrics: TextMetrics,
  limit: number,
  out: TextLine[],
  budget: number | null,
): [string, number] {
  const chars = Array.from(word);
  const from = { at: 0 };
  while (from.at < chars.length) {
    const piece = { width: 0, previous: "", end: from.at };
    while (piece.end < chars.length) {
      const char = chars[piece.end];
      const step = stepOf(piece.previous, char, metrics);
      // At least one glyph per line, or the text would vanish.
      if (piece.end > from.at && piece.width + step > limit) break;
      piece.width += step;
      piece.previous = char;
      piece.end++;
    }
    // Everything left fits: it is the caller's line, not another full one.
    if (piece.end === chars.length) return [chars.slice(from.at).join(""), piece.width];
    out.push({ text: chars.slice(from.at, piece.end).join(""), width: piece.width });
    from.at = piece.end;
    // Out of budget: the rest is unpaintable, so it is never measured. The
    // caller drops the line it gets back rather than pushing it.
    if (budget !== null && out.length >= budget) break;
  }
  return [chars.slice(from.at).join(""), 0];
}

/** Longest prefix that fits: the glyph that would cross the boundary is dropped. */
function clipLine(text: string, metrics: TextMetrics, limit: number): TextLine {
  const run = { kept: "", width: 0, previous: "" };
  for (const char of text) {
    const step = stepOf(run.previous, char, metrics);
    if (run.width + step > limit) break;
    run.kept += char;
    run.width += step;
    run.previous = char;
  }
  return lineOf(run.kept, metrics);
}

/**
 * Ends the line with `…`, dropping glyphs (and the trailing spaces they uncover)
 * until the mark fits. The mark always survives — it is the whole signal — even on a
 * limit too narrow for it.
 */
function ellipsize(text: string, metrics: TextMetrics, limit: number | null): TextLine {
  if (limit === null) return lineOf(`${trimEnd(text)}${ELLIPSIS}`, metrics);

  const markAdvance = metrics.advance(ELLIPSIS);
  const run = { kept: "", width: 0, previous: "" };
  for (const char of text) {
    const step = stepOf(run.previous, char, metrics);
    // The mark kerns against whatever ends up in front of it, so the room it
    // needs is measured against THIS glyph, not against the one before it.
    if (run.width + step + metrics.kern(char, ELLIPSIS) + markAdvance > limit) break;
    run.kept += char;
    run.width += step;
    run.previous = char;
  }
  // Trimming can only shorten it, so the marked line still fits — and measuring the
  // final string once is what guarantees it is exactly the run the tessellator paints.
  return lineOf(`${trimEnd(run.kept)}${ELLIPSIS}`, metrics);
}

/** Offset of an inner extent inside an outer one. Never negative: overflow starts at the edge. */
function alignOffset(align: TextAlign, outer: number, inner: number): number {
  const leftover = Math.max(0, outer - inner);
  if (align === "center") return leftover * 0.5;
  if (align === "end") return leftover;
  return 0;
}

/**
 * Places a laid-out block inside `rect` (the node's rect minus its padding). Each
 * `y` is the top-left of the run as the tessellator wants it — it adds the ascent
 * itself — so the half-leading that centers the glyphs in a taller line box is
 * already folded in.
 */
function placeLines(
  block: TextBlock,
  rect: Rect,
  metrics: TextMetrics,
  align: TextAlign,
  alignY: TextAlign,
): PlacedLine[] {
  const halfLeading = (block.lineHeight - metrics.lineHeight) * 0.5;
  const top = rect.y + alignOffset(alignY, rect.height, block.height);
  return block.lines.map((line, i) => ({
    text: line.text,
    x: rect.x + alignOffset(align, rect.width, line.width),
    y: top + i * block.lineHeight + halfLeading,
  }));
}

export type { PlacedLine, TextBlock, TextLayoutOptions, TextLine, TextMetrics };
export { layoutText, placeLines };
