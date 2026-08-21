import { EmptyState } from "@/components/bindings/EmptyState";
import { Button } from "@/components/ui";
import { KitCell, KitLabel } from "@/kit/KitCell";

/**
 * The four button variants the chrome kept, and the empty state.
 *
 * `EmptyState` is imported rather than rebuilt — it is the one composed
 * component in the chrome that is a pure function of two strings, so the kit can
 * mount the real thing without touching the store. Everything else in the panel
 * reads it, which is why nothing else here is borrowed.
 */
function ButtonsCell() {
  return (
    <KitCell id="buttons" label="Buttons">
      <div className="flex items-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </div>

      <KitLabel>Empty state</KitLabel>
      <EmptyState
        title="No bindings"
        description="This view declares no data paths."
        className="w-[250px]"
      />
    </KitCell>
  );
}

export { ButtonsCell };
