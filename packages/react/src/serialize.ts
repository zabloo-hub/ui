import type { RawIRNode, RawIRButton, RawIRLabel } from "@zabloo/core";
import type { HostNode, TextNode } from "./host-config.js";

function isText(n: HostNode | TextNode): n is TextNode {
  return (n as TextNode).text !== undefined;
}

export function serialize(node: HostNode): RawIRNode {
  if (node.type === "zabloo:label") {
    const p = node.props as { color: string };
    const text = node.children.map((c) => (isText(c) ? c.text : "")).join("");
    const label: RawIRLabel = { type: "Label", text, style: { color: p.color } };
    return label;
  }
  if (node.type === "zabloo:button") {
    const p = node.props as {
      id: string; variant: string; onClick?: string;
      padding: { x: string; y: string };
      background: string; radius: string;
      states?: { hover?: { background: string } };
    };
    const childNodes = node.children.filter((c): c is HostNode => !isText(c)).map(serialize);
    const button: RawIRButton = {
      type: "Button",
      id: p.id,
      variant: p.variant,
      layout: { paddingX: p.padding.x, paddingY: p.padding.y, alignItems: "center" },
      style: {
        background: p.background,
        radius: p.radius,
        ...(p.states?.hover ? { states: { hover: { background: p.states.hover.background } } } : {}),
      },
      actions: { onClick: p.onClick },
      children: childNodes,
    };
    return button;
  }
  throw new Error(`Unknown host type: ${node.type}`);
}
