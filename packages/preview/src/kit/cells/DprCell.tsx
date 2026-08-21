import { Maximize, Moon, Sun } from "lucide-react";
import * as React from "react";
import { Button, ToggleGroup, ToggleGroupItem } from "@/components/ui";
import { KitCaption, KitCell, KitLabel } from "@/kit/KitCell";

/**
 * The segmented DPR box and the three icon buttons, which share a column in the
 * artboard.
 *
 * The segments are written `auto · 1× · 2× · 3×` and not `DPR auto`: the topbar
 * needs the longer label because there it is the only thing naming the control,
 * and here the section label above it already does (`DprControl` says the same
 * in reverse).
 *
 * The three buttons are one component in three states, so they are drawn with
 * the attributes that produce them rather than with three sets of classes:
 * nothing for rest, `aria-pressed` for the muted toggled state of the theme
 * button, `data-active` for the indigo of zen.
 */
function DprCell() {
  const [dpr, setDpr] = React.useState("auto");

  return (
    <KitCell id="segmented-dpr" label="Segmented · DPR">
      <ToggleGroup
        type="single"
        variant="segmented"
        aria-label="Device pixel ratio"
        value={dpr}
        onValueChange={(value) => value !== "" && setDpr(value)}
      >
        {["auto", "1×", "2×", "3×"].map((segment) => (
          <ToggleGroupItem key={segment} value={segment}>
            {segment}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <KitLabel>Icon buttons</KitLabel>
      <div className="flex gap-2">
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Sun className="size-[15px]" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Theme, toggled" aria-pressed="true">
          <Moon />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Zen mode, active" data-active>
          <Maximize />
        </Button>
      </div>
      <KitCaption>rest · toggled · zen active</KitCaption>
    </KitCell>
  );
}

export { DprCell };
