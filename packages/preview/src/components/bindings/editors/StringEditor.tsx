import { Input } from "@/components/ui";
import { displayText, type EditorProps } from "./editor";

/**
 * The 28px mono Input. It writes on every keystroke rather than on blur, like
 * the number editor and like the old page's single text box before it: this
 * panel plays the GAME, and a game pushes a value the moment it has one.
 */
function StringEditor({ id, value, disabled, describedBy, onCommit }: EditorProps) {
  return (
    <Input
      id={id}
      aria-describedby={describedBy}
      value={displayText(value)}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.value)}
    />
  );
}

export { StringEditor };
