import {
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { useViewport } from "@/store/hooks";
import { type Dpr, isDpr } from "@/store/presets";

/** The four segments, in the order the box draws them. */
const SEGMENTS: readonly { value: Dpr; label: string }[] = [
  // The kit writes this segment "auto" and the topbar writes it "DPR auto"; the
  // toolbar is where it lives, and there it is the only label that says what the
  // box is about.
  { value: "auto", label: "DPR auto" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 3, label: "3×" },
];

/**
 * The pixel ratio the view rasterizes at: the display's own, or a forced 1/2/3 —
 * which is how a 4K panel gets to see what a 1× console will render (ZAB-78).
 *
 * Radix speaks strings and the store speaks `"auto" | 1 | 2 | 3`, so the two are
 * bridged here rather than widening the store's type for a DOM attribute's sake.
 * A deselect (Radix hands back `""` when you press the segment that is already
 * on) is ignored: there is no "no DPR", and a box with nothing lit would be a
 * state the canvas cannot be in.
 *
 * The `<TooltipProvider>` is local. Radix nests them, so this keeps working
 * unchanged the day V7's topbar or V16's shell mounts a global one, and it means
 * the control is whole on its own instead of depending on an ancestor that does
 * not exist yet.
 *
 * **Focusing a segment selects it** (ZAB-109). Radix renders this as a
 * `radiogroup` of `radio`s and moves the focus between them with the arrows, but
 * leaves the selection to Enter — so the arrows walked from `1×` to `2×` with
 * `aria-checked` standing still, which is the one thing a radio group promises
 * not to do. Selecting on focus is that promise kept, and it costs the pointer
 * nothing: a click already selected, and the deselect Radix sends back when you
 * press the segment that is on is ignored either way.
 */
function DprControl() {
  const { dpr, setDpr } = useViewport();

  const change = (value: string): void => {
    const next = value === "auto" ? "auto" : Number(value);
    if (!isDpr(next)) return;
    setDpr(next);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroup
            type="single"
            variant="segmented"
            aria-label="Device pixel ratio"
            value={String(dpr)}
            onValueChange={change}
          >
            {SEGMENTS.map((segment) => (
              <ToggleGroupItem
                key={segment.label}
                value={String(segment.value)}
                onFocus={() => change(String(segment.value))}
              >
                {segment.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </TooltipTrigger>
        <TooltipContent>
          Pixel ratio the view rasterizes at (auto follows the display)
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { DprControl };
