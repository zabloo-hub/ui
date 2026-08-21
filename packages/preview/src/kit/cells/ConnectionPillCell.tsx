import { ConnectionPill } from "@/components/topbar/ConnectionPill";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The pill the topbar puts alone on the right, and the component the kit was
 * missing most.
 *
 * `BadgesCell` draws the three `Badge` variants it wears — that is the primitive,
 * and it is genuinely all three at once, which this cell cannot be. What that one
 * cannot show is the BRANCH: at `stale`, and only once there is an error to put
 * in it, the pill stops being a span and becomes a `<button>` with a tooltip,
 * because a tooltip nobody can focus is a tooltip half the users of a dev tool
 * never see, and Radix needs a real interactive trigger to give it to them.
 *
 * Live, and meant to be poked — hover it or tab to it. It writes nothing at all.
 */
function ConnectionPillCell() {
  return (
    <KitCell id="connection-pill" label="Connection pill">
      <KitSpecimen className="flex items-center bg-card p-3">
        <ConnectionPill />
      </KitSpecimen>
      <KitCaption>follows the scenario · at stale it grows the error tooltip</KitCaption>
    </KitCell>
  );
}

export { ConnectionPillCell };
