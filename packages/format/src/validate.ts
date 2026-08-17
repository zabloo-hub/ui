/**
 * Envelope validation — the loading contract every target shares (decision
 * 2026-08-12, ZAB-37). Until F8 this was deliberately minimal and forward-tolerant
 * (decision 2026-08-11: no `data` decoding, dangling refs tolerated); what lands
 * here is the POLICY, in one place, because both the web renderer and the Unity
 * loader must degrade the same way in front of the same bytes.
 *
 * **A corrupt envelope never takes the game down.** Three levels, and the split
 * between them is one question — *is there still a tree to render?*:
 *
 * | Level | What it covers |
 * |---|---|
 * | `fatal` | Invalid/truncated JSON, not an object, missing or non-numeric `v`, an incompatible major version, a missing `views` map, and zero usable views once everything else is repaired. |
 * | `warn` | Everything that can be repaired locally: a view that is not a node, a malformed node, a property of the wrong type, an invalid asset entry, a dangling token/asset/anchor reference, a duplicate id. The envelope loads without them. |
 * | silence | Unknown properties and unknown node types — forward-tolerance is a feature, not an error (normative rule, decision 2026-08-11). |
 *
 * **Shapes, never vocabularies.** A closed set (`Easing`, `ImageFit`, `AnchorAt`,
 * `GroupBehavior`, …) is checked to be a *string* and no further: the vocabulary is
 * exactly what a later version grows, and every consumer already falls back to its
 * default on a value it does not know. Validating the value here would turn
 * tomorrow's content into today's error — the opposite of what this file is for.
 *
 * **The result is repaired, not just reported.** `readEnvelope` returns a COPY with
 * the broken parts removed, so a consumer that loaded an envelope can trust its
 * shape instead of defending itself at every node, every frame. Unknown properties
 * survive the copy untouched.
 */

import type { AssetEntry, AssetRef, Envelope, TokenValue, ZNode } from "./index.js";

/** Major IR version implemented by this package. */
export const IR_VERSION = 1;

/** True if this package's reader can consume content with version `v`. */
export function supportsVersion(v: number): boolean {
  return Number.isInteger(v) && v === IR_VERSION;
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

/** `fatal` aborts the load; `warn` was repaired and the envelope still loads. */
export type DiagnosticLevel = "warn" | "fatal";

/**
 * Stable identity of a diagnostic — what a consumer switches on (and what the Unity
 * loader will emit for the same input). The prose of `message` is free to improve;
 * these strings are the contract.
 */
export type DiagnosticCode =
  | "invalid-json"
  | "not-an-object"
  | "missing-version"
  | "unsupported-version"
  | "missing-views"
  | "no-usable-views"
  | "invalid-tokens"
  | "invalid-token"
  | "invalid-assets"
  | "invalid-asset"
  | "invalid-node"
  | "invalid-prop"
  | "invalid-binding"
  | "too-deep"
  | "duplicate-id"
  | "unknown-token"
  | "unknown-asset"
  | "unknown-anchor";

/** One thing the validator found, addressed to whoever authored the envelope. */
export interface Diagnostic {
  level: DiagnosticLevel;
  code: DiagnosticCode;
  /**
   * Where it is, as a path into the envelope — `views["hud"].children[2].text`.
   * Map keys are bracketed because view ids, asset ids and token names contain
   * dots of their own. `""` is the envelope itself.
   */
  path: string;
  /** Human-readable and self-contained: it already names the path, field and reason. */
  message: string;
}

/** What `readEnvelope` gives back: the repaired envelope (or none) and what it found. */
export interface EnvelopeReport {
  /** The repaired envelope, or `null` if a `fatal` diagnostic stopped the load. */
  envelope: Envelope | null;
  diagnostics: Diagnostic[];
}

/**
 * The exception form of a failed load. `message` is the fatal diagnostic's message —
 * already legible, already naming the field and the version — and `diagnostics`
 * carries everything found on the way there, so a caller that only caught the throw
 * can still report the warnings.
 */
export class EnvelopeError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const fatal = diagnostics.find((d) => d.level === "fatal");
    super(fatal?.message ?? "IR envelope: validation failed");
    this.name = "EnvelopeError";
    this.diagnostics = diagnostics;
  }
}

