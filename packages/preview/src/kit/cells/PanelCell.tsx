import { GripVertical, X } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { KitCaption, KitCell, KitLabel } from "@/kit/KitCell";

/**
 * The topbar's Bindings toggle in both states, and the head of the panel it
 * opens.
 *
 * The open toggle carries one class the primitive does not give it:
 * `data-active` moves a Button's background and text to indigo but leaves the
 * border where the variant put it, and the design draws the open toggle with an
 * indigo-soft border as well. Added here and listed in the PR as a deviation of
 * V3 — the border belongs in the variant, next to the two colours it goes with.
 *
 * The header is composed from the same Card parts `BindingsPanel` uses, which is
 * what the artboard's cell is: the header, at rest, with one line of prose under
 * it instead of a list — the fields have their own cell. The panel ITSELF is on
 * the second sheet (`BindingsPanelCell`), where it can be given the container it
 * floats in and the store it refuses to draw without.
 */
function PanelCell() {
  return (
    <KitCell id="bindings-toggle" label="Bindings · toolbar toggle">
      <div className="flex gap-2">
        <Button variant="outline" size="sm">
          <span className="font-mono text-caption font-medium">{"{ }"}</span>
          Bindings
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-active
          className="data-active:border-indigo-soft-border"
        >
          <span className="font-mono text-caption font-medium">{"{ }"}</span>
          Bindings
        </Button>
      </div>
      <KitCaption>closed · open</KitCaption>

      <KitLabel>Floating panel header</KitLabel>
      <Card className="w-[260px]">
        <CardHeader>
          <CardTitle>Data bindings</CardTitle>
          <CardDescription>6 paths</CardDescription>
          <CardAction>
            <GripVertical aria-hidden="true" className="size-3 cursor-grab text-faint" />
            <X aria-hidden="true" className="size-3.5 cursor-pointer text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent className="py-[10px] text-caption text-muted-foreground">
          Drag the grip to reposition · × closes (reopen from the toolbar).
        </CardContent>
      </Card>
    </KitCell>
  );
}

export { PanelCell };
