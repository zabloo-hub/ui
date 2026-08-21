import { Topbar } from "@/components/topbar/Topbar";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The bar itself, not its parts.
 *
 * Three cells above already mirror the controls one at a time — the view
 * selector, the viewport menu, the segmented DPR, the bindings toggle — and every
 * one of them is composed out of primitives. What none of them can show is the
 * thing the bar IS: the 12/8 rhythm, the wordmark's divider, and the right
 * cluster that `ml-auto` pushes away from everything else. So this is the real
 * `<Topbar>`, reading the same store the tool reads.
 *
 * Frozen, and it is the clearest case for it: every control in here writes
 * something the tool remembers — the preset, the dpr, the theme, the panel flag —
 * and the view selector writes through the one channel the fixture's seal does
 * not cover (`selectView`, straight to storage). A kit you could accidentally
 * change your working preset from is a kit nobody trusts twice.
 *
 * The height is the shell's 44px. The bottom border the shell draws is the
 * specimen's own frame here, which is the same hairline.
 */
function TopbarCell() {
  return (
    <KitCell id="topbar" label="Topbar" className="col-span-3">
      <KitSpecimen frozen>
        <div className="h-11">
          <Topbar />
        </div>
      </KitSpecimen>
      <KitCaption>
        the real bar, frozen — poking it would move the preset, the dpr or the theme the tool
        reopens in
      </KitCaption>
    </KitCell>
  );
}

export { TopbarCell };