/**
 * The loader's entry point: JSON text (or an already-parsed value) in, a repaired
 * envelope plus diagnostics out. It NEVER throws — a truncated file, a hostile
 * payload and a v2 envelope all come back as a `fatal` diagnostic with a readable
 * message, which is what lets a hot-update fail without touching the UI on screen.
 */
export function readEnvelope(input: unknown): EnvelopeReport {
  const diagnostics: Diagnostic[] = [];
  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail(diagnostics, "invalid-json", "", `not valid JSON — ${detail}`);
    }
    return validateEnvelope(parsed, diagnostics);
  }
  return validateEnvelope(input, diagnostics);
}

/**
 * Structural validation of an ALREADY-PARSED envelope, throwing on the first fatal.
 * The strict sibling of `readEnvelope`, kept for callers that want an exception:
 * a string is not a JSON document here, it is simply not an object.
 */
export function parseEnvelope(data: unknown): Envelope {
  const { envelope, diagnostics } = validateEnvelope(data, []);
  if (envelope === null) throw new EnvelopeError(diagnostics);
  return envelope;
}

// --- the walk -------------------------------------------------------------

/** Per-view state: ids are collected as the tree is walked, anchors resolved after. */
interface Ctx {
  readonly diagnostics: Diagnostic[];
  readonly tokens: Record<string, TokenValue>;
  readonly assetIds: Set<string>;
  ids: Set<string>;
  anchors: Array<{ id: string; path: string }>;
}

function validateEnvelope(value: unknown, diagnostics: Diagnostic[]): EnvelopeReport {
  if (!isRecord(value)) {
    return fail(diagnostics, "not-an-object", "", "expected a JSON object");
  }
  if (typeof value.v !== "number" || !Number.isFinite(value.v)) {
    return fail(diagnostics, "missing-version", "", "missing numeric `v` field");
  }
  if (!supportsVersion(value.v)) {
    return fail(
      diagnostics,
      "unsupported-version",
      "",
      `unsupported major version ${value.v} (this reader implements v${IR_VERSION})`,
    );
  }
  if (!isRecord(value.views)) {
    return fail(diagnostics, "missing-views", "", "missing `views` map");
  }

  const ctx: Ctx = {
    diagnostics,
    tokens: readTokens(value.tokens, diagnostics),
    assetIds: new Set(),
    ids: new Set(),
    anchors: [],
  };
  const assets = readAssets(value.assets, diagnostics);
  if (assets !== undefined) for (const id of Object.keys(assets)) ctx.assetIds.add(id);

  const views: Record<string, ZNode> = {};
  for (const [id, view] of Object.entries(value.views)) {
    ctx.ids = new Set();
    ctx.anchors = [];
    const clean = sanitizeNode(view, viewPath(id), ctx, "view");
    if (clean === null) continue;
    for (const anchor of ctx.anchors) {
      if (ctx.ids.has(anchor.id)) continue;
      warn(
        ctx,
        "unknown-anchor",
        anchor.path,
        `anchor id "${anchor.id}" matches no node in view "${id}" — the overlay falls ` +
          "back to the layer placement",
      );
    }
    views[id] = clean;
  }
  if (Object.keys(views).length === 0) {
    const empty = Object.keys(value.views).length === 0;
    return fail(
      diagnostics,
      "no-usable-views",
      "",
      empty ? "the `views` map is empty" : "no usable views (every view was dropped)",
    );
  }

  const envelope = { ...value, v: value.v, tokens: ctx.tokens, views } as Envelope;
  if (assets === undefined || Object.keys(assets).length === 0) {
    Reflect.deleteProperty(envelope, "assets");
  } else {
    envelope.assets = assets;
  }
  return { envelope, diagnostics };
}

