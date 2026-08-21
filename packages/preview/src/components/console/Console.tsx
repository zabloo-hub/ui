/**
 * The bottom console: three tabs over one body, and the header row that stays
 * visible when the body is not.
 *
 * The old page had no console — the log was a stack of divs floating over the
 * canvas that erased itself after six seconds, and the errors were a red `<pre>`
 * on top of the view you were trying to look at. Both are answers to "where do I
 * put this?" rather than to "where would you look for it?", and the answer to
 * the second one is the bottom of the window, in a drawer, like every other tool
 * on the machine.
 *
 * The console does NOT own its height. The shell reserves 198px open and 34px
 * collapsed (V17) because those two numbers have to add up against the topbar,
 * the stage and the statusbar; this file fills whatever it is given and only
 * fixes the header at 34 so the collapsed case is the header and nothing else.
 *
 * Collapsed UNMOUNTS the body rather than hiding it, for the reason the shell
 * unmounts the bars in zen: every tab reads the store, so there is nothing in
 * their markup worth preserving, and leaving V12's stats recomputing behind a
 * closed drawer is work done for nobody.
 *
 * Picking a tab also OPENS the console. Radix will happily switch tabs on a
 * collapsed console, and a click that visibly does nothing is a click the user
 * repeats — the tab they asked for is the tab they want to see.
 */

import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useActions, useLayout, useProblems } from "@/store/hooks";
import { isConsoleTab } from "@/store/layout";
import { ActionsTab } from "./ActionsTab";
import { ProblemsTab } from "./ProblemsTab";
import { StatsTab } from "./StatsTab";

function Console() {
  const { consoleOpen, consoleTab, setConsoleTab, setConsoleOpen, toggleConsole } = useLayout();
  const { fatalCount } = useProblems();
  const { clear } = useActions();

  const Chevron = consoleOpen ? ChevronDown : ChevronUp;

  return (
    <Tabs
      value={consoleTab}
      onValueChange={(value) => {
        if (!isConsoleTab(value)) return;
        setConsoleTab(value);
        setConsoleOpen(true);
      }}
      className="h-full bg-card"
    >
      <div className="flex h-[34px] shrink-0 items-center gap-[2px] border-b px-2">
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="problems">
            Problems
            {/* Fatals only: a warning is not something to interrupt anyone over. */}
            {fatalCount > 0 && <Badge variant="count">{fatalCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>

        {/* The pair is what gets pushed right, not the button: Clear belongs to
            the Actions tab alone, and hanging the `auto` margin off it would move
            the chevron every time you left that tab. */}
        <div className="ml-auto flex items-center">
          {consoleTab === "actions" && (
            <Button variant="ghost" size="xs" className="px-2 py-1" onClick={clear}>
              Clear
            </Button>
          )}
          <button
            type="button"
            aria-expanded={consoleOpen}
            aria-label={consoleOpen ? "Collapse console" : "Expand console"}
            onClick={toggleConsole}
            className="mx-[6px] rounded-xs text-muted-foreground hover:text-foreground focus-visible:focus-ring"
          >
            <Chevron className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {consoleOpen && (
        <>
          <TabsContent value="actions">
            <ActionsTab />
          </TabsContent>
          {/* The console owns the frame and which one shows; each tab owns its content. */}
          <TabsContent value="problems">
            <ProblemsTab />
          </TabsContent>
          <TabsContent value="stats">
            <StatsTab />
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}

export { Console };
