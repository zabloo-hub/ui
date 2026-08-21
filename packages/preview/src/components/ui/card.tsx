import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Two cards in the design and they are not the same object: the bindings panel
 * floats over the canvas (radius 10, big soft shadow) and the JSON editor sits
 * inside it (radius 8, flat). Hence `floating` and `inset` rather than shadcn's
 * one size with a `sm` spacing knob.
 *
 * The generated card's `--card-spacing` machinery, its `ring-1` outline and its
 * first/last-image rounding are gone — a 1px border is what the design draws,
 * and no card in this chrome holds an image.
 */
const cardVariants = cva("flex min-w-0 flex-col overflow-hidden border border-border bg-card", {
  variants: {
    variant: {
      /** The bindings panel, over the stage. */
      floating: "rounded-xl shadow-panel",
      /** The JSON editor, inside it. */
      inset: "rounded-lg",
    },
  },
  defaultVariants: {
    variant: "floating",
  },
});

function Card({
  className,
  variant = "floating",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex items-center gap-2 border-border border-b px-[14px] pt-[12px] pb-[10px]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-title" className={cn("text-ui font-semibold", className)} {...props} />
  );
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-code text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("ml-auto flex shrink-0 items-center gap-2.5", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-h-0 px-[14px] py-[12px]", className)}
      {...props}
    />
  );
}

/** The amber "values held" note under a disabled panel. */
function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center border-border border-t px-[14px] py-[8px]", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
};