/** The flat dictionary, minus the entries whose value is not a token value. */
function readTokens(value: unknown, diagnostics: Diagnostic[]): Record<string, TokenValue> {
  if (value === undefined) {
    push(
      diagnostics,
      "warn",
      "invalid-tokens",
      "",
      "missing `tokens` dictionary — treated as empty",
    );
    return {};
  }
  if (!isRecord(value)) {
    push(
      diagnostics,
      "warn",
      "invalid-tokens",
      "tokens",
      "expected an object — the dictionary is ignored",
    );
    return {};
  }
  const tokens: Record<string, TokenValue> = {};
  for (const [name, token] of Object.entries(value)) {
    if (typeof token === "string" || (typeof token === "number" && Number.isFinite(token))) {
      tokens[name] = token;
      continue;
    }
    push(
      diagnostics,
      "warn",
      "invalid-token",
      `tokens[${quote(name)}]`,
      `expected a string or a finite number, got ${describe(token)} — token dropped`,
    );
  }
  return tokens;
}

/**
 * The asset manifest, minus the malformed entries. A broken icon costs its own node
 * a texture; it never costs the UI its load, which is why an invalid entry warns
 * instead of aborting (change of policy, ZAB-37 — it used to throw).
 */
function readAssets(
  value: unknown,
  diagnostics: Diagnostic[],
): Record<string, AssetEntry> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    push(
      diagnostics,
      "warn",
      "invalid-assets",
      "assets",
      "expected an object — the manifest is ignored",
    );
    return undefined;
  }
  const assets: Record<string, AssetEntry> = {};
  for (const [id, entry] of Object.entries(value)) {
    const reason = assetProblem(entry);
    if (reason === null) {
      assets[id] = entry as AssetEntry;
      continue;
    }
    push(diagnostics, "warn", "invalid-asset", `assets[${quote(id)}]`, `${reason} — asset dropped`);
  }
  return assets;
}

/**
 * Cheap shape checks only — `data` is never decoded here (that would pay the cost
 * twice). Returns the reason the entry is unusable, or `null` when it is fine.
 */
function assetProblem(value: unknown): string | null {
  if (!isRecord(value)) return "expected an object";
  if (typeof value.hash !== "string" || value.hash.length === 0) {
    return "missing a non-empty `hash`";
  }
  if (typeof value.mime !== "string" || value.mime.length === 0) {
    return "missing a non-empty `mime`";
  }
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) {
    return "missing a non-negative numeric `size`";
  }
  if (value.width !== undefined && !isFiniteNumber(value.width)) return "`width` is not a number";
  if (value.height !== undefined && !isFiniteNumber(value.height))
    return "`height` is not a number";
  if (value.data !== undefined && !isBase64(value.data)) return "`data` is not base64";
  return null;
}

/**
 * Node types whose children are SLOTS the SDK reads by position (Collapse's header,
 * Toggle's indicators, Slider's fill and thumb, ProgressBar's fill, Repeat's
 * template, an `"exclusive-select"` group's bar and panels). Dropping a child of one
 * of these would renumber the ones after it and silently change what they mean, so a
 * dropped slot is replaced by an inert empty `Container` instead.
 */
const POSITIONAL_TYPES = new Set(["Collapse", "Toggle", "Slider", "ProgressBar", "Repeat"]);

/**
 * Deepest tree this reader walks. Nothing authored comes close (a real screen nests
 * tens of levels, not hundreds); what does is a hostile or corrupt payload, and every
 * pass downstream — this walk, layout, paint, hit-testing — is recursive, so a tree
 * that would overflow the stack has to stop being a tree at the door. The cut is a
 * warning like any other: the subtree is dropped, the rest of the UI loads.
 */
const MAX_DEPTH = 256;

/** What a dropped node costs, worded for where it sat. */
type NodeKind = "node" | "view" | "slot";

const DROPPED: Record<NodeKind, string> = {
  node: "node dropped",
  view: "view dropped",
  slot: "slot replaced by an empty Container",
};

/**
 * Repairs one node, or returns `null` when nothing usable is left of it — which is
 * the case for a value that is not a node object at all, and for a node whose type
 * REQUIRES a field it does not have (a `Text` with no `text`, an `Image` with no
 * `src`, a `Repeat` with nothing to repeat). Everything else is repaired in place:
 * a property of the wrong type is dropped and its default takes over.
 */
