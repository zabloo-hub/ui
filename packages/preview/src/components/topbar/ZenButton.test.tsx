/**
 * The way INTO zen, and only into it.
 *
 * The one-way part is the whole design of the button and is invisible from the
 * topbar, which unmounts the moment zen is on: `setZen(true)` rather than
 * `toggleZen()`, because a control that cannot be seen in one of its two states
 * must not be able to reach it. Driven directly, the second press is assertable.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_LAYOUT, useStore } from "@/store";
import { ZenButton } from "./ZenButton";

const button = () => screen.getByRole("button", { name: "Zen mode" });

beforeEach(() => {
  useStore.setState({ layout: { ...DEFAULT_LAYOUT, zen: false } });
});

describe("ZenButton", () => {
  it("goes into zen", async () => {
    const user = userEvent.setup();
    render(<ZenButton />);

    await user.click(button());

    expect(useStore.getState().layout.zen).toBe(true);
  });

  /** A toggle here would let a button nobody can see turn zen back off. */
  it("only ever goes in: pressing it again is not a way out", async () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, zen: true } });
    const user = userEvent.setup();
    render(<ZenButton />);

    await user.click(button());

    expect(useStore.getState().layout.zen).toBe(true);
  });

  /** An icon-only button says what it is in its label or it says nothing. */
  it("names itself for anyone not looking at the glyph", () => {
    render(<ZenButton />);

    expect(button()).toHaveAccessibleName("Zen mode");
    expect(button().querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
