import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type { ComponentProps } from "react";

/**
 * Untouched by the compaction — a collapsible has no measurements of its own.
 * It is here because the console frame and the JSON binding editor both need
 * one, and both would otherwise reach for the primitive directly.
 */
function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent(props: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
