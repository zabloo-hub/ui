/**
 * Serializable metrics of ONE rendered frame — the golden harness's unit of
 * comparison (ZAB-48) and, from ZAB-38 on, the cross-target contract: the same
 * envelope loaded in Unity must produce this same document.
 *
 * It answers the questions a renderer can be wrong about in ways a screenshot
 * would not explain: where every rect landed, where the text broke and on which
 * baselines it sits, what is in layout and what left it, which region clips what,
 * in what order the overlay layer paints, and where the focus/hover/press ended
 * up. Pixels are deliberately absent — they belong to the golden IMAGES of
 * ZAB-38, which need a GPU; everything here runs in CI on a bare CPU.
 *
 * Three rules keep a diff readable, and they are why this is a module and not an
 * inline `JSON.stringify` in the tests:
 *
 * 1. **Stable order.** Keys are written in a fixed order, never
 *    insertion-dependent, so a re-render of an unchanged tree is byte-identical.
 * 2. **Absent means default.** A field only appears when it says something — an
 *    unfocused node carries no `states`, an unclipped one no `clip`. What shows
 *    up in a diff is what changed, not the noise around it.
 * 3. **Rounded once, here.** Floats are quantized to `precision` decimals so the
 *    last bits of an FMA never rewrite a golden file (and so Unity, whose text
 *    metrics are computed by the same stb code but not by the same FPU, can
 *    compare against these very numbers).
 */

import type { Clip } from "./clip.js";
import { childClip, type NodeRadius } from "./hit.js";
import { inLayout, type LayoutNode, type Rect } from "./layout.js";
import type { Color } from "./tessellator.js";
import type { PlacedLine } from "./text.js";

/** Decimals kept on every number of a snapshot. */
export const DEFAULT_PRECISION = 3;

/** Path of the view's root. Not a valid id, so it can never collide with one. */
const ROOT_PATH = "$root";

export interface RectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipSnapshot extends RectSnapshot {
  radius: number;
}

/** One line of a `Text`, as this frame broke and placed it. */
export interface LineSnapshot {
  text: string;
  /** Painted width — trailing spaces excluded, kerning included. */
  width: number;
  /** Left edge of the run, after `textAlign`. */
  x: number;
  /** The line's baseline in view space — where the glyphs actually sit. */
  baseline: number;
}

export interface TextSnapshot {
  lines: LineSnapshot[];
  /** Distance between the tops of two consecutive lines. */
  lineHeight: number;
  /** True when the wrap dropped lines (`maxLines`) or glyphs (`overflow`). */
  truncated: boolean;
}

/** A `Text`'s placement this frame, as the paint pass computed it. */
export interface PlacedText {
  lines: readonly PlacedLine[];
  /** Top of a line box to its baseline — what turns a placed `y` into a baseline. */
  ascent: number;
}

/** Why a node is out of layout — both mechanisms have `display:none` semantics. */
export type OutReason = "visible" | "section";

export interface NodeSnapshot {
  type: string;
  /** The node's `id`, or its positional path from the root (`"0.2.1"`). */
  ref: string;
  /** Present ONLY when the node is out of layout; everything else is then omitted. */
  out?: OutReason;
  rect?: RectSnapshot;
  /**
   * The size the measure pass asked for, when the arrange pass gave it another
   * one — a stretched or grown child. Silent when they agree.
   */
  measured?: { x: number; y: number };
  /** Active runtime states, in the format's normative merge order. */
  states?: string[];
  /** Resolved paint inputs — tokens collapsed, transitions applied. */
  style?: Record<string, string | number>;
  text?: TextSnapshot;
  /** The region this node's own rect is cut by. Absent = unclipped. */
  clip?: ClipSnapshot;
  /** ScrollView: the runtime offset and how far it may go. */
  scroll?: { x: number; y: number; maxX: number; maxY: number };
  /** Slider (`value`), ProgressBar (`progress`) and Toggle (`checkedProgress`). */
  value?: number;
  /** TextInput: the buffer, and the caret/selection over it. */
  field?: { text: string; anchor: number; focus: number; scroll: number };
  /** Repeat: the realized window, when it is virtualized. */
  window?: { first: number; count: number; perLine: number; lead: number; reserved: number };
  children?: NodeSnapshot[];
}

