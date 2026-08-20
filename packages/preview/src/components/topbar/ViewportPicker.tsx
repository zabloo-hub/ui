import { ChevronDown, Monitor } from "lucide-react";
import * as React from "react";
import {
  Button,
  DropdownMenuValue,
  dropdownMenuItemVariants,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useViewport } from "@/store/hooks";
import { PRESETS, type PresetId, parseSize, preset, type Size } from "@/store/presets";

/**
 * What the UI is laid out at, as a named preset — the picker ZAB-78 asked for
 * when it replaced a canvas that took whatever the window gave it.
 *
 * A `<Popover>` and not a `<DropdownMenu>`, which is the one place this file
 * departs from the ticket and the reason V3 shipped a popover at all: the custom
 * row holds two inputs, and a Radix menu answers typing with its own typeahead,
 * so the `1` of `1512` would jump the highlight to `1080p` instead of landing in
 * the field. The rows still wear `dropdownMenuItemVariants`, so the menu's look —
 * 5px 9px, indigo-soft when active — lives in the primitive and not in a copy of
 * its class string. What is lost is arrow-key travel through the list; Tab
 * reaches every row, and a dev tool's viewport picker is not a keyboard surface.
 *
 * Nothing here touches the canvas: it writes the store, and V10's Stage is what
 * turns `viewport`/`custom` into pixels.
 */
function ViewportPicker() {
  const { preset: current, custom, setPreset, setCustom } = useViewport();
  const [open, setOpen] = React.useState(false);
  const content = React.useRef<HTMLDivElement>(null);

  // Focus the surface, not the first row. Radix's focus scope goes to the first
  // focusable descendant, and a row wearing `focus:bg-accent` reads as hovered —
  // so opening the picker would highlight `Fit window` before the pointer had
  // touched anything, and hide the indigo of the active row whenever the two are
  // the same. The content is `tabIndex={-1}`, so Tab still walks into the list.
  const keepFocusOnSurface = (event: Event): void => {
    event.preventDefault();
    content.current?.focus();
  };

  const choose = (id: PresetId): void => {
    setPreset(id);
    setOpen(false);
  };

  const apply = (size: Size): void => {
    // In this order, which is what the button means: the size the `custom`
    // preset lays out at, and then the switch onto it. `setCustom` deliberately
    // does not switch by itself — typing a number must not yank the canvas out
    // from under the preset you are still looking at.
    setCustom(size);
    setPreset("custom");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Viewport">
          <Monitor className="size-[13px] text-muted-foreground" />
          <span>{preset(current).label}</span>
          <TriggerSize id={current} custom={custom} />
          <ChevronDown className="size-[10px] text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        onOpenAutoFocus={keepFocusOnSurface}
        className="w-[230px] gap-0 overflow-hidden p-0"
      >
        <div className="flex flex-col gap-px p-[6px]">
          {/* `custom` is dropped from the list: the footer IS it, and a row that
              opens nothing would say the same thing twice. `fit` stays, and is
              the one row with no resolution beside it. */}
          {PRESETS.filter((candidate) => candidate.id !== "custom").map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              // Spelled out because the label and the resolution are two
              // elements with a flex gap between them and no whitespace: read as
              // one name they would come out glued ("Switch1280×720").
              aria-label={
                candidate.size === null
                  ? candidate.label
                  : `${candidate.label} ${formatSize(candidate.size)}`
              }
              data-active={candidate.id === current || undefined}
              onClick={() => choose(candidate.id)}
              className={cn(dropdownMenuItemVariants(), "w-full justify-between text-left")}
            >
              <span>{candidate.label}</span>
              {candidate.size !== null && (
                <DropdownMenuValue>{formatSize(candidate.size)}</DropdownMenuValue>
              )}
            </button>
          ))}
        </div>
        <CustomRow seed={custom} onApply={apply} />
      </PopoverContent>
    </Popover>
  );
}

/** The trigger's right half: the resolution, in mono, or nothing under `fit`. */
function TriggerSize({ id, custom }: { id: PresetId; custom: Size }) {
  const size = id === "custom" ? custom : preset(id).size;
  if (size === null) return null;
  return (
    <span className="font-mono text-caption font-normal text-muted-foreground">
      {formatSize(size)}
    </span>
  );
}

/**
 * The footer: `Custom · [W] × [H] · Set`.
 *
 * The two boxes are drafts, not the store — seeded from the remembered custom
 * size, and seeded again on every open because Radix unmounts a closed popover's
 * content, so a size typed and abandoned does not survive as a half-edit. A draft that is empty, not a number
 * or below 1 only disables the button: a box mid-word is not an error to shout
 * about, which is the same forgiveness `parseViewport` showed in ZAB-78 and
 * `normalize` shows in the slice today.
 */
function CustomRow({ seed, onApply }: { seed: Size; onApply: (size: Size) => void }) {
  const [width, setWidth] = React.useState(String(seed.width));
  const [height, setHeight] = React.useState(String(seed.height));

  const size = parseDraft(width, height);

  const submit = (): void => {
    if (size === null) return;
    onApply(size);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="flex items-center gap-[6px] border-t border-border p-[9px]">
      <span className="text-ui text-subtle">Custom</span>
      <Input
        size="xs"
        inputMode="numeric"
        aria-label="Custom width"
        value={width}
        onChange={(event) => setWidth(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="text-ui text-muted-foreground">×</span>
      <Input
        size="xs"
        inputMode="numeric"
        aria-label="Custom height"
        value={height}
        onChange={(event) => setHeight(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button size="xs" className="ml-auto" disabled={size === null} onClick={submit}>
        Set
      </Button>
    </div>
  );
}

/**
 * The pair of boxes as one size. It goes through `parseSize` rather than reading
 * two numbers here so that what counts as a size — the ≥ 1 floor, the five-digit
 * ceiling — is stated once, in `presets.ts`, and cannot drift between the picker
 * and the slice that stores what the picker produced.
 */
function parseDraft(width: string, height: string): Size | null {
  return parseSize(`${width.trim()}x${height.trim()}`);
}

/** `1280×800` — the `×` of the design, not the `x` the parser accepts. */
function formatSize(size: Size): string {
  return `${size.width}×${size.height}`;
}

export { ViewportPicker };
