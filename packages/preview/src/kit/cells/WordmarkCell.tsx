import { Wordmark } from "@/components/topbar/Wordmark";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * `▦ zabloo dev` — the smallest thing in the bar, and deliberately so.
 *
 * It has a cell of its own for one reason: the gradient square is the only place
 * the design's two indigos are written down together (`--brand-gradient`), and a
 * page whose job is to prove the palette resolves should be showing it at a size
 * you can look at rather than tucked into the left end of the topbar above.
 */
function WordmarkCell() {
  return (
    <KitCell id="wordmark" label="Wordmark">
      <KitSpecimen className="flex items-center bg-card p-3">
        <Wordmark />
      </KitSpecimen>
      <KitCaption>16px gradient square · 13px name · 10px mono dev</KitCaption>
    </KitCell>
  );
}

export { WordmarkCell };
