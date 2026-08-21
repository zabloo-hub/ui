import * as React from "react";
import { Badge, Input, NumberInput, Switch } from "@/components/ui";
import { KitCell } from "@/kit/KitCell";

/**
 * The four controls a bindings field can be, in the 230px column the artboard
 * draws them in: the switch off and on, the number with its stepper, an input
 * showing the focus ring, and the row a write from the canvas leaves behind.
 *
 * The focused input wears `focus-ring` as a plain class instead of being really
 * focused. `autoFocus` would work exactly once — the page would scroll to this
 * cell on load, and clicking anywhere else would take the state away, which is
 * the one state this cell exists to hold still. The utility is V2's, so it is
 * the same 1.5px border and 3px halo the real `:focus-visible` produces. The
 * artboard also draws a caret next to the word; a real input draws its own when
 * it really has focus, so a painted one is left out.
 *
 * The two-way row is hand-composed rather than borrowed from `BindingField`, and
 * that is what this cell is: the CONTROLS a field can hold, drawn as the artboard
 * draws them, without the field around them. The real one is on the second sheet
 * (`BindingFieldsCell`), mark and all — it gets the marked state by being handed a
 * frozen binding, since the field starts a four-second timer to clear it and a kit
 * page that quietly undressed itself four seconds after load would be showing the
 * one state it was asked to show the least.
 */
function BindingInputsCell() {
  const [gold, setGold] = React.useState(1250);

  return (
    <KitCell id="binding-inputs" label="Binding inputs">
      <div className="flex w-[230px] flex-col gap-[10px]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-log font-medium">bool · off / on</span>
          <span className="flex gap-2">
            <Switch aria-label="bool, off" defaultChecked={false} />
            <Switch aria-label="bool, on" defaultChecked />
          </span>
        </div>

        <NumberInput aria-label="player.gold" value={gold} onValueChange={setGold} />

        <Input aria-label="Focused input" defaultValue="focused" className="focus-ring" />

        <div className="flex items-center justify-between rounded-lg border border-indigo-soft-border bg-indigo-soft px-[10px] py-[7px]">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-log font-medium">two-way write</span>
            <Badge variant="ui-chip">← UI</Badge>
          </span>
          <Switch aria-label="two-way write" defaultChecked />
        </div>
      </div>
    </KitCell>
  );
}

export { BindingInputsCell };
