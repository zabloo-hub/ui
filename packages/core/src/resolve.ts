import type { Theme } from "./theme.js";
import type { RawIRNode, IRNode } from "./types.js";

export function token(ref: string, theme: Theme): string | number {
  const dot = ref.indexOf(".");
  const category = ref.slice(0, dot);
  const key = ref.slice(dot + 1);
  const table = (theme as Record<string, Record<string, string | number>>)[category];
  if (!table || !(key in table)) throw new Error(`Unknown token: ${ref}`);
  return table[key];
}

export function resolve(node: RawIRNode, theme: Theme): IRNode {
  if (node.type === "Label") {
    return { type: "Label", text: node.text, style: { color: token(node.style.color, theme) as string } };
  }
  const states = node.style.states?.hover
    ? { hover: { background: token(node.style.states.hover.background, theme) as string } }
    : undefined;
  return {
    type: "Button",
    id: node.id,
    variant: node.variant,
    layout: {
      paddingX: token(node.layout.paddingX, theme) as number,
      paddingY: token(node.layout.paddingY, theme) as number,
      alignItems: node.layout.alignItems,
    },
    style: {
      background: token(node.style.background, theme) as string,
      radius: token(node.style.radius, theme) as number,
      ...(states ? { states } : {}),
    },
    actions: { ...node.actions },
    children: node.children.map((c) => resolve(c, theme)),
  };
}