function sanitizeNode(
  value: unknown,
  path: string,
  ctx: Ctx,
  kind: NodeKind,
  depth = 0,
): ZNode | null {
  if (depth > MAX_DEPTH) {
    warn(ctx, "too-deep", path, `nested deeper than ${MAX_DEPTH} levels — subtree dropped`);
    return null;
  }
  if (!isRecord(value)) {
    warn(
      ctx,
      "invalid-node",
      path,
      `expected a node object, got ${describe(value)} — ${DROPPED[kind]}`,
    );
    return null;
  }
  if (typeof value.type !== "string" || value.type.length === 0) {
    warn(ctx, "invalid-node", path, `missing a non-empty \`type\` — ${DROPPED[kind]}`);
    return null;
  }
  const type = value.type;
  const node: Record<string, unknown> = { ...value };

  // --- NodeBase, shared by every type including the unknown ones ---
  if (typeof node.id === "string" && node.id.length > 0) {
    if (ctx.ids.has(node.id)) {
      warn(
        ctx,
        "duplicate-id",
        `${path}.id`,
        `id "${node.id}" is already used in this view — the SDK addresses only one of them`,
      );
    }
    ctx.ids.add(node.id);
  } else if (node.id !== undefined) {
    dropProp(node, "id", path, ctx, "a non-empty string");
  }
  bindableProp(node, "visible", path, ctx, isBoolean, "a boolean");
  bindableProp(node, "disabled", path, ctx, isBoolean, "a boolean");
  boolProp(node, "autofocus", path, ctx);
  boolProp(node, "clip", path, ctx);
  sanitizeLayout(node, path, ctx);
  sanitizeStyleProp(node, path, ctx);
  sanitizeStates(node, path, ctx);
  sanitizeTransition(node, path, ctx);

  // --- per type: required fields first (they can sink the node) ---
  switch (type) {
    case "Text":
      if (!isBindable(node.text, isNonEmptyString)) {
        warn(
          ctx,
          "invalid-node",
          `${path}.text`,
          `Text has no usable \`text\` (${describe(node.text)}) — ${DROPPED[kind]}`,
        );
        return null;
      }
      noteBinding(node.text, `${path}.text`, ctx);
      break;
    case "Image":
      if (!isAssetRef(node.src)) {
        warn(
          ctx,
          "invalid-node",
          `${path}.src`,
          `Image has no usable \`src\` (${describe(node.src)}; expected "asset:<id>") — ` +
            DROPPED[kind],
        );
        return null;
      }
      if (!ctx.assetIds.has(assetIdFromRef(node.src))) {
        warn(
          ctx,
          "unknown-asset",
          `${path}.src`,
          `"${node.src}" is not in the envelope's asset manifest — the node paints its ` +
            "background only",
        );
      }
      stringProp(node, "fit", path, ctx);
      break;
    case "Repeat":
      // Stricter than an ordinary binding: elsewhere a path that reads nothing is
      // just no value, but a Repeat with no array has no children at all.
      if (!isBind(node.items) || node.items.bind.length === 0) {
        warn(
          ctx,
          "invalid-node",
          `${path}.items`,
          `Repeat has no usable \`items\` binding (${describe(node.items)}) — ${DROPPED[kind]}`,
        );
        return null;
      }
      noteBinding(node.items, `${path}.items`, ctx);
      stringProp(node, "as", path, ctx);
      stringProp(node, "key", path, ctx);
      break;
    case "Container":
      stringProp(node, "group", path, ctx);
      numberProp(node, "selected", path, ctx);
      bindableProp(node, "value", path, ctx, isStringOrNumber, "a string or a number");
      stringProp(node, "onChange", path, ctx);
      break;
    case "Button":
      stringProp(node, "onClick", path, ctx);
      break;
    case "Collapse":
      boolProp(node, "open", path, ctx);
      break;
    case "ScrollView":
      stringProp(node, "axis", path, ctx);
      boolProp(node, "scrollbar", path, ctx);
      break;
    case "Toggle":
      bindableProp(node, "checked", path, ctx, isBoolean, "a boolean");
      typedProp(node, "value", path, ctx, isStringOrNumber, "a string or a number");
      stringProp(node, "onChange", path, ctx);
      break;
    case "Slider":
      bindableProp(node, "value", path, ctx, isFiniteNumber, "a number");
      numberProp(node, "min", path, ctx);
      numberProp(node, "max", path, ctx);
      numberProp(node, "step", path, ctx);
      checkRange(node, path, ctx);
      stringProp(node, "axis", path, ctx);
      stringProp(node, "onChange", path, ctx);
      stringProp(node, "onCommit", path, ctx);
      break;
    case "TextInput":
      bindableProp(node, "value", path, ctx, isString, "a string");
      stringProp(node, "placeholder", path, ctx);
      numberProp(node, "maxLength", path, ctx);
      stringProp(node, "onChange", path, ctx);
      stringProp(node, "onSubmit", path, ctx);
      break;
    case "ProgressBar":
      bindableProp(node, "value", path, ctx, isFiniteNumber, "a number");
      break;
    case "Spinner":
      dimProp(node, "period", path, ctx);
      numberProp(node, "min", path, ctx);
      stringProp(node, "easing", path, ctx);
      break;
    case "Overlay":
      sanitizeAnchor(node, path, ctx);
      boolProp(node, "modal", path, ctx);
      numberProp(node, "z", path, ctx);
      numberProp(node, "autoCloseMs", path, ctx);
      stringProp(node, "onDismiss", path, ctx);
      break;
    default:
      // Unknown type: rendered as a Container preserving layout/style/visible/
      // disabled/children (normative rule, decision 2026-08-11). Its own props are
      // none of this reader's business — they belong to a version it does not
      // implement. `disabled` is in that list because dropping it would turn a
      // control the author switched off into a live one (ZAB-63).
      break;
  }

  sanitizeChildren(node, path, ctx, POSITIONAL_TYPES.has(type) || isSelectGroup(type, node), depth);
  return node as unknown as ZNode;
}

