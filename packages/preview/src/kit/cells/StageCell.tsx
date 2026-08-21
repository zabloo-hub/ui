import { Stage } from "@/components/stage/Stage";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The stage, with the geometry that is the whole reason it is three boxes and
 * not one: a frame declared at the preset's size, a box sized to what that
 * becomes on screen, and a `transform` between them.
 *
 * It is mounted at 300px of height precisely so the scale is doing something —
 * the fixture pins Steam Deck, so a 1280×800 frame lands here at something like
 * 30% and the caption says so. That is also why the fixture bothers to set a
 * preset at all: `fit` is the default on a fresh profile and is the one preset
 * with no frame, no border, no shadow and no zoom to read.
 *
 * NOT frozen: the only thing the stage writes is the size it measured, which is
 * this box's, and it has to keep measuring or the zoom in the caption would be a
 * number from some other layout.
 *
 * The canvas is blank on purpose and cannot be otherwise. Nothing paints on it
 * but the renderer, which the session mounts (V6) and `/kit` never starts — the
 * page is a mirror of the chrome, and the picture inside the frame belongs to
 * the developer.
 *
 * In the `stale` scenario this is also where the veil and the pill are shown in
 * place: over the last good render, at the top of the frame, which is the one
 * thing a specimen of the pill on its own cannot say.
 */
function StageCell() {
  return (
    <KitCell id="stage" label="Stage" className="col-span-3">
      <KitSpecimen className="h-[300px]">
        <Stage />
      </KitSpecimen>
      <KitCaption>
        caption · frame · zoom — blank canvas (nothing renders here); the veil and the stale pill
        come with the stale scenario
      </KitCaption>
    </KitCell>
  );
}

export { StageCell };
