import * as React from "react";
import { Card, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { EditorProps } from "./editor";

interface JsonEditorProps extends EditorProps {
  /** The field's own label row, dropped into the card header. */
  label: React.ReactNode;
}

/**
 * Arrays and objects: an inset card whose header is the field's label, and whose
 * body is the value pretty-printed at 10.5px/1.6.
 *
 * "Edit JSON" turns the `<pre>` into a `<textarea>` of the same metrics. What is
 * typed there is not written on every keystroke the way the other editors are —
 * a half-written array is not a value — so it goes at blur or on Cmd/Ctrl+Enter,
 * and only if it parses. Text that does not parse gets the danger border and is
 * KEPT: dropping it on blur would throw away the edit at the exact moment the
 * person went looking for the missing bracket. Esc is the way out.
 *
 * Open by default, as artboard 1a draws it.
 */
function JsonEditor({ id, path, value, disabled, describedBy, onCommit, label }: JsonEditorProps) {
  const [open, setOpen] = React.useState(true);
  // Null while the value is being SHOWN; a string while it is being edited.
  const [draft, setDraft] = React.useState<string | null>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  const invalid = draft !== null && !parses(draft);

  React.useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  const commit = (): void => {
    if (draft === null || !parses(draft)) return;
    onCommit(draft);
    setDraft(null);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card variant="inset" data-slot="json-editor">
        <div className="flex items-center gap-[6px] bg-background px-[10px] py-[7px]">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-[6px] text-left">
            <Disclosure open={open} />
            {label}
          </CollapsibleTrigger>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "ml-auto shrink-0 text-label text-indigo",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={() => {
              setOpen(true);
              setDraft(pretty(value));
            }}
          >
            Edit JSON
          </button>
        </div>
        <CollapsibleContent>
          {editing ? (
            <textarea
              id={id}
              ref={area}
              aria-label={path}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={cn(
                BODY,
                "block w-full resize-y border-border border-t outline-none",
                invalid && "border border-danger",
              )}
              rows={rowsOf(draft)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(null);
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
          ) : (
            <pre className={cn(BODY, "m-0 overflow-x-auto border-border border-t")}>
              {pretty(value)}
            </pre>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/** The one thing the `<pre>` and the `<textarea>` must never disagree about. */
const BODY = "bg-card px-[12px] py-[8px] font-mono text-code leading-[1.6] text-subtle";

/**
 * The disclosure triangle, inline rather than lucide's `ChevronRight`: at 9px a
 * stroked chevron and this filled triangle are different marks, and the design
 * draws the triangle.
 */
function Disclosure({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
    >
      <path d="M3 1.5 7.5 5 3 8.5Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The value as JSON, indent 2. A string is printed as it stands: that is what a
 * `coerce` left behind when the text did not parse, and re-quoting it would make
 * the panel look like it had accepted something it had not.
 */
function pretty(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Grow with the value, up to the point where the panel would be all textarea. */
function rowsOf(text: string): number {
  return Math.min(Math.max(text.split("\n").length, 3), 12);
}

export { JsonEditor, type JsonEditorProps };
