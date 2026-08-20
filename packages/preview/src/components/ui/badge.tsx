import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Not shadcn's Badge with new colours: the chrome has SEVEN different small
 * labels and only three of them are pills, so the generated `default/secondary/
 * destructive/outline` axis is replaced wholesale by the seven the design draws
 * (artboard 1e, "BADGES"). Sizes are baked into each variant because none of
 * them shares a scale with the others — a 9.5px count badge and a 12px
 * connection pill are different objects that happen to both be small.
 *
 * The connection variants set `--badge-dot` instead of asking the caller to pass
 * a colour to {@link BadgeDot}: the dot is a shade darker than the label it sits
 * next to (`--ok` vs `--ok-fg`), and pairing those by hand at every call site is
 * exactly how a "Live" pill ends up with an amber dot.
 */
const badgeVariants = cva("inline-flex w-fit shrink-0 items-center whitespace-nowrap", {
  variants: {
    variant: {
      /** Connection pills. Padding is asymmetric: the dot needs less room than the text. */
      live: cn(
        "gap-1.5 rounded-full border py-[3px] pr-[10px] pl-[8px] text-[12px] font-medium",
        "border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok-fg)] [--badge-dot:var(--ok)]",
      ),
      stale: cn(
        "gap-1.5 rounded-full border py-[3px] pr-[10px] pl-[8px] text-[12px] font-medium",
        "border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-fg)] [--badge-dot:var(--warn)]",
      ),
      disconnected: cn(
        "gap-1.5 rounded-full border py-[3px] pr-[10px] pl-[8px] text-[12px] font-medium",
        "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-fg)]",
        "[--badge-dot:var(--danger)]",
      ),
      /** The problem count on the Problems tab. White on red in both themes. */
      count: "rounded-full bg-[var(--danger)] px-[6px] py-px text-[9.5px] font-semibold text-white",
      /** The fps readout in the statusbar. */
      "mono-chip":
        "rounded-[5px] border border-border px-[7px] py-[2px] font-mono text-[10.5px] text-muted-foreground",
      /** `number`, `string`, `boolean`, `array(4)` next to a binding path. */
      "type-tag":
        "rounded-[4px] border border-border px-[5px] py-px text-[9.5px] text-muted-foreground",
      /** `← UI`: the canvas wrote this value back. */
      "ui-chip": cn(
        "rounded-[4px] bg-[var(--indigo-chip)] px-[5px] py-px",
        "font-mono text-[9.5px] font-medium text-[var(--indigo)]",
      ),
      /**
       * Diagnostic severity. The mockup draws 1px 6px in artboard 1b and 2px 7px
       * in 1e for the same chip; ZAB-84 fixes it at 1px 6px.
       */
      "severity-fatal": cn(
        "rounded-[4px] bg-[var(--danger-bg)] px-[6px] py-px",
        "font-mono text-[9.5px] font-medium text-[var(--danger-fg)]",
      ),
      "severity-warn": cn(
        "rounded-[4px] bg-[var(--warn-bg)] px-[6px] py-px",
        "font-mono text-[9.5px] font-medium text-[var(--warn-fg)]",
      ),
    },
  },
  defaultVariants: {
    variant: "live",
  },
});

function Badge({
  className,
  variant = "live",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * The 7px dot of a connection pill. It reads its colour off the pill, so it is
 * only ever correct — see the note on {@link badgeVariants}.
 */
function BadgeDot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="badge-dot"
      className={cn("size-[7px] shrink-0 rounded-full bg-[var(--badge-dot)]", className)}
      {...props}
    />
  );
}

export { Badge, BadgeDot, badgeVariants };
