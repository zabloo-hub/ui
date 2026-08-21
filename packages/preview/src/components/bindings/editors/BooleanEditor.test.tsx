/**
 * The switch, driven as what it is: a pure function of the six props in
 * `editor.ts`. No store, no field — which is the point, because the one rule
 * this editor owns is invisible from `BindingField`.
 *
 * That rule is `coerceTyped` on the way IN. What a bound path holds is whatever
 * the game's runtime put there, and a runtime pushing `1` for a checkbox is not
 * a bug to render as "off".
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BooleanEditor } from "./BooleanEditor";

const props = {
  id: "music",
  path: "settings.music",
  describedBy: "music-type",
  onCommit: () => {},
};

const box = () => screen.getByRole("switch");

describe("BooleanEditor", () => {
  it.each([
    [true, true],
    [1, true],
    ["true", true],
    [false, false],
    [0, false],
    ["false", false],
    [undefined, false],
  ])("reads %o as the switch's %s", (value, checked) => {
    render(<BooleanEditor {...props} value={value} />);

    expect(box()).toHaveAttribute("aria-checked", String(checked));
  });

  /** What the switch produces is already a boolean and goes back untouched. */
  it("hands back a real boolean, not the shape it was given", async () => {
    const committed: unknown[] = [];
    const user = userEvent.setup();
    render(<BooleanEditor {...props} value={1} onCommit={(raw) => committed.push(raw)} />);

    await user.click(box());

    expect(committed).toEqual([false]);
  });

  /** The panel holds values but stops editing them while an export is broken. */
  it("still shows the value when the panel is disabled, and refuses the click", async () => {
    const committed: unknown[] = [];
    const user = userEvent.setup();
    render(<BooleanEditor {...props} value disabled onCommit={(raw) => committed.push(raw)} />);

    await user.click(box());

    expect(box()).toBeDisabled();
    expect(box()).toHaveAttribute("aria-checked", "true");
    expect(committed).toEqual([]);
  });

  it("answers to the field's label and its type tag", () => {
    render(<BooleanEditor {...props} value={false} />);

    expect(box()).toHaveAttribute("id", "music");
    expect(box()).toHaveAttribute("aria-describedby", "music-type");
  });
});
