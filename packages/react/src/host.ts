/**
 * Host instance model + IR serialization.
 *
 * The reconciler mounts JSX into this tiny mutable tree (react-three-fiber style:
 * React drives it, nothing renders to DOM). After the sync commit, `toIR` walks it
 * and emits `@zabloo/format` nodes. User components never appear here — React has
 * already executed them by the time instances are created.
 */

import type {
  AssetRef,
  Bindable,
  ButtonNode,
  CollapseNode,
  ContainerNode,
  Dim,
  Easing,
  GroupBehavior,
  ImageFit,
  ImageNode,
  Layout,
  OverlayAnchor,
  OverlayNode,
  ProgressBarNode,
  RepeatNode,
  ScrollAxis,
  ScrollViewNode,
  SliderAxis,
  SliderNode,
  SpinnerNode,
  StateName,
  StateOverride,
  Style,
  TextInputNode,
  TextNode,
  ToggleNode,
  Transition,
  ZNode,
} from "@zabloo/format";

/** Host vocabulary — the IR primitives authorable in v1. */
export type HostType =
  | "Container"
  | "Text"
  | "Button"
  | "Collapse"
  | "ScrollView"
  | "Overlay"
  | "Toggle"
  | "Slider"
  | "Image"
  | "ProgressBar"
  | "Spinner"
  | "Repeat"
  | "TextInput";

/** Props common to every zabloo primitive (mirrors the IR's NodeBase). */
export interface CommonProps {
  id?: string;
  visible?: Bindable<boolean>;
  /**
   * Takes this node and everything inside it out of the interaction model: no
   * focus, no hover, no press, no action (ZAB-63). It **inherits**, so one
   * `disabled` on a `<Column>` switches off the form in it — and every node of
   * that subtree, labels included, can dress it through `states.disabled`.
   *
   * Bindable, like `visible`: `disabled={{ bind: "settings.custom" }}` lets the
   * game light half a screen up with a `SetData`. There is no default look — what
   * a disabled control looks like is `states.disabled.style`.
   */
  disabled?: Bindable<boolean>;
  layout?: Layout;
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
  /**
   * Tweens this node's animatable values when they change (F7). One object per
   * node, read from the base node only — no cascade, no per-state override.
   */
  transition?: Transition;
  /** Named style set from the theme — resolved at authoring time, never in the IR. */
  variant?: string;
  /** Receives initial focus (directional navigation — decision 2026-08-03 §7). */
  autofocus?: boolean;
  /**
   * Clips children's paint AND hit-testing to this node's rect (overflow:
   * hidden). Implied by `<ScrollView>`, which always clips.
   */
  clip?: boolean;
}

export interface HostInstance {
  kind: "instance";
  type: HostType;
  props: CommonProps & {
    onClick?: string;
    bind?: string;
    open?: boolean;
    group?: GroupBehavior;
    selected?: number;
    /**
     * ScrollView: the axis children are measured unconstrained on, and whether
     * the SDK paints its overlay indicator. The scroll offset is NOT here — it
     * is runtime state the SDK owns, never authored (like Button's `pressed`).
     */
    axis?: ScrollAxis;
    scrollbar?: boolean;
    checked?: Bindable<boolean>;
    onChange?: string;
    /**
     * Toggle: this option's value in a group. Container: the group's selected
     * value. ProgressBar: the 0..1 fraction. Slider: the current number
     * (usually a read/write binding).
     */
    value?: Bindable<string | number>;
    /**
     * Slider: the range ends and the settle hook (`axis` is shared with
     * ScrollView). `min` is shared with the Spinner, where it is the wave's
     * floor — this bag is the union of every primitive's props, and the two
     * meanings never meet on one node.
     */
    min?: number;
    max?: number;
    step?: number;
    onCommit?: string;
    /**
     * TextInput: the empty-field hint, the confirm hook and the cap on what the
     * player can type (`value`/`onChange` are shared with the other value controls).
     */
    placeholder?: string;
    onSubmit?: string;
    maxLength?: number;
    /** Image: authoring path relative to `src/assets/` — `zabloo export` rewrites it. */
    src?: string;
    fit?: ImageFit;
    /** Spinner: cycle length and ramp curve (its wave floor is `min`, above). */
    period?: Dim;
    easing?: Easing;
    /** Overlay: input capture + focus trap, stacking, dismiss hook and self-close delay. */
    modal?: boolean;
    z?: number;
    onDismiss?: string;
    autoCloseMs?: number;
    /** Overlay: the node this one is placed against, and what puts it in the layer. */
    anchor?: OverlayAnchor;
    /**
     * Repeat: the bound array's path (always a binding — the data never travels in
     * the document), the item alias the template binds against, and the path
     * relative to the item that names its identity. `keyPath` and not `key`
     * because React owns that prop name.
     */
    items?: string;
    as?: string;
    keyPath?: string;
  };
  children: HostNode[];
}

