/**
 * The kit is verified by looking at it next to the artboard — that is the whole
 * point of the page, and no assertion in jsdom can stand in for it.
 *
 * So this is a smoke test with one job: catch a cell that stopped rendering.
 * Every cell is a specimen of something the chrome ships, and the way a kit page
 * rots is that one of them throws or quietly disappears and nobody notices,
 * because nobody re-opens the page until the next design review.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kit } from "@/kit/Kit";

/** The ten cells of artboard 1e, by their handle and by the label above them. */
const CELLS: readonly [id: string, label: string][] = [
  ["view-selector", "View selector"],
  ["viewport-picker", "Viewport picker · open"],
  ["segmented-dpr", "Segmented · DPR"],
  ["console-tabs", "Console tabs"],
  ["binding-inputs", "Binding inputs"],
  ["badges", "Badges"],
  ["buttons", "Buttons"],
  ["tokens", "Tokens · light / dark"],
  ["log-lines", "Log line types"],
  ["bindings-toggle", "Bindings · toolbar toggle"],
];

afterEach(() => {
  // `readTokenPairs` puts the class back as it found it, but a test that flipped
  // the toggle leaves the page in dark — and `<html>` outlives the render.
  document.documentElement.classList.remove("dark");
});

describe("Kit", () => {
  it("renders the ten cells of artboard 1e", () => {
    const { container } = render(<Kit />);

    for (const [id, label] of CELLS) {
      expect(container.querySelector(`[data-kit-cell="${id}"]`)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
  });

  it("starts in the theme <html> is already in, and toggles from there", async () => {
    render(<Kit />);

    expect(document.documentElement).not.toHaveClass("dark");

    await userEvent.click(screen.getByRole("button", { name: "Switch to dark" }));

    expect(document.documentElement).toHaveClass("dark");
  });

  it("draws a swatch per token pair", () => {
    const { container } = render(<Kit />);

    expect(container.querySelectorAll("[data-token]")).toHaveLength(12);
  });
});
