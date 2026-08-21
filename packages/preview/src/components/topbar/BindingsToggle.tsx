import { Toggle } from "@/components/ui";
import { useStore } from "@/store";

/**
 * `{ } Bindings` — the switch for V14's floating panel, and the only control in
 * the topbar whose "on" is indigo rather than muted: the panel is a surface that
 * is either there or not, not a setting.
 *
 * The glyph is text and not lucide's `Braces` for the reason `ui/toggle.tsx`
 * gives — at 11px a stroked icon next to a 12px label goes muddy.
 *
 * Two narrow selectors instead of `useLayout()`: the layout slice also holds the
 * panel's position, and V14 writes that on every frame of a drag — through the
 * slice hook this button would re-render along with it.
 */
function BindingsToggle() {
  const panelOpen = useStore((state) => state.layout.panelOpen);
  const setPanelOpen = useStore((state) => state.setPanelOpen);

  return (
    <Toggle data-slot="bindings-toggle" pressed={panelOpen} onPressedChange={setPanelOpen}>
      <span className="font-mono text-caption font-medium">{"{ }"}</span>
      Bindings
    </Toggle>
  );
}

export { BindingsToggle };
