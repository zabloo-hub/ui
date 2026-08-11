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
  ProgressBarNode,
  ScrollAxis,
  ScrollViewNode,
  SpinnerNode,
  StateName,
  StateOverride,
  Style,
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
  | "Toggle"
  | "Image"
  | "ProgressBar"
  | "Spinner";

/** Props common to every zabloo primitive (mirrors the IR's NodeBase). */
export interface CommonProps {
  id?: string;
  visible?: Bindable<boolean>;
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
    axis?: ScrollAxis;
    scrollbar?: boolean;
    checked?: Bindable<boolean>;
    onChange?: string;
    /**
     * Toggle: this option's value in a group. Container: the group's selected
     * value. ProgressBar: the 0..1 fraction.
     */
    value?: Bindable<string | number>;
    /** Image: authoring path relative to `src/assets/` — `zabloo export` rewrites it. */
    src?: string;
    fit?: ImageFit;
    /** Spinner: cycle length, wave floor and ramp curve. */
    period?: Dim;
    min?: number;
    easing?: Easing;
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
  "Toggle",
  "Image",
  "ProgressBar",
  "Spinner",
]);

export function isHostType(type: string): type is HostType {
  return HOST_TYPES.has(type);
}

export function createHostInstance(type: string, props: HostInstance["props"]): HostInstance {
  if (!isHostType(type)) {
    throw new Error(
      `<${type}> is not a zabloo primitive. The v1 vocabulary is Container, Text, Button, ` +
        `Collapse, ScrollView, Toggle, Image, ProgressBar, Spinner ` +
        `(Row/Column/Checkbox/Switch/Radio/Badge are sugar from @zabloo/react).`,
    );
  }
  return { kind: "instance", type, props, children: [] };
}

/** Serializes a mounted host instance into an IR node. */
export function toIR(instance: HostInstance): ZNode {
  // `variant` is intentionally NOT serialized — resolved at authoring time.
  const { id, visible, layout, style, states, transition, autofocus, clip } = instance.props;
  const base = {
    ...(id !== undefined && { id }),
    ...(visible !== undefined && { visible }),
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
