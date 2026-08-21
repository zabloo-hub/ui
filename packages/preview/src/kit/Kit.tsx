import { Moon, Sun } from "lucide-react";
import { Button, ToggleGroup, ToggleGroupItem } from "@/components/ui";
import { BadgesCell } from "@/kit/cells/BadgesCell";
import { BindingFieldsCell } from "@/kit/cells/BindingFieldsCell";
import { BindingInputsCell } from "@/kit/cells/BindingInputsCell";
import { BindingsPanelCell } from "@/kit/cells/BindingsPanelCell";
import { ButtonsCell } from "@/kit/cells/ButtonsCell";
import { ConnectionPillCell } from "@/kit/cells/ConnectionPillCell";
import { ConsoleCell } from "@/kit/cells/ConsoleCell";
import { ConsoleRegionCell } from "@/kit/cells/ConsoleRegionCell";
import { DprCell } from "@/kit/cells/DprCell";
import { GamepadCell } from "@/kit/cells/GamepadCell";
import { LogLinesCell } from "@/kit/cells/LogLinesCell";
import { PanelCell } from "@/kit/cells/PanelCell";
import { StageCell } from "@/kit/cells/StageCell";
import { StagePillsCell } from "@/kit/cells/StagePillsCell";
import { StatusbarCell } from "@/kit/cells/StatusbarCell";
import { TokensCell } from "@/kit/cells/TokensCell";
import { TopbarCell } from "@/kit/cells/TopbarCell";
import { ViewportPickerCell } from "@/kit/cells/ViewportPickerCell";
import { ViewSelectorCell } from "@/kit/cells/ViewSelectorCell";
import { WordmarkCell } from "@/kit/cells/WordmarkCell";
import { SCENARIOS } from "@/kit/fixture";
import { useKitFixture } from "@/kit/useKitFixture";
import { useKitTheme } from "@/kit/useKitTheme";

/**
 * `/kit` — every chrome component in every state, in both themes: the cheap
 * Storybook. Two sheets, and the difference between them is the whole design of
 * this page.
 *
 * **The first sheet is artboard 1e**, laid out the way the design lays it out so
 * the two can be put side by side in two windows. It is the PRIMITIVES of
 * `components/ui/**`, drawn in the states that cost the most to reach by hand — a
 * menu open on its hover row, an input that has focus, a value the canvas just
 * wrote back — each one with the same component the chrome is built from, so a
 * change down there shows up here without anyone updating a fixture.
 *
 * **The second sheet is the chrome itself**: the topbar, the stage, the console,
 * the statusbar, the pills and the typed binding fields, MOUNTED, not
 * reassembled. It exists because the first sheet was the whole page until ZAB-104
 * and the docstring you are reading claimed otherwise: a mirror of the primitives
 * a component is made of is not a mirror of the component, and the states that
 * only the component has — the connection pill's tooltip branch, a stage under a
 * veil, `1 fatal · 2 warnings`, a JSON editor holding text that does not parse —
 * were nowhere on it.
 *
 * Mounting them means the page reads the store, which the old rule here forbade
 * outright. The rule it is replaced by is narrower and enforced by a mechanism
 * rather than by care: the page SEALS the store's persistence before it seeds
 * anything (`fixture.ts`), so nothing it does can reach the disk, and the
 * specimens that write when poked are `inert`. The mirror still cannot change the
 * tool; it can now show it.
 *
 * There is one store on the page, so the store-driven specimens all show the same
 * scenario at once — hence the live/stale/disconnected switcher on the second
 * sheet, which is how the three states of the pill, the veil, the summary and the
 * view menu's red dot are reached.
 *
 * **It ships in the production bundle**, statically imported by `main.tsx`
 * alongside `App`, against a rule of 20 KB gzipped. What the page costs is
 * **5.5 KB gz** — 438.03 with the import against 432.52 without it, re-measured
 * when the second sheet doubled the page.
 *
 * It went UP in source and DOWN in bytes, from the 8.0 KB V17 measured, and both
 * halves of that have the same cause. Reassembling a component out of primitives
 * ships code; MOUNTING one ships an import of code the app already paid for, so
 * the specimens of the second sheet are close to free. And the 8.0 was measured
 * while the kit was the only importer of Radix's Tabs and DropdownMenu; with the
 * view selector (#79) and the console (#77) in the chrome, those are charged
 * where they belong. The CSS does not move either way: Tailwind scans `src/`
 * whether or not a file is imported.
 *
 * The trade a `import.meta.env.DEV` split would have made is the point as much
 * as the number: `/kit` is 5 KB of a 400 KB download, and it is what someone
 * debugging a theme on a machine that is not theirs has to look at.
 *
 * Three specimens are not what they look like, and every note is on the cell that
 * owns it: the menus of the first sheet are drawn inline because a real Radix menu
 * would portal itself over the grid (`ViewSelectorCell`); the `← UI` field is
 * handed a binding as a prop rather than read from the store, because the mark has
 * a four-second timer on it and a page that undressed itself while you looked at
 * it would be showing the state it was asked for the least (`BindingFieldsCell`);
 * and the gamepad icon cannot be lit, because a browser does not admit to a pad
 * until someone presses a button on it (`GamepadCell`). The rule they share: a
 * state with a clock in it is reached by freezing what the component is given,
 * never by starting the mechanism.
 */
