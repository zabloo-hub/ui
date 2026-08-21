import { useEffect, useRef, useState } from "react";
import { Input, NumberInput } from "@/components/ui";
import { displayText, type EditorProps } from "./editor";

/**
 * V3's `NumberInput` — 28px, stepper, ↑/↓ with ×10 on Shift — for a path the
 * envelope types as a number.
 *
 * The value it holds, though, is not guaranteed to BE one: the type comes from
 * the binding site and the game can `SetData` anything into it. A string is
 * shown as it is, in a plain field, and the type tag does not change — the panel
 * reports what the game did rather than hiding it behind a `NaN`.
 *
 * Which of the two controls is on screen is decided only while nobody is typing
 * in it. Editing `"eighty"` into `"80"` makes the value numeric at the first
 * digit, and re-deciding there would swap the control under the cursor and eat
 * the rest of the word.
 */
function NumberEditor({ id, value, disabled, describedBy, onCommit }: EditorProps) {
  const [numeric, setNumeric] = useState(() => isNumeric(value));
  const typing = useRef(false);

  useEffect(() => {
    if (typing.current) return;
    setNumeric(isNumeric(value));
  }, [value]);

  const focus = {
    onFocus: () => {
      typing.current = true;
    },
    onBlur: () => {
      typing.current = false;
      setNumeric(isNumeric(value));
    },
  };

  if (numeric) {
    return (
      <NumberInput
        id={id}
        aria-describedby={describedBy}
        value={typeof value === "number" ? value : undefined}
        disabled={disabled}
        onValueChange={onCommit}
        {...focus}
      />
    );
  }

  return (
    <Input
      id={id}
      aria-describedby={describedBy}
      value={displayText(value)}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.value)}
      {...focus}
    />
  );
}

/** A path with no value yet is a number waiting to happen, not a string. */
function isNumeric(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

export { NumberEditor };