/** A `Container` whose `group` makes its children positional (the Tabs contract). */
function isSelectGroup(type: string, node: Record<string, unknown>): boolean {
  return type === "Container" && node.group === "exclusive-select";
}

function sanitizeChildren(
  node: Record<string, unknown>,
  path: string,
  ctx: Ctx,
  positional: boolean,
  depth: number,
): void {
  const children = node.children;
  if (children === undefined) return;
  if (!Array.isArray(children)) {
    dropProp(node, "children", path, ctx, "an array of nodes");
    return;
  }
  const clean: ZNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const childPath = `${path}.children[${i}]`;
    const child = sanitizeNode(
      children[i],
      childPath,
      ctx,
      positional ? "slot" : "node",
      depth + 1,
    );
    if (child !== null) clean.push(child);
    else if (positional) clean.push({ type: "Container" });
  }
  node.children = clean;
}

/**
 * An `anchor` that is not a usable relation loses the whole field, never the node:
 * the overlay still carries its layer placement, which is exactly the pre-ZAB-46
 * rendering it degrades to.
 */
function sanitizeAnchor(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const anchor = node.anchor;
  if (anchor === undefined) return;
  if (!isRecord(anchor) || !isNonEmptyString(anchor.id)) {
    dropProp(node, "anchor", path, ctx, "an object with a non-empty `id`");
    return;
  }
  const copy: Record<string, unknown> = { ...anchor };
  const anchorPath = `${path}.anchor`;
  stringProp(copy, "at", anchorPath, ctx);
  stringProp(copy, "trigger", anchorPath, ctx);
  dimProp(copy, "offset", anchorPath, ctx);
  node.anchor = copy;
  ctx.anchors.push({ id: anchor.id, path: `${anchorPath}.id` });
}

function sanitizeLayout(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const layout = node.layout;
  if (layout === undefined) return;
  if (!isRecord(layout)) {
    dropProp(node, "layout", path, ctx, "an object");
    return;
  }
  const copy: Record<string, unknown> = { ...layout };
  const at = `${path}.layout`;
  stringProp(copy, "direction", at, ctx);
  stringProp(copy, "justify", at, ctx);
  stringProp(copy, "align", at, ctx);
  for (const key of ["gap", "padding", "width", "height"]) dimProp(copy, key, at, ctx);
  numberProp(copy, "grow", at, ctx);
  boolProp(copy, "wrap", at, ctx);
  node.layout = copy;
}

