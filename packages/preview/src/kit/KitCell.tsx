/**
 * The three pieces every cell of the kit is built out of: the cell itself, the
 * small caps label above each group, and the caption under the ones that need
 * to name what they are showing (`rest · toggled · zen active`).
 *
 * A cell holds ONE component family and may hold two groups of it — the
 * artboard's cells do (`SEGMENTED · DPR` and `ICON BUTTONS` share a column) —
 * which is why the label is a component rather than a prop: the second one is a
 * sibling of the first group, not a header of the cell.
 *
 * `data-kit-cell` is the handle the smoke test counts the page by, and the
 * thing a later ticket can address one cell of the kit with. The label is not
 * enough: it is display text, and display text is allowed to be reworded.
 */

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface KitCellProps extends ComponentProps<"section"> {
  /** Kebab-case, stable: `view-selector`, `binding-inputs`. */
  id: string;
  label: string;
}

function KitCell({ id, label, className, children, ...props }: KitCellProps) {
  return (
    <section data-kit-cell={id} className={cn("flex flex-col gap-3", className)} {...props}>
      <KitLabel>{label}</KitLabel>
      {children}
    </section>
  );
}

/**
 * 10px/600 with .09em of tracking, uppercased in CSS rather than in the string —
 * the same treatment `DropdownMenuLabel` gives the one label inside a menu, so
 * the two cannot drift.
 *
 * `first:mt-0` is what lets a second group inside a cell wear the artboard's 8px
 * of air above it without the cell's own label inheriting it.
 */
function KitLabel({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "mt-2 text-label font-semibold tracking-[.09em] text-muted-foreground uppercase first:mt-0",
        className,
      )}
      {...props}
    />
  );
}

/** The 11px muted line under a group, naming the states it is showing. */
function KitCaption({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-caption text-muted-foreground", className)} {...props} />;
}

export type { KitCellProps };
export { KitCaption, KitCell, KitLabel };
