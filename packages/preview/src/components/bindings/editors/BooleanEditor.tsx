import { coerceTyped } from "@/bridge";
import { Switch } from "@/components/ui";
import type { EditorProps } from "./editor";

/**
 * The 36×20 Switch of the design, to the right of its path.
 *
 * The value goes through `coerceTyped` on the way IN as well as out: what a
 * control writes back is whatever the game's runtime had — Unity pushing `1`
 * for a checkbox is not a bug to render as "off" — while what the switch itself
 * produces is already a boolean and comes through untouched.
 */
function BooleanEditor({ id, value, disabled, describedBy, onCommit }: EditorProps) {
  return (
    <Switch
      id={id}
      aria-describedby={describedBy}
      checked={coerceTyped("boolean", value) === true}
      disabled={disabled}
      onCheckedChange={onCommit}
    />
  );
}

export { BooleanEditor };
