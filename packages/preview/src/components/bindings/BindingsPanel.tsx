/**
 * The data panel: the preview playing the game's part, one field per path the
 * envelope declares.
 *
 * It floats OVER the stage instead of sitting in a column beside it, and that is
 * the load-bearing decision. It is not a Dialog either: a dialog would trap the
 * focus and dim the canvas, and the canvas is the thing you are testing — the
 * panel has to be movable out of the way of what it is inspecting, never in
 * front of it. Hence a card, a grip, and a position you can drag and that the
 * next reload remembers.
 *
 * Two states it can be in that are not "a list of fields":
 *
 * - **Empty.** A view with no bindings is a normal view, not a failure, so it
 *   says so in the panel's own words rather than showing an empty box.
 * - **Disabled.** A stale export or a fatal means what is on the canvas is older
 *   than the file on disk, and pushing a value into a view that is not the one
 *   you are editing would be a lie. The fields go inert — and the footer's whole
 *   job is to promise that the values are still there, because they are: they
 *   live in the store and are re-pushed when the export loads (see
 *   `store/bindings.ts`).
 *
 * The panel does not mount itself. V10's stage is its `position: relative`
 * container and V16 is what knows about zen's chrome; this file only knows it
 * must not draw in either of the two cases below.
 *
 * The header carries two controls that are not the drag: the grip, which resets
 * the position, and the close button. Both are real `<button>`s — an action you
 * can only reach by double-clicking a decorative svg is an action half the
 * people using this panel do not have.
 */

import { GripVertical, X } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useBindings, useConnection, useLayout, useProblems } from "@/store/hooks";
import { EmptyState } from "./EmptyState";
import { BindingField } from "./editors";
import { useDrag } from "./useDrag";

function BindingsPanel() {
  const { panelOpen, panelPos, zen, setPanelOpen, setPanelPos } = useLayout();
  const { byPath, order } = useBindings();
  const { connection } = useConnection();
  const { hasFatal } = useProblems();
  const drag = useDrag(panelPos, setPanelPos);

  if (!panelOpen || zen) return null;

  // Held, not lost: the export on screen is not the file on disk, so an edit
  // would push a value into a view you are not looking at.
  const held = connection === "stale" || hasFatal;

  return (
    <Card
      ref={drag.ref}
      data-panel="bindings"
      // Over the canvas, under the menus and tooltips that Radix portals out.
      className="absolute z-10 max-h-[calc(100%-28px)] w-[296px]"
      style={drag.style}
    >
      <CardHeader
        data-drag-handle
        className={cn("select-none", drag.dragging ? "cursor-grabbing" : "cursor-grab")}
        {...drag.handleProps}
      >
        <CardTitle>Data bindings</CardTitle>
        <CardDescription>
          {order.length} {order.length === 1 ? "path" : "paths"}
        </CardDescription>
        <CardAction>
          {/* The grip is the affordance; the whole header is the target. It is a
              real button because the reset it carries had no keyboard path at
              all while it hung off a double click on an `aria-hidden` svg — the
              one action in this panel you could not reach without a mouse. */}
          <button
            data-grip
            type="button"
            aria-label="Reset panel position"
            // Arms the reset and lets the press through: the header still gets it
            // and the panel is still draggable by its grip. The reset itself
            // fires on the release, because the header captures the pointer and
            // the browser hands the resulting `click` to the header, not here.
            onPointerDown={drag.pressReset}
            // The keyboard's path to the same action, and only that: a `click`
            // the mouse produced always carries its count in `detail`, and a
            // press already reset on its release. Ignoring those is what stops
            // the click that ends a drag from undoing the move just made —
            // without a flag that has to outlive the gesture to say so.
            onClick={(event) => {
              if (event.detail === 0) drag.reset();
            }}
            className={cn(
              "text-faint hover:text-muted-foreground focus-visible:focus-ring",
              drag.dragging ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            <GripVertical aria-hidden="true" className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Close bindings panel"
            // Without this the close button is also the start of a drag.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPanelOpen(false)}
            className="rounded-xs text-muted-foreground hover:text-foreground focus-visible:focus-ring"
          >
            <X className="size-3.5" />
          </button>
        </CardAction>
      </CardHeader>

      <CardContent
        aria-disabled={held || undefined}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto",
          held && "pointer-events-none opacity-55",
        )}
      >
        {order.length === 0 ? (
          <EmptyState title="No bindings" description="This view declares no data paths." />
        ) : (
          order.map((path) => (
            <div key={path} data-binding-path={path}>
              {/* The panel owns the list and its order; the field owns everything inside it. */}
              {/* `disabled` as well as the container's `pointer-events-none`:
                  that one stops the mouse, not a field the Tab key reached. */}
              <BindingField binding={byPath[path]} disabled={held} />
            </div>
          ))
        )}
      </CardContent>

      {held && (
        <CardFooter className="mt-auto bg-warn-surface py-[12px] text-caption text-warn-fg">
          Values held — editor re-enables when the export loads.
        </CardFooter>
      )}
    </Card>
  );
}

export { BindingsPanel };
