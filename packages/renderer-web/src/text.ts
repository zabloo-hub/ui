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
export interface TextMetrics {
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

export interface TextLayoutOptions {
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

export interface TextLine {
  text: string;
  /** Painted width — trailing spaces excluded. */
  width: number;
}

export interface TextBlock {
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
export interface PlacedLine {
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
export function layoutText(
  content: string,
  metrics: TextMetrics,
  options: TextLayoutOptions,
): TextBlock {
  const limit = options.maxWidth !== null && options.maxWidth > 0 ? options.maxWidth : null;
  const lines: TextLine[] = [];

  // Hard breaks first: they are honored whatever the width is.
  for (const paragraph of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (options.wrap && limit !== null) wrapParagraph(paragraph, metrics, limit, lines);
    else lines.push(lineOf(paragraph, metrics));
  }

  const maxLines = options.maxLines;
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

/** Greedy first-fit wrap of one hard-break-free paragraph, appended to `out`. */
function wrapParagraph(
  paragraph: string,
  metrics: TextMetrics,
  limit: number,
  out: TextLine[],
): void {
  const chars = Array.from(paragraph);
  const start = out.length;
  let line = "";
  let lineWidth = 0;
  let lineLast = ""; // left half of the kerning pair at the next junction

  let i = 0;
  while (i < chars.length) {
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
    const segmentWidth = widthOf(segment, metrics);

    if (line === "") {
      // Spaces that START a line are indentation: they paint, so they count.
      line = segment;
      lineWidth = segmentWidth;
      if (lineWidth > limit) {
        [line, lineWidth] = breakWord(line, metrics, limit, out);
      }
    } else if (lineWidth + metrics.kern(lineLast, segment[0]) + segmentWidth <= limit) {
      lineWidth += metrics.kern(lineLast, segment[0]) + segmentWidth;
      line += segment;
    } else {
      // Break here: the line ends, and with it go the spaces at the break and the
      // kerning pair that straddled it.
      out.push({ text: line, width: lineWidth });
      line = word;
      lineWidth = widthOf(word, metrics);
      if (lineWidth > limit) [line, lineWidth] = breakWord(line, metrics, limit, out);
    }
    lineLast = lastChar(line);
  }

  // An empty paragraph still owns a line, so a blank line takes vertical space.
  if (line !== "" || out.length === start) out.push({ text: line, width: lineWidth });
}

/**
 * Splits a word too long for a line of its own between glyphs, emitting the full
 * lines and returning the remainder as the caller's current line. At least one glyph
 * per line, so a `limit` narrower than a single glyph still terminates.
 */
function breakWord(
  word: string,
  metrics: TextMetrics,
  limit: number,
  out: TextLine[],
): [string, number] {
  let rest = word;
  let restWidth = widthOf(rest, metrics);
  while (restWidth > limit) {
    let taken = "";
    let takenWidth = 0;
    let previous = "";
    for (const char of rest) {
      const step = (previous === "" ? 0 : metrics.kern(previous, char)) + metrics.advance(char);
      if (taken !== "" && takenWidth + step > limit) break;
      taken += char;
      takenWidth += step;
      previous = char;
    }
    out.push({ text: taken, width: takenWidth });
    rest = rest.slice(taken.length);
    // Re-measured, not subtracted: the pair straddling the break is gone now.
    restWidth = widthOf(rest, metrics);
  }
  return [rest, restWidth];
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
export function placeLines(
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
