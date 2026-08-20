import * as React from "react";
import { coerceTyped } from "@/bridge";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { type Binding, useStore } from "@/store";
import { BooleanEditor } from "./BooleanEditor";
import { JsonEditor } from "./JsonEditor";
import { NumberEditor } from "./NumberEditor";
import { StringEditor } from "./StringEditor";

/** How long the `← UI` mark stays up before the field clears it itself. */
const UI_MARK_MS = 4000;

interface BindingFieldProps {
  binding: Binding;
  /** The panel's error state: values are held and shown, but not editable. */
  disabled?: boolean;
}

/**
 * One declared path: its label, its type tag, and the editor its type calls for.
 *
 * The traffic here goes BOTH ways, which is the whole point of a two-way
 * binding (ZAB-23). The editor writes (`setFromEditor` → the session → `setData`)
 * and a control on the canvas writes back (`onDataChanged` → `setFromUI`), and a
 * write from the canvas has to be VISIBLE or the panel is lying about what the
 * game holds: the field wears the indigo row and the `← UI` chip for four
 * seconds, or until the next edit of its own — which the store already clears in
 * `setFromEditor`.
 *
 * Everything typed lives here rather than in the four editors: they are handed a
 * value and hand back what was done to it (`editor.ts`), and this is what knows
 * about the store, the mark and the clock.
 */
function BindingField({ binding, disabled }: BindingFieldProps) {
  const id = React.useId();
  const tagId = `${id}-type`;
  const field = React.useRef<HTMLDivElement>(null);
  const setFromEditor = useStore((state) => state.setFromEditor);
  const clearUIMark = useStore((state) => state.clearUIMark);
  const value = useHeldValue(binding, field);
  const marked = binding.lastWriteFrom === "ui";

  React.useEffect(() => {
    if (binding.lastWriteFrom !== "ui" || binding.writtenAt === null) return;
    // Four seconds from the WRITE, not from this effect: a panel that is closed
    // and reopened three seconds later has one second of mark left, not four.
    const left = Math.max(0, UI_MARK_MS - (Date.now() - binding.writtenAt));
    const timer = setTimeout(() => clearUIMark(binding.path), left);
    return () => clearTimeout(timer);
  }, [binding.lastWriteFrom, binding.writtenAt, binding.path, clearUIMark]);

  const editor = {
    id,
    path: binding.path,
    value,
    disabled,
    describedBy: tagId,
    onCommit: (raw: unknown) => setFromEditor(binding.path, coerceTyped(binding.type, raw)),
  };

  const label = (
    <FieldLabel
      htmlFor={binding.type === "array" || binding.type === "object" ? undefined : id}
      path={binding.path}
      tag={typeTag(binding.type, value)}
      tagId={tagId}
      marked={marked}
    />
  );

  return (
    <div
      ref={field}
      data-slot="binding-field"
      data-path={binding.path}
      data-ui-mark={marked || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-[5px]",
        // A boolean is one row: the path on the left, the switch on the right.
        // The right padding is the marked row's own, once it has one.
        binding.type === "boolean" && "flex-row items-center justify-between gap-[6px]",
        binding.type === "boolean" && !marked && "pr-[10px]",
        marked && "rounded-lg border border-indigo-soft-border bg-indigo-soft px-[10px] py-[8px]",
      )}
    >
      {binding.type === "array" || binding.type === "object" ? (
        <JsonEditor {...editor} label={label} />
      ) : (
        <>
          {label}
          {binding.type === "boolean" ? (
            <BooleanEditor {...editor} />
          ) : binding.type === "number" ? (
            <NumberEditor {...editor} />
          ) : (
            <StringEditor {...editor} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The path, and next to it either the type tag or the `← UI` chip — the design
 * swaps one for the other rather than showing both, and a 296px panel is why.
 *
 * The tag does not leave the accessibility tree with it: it is what
 * `aria-describedby` points at, so it stays as text and only stops being drawn.
 *
 * `htmlFor` is left out for the JSON editor alone. A `<label>` is interactive
 * content, this one sits inside the collapsible's trigger BUTTON, and the
 * textarea it would name does not exist until someone clicks "Edit JSON" —
 * so there it is a plain span and the textarea names itself.
 */
function FieldLabel({
  htmlFor,
  path,
  tag,
  tagId,
  marked,
}: {
  htmlFor?: string;
  path: string;
  tag: string;
  tagId: string;
  marked: boolean;
}) {
  const text = "truncate font-mono text-log font-medium leading-none";

  return (
    <div className="flex min-w-0 items-center gap-[6px]">
      {htmlFor === undefined ? (
        <span className={text}>{path}</span>
      ) : (
        <label htmlFor={htmlFor} className={text}>
          {path}
        </label>
      )}
      {marked && <Badge variant="ui-chip">← UI</Badge>}
      <Badge variant="type-tag" id={tagId} className={cn(marked && "sr-only")}>
        {tag}
      </Badge>
    </div>
  );
}

/** `array(4)` needs an array to count; the type tag itself never moves. */
function typeTag(type: Binding["type"], value: unknown): string {
  if (type === "array" && Array.isArray(value)) return `array(${value.length})`;
  return type;
}

/**
 * The value the field shows, which is the store's — except while the person is
 * typing in it.
 *
 * A control on the canvas writing to the path someone is editing must not take
 * the text out from under them, so a write from `'ui'` that lands on a focused
 * field is PARKED and applied when the field is left. A write from `'editor'` is
 * their own keystroke coming back through the store and is never held: parking
 * that one is how a stepper snaps back to a stale number.
 */
function useHeldValue(binding: Binding, field: React.RefObject<HTMLDivElement | null>): unknown {
  const [held, setHeld] = React.useState(binding.value);
  const parked = React.useRef<{ value: unknown } | null>(null);

  React.useEffect(() => {
    const focused = field.current?.contains(document.activeElement) ?? false;
    if (focused && binding.lastWriteFrom === "ui") {
      parked.current = { value: binding.value };
      return;
    }
    parked.current = null;
    setHeld(binding.value);
  }, [binding.value, binding.lastWriteFrom, field]);

  // `focusout` on the node rather than React's `onBlur` on the div: it is the
  // same event, but a div that listens for one is a div that owes the reader a
  // role, and this one is a wrapper and not a widget.
  React.useEffect(() => {
    const node = field.current;
    if (node === null) return;
    const left = (event: FocusEvent): void => {
      if (parked.current === null) return;
      // Moving between the two halves of a number input is not leaving the field.
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      setHeld(parked.current.value);
      parked.current = null;
    };
    node.addEventListener("focusout", left);
    return () => node.removeEventListener("focusout", left);
  }, [field]);

  return held;
}

export { BindingField, type BindingFieldProps, UI_MARK_MS };
