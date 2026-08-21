import { BindingsPanel } from "@/components/bindings/BindingsPanel";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The floating panel, in the container it floats in.
 *
 * `PanelCell` on the first sheet draws its header out of the same Card parts the
 * panel uses, which is the artboard's specimen and is all a sheet of primitives
 * can be. What only the component has is the state underneath: at `stale` — or
 * with any fatal — the fields go inert and a footer promises the values are HELD
 * rather than lost, which is the panel's answer to the one question a disabled
 * control always raises. Flip the scenario to watch it appear and go.
 *
 * The specimen is a stage, not a card: the panel is `position: absolute` and the
 * shell gives it the stage as its containing block, so a box of stage colour with
 * room in it is the closest thing to where it really lives — top right, 14px in,
 * exactly as it opens.
 *
 * Frozen: the grip moves a remembered position and the × writes the remembered
 * open flag. Its fields are the same ones the cell beside it lets you type in.
 */
function BindingsPanelCell() {
  return (
    <KitCell id="bindings-panel" label="Bindings panel">
      <KitSpecimen frozen className="relative h-[330px] bg-stage">
        <BindingsPanel />
      </KitSpecimen>
      <KitCaption>
        at live it edits · at stale the fields are held and the footer says so
      </KitCaption>
    </KitCell>
  );
}

export { BindingsPanelCell };