function sanitizeStyleProp(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const style = node.style;
  if (style === undefined) return;
  if (!isRecord(style)) {
    dropProp(node, "style", path, ctx, "an object");
    return;
  }
  node.style = sanitizeStyle(style, `${path}.style`, ctx);
}

function sanitizeStyle(
  style: Record<string, unknown>,
  at: string,
  ctx: Ctx,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...style };
  for (const key of ["background", "borderColor", "color"]) colorProp(copy, key, at, ctx);
  for (const key of ["radius", "borderWidth", "fontSize", "lineHeight"])
    dimProp(copy, key, at, ctx);
  numberProp(copy, "opacity", at, ctx);
  numberProp(copy, "maxLines", at, ctx);
  stringProp(copy, "textAlign", at, ctx);
  stringProp(copy, "textAlignY", at, ctx);
  stringProp(copy, "overflow", at, ctx);
  boolProp(copy, "wrap", at, ctx);
  return copy;
}

/** `states` is a map of state name → `{ style }`; a broken entry loses that state. */
function sanitizeStates(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const states = node.states;
  if (states === undefined) return;
  if (!isRecord(states)) {
    dropProp(node, "states", path, ctx, "an object");
    return;
  }
  const copy: Record<string, unknown> = {};
  for (const [name, override] of Object.entries(states)) {
    const at = `${path}.states[${quote(name)}]`;
    if (!isRecord(override)) {
      warn(
        ctx,
        "invalid-prop",
        at,
        `expected an object, got ${describe(override)} — state dropped`,
      );
      continue;
    }
    const entry: Record<string, unknown> = { ...override };
    if (entry.style !== undefined) {
      if (isRecord(entry.style)) {
        entry.style = sanitizeStyle(entry.style, `${at}.style`, ctx);
      } else {
        dropProp(entry, "style", at, ctx, "an object");
      }
    }
    copy[name] = entry;
  }
  node.states = copy;
}

/** A transition without a usable `duration` is no transition: the node just snaps. */
function sanitizeTransition(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const transition = node.transition;
  if (transition === undefined) return;
  if (!isRecord(transition) || !isDim(transition.duration)) {
    dropProp(node, "transition", path, ctx, "an object with a `duration`");
    return;
  }
  const copy: Record<string, unknown> = { ...transition };
  const at = `${path}.transition`;
  noteTokenRef(copy.duration, `${at}.duration`, ctx);
  stringProp(copy, "easing", at, ctx);
  node.transition = copy;
}

/** `min`/`max` that cross leave the Slider its defaults instead of an empty range. */
function checkRange(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const { min, max } = node;
  if (typeof min !== "number" || typeof max !== "number" || min < max) return;
  warn(
    ctx,
    "invalid-prop",
    `${path}.min`,
    `\`min\` (${min}) is not below \`max\` (${max}) — both dropped, the range falls back to 0..1`,
  );
  Reflect.deleteProperty(node, "min");
  Reflect.deleteProperty(node, "max");
}

// --- property helpers -----------------------------------------------------

function typedProp(
  node: Record<string, unknown>,
  key: string,
  path: string,
  ctx: Ctx,
  ok: (value: unknown) => boolean,
  expected: string,
): void {
  if (node[key] === undefined || ok(node[key])) return;
  dropProp(node, key, path, ctx, expected);
}

/** A prop that is either a static value or a `{ bind }` — the READ/WRITE controls. */
function bindableProp(
  node: Record<string, unknown>,
  key: string,
  path: string,
  ctx: Ctx,
  ok: (value: unknown) => boolean,
  expected: string,
): void {
  const value = node[key];
  if (value === undefined) return;
  if (!isBindable(value, ok)) {
    dropProp(node, key, path, ctx, `${expected} or a { bind } path`);
    return;
  }
  noteBinding(value, `${path}.${key}`, ctx);
}

function stringProp(node: Record<string, unknown>, key: string, path: string, ctx: Ctx): void {
  typedProp(node, key, path, ctx, isNonEmptyString, "a non-empty string");
}