/** One entry of the overlay layer, in paint order. */
export interface LayerSnapshot {
  ref: string;
  z: number;
  modal: boolean;
  /** Enter/exit fade, 0..1 — below 1 the entry is on its way in or out. */
  presence: number;
  rect: RectSnapshot;
}

export interface ViewSnapshot {
  view: string;
  size: { width: number; height: number };
  /** Refs of the nodes holding each pointer/keyboard state, or null. */
  focus: string | null;
  hover: string | null;
  pressed: string | null;
  /** Overlays in `(z, document order)`, bottom-most first. */
  layer: LayerSnapshot[];
  tree: NodeSnapshot;
}

export interface SnapshotInput {
  view: string;
  size: { width: number; height: number };
  root: LayoutNode;
  /** The layer as it PAINTED, exiting entries included, with each one's fade. */
  layer: ReadonlyArray<{ node: LayoutNode; presence: number }>;
  focused: LayoutNode | null;
  hovered: LayoutNode | null;
  pressed: LayoutNode | null;
  /** The view's own corner-radius resolution — the clips are computed with it. */
  radiusOf: NodeRadius;
  /** This frame's placed lines for a `Text`, or null for every other node. */
  textOf: (node: LayoutNode) => PlacedText | null;
  precision?: number;
}

/**
 * The states a node can carry, in the merge order the format declares normative
 * (`base → empty → selected → checked → hover → focused → pressed`). Listing them
 * in that order means a diff of two snapshots compares the same positions.
 */
const STATES: ReadonlyArray<{ name: string; of: (node: LayoutNode) => boolean }> = [
  { name: "empty", of: (node) => node.ir.type === "TextInput" && node.empty },
  { name: "selected", of: (node) => node.selected },
  { name: "checked", of: (node) => node.checked },
  { name: "open", of: (node) => node.ir.type === "Collapse" && node.open },
  { name: "hover", of: (node) => node.hovered },
  { name: "focused", of: (node) => node.focused },
  { name: "pressed", of: (node) => node.pressed },
  // The EFFECTIVE flag, inherited included: what a second target has to reproduce
  // is which nodes are out of the interaction model, not which ones declared it.
  { name: "disabled", of: (node) => node.disabled },
];

/** Resolved values worth recording, in a fixed order. Colors serialize as hex. */
const STYLE_KEYS = [
  "background",
  "color",
  "borderColor",
  "borderWidth",
  "radius",
  "opacity",
  "padding",
  "gap",
] as const;

export function snapshotView(input: SnapshotInput): ViewSnapshot {
  const precision = input.precision ?? DEFAULT_PRECISION;
  const refs = refMap(input.root);
  const ctx: Context = { refs, precision, radiusOf: input.radiusOf, textOf: input.textOf };

  return {
    view: input.view,
    size: {
      width: round(input.size.width, precision),
      height: round(input.size.height, precision),
    },
    focus: refOf(refs, input.focused),
    hover: refOf(refs, input.hovered),
    pressed: refOf(refs, input.pressed),
    layer: input.layer.map((entry) => ({
      ref: refs.get(entry.node) ?? "?",
      z: numberOr((entry.node.ir as { z?: unknown }).z, 0),
      modal: (entry.node.ir as { modal?: unknown }).modal !== false,
      presence: round(entry.presence, precision),
      rect: rectOf(entry.node.rect, precision),
    })),
    tree: snapshotNode(input.root, null, ctx),
  };
}

interface Context {
  refs: Map<LayoutNode, string>;
  precision: number;
  radiusOf: NodeRadius;
  textOf: (node: LayoutNode) => PlacedText | null;
}

/**
 * A node and its subtree under `inherited` (the clip its own rect is subject to).
 * An out-of-layout node stops the walk: its rect, its style and its children are
 * whatever the last frame that DID lay it out left behind, and recording stale
 * numbers would be a lie about a node that is not on screen.
 */
