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

import type * as React from "react";
import { cn } from "@/lib/utils";

interface KitCellProps extends React.ComponentProps<"section"> {
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
 *
 * An `h3`: the page is an `h1`, each sheet an `h2`, and a cell sits inside one of
 * them. The level is not what makes it look like this — the small caps are — so
 * the outline is free to be the true one.
 */
function KitLabel({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "mt-2 text-label font-semibold tracking-[.09em] text-muted-foreground uppercase first:mt-0",
        className,
      )}
      {...props}
    />
  );
}

/** The 11px muted line under a group, naming the states it is showing. */
function KitCaption({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-caption text-muted-foreground", className)} {...props} />;
}

interface KitSpecimenProps extends React.ComponentProps<"div"> {
  /**
   * The component inside writes to the store when it is poked. See the note
   * below for what that costs and why the answer is `inert`.
   */
  frozen?: boolean;
}

/**
 * The frame a REAL chrome component is mounted in — the other half of the kit,
 * next to the cells that compose a specimen out of primitives.
 *
 * The hairline is not decoration: a topbar or a statusbar is a full-width band
 * with its own surface, and without a box around it the specimen would read as
 * part of the page rather than as a thing being shown.
 *
 * `frozen` renders the subtree `inert`, which is how a live component becomes a
 * specimen: identical markup, identical styles, but no pointer, no focus and no
 * tab stop. It is on the ones that WRITE — the topbar's pickers move the preset,
 * the dpr, the theme and the panel flag; the zen pill leaves zen — and `/kit`
 * shares one browser with the real preview. The store's persistence is sealed
 * (`fixture.ts`), so a click could not reach the disk anyway; `inert` is what
 * keeps the page honest about what it is, which is a mirror. Everything that only
 * READS stays live and is meant to be poked: the connection pill's tooltip, the
 * console's tabs, the typed editors.
 */
function KitSpecimen({ frozen, className, ...props }: KitSpecimenProps) {
  return (
    <div
      data-kit-specimen=""
      inert={frozen}
      className={cn("overflow-hidden rounded-md border border-border", className)}
      {...props}
    />
  );
}

export type { KitCellProps, KitSpecimenProps };
export { KitCaption, KitCell, KitLabel, KitSpecimen };
