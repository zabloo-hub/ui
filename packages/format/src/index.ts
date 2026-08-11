/**
 * @zabloo/format — the zabloo IR: a versioned, engine-agnostic envelope of views.
 *
 * The IR is a payload consumed at runtime by engine SDKs (and hot-updated over the
 * wire), never build-time source. Design rules (see decisions 2026-08-01):
 * - v1 vocabulary is a closed set grown by capability: Container, Text, Button,
 *   Collapse, ScrollView, Image.
 * - Assets travel embedded (base64) in an `assets` manifest; nodes reference them as `asset:<id>` (decision 2026-08-11).
 * - Styles are resolved per node and reference a flat token dictionary in the envelope.
 * - Layout is runtime Flexbox in the SDK (Yoga subset) — no baked rects.
 * - Paint is 100% implicit from style in v1 (no explicit draw-command layer).
 * - Two dynamic mechanisms only: named actions and data-path bindings.
 * - Style/layout changes may be tweened by a per-node `transition` (duration + easing
 *   from a closed curve set) — no keyframes, no timelines (decision 2026-08-11).
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

/** A reference to an asset in the envelope's manifest, e.g. `"asset:icons/coin.png"`. */
export type AssetRef = `asset:${string}`;

/**
 * One asset in the envelope's manifest (decision 2026-08-11, ZAB-10). `hash` is the
 * content identity (SHA-256 hex): dedup today, content-addressed caching/CDN once the
 * platform exists. `data` is optional in the SCHEMA only — v1 exports always inline
 * it; a future platform may omit it and let SDKs resolve bytes by hash (deferred
 * resolution) without a format change.
 */
export interface AssetEntry {
  hash: string;
  /** MIME type, e.g. "image/png". The format is generic; accepted MIMEs are an export concern. */
  mime: string;
  /** Byte size of the decoded content. */
  size: number;
  /** Pixel dimensions (images): lets layout reserve space before decoding. */
  width?: number;
  height?: number;
  /** Content bytes, base64-encoded. */
  data?: string;
}

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
  /** Asset manifest keyed by logical id. Optional: envelopes without assets stay valid as-is. */
  assets?: Record<string, AssetEntry>;
}

/** v1 node vocabulary (closed set). */
export type ZNode =
  | ContainerNode
  | TextNode
  | ButtonNode
  | CollapseNode
  | ScrollViewNode
  | ImageNode;

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

/**
 * Closed set of easing curves (decision 2026-08-11). Defined as closed-form cubic
 * polynomials rather than CSS cubic-béziers so every target computes the SAME number
 * without a solver — see `easeProgress`, the normative reference implementation.
 */
export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

/**
 * Declarative transition for a node's animatable values. The SDK tweens whenever a
 * RESOLVED animatable value changes, whatever caused the change (entering/leaving a
 * state, `SetData` on a bound input, a token swap) — there is no trigger list.
 *
 * Animatable: `background`, `borderColor`, `color` (componentwise lerp in straight
 * sRGB with straight alpha), `opacity`, `radius`, `borderWidth`, and the layout dims
 * `width`, `height`, `gap`, `padding`. Everything else snaps: `fontSize` (the glyph
 * atlas key), `grow`, the layout enums, and every structural prop (`visible`, `clip`,
 * `text`, `open`, `src`, `axis`, `scrollbar`).
 *
 * Both endpoints must resolve to numbers/colors — an `undefined` (auto) endpoint
 * snaps. Mounting and envelope reloads snap too (no previous value to tween from);
 * an interruption retargets from the current interpolated value over a full duration.
 */
export interface Transition {
  /** Duration in milliseconds. A `Dim` so motion is themeable (`"{motion.fast}"`); <= 0 is instant. */
  duration: Dim;
  /** Default: "ease-out". */
  easing?: Easing;
}

