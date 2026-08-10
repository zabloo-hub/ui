/**
 * Host instance model + IR serialization.
 *
 * The reconciler mounts JSX into this tiny mutable tree (react-three-fiber style:
 * React drives it, nothing renders to DOM). After the sync commit, `toIR` walks it
 * and emits `@zabloo/format` nodes. User components never appear here — React has
 * already executed them by the time instances are created.
 */

import type {
  Bindable,
  ButtonNode,
  CollapseNode,
  ContainerNode,
  GroupBehavior,
  Layout,
  StateName,
  StateOverride,
  Style,
  TextNode,
  ZNode,
} from "@zabloo/format";

/** Host vocabulary — the IR primitives authorable in v1 (ScrollView + `clip`: F1, pending). */
export type HostType = "Container" | "Text" | "Button" | "Collapse";

/** Props common to every zabloo primitive (mirrors the IR's NodeBase). */
export interface CommonProps {
  id?: string;
  visible?: Bindable<boolean>;
  layout?: Layout;
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
  /** Named style set from the theme — resolved at authoring time, never in the IR. */
  variant?: string;
  /** Receives initial focus (directional navigation — decision 2026-08-03 §7). */
  autofocus?: boolean;
}

export interface HostInstance {
  kind: "instance";
  type: HostType;
  props: CommonProps & {
    onClick?: string;
    bind?: string;
    open?: boolean;
    group?: GroupBehavior;
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

const HOST_TYPES: ReadonlySet<string> = new Set(["Container", "Text", "Button", "Collapse"]);

export function isHostType(type: string): type is HostType {
  return HOST_TYPES.has(type);
}

export function createHostInstance(type: string, props: HostInstance["props"]): HostInstance {
  if (!isHostType(type)) {
    throw new Error(
      `<${type}> is not a zabloo primitive. The v1 vocabulary is Container, Text, Button, ` +
        `Collapse (Row/Column are sugar from @zabloo/react).`,
    );
  }
  return { kind: "instance", type, props, children: [] };
}

/** Serializes a mounted host instance into an IR node. */
export function toIR(instance: HostInstance): ZNode {
  // `variant` is intentionally NOT serialized — resolved at authoring time.
  const { id, visible, layout, style, states, autofocus } = instance.props;
  const base = {
    ...(id !== undefined && { id }),
    ...(visible !== undefined && { visible }),
    ...(layout !== undefined && { layout }),
    ...(style !== undefined && { style }),
    ...(states !== undefined && { states }),
    ...(autofocus !== undefined && { autofocus }),
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
