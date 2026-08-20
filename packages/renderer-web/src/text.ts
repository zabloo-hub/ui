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
function widthOf(text: string, metrics: TextMetrics): number {
  let width = 0;
  let previous = "";
  for (const char of text) {
    if (previous !== "") width += metrics.kern(previous, char);
    width += metrics.advance(char);
    previous = char;
  }
  return width;
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
  let width = 0;
  let previous = "";
  for (const char of text) {
    if (previous !== "") width += metrics.kern(previous, char);
    width += metrics.advance(char);
    previous = char;
    if (width > limit) return null;
  }
  return width;
}

/** Last code point of a string — the left half of the kerning pair at a junction. */
function lastChar(text: string): string {
  return Array.from(text).at(-1) ?? "";
}

/** Trailing spaces do not paint and do not count — a line's width ends at its last word. */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && isBreakSpace(text[end - 1])) end--;
  return text.slice(0, end);
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
  let truncated = dropped;
  const last = lines.length - 1;
  for (let i = 0; i <= last; i++) {
    const tooWide = canCut && lines[i].width > limit;
    if (tooWide) truncated = true;
    if (options.overflow === "ellipsis" && (tooWide || (dropped && i === last))) {
      lines[i] = ellipsize(lines[i].text, metrics, limit);
    } else if (tooWide) {
      lines[i] = clipLine(lines[i].text, metrics, limit as number);
    }
  }

  let width = 0;
  for (const line of lines) width = Math.max(width, line.width);
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
  let line = "";
  let lineWidth = 0;
  let lineLast = ""; // left half of the kerning pair at the next junction

  let i = 0;
  while (i < chars.length) {
    if (budget !== null && out.length >= budget) return;
    // A segment is a run of spaces plus the word that follows it.
    let spaces = "";
    while (i < chars.length && isBreakSpace(chars[i])) {
      spaces += chars[i];
      i++;
    }
    let word = "";
    while (i < chars.length && !isBreakSpace(chars[i])) {
      word += chars[i];
      i++;
    }
    if (word === "") break; // trailing spaces: they neither paint nor break

    const segment = spaces + word;
    // Measured only as far as it takes to know it does NOT fit (ZAB-69): a token
    // wider than the whole column is about to be broken glyph by glyph anyway,
    // and measuring all 50k of it first is the other half of the quadratic.
    const segmentWidth = widthUpTo(segment, metrics, limit);

    if (line === "") {
      if (segmentWidth === null) {
        [line, lineWidth] = breakWord(segment, metrics, limit, out, budget);
      } else {
        // Spaces that START a line are indentation: they paint, so they count.
        line = segment;
        lineWidth = segmentWidth;
      }
    } else if (
      segmentWidth !== null &&
      lineWidth + metrics.kern(lineLast, segment[0]) + segmentWidth <= limit
    ) {
      lineWidth += metrics.kern(lineLast, segment[0]) + segmentWidth;
      line += segment;
    } else {
      // Break here: the line ends, and with it go the spaces at the break and the
      // kerning pair that straddled it.
      out.push({ text: line, width: lineWidth });
      const wordWidth = widthUpTo(word, metrics, limit);
      if (wordWidth === null) {
        [line, lineWidth] = breakWord(word, metrics, limit, out, budget);
      } else {
        line = word;
        lineWidth = wordWidth;
      }
    }
    lineLast = lastChar(line);
  }

  // Past the budget the line in hand is one nobody will paint — and, when a long
  // word ran out of budget mid-break, one whose width was never measured.
  if (budget !== null && out.length >= budget) return;
  // An empty paragraph still owns a line, so a blank line takes vertical space.
  if (line !== "" || out.length === start) out.push({ text: line, width: lineWidth });
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
  let i = 0;
  while (i < chars.length) {
    let width = 0;
    let previous = "";
    let end = i;
    while (end < chars.length) {
      const char = chars[end];
      const step = (previous === "" ? 0 : metrics.kern(previous, char)) + metrics.advance(char);
      if (end > i && width + step > limit) break;
      width += step;
      previous = char;
      end++;
    }
    // Everything left fits: it is the caller's line, not another full one.
    if (end === chars.length) return [chars.slice(i).join(""), width];
    out.push({ text: chars.slice(i, end).join(""), width });
    i = end;
    // Out of budget: the rest is unpaintable, so it is never measured. The
    // caller drops the line it gets back rather than pushing it.
    if (budget !== null && out.length >= budget) break;
  }
  return [chars.slice(i).join(""), 0];
}

/** Longest prefix that fits: the glyph that would cross the boundary is dropped. */
function clipLine(text: string, metrics: TextMetrics, limit: number): TextLine {
  let kept = "";
  let width = 0;
  let previous = "";
  for (const char of text) {
    const step = (previous === "" ? 0 : metrics.kern(previous, char)) + metrics.advance(char);
    if (width + step > limit) break;
    kept += char;
    width += step;
    previous = char;
  }
  return lineOf(kept, metrics);
}

/**
 * Ends the line with `…`, dropping glyphs (and the trailing spaces they uncover)
 * until the mark fits. The mark always survives — it is the whole signal — even on a
 * limit too narrow for it.
 */
function ellipsize(text: string, metrics: TextMetrics, limit: number | null): TextLine {
  if (limit === null) return lineOf(`${trimEnd(text)}${ELLIPSIS}`, metrics);

  const markAdvance = metrics.advance(ELLIPSIS);
  let kept = "";
  let width = 0;
  let previous = "";
  for (const char of text) {
    const step = (previous === "" ? 0 : metrics.kern(previous, char)) + metrics.advance(char);
    // The mark kerns against whatever ends up in front of it, so the room it
    // needs is measured against THIS glyph, not against the one before it.
    if (width + step + metrics.kern(char, ELLIPSIS) + markAdvance > limit) break;
    kept += char;
    width += step;
    previous = char;
  }
  // Trimming can only shorten it, so the marked line still fits — and measuring the
  // final string once is what guarantees it is exactly the run the tessellator paints.
  return lineOf(`${trimEnd(kept)}${ELLIPSIS}`, metrics);
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
