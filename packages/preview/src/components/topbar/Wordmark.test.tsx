/**
 * `▦ zabloo dev` — deliberately the smallest thing in the bar.
 *
 * There is no behaviour here, so what is worth holding is what would otherwise
 * be corrected by hand into a bug: the square takes its two indigos from the
 * `brand-gradient` utility, which is the one place they are written down, and
 * `dev` reads its grey off `text-muted-foreground` rather than the artboard's
 * literal `#a1a1aa` — the token is already worth exactly that in each theme.
 */

import { render } from "@testing-library/react";
import { Wordmark } from "./Wordmark";

const wordmark = () => document.querySelector('[data-slot="wordmark"]');

describe("Wordmark", () => {
  it("names the tool after the brand", () => {
    render(<Wordmark />);

    expect(wordmark()).toHaveTextContent("zabloodev");
  });

  it("paints the square from the brand gradient, not from two hexes", () => {
    render(<Wordmark />);

    expect(wordmark()?.firstElementChild).toHaveClass("brand-gradient");
  });

  it("greys `dev` with the theme's own muted token", () => {
    render(<Wordmark />);

    expect(wordmark()?.lastElementChild).toHaveClass("text-muted-foreground");
  });
});