function Kit() {
  const { theme, toggle } = useKitTheme();
  const { scenario, select } = useKitFixture();

  return (
    <div className="min-h-screen bg-background p-10 text-foreground">
      <div className="flex w-[1440px] items-center gap-[10px] pb-3">
        <h1 className="text-brand font-semibold">UI kit</h1>
        <p className="text-ui text-muted-foreground">
          chrome components, all states, light/dark tokens
        </p>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={theme === "dark"}
          aria-label={theme === "light" ? "Switch to dark" : "Switch to light"}
          className="ml-auto"
          onClick={toggle}
        >
          {theme === "light" ? <Sun className="size-[15px]" /> : <Moon />}
          {theme === "light" ? "Light" : "Dark"}
        </Button>
      </div>

      {/* The badge moved off the page title and onto the sheet it belongs to the
          day there were two sheets: only this one has an artboard behind it. */}
      <div className="flex w-[1440px] items-center gap-[10px] pb-3">
        <span className="rounded-sm bg-foreground px-2 py-[3px] font-mono text-caption font-semibold text-background">
          1e
        </span>
        <h2 className="text-brand font-semibold">Primitives</h2>
        <p className="text-ui text-muted-foreground">
          the design system, in the states the artboard draws
        </p>
      </div>

      {/* The artboard's sheet: fixed at 1440 so the three columns land where the
          design puts them, and left to overflow a narrower window rather than
          reflowing into a layout the design has no drawing of. */}
      <div className="grid w-[1440px] grid-cols-3 gap-x-12 gap-y-10 rounded-xl border border-border bg-card px-[44px] py-[40px] shadow-sm">
        <ViewSelectorCell />
        <ViewportPickerCell />
        <DprCell />
        <ConsoleCell />
        <BindingInputsCell />
        <BadgesCell />
        <ButtonsCell />
        <TokensCell />
        <LogLinesCell />
        <PanelCell />
      </div>

      {/* The second sheet has no artboard behind it — 1e draws the primitives and
          stops — so it is titled rather than numbered, and it carries the one
          control the page needs: there is a single store under every specimen
          below, so the scenario is a property of the SHEET and not of a cell. */}
      <div className="flex w-[1440px] items-center gap-[10px] pt-10 pb-3">
        <h2 className="text-brand font-semibold">Chrome</h2>
        <p className="text-ui text-muted-foreground">
          the components themselves, mounted — frozen where poking them would move the tool
        </p>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Scenario"
          value={scenario}
          className="ml-auto"
          onValueChange={(value) => {
            if (value === "live" || value === "stale" || value === "disconnected") select(value);
          }}
        >
          {SCENARIOS.map((name) => (
            <ToggleGroupItem key={name} value={name}>
              {name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid w-[1440px] grid-cols-3 gap-x-12 gap-y-10 rounded-xl border border-border bg-card px-[44px] py-[40px] shadow-sm">
        <TopbarCell />
        <StageCell />
        <ConsoleRegionCell />
        <StatusbarCell />
        <BindingFieldsCell />
        <BindingsPanelCell />
        <StagePillsCell />
        <ConnectionPillCell />
        <WordmarkCell />
        <GamepadCell />
      </div>
    </div>
  );
}

export { Kit };
