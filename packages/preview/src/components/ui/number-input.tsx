import * as React from "react";
import { InputFrame } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The number editor of the bindings panel: an input with a stepper column glued
 * to its right edge inside the same 28px frame.
 *
 * shadcn has no number input, and the native spinner is not this — it only shows
 * on hover, it is a different size in every browser, and the design draws two
 * 8px triangles stacked with a hairline between them. So the spinner is hidden
 * and the arrows are real buttons.
 *
 * `<input type="number">` underneath, though, because it is worth an implicit
 * `role="spinbutton"` and `aria-valuemin`/`aria-valuemax` for free. The arrow
 * keys are handled here instead of natively so that Shift can mean
 * {@link NumberInputProps.shiftStep} — a gold value moves in 10s, not in 1s.
 */
interface NumberInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value?: number;
  onValueChange?: (value: number) => void;
  /** Arrow keys and the stepper buttons move by this. */
  step?: number;
  /** …and by this while Shift is held. Ten steps unless given. */
  shiftStep?: number;
  min?: number;
  max?: number;
}

/** Keeps 0.1 + 0.2 from surfacing in a bindings panel. */
function round(value: number): number {
  return Number(value.toFixed(6));
}

function NumberInput({
  className,
  value,
  onValueChange,
  step = 1,
  shiftStep,
  min,
  max,
  disabled,
  onKeyDown,
  onBlur,
  ...props
}: NumberInputProps) {
  // Null while the field is showing exactly what the user typed — "" and "-" are
  // states a number cannot represent, and echoing `value` back over them mid-word
  // is how a field starts eating keystrokes.
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? (value === undefined ? "" : String(value));

  const clamp = (next: number): number => {
    if (min !== undefined && next < min) return min;
    if (max !== undefined && next > max) return max;
    return next;
  };

  const nudge = (direction: 1 | -1, shift: boolean): void => {
    const delta = (shift ? (shiftStep ?? step * 10) : step) * direction;
    setDraft(null);
    onValueChange?.(clamp(round((value ?? 0) + delta)));
  };

  return (
    <InputFrame className={cn("px-0", className)} data-slot="number-input" data-disabled={disabled}>
      <input
        type="number"
        data-slot="number-input-field"
        className={cn(
          "h-full min-w-0 flex-1 border-0 bg-transparent px-[10px] outline-none",
          "font-mono text-[12px] text-foreground placeholder:text-muted-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
          // The native spinner would sit exactly where our stepper is.
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
          "[&::-webkit-outer-spin-button]:appearance-none",
        )}
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(parsed)) {
            onValueChange?.(parsed);
          }
        }}
        onBlur={(event) => {
          setDraft(null);
          if (value !== undefined) {
            const clamped = clamp(value);
            if (clamped !== value) onValueChange?.(clamped);
          }
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            nudge(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
          }
          onKeyDown?.(event);
        }}
        {...props}
      />
      <span className="flex h-full flex-col self-stretch border-border border-l">
        <NumberInputStep
          label="Increase"
          glyph="▲"
          disabled={disabled}
          onClick={(event) => nudge(1, event.shiftKey)}
        />
        <NumberInputStep
          label="Decrease"
          glyph="▼"
          disabled={disabled}
          className="border-border border-t"
          onClick={(event) => nudge(-1, event.shiftKey)}
        />
      </span>
    </InputFrame>
  );
}

/**
 * `tabIndex={-1}`: the field itself is a spinbutton and already takes the arrow
 * keys, so putting two more stops in the tab order would only make the panel
 * three times longer to walk through.
 */
function NumberInputStep({
  label,
  glyph,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string; glyph: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      className={cn(
        "flex flex-1 items-center justify-center px-[7px] py-px",
        "text-[8px] leading-[1.2] text-muted-foreground transition-colors",
        "hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {glyph}
    </button>
  );
}

export { NumberInput, type NumberInputProps };
