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
 * Two narrow selectors instead of `useLayout()`: the layout slice also holds
 * writes that are none of this button's business — the panel position a drag
 * commits on release, the console toggle — and through the slice hook it would
 * re-render on every one of them.
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