function boolProp(node: Record<string, unknown>, key: string, path: string, ctx: Ctx): void {
  typedProp(node, key, path, ctx, isBoolean, "a boolean");
}

function numberProp(node: Record<string, unknown>, key: string, path: string, ctx: Ctx): void {
  typedProp(node, key, path, ctx, isFiniteNumber, "a finite number");
}

function dimProp(node: Record<string, unknown>, key: string, path: string, ctx: Ctx): void {
  typedProp(node, key, path, ctx, isDim, "a number or a `{token}` reference");
  noteTokenRef(node[key], `${path}.${key}`, ctx);
}

function colorProp(node: Record<string, unknown>, key: string, path: string, ctx: Ctx): void {
  typedProp(node, key, path, ctx, isNonEmptyString, "a color string or a `{token}` reference");
  noteTokenRef(node[key], `${path}.${key}`, ctx);
}

function dropProp(
  node: Record<string, unknown>,
  key: string,
  path: string,
  ctx: Ctx,
  expected: string,
): void {
  warn(
    ctx,
    "invalid-prop",
    `${path}.${key}`,
    `expected ${expected}, got ${describe(node[key])} — property dropped`,
  );
  Reflect.deleteProperty(node, key);
}

/**
 * A `{token}` that the dictionary does not define. It is a warning and not a repair:
 * the consumer resolves it to "no value" and the node falls back to its default,
 * which is a visible degradation the author can see and fix.
 */
function noteTokenRef(value: unknown, path: string, ctx: Ctx): void {
  if (!isTokenRef(value)) return;
  const name = value.slice(1, -1);
  if (name in ctx.tokens) return;
  warn(
    ctx,
    "unknown-token",
    path,
    `token ${value} is not in the envelope's dictionary — the value is ignored`,
  );
}

/**
 * A binding whose PATH is malformed (empty segments, a leading or trailing dot).
 * The data itself is never checked: a path that reads nothing is the game's state,
 * not an envelope error, and bound UI degrades to "no value" by design.
 */
function noteBinding(value: unknown, path: string, ctx: Ctx): void {
  if (!isRecord(value) || typeof value.bind !== "string") return;
  const bind = value.bind;
  if (bind.length > 0 && !bind.split(".").some((segment) => segment.length === 0)) return;
  warn(
    ctx,
    "invalid-binding",
    `${path}.bind`,
    `"${bind}" is not a usable data path — it will always read as no value`,
  );
}

// --- predicates and formatting -------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringOrNumber(value: unknown): boolean {
  return isNonEmptyString(value) || isFiniteNumber(value);
}

function isTokenRef(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 2 && value.startsWith("{") && value.endsWith("}")
  );
}

function isDim(value: unknown): boolean {
  return isFiniteNumber(value) || isTokenRef(value);
}

function isBind(value: unknown): value is { bind: string } {
  return isRecord(value) && typeof value.bind === "string";
}

function isBindable(value: unknown, ok: (value: unknown) => boolean): boolean {
  return ok(value) || isBind(value);
}

const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

function isBase64(value: unknown): boolean {
  return typeof value === "string" && value.length % 4 === 0 && BASE64_SHAPE.test(value);
}

function viewPath(id: string): string {
  return `views[${quote(id)}]`;
}

function quote(key: string): string {
  return JSON.stringify(key);
}

/** What a bad value IS, for a message that says more than "invalid". */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "nothing";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function warn(ctx: Ctx, code: DiagnosticCode, path: string, detail: string): void {
  push(ctx.diagnostics, "warn", code, path, detail);
}

function fail(
  diagnostics: Diagnostic[],
  code: DiagnosticCode,
  path: string,
  detail: string,
): EnvelopeReport {
  push(diagnostics, "fatal", code, path, detail);
  return { envelope: null, diagnostics };
}

function push(
  diagnostics: Diagnostic[],
  level: DiagnosticLevel,
  code: DiagnosticCode,
  path: string,
  detail: string,
): void {
  const message = path.length === 0 ? `IR envelope: ${detail}` : `IR envelope: ${path} — ${detail}`;
  diagnostics.push({ level, code, path, message });
}
