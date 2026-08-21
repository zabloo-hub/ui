import { BindingsPanel } from "@/components/bindings/BindingsPanel";
import { Console } from "@/components/console/Console";
import { Stage } from "@/components/stage/Stage";
import { Statusbar } from "@/components/statusbar/Statusbar";
import { Topbar } from "@/components/topbar/Topbar";
import { ZenPill } from "@/components/zen/ZenPill";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";

/**
 * The stack the whole chrome hangs off — topbar 44, stage taking what is left,
 * console 198 (34 collapsed), statusbar 26 — and the two ways the store bends it.
 *
 * The shell owns those heights rather than the regions, because one of them is a
 * question only the store can answer and the rest have to add up against it. The
 * regions own everything inside; `data-region` is the handle tests and later
 * tickets address one by, and it survives whatever markup ends up in there.
 *
 * Zen UNMOUNTS the three bars instead of hiding them: everything they show lives
 * in the store, so there is nothing to preserve, and leaving V11's log and V12's
 * stats subscribed while nobody can see them is work done for no one. The
 * bindings panel is the exception, and not by omission — it already refuses to
 * draw in zen (V14), and splitting that one decision across two files is how the
 * two of them end up disagreeing. The shell mounts it in the stage, which is the
 * `position: relative` container it needs, and leaves the rest to it.
 *
 * What must not move is the stage — remounting it would take the WebGL context
 * down with it and cost a full reload of the scene — so it keeps its slot in a
 * static children list and only its siblings come and go.
 *
 * Two selectors rather than `useLayout()`: this is the chrome's root, and the
 * slice also carries writes that are none of its business — the panel position a
 * drag commits on release, the console toggle. Through the slice hook, every one
 * of them would re-render the whole shell.
 */
function AppShell() {
  const zen = useStore((state) => state.layout.zen);
  const consoleOpen = useStore((state) => state.layout.consoleOpen);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {!zen && (
        <header data-region="topbar" className="h-11 shrink-0 border-b">
          <Topbar />
        </header>
      )}
      <main data-region="stage" className="relative min-h-0 flex-1">
        <Stage />
        <BindingsPanel />
        {zen && <ZenPill />}
      </main>
      {!zen && (
        <section
          data-region="console"
          aria-label="Console"
          className={cn("shrink-0 border-t", consoleOpen ? "h-[198px]" : "h-[34px]")}
        >
          <Console />
        </section>
      )}
      {!zen && (
        <footer data-region="statusbar" className="h-[26px] shrink-0 border-t">
          <Statusbar />
        </footer>
      )}
    </div>
  );
}

export { AppShell };
