/**
 * @zabloo/format — the zabloo IR: a versioned, engine-agnostic envelope of views.
 *
 * The IR is a payload consumed at runtime by engine SDKs (and hot-updated over the
 * wire), never build-time source. Design rules (see decisions 2026-08-01):
 * - v1 vocabulary is a closed set of 5 primitives: Container, Text, Button,
 *   Collapse, ScrollView.
 * - Styles are resolved per node and reference a flat token dictionary in the envelope.
 * - Layout is runtime Flexbox in the SDK (Yoga subset) — no baked rects.
 * - Paint is 100% implicit from style in v1 (no explicit draw-command layer).
 * - Two dynamic mechanisms only: named actions and data-path bindings.
 * - Forward-tolerant: SDKs ignore unknown props, render unknown node types as a
 *   Container preserving `layout`/`style`/`visible`/`children` (normative rule,
 *   decision 2026-08-11), and refuse only on a major-version mismatch.
 */

/** Major IR version implemented by this package. */
export const IR_VERSION = 1;

/** A reference to a design token, e.g. `"{color.primary}"`. */
export type TokenRef = `{${string}}`;

/** Token values in the envelope's flat dictionary. */
export type TokenValue = string | number;

/** A static value or a data-path binding, e.g. `{ bind: "player.gold" }`. */
export type Bindable<T> = T | { bind: string };

/** Dimension: a number (px) or a token reference. */
export type Dim = number | TokenRef;

/** Color: a literal (e.g. `"#4f46e5"`) or a token reference. */
export type ColorValue = string | TokenRef;

/**
 * Versioned multi-view envelope — the unit the SDK loader consumes, whether it comes
 * from a manual import or a platform hot-update (one loading path).
 */
export interface Envelope {
  /** IR version. SDKs refuse only on a major mismatch. */
  v: number;
  /** Flat token dictionary, e.g. `{ "color.primary": "#4f46e5" }`. */
  tokens: Record<string, TokenValue>;
  /** Documents (views/scenes) keyed by view ID. */
  views: Record<string, ZNode>;
}

/** v1 node vocabulary (closed set). */
export type ZNode = ContainerNode | TextNode | ButtonNode | CollapseNode | ScrollViewNode;

export type StateName = "hover" | "pressed" | "disabled" | "focused";

/** Per-state style overrides. The SDK owns runtime state, keyed by component type. */
export interface StateOverride {
  style?: Style;
}

/** Yoga subset decided for v1: direction, justify, align, gap, padding, width/height, grow. */
export interface Layout {
  direction?: "row" | "column";
  justify?: "start" | "center" | "end" | "space-between";
  align?: "start" | "center" | "end" | "stretch";
  gap?: Dim;
  padding?: Dim;
  width?: Dim;
  height?: Dim;
  grow?: number;
}

/**
 * Resolved per-node style. Paint is implicit: `background`/`radius`/`borderWidth`
 * imply the rounded-rect fill/stroke the tessellator derives.
 */
export interface Style {
  background?: ColorValue;
  radius?: Dim;
  borderWidth?: Dim;
  borderColor?: ColorValue;
  color?: ColorValue;
  fontSize?: Dim;
  opacity?: number;
}

interface NodeBase {
  id?: string;
  /** Single hiding mechanism — `display:none` semantics (leaves layout). */
  visible?: Bindable<boolean>;
  layout?: Layout;
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
  /**
   * Receives initial focus (decision 2026-08-03 §7: navigation is automatic
   * spatial — the SDK moves focus from live layout rects; focusability derives
   * from component identity; `states.focused` styles the focused node).
   */
  autofocus?: boolean;
  /**
   * Clips children's paint AND hit-testing to this node's layout rect
   * (paint-only config, like `opacity` — no runtime state). Overflowing
   * children neither draw nor receive input outside the rect.
   */
  clip?: boolean;
}

/**
 * Declarative group behaviors (decision 2026-08-03, composites): composites are
 * NOT IR types — they flatten to primitives at authoring time, and cross-child
 * behavior is declared with `group` and implemented generically by the SDK.
 * Older SDKs ignore unknown `group` values, so composites degrade gracefully
 * (an Accordion becomes independent Collapses) instead of failing to render.
 */
export type GroupBehavior = "exclusive-open";

export interface ContainerNode extends NodeBase {
  type: "Container";
  /** Cross-child behavior the SDK enforces (e.g. Accordion = "exclusive-open"). */
  group?: GroupBehavior;
  children?: ZNode[];
}

export interface TextNode extends NodeBase {
  type: "Text";
  text: Bindable<string>;
}

export interface ButtonNode extends NodeBase {
  type: "Button";
  /** Named action, exposed idiomatically per engine (C# event / signal / Blueprint). */
  onClick?: string;
  children?: ZNode[];
}

/**
 * Collapsible region (the `<details>`/`<summary>` model): `children[0]` is the
 * header — always visible, tapping it toggles — and the rest is content that
 * enters/leaves layout with `display:none` semantics. The SDK owns the runtime
 * open state (keyed by type) and re-runs layout on toggle; the game can also
 * drive it programmatically (`SetOpen(id, open)`).
 */
export interface CollapseNode extends NodeBase {
  type: "Collapse";
  /** Initial state (default: true). */
  open?: boolean;
  /** `children[0]` = header; `children[1..]` = collapsible content. */
  children?: ZNode[];
}

/** Scrollable axis of a ScrollView. */
export type ScrollAxis = "vertical" | "horizontal" | "both";

/**
 * Scrollable region (5th primitive, decision 2026-08-11). A normal flex
 * container on both sides: its own size comes from its layout props, and
 * `direction`/`justify`/`align`/`gap`/`padding` apply to its children — but
 * children are measured UNCONSTRAINED on the scrollable axis, and the SDK owns
 * the runtime scroll offset (clamped to `max(0, contentSize - viewport)` on
 * every relayout) plus the wheel/drag input and the overlay scrollbar.
 * Always clips; an explicit `clip: false` is ignored.
 */
export interface ScrollViewNode extends NodeBase {
  type: "ScrollView";
  /** Scrollable axis. Default: "vertical". */
  axis?: ScrollAxis;
  /** Overlay position indicator painted by the SDK. Default: true. */
  scrollbar?: boolean;
  children?: ZNode[];
}

/** True if this package's reader can consume content with version `v`. */
export function supportsVersion(v: number): boolean {
  return Number.isInteger(v) && v === IR_VERSION;
}

/**
 * Minimal structural validation of an envelope. Forward-tolerant by design: unknown
 * props and node types pass through — only the envelope shape and the major version
 * are enforced.
 */
export function parseEnvelope(data: unknown): Envelope {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("IR envelope: expected a JSON object");
  }
  const env = data as Record<string, unknown>;
  if (typeof env.v !== "number") {
    throw new Error("IR envelope: missing numeric `v` field");
  }
  if (!supportsVersion(env.v)) {
    throw new Error(
      `IR envelope: unsupported major version ${env.v} (this reader implements v${IR_VERSION})`,
    );
  }
  if (typeof env.tokens !== "object" || env.tokens === null) {
    throw new Error("IR envelope: missing `tokens` dictionary");
  }
  if (typeof env.views !== "object" || env.views === null) {
    throw new Error("IR envelope: missing `views` map");
  }
  return data as Envelope;
}
