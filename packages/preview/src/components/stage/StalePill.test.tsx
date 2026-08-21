/**
 * The one line the veil says out loud.
 *
 * Deliberately not an error overlay: the canvas underneath still holds the last
 * good render, and this states the fact rather than hiding it. Which is why the
 * two things worth asserting are the sentence itself — it names the cause and
 * what you are still looking at — and the dot being decoration, so a reader is
 * not handed a bullet before the words.
 *
 * Where the pill goes relative to the scaled frame is the Stage's decision and
 * stays asserted over there.
 */

import { render, screen } from "@testing-library/react";
import { StalePill } from "./StalePill";

const pill = () => document.querySelector('[data-slot="stale-pill"]');

describe("StalePill", () => {
  it("says what failed and what is still on screen", () => {
    render(<StalePill />);

    expect(screen.getByText("Stale — export failed, showing last good render")).toBe(pill());
  });

  /** The colour is the sentence's, said again; a reader gets it once. */
  it("keeps its dot out of the reading", () => {
    render(<StalePill />);

    expect(pill()?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(pill()).toHaveAccessibleName("");
  });

  /** It floats over the render it is talking about, and above the veil. */
  it("sits centred over the canvas, above the veil", () => {
    render(<StalePill />);

    expect(pill()).toHaveClass("absolute", "left-1/2", "-translate-x-1/2", "z-20");
  });

  /**
   * `bg-foreground text-background` and not the artboard's literal `#09090b`: in
   * dark that flips to a pale pill, where a near-black one would be the stage.
   */
  it("takes its two colours from the theme rather than naming them", () => {
    render(<StalePill />);

    expect(pill()).toHaveClass("bg-foreground", "text-background");
  });
});