function snapshotNode(node: LayoutNode, inherited: Clip | null, ctx: Context): NodeSnapshot {
  const ref = ctx.refs.get(node) ?? "?";
  if (!inLayout(node)) {
    return { type: node.ir.type, ref, out: node.visibleFlag ? "section" : "visible" };
  }

  // An Overlay is a paint root laid out against the view rect: the clips of
  // wherever it was DECLARED never apply to it (the same boundary `effectiveClip`
  // and the paint pass draw), so the region restarts here.
  const cut = node.ir.type === "Overlay" ? null : inherited;

  const { precision } = ctx;
  const snapshot: NodeSnapshot = { type: node.ir.type, ref, rect: rectOf(node.rect, precision) };

  if (
    !close(node.measured.x, node.rect.width, precision) ||
    !close(node.measured.y, node.rect.height, precision)
  ) {
    snapshot.measured = {
      x: round(node.measured.x, precision),
      y: round(node.measured.y, precision),
    };
  }

  const states = STATES.filter((state) => state.of(node)).map((state) => state.name);
  if (states.length > 0) snapshot.states = states;

  const style = styleOf(node, precision);
  if (style) snapshot.style = style;

  const text = textOf(node, ctx);
  if (text) snapshot.text = text;

  if (cut) snapshot.clip = clipOf(cut, precision);

  if (node.ir.type === "ScrollView") {
    snapshot.scroll = {
      x: round(node.scrollOffset.x, precision),
      y: round(node.scrollOffset.y, precision),
      maxX: round(node.scrollMax.x, precision),
      maxY: round(node.scrollMax.y, precision),
    };
  }

  const value = controlValue(node);
  if (value !== null) snapshot.value = round(value, precision);

  if (node.ir.type === "TextInput") {
    snapshot.field = {
      text: node.text,
      anchor: node.selection.anchor,
      focus: node.selection.focus,
      scroll: round(node.textScroll, precision),
    };
  }

  if (node.virtual) {
    snapshot.window = {
      first: node.virtual.first,
      count: node.virtual.count,
      perLine: node.virtual.perLine,
      lead: round(node.virtual.lead, precision),
      reserved: round(node.virtual.reserved, precision),
    };
  }

  if (node.children.length > 0) {
    // The clip a child inherits, computed exactly as paint and hit-testing do.
    const inner = childClip(node, cut, ctx.radiusOf);
    snapshot.children = node.children.map((child) => snapshotNode(child, inner, ctx));
  }
  return snapshot;
}

/** The one number a control's behavior owns, when it has one. */
function controlValue(node: LayoutNode): number | null {
  if (node.ir.type === "Slider") return node.sliderDisplay;
  if (node.ir.type === "ProgressBar") return node.progress;
  if (node.ir.type === "Toggle") return node.checkedProgress;
  return null;
}

