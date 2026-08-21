import { Statusbar } from "@/components/statusbar/Statusbar";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The 26px footer, whole: the connection dot and its word, the problem summary,
 * the envelope's filename, the frame reading pushed to the right edge, and the
 * gamepad icon.
 *
 * Live, because nothing in it writes: the only interactive thing is the gamepad
 * button, and it exists to be hovered — its tooltip is the state worth having on
 * this page.
 *
 * Two of its readings answer the scenario switcher, which is the point of showing
 * the whole bar rather than its pieces: `ProblemSummary` has three shapes
 * (`0 problems`, `2 warnings`, `1 fatal · 2 warnings`) and only the fixture can
 * put a fatal in front of it.
 *
 * `Fps` will settle on `idle` within a second whatever the fixture seeds, and that
 * is not the specimen failing. The counter falls to zero because something
 * re-counts the window and no frame arrives to say frames stopped arriving (see
 * `store/stats.ts`); holding `60 fps` here would mean running a frame source
 * behind the page, which is the live mechanism this kit does not mount.
 */
function StatusbarCell() {
  return (
    <KitCell id="statusbar" label="Statusbar" className="col-span-3">
      <KitSpecimen className="h-[26px]">
        <Statusbar />
      </KitSpecimen>
      <KitCaption>
        live — the summary follows the scenario; `idle` is the resting truth of a canvas nobody is
        painting
      </KitCaption>
    </KitCell>
  );
}

export { StatusbarCell };