export interface HostTextInstance {
  kind: "text";
  text: string;
}

export type HostNode = HostInstance | HostTextInstance;

/** The root container the reconciler renders into. */
export interface HostContainer {
  children: HostNode[];
}

const HOST_TYPES: ReadonlySet<string> = new Set([
  "Container",
  "Text",
  "Button",
  "Collapse",
  "ScrollView",
  "Overlay",
  "Toggle",
  "Slider",
  "Image",
  "ProgressBar",
  "Spinner",
  "Repeat",
  "TextInput",
]);

export function isHostType(type: string): type is HostType {
  return HOST_TYPES.has(type);
}

export function createHostInstance(type: string, props: HostInstance["props"]): HostInstance {
  if (!isHostType(type)) {
    throw new Error(
      `<${type}> is not a zabloo primitive. The v1 vocabulary is Container, Text, Button, ` +
        `Collapse, ScrollView, Overlay, Toggle, Slider, TextInput, Image, ProgressBar, Spinner, ` +
        `Repeat (Row/Column/Checkbox/Switch/Radio/Badge/Modal/Toast/Tooltip/List/Grid are sugar ` +
        `from @zabloo/react).`,
    );
  }
  return { kind: "instance", type, props, children: [] };
}

/** Serializes a mounted host instance into an IR node. */
export function toIR(instance: HostInstance): ZNode {
  // `variant` is intentionally NOT serialized — resolved at authoring time.
  const { id, visible, disabled, layout, style, states, transition, autofocus, clip } =
    instance.props;
  const base = {
    ...(id !== undefined && { id }),
    ...(visible !== undefined && { visible }),
    ...(disabled !== undefined && { disabled }),
    ...(layout !== undefined && { layout }),
    ...(style !== undefined && { style }),
    ...(states !== undefined && { states }),
    ...(transition !== undefined && { transition }),
    ...(autofocus !== undefined && { autofocus }),
    ...(clip !== undefined && { clip }),
  };

  switch (instance.type) {
    case "Text": {
      const text = textContent(instance);
      const node: TextNode = { type: "Text", ...base, text };
      return node;
    }
    case "Button": {
      const node: ButtonNode = {
        type: "Button",
        ...base,
        ...(instance.props.onClick !== undefined && { onClick: instance.props.onClick }),
        ...childrenIR(instance),
      };
      return node;
    }
    case "Collapse": {
      const node: CollapseNode = {
        type: "Collapse",
        ...base,
        ...(instance.props.open !== undefined && { open: instance.props.open }),
        ...childrenIR(instance),
      };
      if (!node.children || node.children.length < 2) {
        throw new Error("<Collapse> needs at least a header (first child) and one content child.");
      }
      return node;
    }
    case "Container": {
      const node: ContainerNode = {
        type: "Container",
        ...base,
        ...(instance.props.group !== undefined && { group: instance.props.group }),
        ...(instance.props.selected !== undefined && { selected: instance.props.selected }),
        ...(instance.props.value !== undefined && { value: instance.props.value }),
        ...childrenIR(instance),
      };
      return node;
    }
    case "Toggle": {
      const value = instance.props.value;
      if (value !== undefined && typeof value === "object") {
        throw new Error(
          "A <Radio> value is static — bind the selection on the <RadioGroup> instead.",
        );
      }
      const node: ToggleNode = {
        type: "Toggle",
        ...base,
        ...(instance.props.checked !== undefined && { checked: instance.props.checked }),
        ...(value !== undefined && { value }),
        ...(instance.props.onChange !== undefined && { onChange: instance.props.onChange }),
        ...childrenIR(instance),
      };
      // The indicator convention is positional, so a half-built one must fail here
      // rather than silently render a control that never changes shape.
      if (node.children && node.children.length < 2) {
        throw new Error(
          "A Toggle needs both indicator slots: children[0] (checked) and children[1] (unchecked).",
        );
      }
      return node;
    }
    case "Slider": {
      const { value, min, max, step, axis, onChange, onCommit } = instance.props;
      if (typeof value === "object" && value !== null && !("bind" in value)) {
        throw new Error("<Slider value> must be a number or a { bind } binding.");
      }
      if (min !== undefined && max !== undefined && max <= min) {
        throw new Error(`<Slider> needs max > min (got min=${min}, max=${max}).`);
      }
      const node: SliderNode = {
        type: "Slider",
        ...base,
        ...(value !== undefined && { value: value as SliderNode["value"] }),
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max }),
        ...(step !== undefined && { step }),
        ...(axis !== undefined && { axis: axis as SliderAxis }),
        ...(onChange !== undefined && { onChange }),
        ...(onCommit !== undefined && { onCommit }),
        ...childrenIR(instance),
      };
      // The slots are positional, like the Toggle's indicator: a half-built
      // slider would render a rail whose thumb never appears.
      if (node.children?.length !== 2) {
        throw new Error(
          "A Slider needs exactly two slots: children[0] (fill), children[1] (thumb).",
        );
      }
      return node;
    }
    case "TextInput": {
      const { value, placeholder, onChange, onSubmit, maxLength } = instance.props;
      if (typeof value === "number") {
        throw new Error("<TextInput value> is a string (or a binding to one).");
      }
      if (typeof value === "object" && value !== null && !("bind" in value)) {
        throw new Error("<TextInput value> must be a string or a { bind } binding.");
      }
      // The renderer ignores a non-positive cap, which would silently turn a typo
      // into "no limit" — say it here, at authoring time (like Overlay's autoCloseMs).
      if (maxLength !== undefined && !(maxLength > 0)) {
        throw new Error(
          `<TextInput maxLength={${maxLength}}> must be a positive number of characters ` +
            "(omit it for an unbounded field).",
        );
      }
      if (instance.children.length > 0) {
        throw new Error("<TextInput> takes no children — it is a leaf, like <Text>.");
      }
      const node: TextInputNode = {
        type: "TextInput",
        ...base,
        ...(value !== undefined && { value: value as TextInputNode["value"] }),
        ...(placeholder !== undefined && { placeholder }),
        ...(onChange !== undefined && { onChange }),
        ...(onSubmit !== undefined && { onSubmit }),
        ...(maxLength !== undefined && { maxLength }),
      };
      return node;
    }
    case "Image": {
      const src = instance.props.src;
      if (typeof src !== "string" || src.length === 0) {
        throw new Error(
          '<Image> needs a `src` path relative to src/assets/, e.g. "icons/coin.png".',
        );
      }
      if (instance.children.length > 0) {
        throw new Error("<Image> takes no children — it is a leaf, like <Text>.");
      }
      const node: ImageNode = {
        type: "Image",
        ...base,
        // Authoring path, not an `asset:` ref yet: the export's collection pass
        // hashes the file and rewrites this prop (decision 2026-08-11, assets).
        src: src as AssetRef,
        ...(instance.props.fit !== undefined && { fit: instance.props.fit }),
      };
      return node;
    }
    case "ProgressBar": {
      const value = instance.props.value;
      if (typeof value === "string") {
        throw new Error("<ProgressBar value> is a number in 0..1 (or a binding to one).");
      }
      const { children } = childrenIR(instance);
      // The fill is a positional slot, like Collapse's header: a bar without it
      // would paint a track that never fills, which is never what was meant.
      if (children?.length !== 1) {
        throw new Error("<ProgressBar> takes exactly one child: the fill.");
      }
      const node: ProgressBarNode = {
        type: "ProgressBar",
        ...base,
        ...(value !== undefined && { value }),
        children,
      };
      return node;
    }
    case "Spinner": {
      const { children } = childrenIR(instance);
      if (!children || children.length === 0) {
        throw new Error("<Spinner> needs at least one child: the beads that pulse.");
      }
      const node: SpinnerNode = {
        type: "Spinner",
        ...base,
        ...(instance.props.period !== undefined && { period: instance.props.period }),
        ...(instance.props.min !== undefined && { min: instance.props.min }),
        ...(instance.props.easing !== undefined && { easing: instance.props.easing }),
        children,
      };
      return node;
    }
    case "Overlay": {
      const { modal, z, onDismiss, autoCloseMs, anchor } = instance.props;
      // The renderer ignores a non-positive timeout, which would silently turn a
      // typo into "never closes on its own" — say it here, at authoring time.
      if (autoCloseMs !== undefined && !(autoCloseMs > 0)) {
        throw new Error(
          `<Overlay autoCloseMs={${autoCloseMs}}> must be a positive number of milliseconds ` +
            "(omit it to keep the overlay up until something closes it).",
        );
      }
      // An anchor with no target anchors nothing: the renderer would fall back to
      // the layer placement, which is not what an `anchor` prop reads as.
      if (anchor !== undefined && (typeof anchor.id !== "string" || anchor.id.length === 0)) {
        throw new Error(
          "An anchored overlay needs the `id` of the node it hangs from, e.g. " +
            'anchor="jump-btn" (and that node needs that same `id`).',
        );
      }
      const node: OverlayNode = {
        type: "Overlay",
        ...base,
        ...(modal !== undefined && { modal }),
        ...(z !== undefined && { z }),
        ...(onDismiss !== undefined && { onDismiss }),
        ...(autoCloseMs !== undefined && { autoCloseMs }),
        ...(anchor !== undefined && { anchor }),
        ...childrenIR(instance),
      };
      return node;
    }
    case "Repeat": {
      const { items, as, keyPath } = instance.props;
      if (typeof items !== "string" || items.length === 0) {
        throw new Error(
          '<List>/<Grid> need an `items` data path, e.g. items="shop.items". The array ' +
            "lives in the game's data, never in the document.",
        );
      }
      const { children } = childrenIR(instance);
      // children[0] is the template and it is positional, like Collapse's header:
      // a Repeat without one would emit a list that can only ever be empty.
      if (!children || children.length === 0) {
        throw new Error("<List>/<Grid> need an item template as their children.");
      }
      const node: RepeatNode = {
        type: "Repeat",
        ...base,
        items: { bind: items },
        ...(as !== undefined && { as }),
        ...(keyPath !== undefined && { key: keyPath }),
        children,
      };
      return node;
    }
    case "ScrollView": {
      const node: ScrollViewNode = {
        type: "ScrollView",
        ...base,
        ...(instance.props.axis !== undefined && { axis: instance.props.axis }),
        ...(instance.props.scrollbar !== undefined && { scrollbar: instance.props.scrollbar }),
        ...childrenIR(instance),
      };
      return node;
    }
  }
}

/** Text content: a data-path binding (`bind` prop) or the joined text children. */
function textContent(instance: HostInstance): Bindable<string> {
  if (instance.props.bind !== undefined) return { bind: instance.props.bind };
  let text = "";
  for (const child of instance.children) {
    if (child.kind !== "text") {
      throw new Error("<Text> children must be plain text (or use the `bind` prop).");
    }
    text += child.text;
  }
  return text;
}

function childrenIR(instance: HostInstance): { children?: ZNode[] } {
  const out: ZNode[] = [];
  for (const child of instance.children) {
    if (child.kind === "text") {
      throw new Error(
        `Raw text ${JSON.stringify(child.text)} must be wrapped in <Text> ` +
          `(found inside <${instance.type}>).`,
      );
    }
    out.push(toIR(child));
  }
  return out.length > 0 ? { children: out } : {};
}
