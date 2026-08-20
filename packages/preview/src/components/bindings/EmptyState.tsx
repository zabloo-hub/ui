/**
 * The dashed placeholder the kit draws for "there is nothing here, and that is
 * fine". Two lines: what is empty, and why it is empty — because "No bindings"
 * on its own reads like something failed to load.
 *
 * The icon is inline SVG rather than a lucide glyph: its dashed outline is the
 * point (an outline of a thing that is not there), and no icon in the set draws
 * one.
 */

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description: string;
  className?: string;
}

function EmptyState({ title, description, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-border border-dashed px-4 py-[22px] text-center",
        className,
      )}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="text-faint">
        <rect
          x="2"
          y="2"
          width="14"
          height="14"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray="3 2.5"
        />
      </svg>
      <span className="text-subtle text-ui font-medium">{title}</span>
      <span className="text-caption text-muted-foreground leading-normal">{description}</span>
    </div>
  );
}

export type { EmptyStateProps };
export { EmptyState };
