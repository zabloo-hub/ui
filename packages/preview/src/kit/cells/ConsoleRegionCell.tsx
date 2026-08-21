import { Console } from "@/components/console/Console";
import { KitCaption, KitCell, KitSpecimen } from "@/kit/KitCell";

/**
 * The console as the shell mounts it: the tab strip, the count badge, Clear, the
 * collapse chevron, and whichever of the three tabs is open under them.
 *
 * `ConsoleCell` above mirrors the artboard's specimen of the strip — three pills
 * and a table of stats, side by side, neither of them wired to the other. This is
 * the component, and it is LIVE: the tabs switch, so the three bodies the chrome
 * actually has are all one click away. Which is the only way to see the rows of
 * `ProblemsTab` and the lines of `ActionsTab` next to the primitives they are
 * made of.
 *
 * What it writes is the open flag and the current tab — remembered fields, and
 * unreachable ones here: the store's persistence is sealed for this page
 * (`fixture.ts`). The one write that seal does not cover is a Problems row that
 * jumps to another view, and the fixture's diagnostics deliberately name no view,
 * so no row is a button. That is what the artboard draws anyway.
 *
 * 198px, the height the shell reserves. The tabs are worth poking: `Actions` is
 * seeded with the three line types, `Problems` with the two severities plus the
 * export failure that gets its own `<pre>`, and `Stats` reads a frame that was
 * seeded rather than painted — which is why its `fps` falls to `idle` a moment
 * after you open it, exactly as it does over a still scene in the real tool.
 */
function ConsoleRegionCell() {
  return (
    <KitCell id="console" label="Console" className="col-span-3">
      <KitSpecimen className="h-[198px]">
        <Console />
      </KitSpecimen>
      <KitCaption>
        live — switch tabs for the action log, the diagnostics and the frame table
      </KitCaption>
    </KitCell>
  );
}

export { ConsoleRegionCell };