function styleOf(node: LayoutNode, precision: number): Record<string, string | number> | undefined {
  const values = node.resolved as Record<string, unknown>;
  const style: Record<string, string | number> = {};
  for (const key of STYLE_KEYS) {
    const value = values[key];
    if (value === undefined) continue;
    if (typeof value === "number") {
      // A zero border, a zero radius and a full opacity are the defaults every
      // node resolves to — recording them would bury the ones that mean something.
      if (value === 0 && key !== "opacity") continue;
      if (value === 1 && key === "opacity") continue;
      style[key] = round(value, precision);
    } else if (Array.isArray(value)) {
      style[key] = hex(value as Color);
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function textOf(node: LayoutNode, ctx: Context): TextSnapshot | undefined {
  const block = node.textBlock;
  if (node.ir.type !== "Text" || !block) return undefined;
  const placed = ctx.textOf(node);
  const { precision } = ctx;
  return {
    lines: block.lines.map((line, i) => {
      const at = placed?.lines[i];
      return {
        text: line.text,
        width: round(line.width, precision),
        x: round(at?.x ?? 0, precision),
        // The tessellator adds the ascent to the placed top: that sum IS the baseline.
        baseline: round((at?.y ?? 0) + (placed?.ascent ?? 0), precision),
      };
    }),
    lineHeight: round(block.lineHeight, precision),
    truncated: block.truncated,
  };
}

/**
 * A stable address for every node of the tree: its `id` when it has one, and its
 * positional path (`"0.2.1"`) when it does not — so a snapshot can point at a
 * node the author never named, and two runs agree on the name.
 *
 * An id shared by several nodes addresses NONE of them: every instance a
 * `Repeat` builds carries the id its template declared, so an id is unique in
 * the document but not in the tree the view expands from it. All of them fall
 * back to their path, which keeps one ref pointing at one node — a rule that has
 * to hold on both sides of the cross-target comparison.
 */
function refMap(root: LayoutNode): Map<LayoutNode, string> {
  const counts = new Map<string, number>();
  const paths = new Map<LayoutNode, string>();
  const walk = (node: LayoutNode, path: string): void => {
    paths.set(node, path);
    const id = node.ir.id;
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
    node.children.forEach((child, i) => {
      walk(child, path === ROOT_PATH ? String(i) : `${path}.${i}`);
    });
  };
  walk(root, ROOT_PATH);

  const refs = new Map<LayoutNode, string>();
  for (const [node, path] of paths) {
    const id = node.ir.id;
    refs.set(node, id !== undefined && counts.get(id) === 1 ? id : path);
  }
  return refs;
}

function refOf(refs: Map<LayoutNode, string>, node: LayoutNode | null): string | null {
  return node ? (refs.get(node) ?? "?") : null;
}

function rectOf(rect: Rect, precision: number): RectSnapshot {
  return {
    x: round(rect.x, precision),
    y: round(rect.y, precision),
    width: round(rect.width, precision),
    height: round(rect.height, precision),
  };
}

function clipOf(clip: Clip, precision: number): ClipSnapshot {
  return { ...rectOf(clip, precision), radius: round(clip.radius, precision) };
}

/** `#rrggbb`, or `#rrggbbaa` when the color is not fully opaque. */
export function hex(color: Color): string {
  const [r, g, b, a] = color;
  const channel = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  const rgb = `#${channel(r)}${channel(g)}${channel(b)}`;
  return a >= 1 ? rgb : `${rgb}${channel(a)}`;
}

/**
 * Quantizes to `precision` decimals. `-0` normalizes to `0` (`JSON.stringify`
 * writes it as `0` anyway, but a `toEqual` would tell them apart) and non-finite
 * values pass through, since hiding a `NaN` is the opposite of what a regression
 * net is for.
 */
export function round(value: number, precision = DEFAULT_PRECISION): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function close(a: number, b: number, precision: number): boolean {
  return round(a, precision) === round(b, precision);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The snapshot as the bytes that land in a golden file: keys in the order this
 * module writes them (never sorted — the reading order of a tree is the order it
 * was built in), two-space indent, trailing newline.
 */
export function serializeSnapshot(snapshot: ViewSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Nodes of a snapshot, depth-first — what an assertion looks a node up in. */
export function walkSnapshot(node: NodeSnapshot, visit: (node: NodeSnapshot) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkSnapshot(child, visit);
}

/**
 * The node with this ref, or null — how a `ViewSnapshot` is actually read: the
 * rect, the wrap points or the states of ONE node, addressed by the `id` it was
 * authored with (the golden assertions, an overlay canvas drawing on top of the
 * view, a test driving a control).
 */
export function findNode(snapshot: ViewSnapshot, ref: string): NodeSnapshot | null {
  let found: NodeSnapshot | null = null;
  walkSnapshot(snapshot.tree, (node) => {
    if (node.ref === ref) found = node;
  });
  return found;
}

/** Every node type the snapshot contains — the dispatch coverage check reads this. */
export function typesIn(snapshot: ViewSnapshot): Set<string> {
  const types = new Set<string>();
  walkSnapshot(snapshot.tree, (node) => types.add(node.type));
  return types;
}
