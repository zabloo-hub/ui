import { Console } from "@/components/console/Console";
import { Stage } from "@/components/stage/Stage";
import { Statusbar } from "@/components/statusbar/Statusbar";
import { Topbar } from "@/components/topbar/Topbar";
import { useSession } from "@/session";

/**
 * The static stack the whole chrome hangs off: topbar 44px, stage taking what is
 * left, console 198px, statusbar 26px, exactly one viewport tall.
 *
 * The regions live HERE and the children are still empty (V7–V13 fill them), so
 * that the tickets of Batch-10/11 each own one component file and none of them
 * has to come back and edit this one. `data-region` is the handle tests and later
 * tickets address a region by; it survives whatever markup ends up inside.
 *
 * No store and no layout state yet: collapsing the console and zen mode arrive
 * with V4 and V16.
 *
 * The one thing that is not layout is `useSession()`: the whole dev loop — the
 * stream, the loads, the mounted view — hangs off this single call, mounted here
 * because it must outlive every region below it.
 */
export function App() {
  useSession();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header data-region="topbar" className="h-11 shrink-0 border-b">
        <Topbar />
      </header>
      <main data-region="stage" className="min-h-0 flex-1">
        <Stage />
      </main>
      <section data-region="console" aria-label="Console" className="h-[198px] shrink-0 border-t">
        <Console />
      </section>
      <footer data-region="statusbar" className="h-[26px] shrink-0 border-t">
        <Statusbar />
      </footer>
    </div>
  );
}
