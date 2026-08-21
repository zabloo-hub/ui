import { EmptyState } from "@/components/bindings/EmptyState";
import { Button } from "@/components/ui";
import { KitCell, KitLabel } from "@/kit/KitCell";

/**
 * The four button variants the chrome kept, and the empty state.
 *
 * `EmptyState` is imported rather than rebuilt: it is a pure function of two
 * strings, so it needs nothing around it. It was the only chrome component on
 * this page for as long as the page could not touch the store — the rest of the
 * panel reads it — and it stays here rather than moving to the second sheet
 * because the artboard puts it in this cell, next to the buttons.
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
