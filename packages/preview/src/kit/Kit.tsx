import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui";
import { BadgesCell } from "@/kit/cells/BadgesCell";
import { BindingInputsCell } from "@/kit/cells/BindingInputsCell";
import { ButtonsCell } from "@/kit/cells/ButtonsCell";
import { ConsoleCell } from "@/kit/cells/ConsoleCell";
import { DprCell } from "@/kit/cells/DprCell";
import { LogLinesCell } from "@/kit/cells/LogLinesCell";
import { PanelCell } from "@/kit/cells/PanelCell";
import { TokensCell } from "@/kit/cells/TokensCell";
import { ViewportPickerCell } from "@/kit/cells/ViewportPickerCell";
import { ViewSelectorCell } from "@/kit/cells/ViewSelectorCell";
import { useKitTheme } from "@/kit/useKitTheme";

/**
 * `/kit` — artboard 1e as a page of the app: every chrome component in every
 * state, in both themes, laid out the way the design lays it out so the two can
 * be put side by side in two windows.
 *
 * It is the cheap Storybook. The states this page holds still are the ones that
 * cost the most to reach by hand in the real chrome — a menu open on its hover
 * row, an input that has focus, a value the canvas just wrote back — and every
 * one of them is drawn with the SAME primitive the chrome uses, so a change in
 * `components/ui/**` shows up here without anyone updating a fixture. Nothing in
 * `kit/` is imported by the app, and nothing in `kit/` touches the store: the
 * page is a mirror, and a mirror that could change the tool would be a worse
 * mirror.
 *
 * **It ships in the production bundle**, statically imported by `main.tsx`
 * alongside `App`, against a rule of 20 KB gzipped. What the page itself costs
 * is **8.0 KB gz** (426.86 against 418.89 with the same primitives already in).
 * Measured today it looks like 23.2, and the 15.2 in between is Radix's Tabs and
 * DropdownMenu — which are in the bundle only because of the kit while V7's view
 * selector and V11's console are still `return null`, and which are two
 * components of the chrome itself, not of its kit. Charging them here would be
 * accounting for the order the batch happens to merge in. The CSS does not move
 * either way: Tailwind scans `src/` whether or not a file is imported.
 *
 * The trade a `import.meta.env.DEV` split would have made is the point as much
 * as the number: `/kit` is 8 KB of a 400 KB download, and it is what someone
 * debugging a theme on a machine that is not theirs has to look at.
 *
 * Two cells are not composed the way the app composes them, and both notes are
 * on the component: the menus are drawn inline because a real Radix menu would
 * portal itself over the grid (`ViewSelectorCell`), and the panel header is
 * assembled from Card parts because `BindingsPanel` reads four slices before it
 * agrees to draw (`PanelCell`).
 */
function Kit() {
  const { theme, toggle } = useKitTheme();

  return (
    <div className="min-h-screen bg-background p-10 text-foreground">
      <div className="flex w-[1440px] items-center gap-[10px] pb-3">
        <span className="rounded-sm bg-foreground px-2 py-[3px] font-mono text-caption font-semibold text-background">
          1e
        </span>
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
    </div>
  );
}

export { Kit };
