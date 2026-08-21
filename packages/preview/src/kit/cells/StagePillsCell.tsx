import { StalePill } from "@/components/stage/StalePill";
import { ZenPill } from "@/components/zen/ZenPill";
import { KitCaption, KitCell, KitLabel, KitSpecimen } from "@/kit/KitCell";

/**
 * The two pills that float over the stage instead of sitting in a bar.
 *
 * They share a cell because they share a surface — both are drawn ON the stage,
 * both are positioned absolutely against it, and both are only legible over that
 * grey. A specimen of either on the card behind this page would be showing a
 * colour neither of them is ever seen on: the stale pill is `bg-foreground`,
 * which on the card is the same near-black as the text next to it.
 *
 * The stage cell above shows the stale pill in place, at the top of the frame it
 * belongs to. This one shows it at rest, and is where it stays visible while the
 * scenario is live.
 *
 * Two columns wide, and that is the pills' own geometry talking: both are
 * absolutely positioned against the stage, and an absolute box that starts at
 * `left: 50%` can only claim the half of its container that is left of the right
 * edge. In a single column the stale pill's one line would wrap into two — which
 * is a true thing about a narrow stage, and a false thing about the pill.
 *
 * The zen pill is frozen: its one button leaves zen, which is a store write. The
 * rest of it is a read — the dot's colour and the caption follow the scenario,
 * which is exactly what the pill is for, since in zen it is the only chrome
 * left on the screen.
 */
function StagePillsCell() {
  return (
    <KitCell id="stage-pills" label="Stale pill" className="col-span-2">
      <KitSpecimen className="relative h-[64px] bg-stage">
        <StalePill />
      </KitSpecimen>

      <KitLabel>Zen pill</KitLabel>
      <KitSpecimen frozen className="relative h-[64px] bg-stage">
        <ZenPill />
      </KitSpecimen>
      <KitCaption>glass over the stage · dot follows the scenario</KitCaption>
    </KitCell>
  );
}

export { StagePillsCell };
