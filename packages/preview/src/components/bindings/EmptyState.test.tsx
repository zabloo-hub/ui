/**
 * The dashed placeholder for "there is nothing here, and that is fine".
 *
 * Two lines rather than one, which is the whole point of the component: "No
 * bindings" on its own reads like something failed to load, and the second line
 * is what says it did not. The callers pass both — `BindingsPanel` is where the
 * words themselves are asserted.
 */

import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

const empty = () => document.querySelector('[data-slot="empty-state"]');

describe("EmptyState", () => {
  it("shows what is empty and why, in that order", () => {
    render(<EmptyState title="No bindings" description="This view declares no data paths." />);

    expect(empty()).toHaveTextContent("No bindingsThis view declares no data paths.");
  });

  /** An outline of a thing that is not there. It is the drawing, not information. */
  it("leaves its icon out of the reading", () => {
    render(<EmptyState title="No bindings" description="Nothing yet." />);

    expect(empty()?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("No bindings")).toBeInTheDocument();
  });

  it("is drawn as the dashed box, and lets a caller place it", () => {
    render(<EmptyState title="No problems" description="Nothing yet." className="mx-4" />);

    expect(empty()).toHaveClass("border-dashed", "mx-4");
  });
});