interface NodeBase {
  id?: string;
  /** Single hiding mechanism — `display:none` semantics (leaves layout). */
  visible?: Bindable<boolean>;
  layout?: Layout;
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
  /**
   * Tweens this node's own animatable values when they change (no cascade — a node
   * never inherits its parent's transition). Read from the base node only: a
   * per-state transition (asymmetric in/out) is a compatible future extension.
   */
  transition?: Transition;
  /**
   * Receives initial focus (decision 2026-08-03 §7: navigation is automatic
   * spatial — the SDK moves focus from live layout rects; focusability derives
   * from component identity; `states.focused` styles the focused node).
   */
  autofocus?: boolean;
  /**
   * Clips children's paint AND hit-testing to this node's layout rect
   * (paint-only config, like `opacity` — no runtime state). Overflowing
   * children neither draw nor receive input outside the rect; a node's
   * effective clipping rect is the intersection with all ancestor clips.
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
 * Padding counts as content (pads the children, expands scrollable bounds).
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

/**
 * Textured rectangle. `src` references the envelope's asset manifest; at authoring
 * time the prop carries a path relative to `src/assets/` and `zabloo export` rewrites
 * it to the final `asset:<id>` ref (ZAB-13 implements the component + rendering).
 */
export interface ImageNode extends NodeBase {
  type: "Image";
  src: AssetRef;
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
  if (env.assets !== undefined) {
    if (typeof env.assets !== "object" || env.assets === null || Array.isArray(env.assets)) {
      throw new Error("IR envelope: `assets` must be an object");
    }
    for (const [id, entry] of Object.entries(env.assets)) {
      validateAssetEntry(id, entry);
    }
  }
  return data as Envelope;
}

/**
 * Decode an asset's inlined bytes. Browser-safe on purpose (atob, no `node:` imports)
 * — shared by the web renderer and the CLI preview; the Unity SDK decodes on its side
 * (Convert.FromBase64String).
 */
export function decodeAssetData(entry: AssetEntry): Uint8Array {
  if (entry.data === undefined) {
    throw new Error("asset has no inline `data` (deferred resolution is not supported yet)");
  }
  const binary = atob(entry.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * True if `value` is a well-formed asset reference (`"asset:<id>"` with a non-empty
 * id). SDK consumers should use this instead of hand-rolled `startsWith("asset:")`
 * string surgery.
 */
export function isAssetRef(value: unknown): value is AssetRef {
  return typeof value === "string" && value.startsWith("asset:") && value.length > "asset:".length;
}

/**
 * Extract the manifest id from an asset ref (strips the `asset:` prefix). SDK
 * consumers should use this instead of hand-rolled string surgery.
 */
export function assetIdFromRef(ref: AssetRef): string {
  return ref.slice("asset:".length);
}

/**
 * Normative reference implementation of the closed easing set: maps linear progress
 * `t` (0..1) to eased progress. Shared by the web renderer and the CLI preview; the
 * Unity SDK ports these exact polynomials, which is what keeps the curves identical
 * across targets. `t` outside 0..1 clamps; an unknown curve (newer content on an
 * older reader) falls back to linear rather than refusing to animate.
 */
export function easeProgress(easing: Easing, t: number): number {
  if (!(t > 0)) return 0; // also catches NaN
  if (t >= 1) return 1;
  switch (easing) {
    case "ease-in":
      return t * t * t;
    case "ease-out":
      return 1 - (1 - t) ** 3;
    case "ease-in-out":
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    default:
      return t;
  }
}

const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Cheap shape checks only — `data` is never decoded here (that would pay the cost twice). */
function validateAssetEntry(id: string, value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`IR envelope: asset "${id}" must be an object`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.hash !== "string" || entry.hash.length === 0) {
    throw new Error(`IR envelope: asset "${id}": missing non-empty \`hash\``);
  }
  if (typeof entry.mime !== "string" || entry.mime.length === 0) {
    throw new Error(`IR envelope: asset "${id}": missing non-empty \`mime\``);
  }
  if (typeof entry.size !== "number" || !Number.isFinite(entry.size) || entry.size < 0) {
    throw new Error(`IR envelope: asset "${id}": missing numeric \`size\``);
  }
  if (
    entry.width !== undefined &&
    (typeof entry.width !== "number" || !Number.isFinite(entry.width))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`width\` must be a number`);
  }
  if (
    entry.height !== undefined &&
    (typeof entry.height !== "number" || !Number.isFinite(entry.height))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`height\` must be a number`);
  }
  if (
    entry.data !== undefined &&
    (typeof entry.data !== "string" ||
      entry.data.length % 4 !== 0 ||
      !BASE64_SHAPE.test(entry.data))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`data\` is not base64`);
  }
}
