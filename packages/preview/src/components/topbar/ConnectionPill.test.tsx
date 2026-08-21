/**
 * The pill alone, because alone is where its one real branch can be read: three
 * states go out as a plain label, and exactly one of them — `stale` WITH
 * something to say — becomes a focusable button carrying a tooltip.
 *
 * `Topbar.test.tsx` held this before. Rendering the whole bar proves the pill is
 * wired into it, which is a different promise: that the branch has two sides, and
 * that the side which becomes a control is reachable without a mouse, is about
 * the pill and belongs next to it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStore } from "@/store";
import { ConnectionPill } from "./ConnectionPill";

const pill = () => document.querySelector('[data-slot="connection-pill"]');
const dot = () => document.querySelector('[data-slot="badge-dot"]');

beforeEach(() => {
  useStore.setState({ connection: "disconnected", lastError: null });
});

describe("ConnectionPill", () => {
  it.each([
    ["live", "Live"],
    ["stale", "Stale"],
    ["disconnected", "Disconnected"],
  ] as const)("says %s out loud, in the variant that colours it", (connection, label) => {
    useStore.setState({ connection });

    render(<ConnectionPill />);

    expect(pill()).toHaveTextContent(label);
    expect(pill()).toHaveAttribute("data-variant", connection);
  });

  /** The dot reads its colour off the pill, so it only ever travels with it. */
  it("puts the dot inside the pill, ahead of the word", () => {
    render(<ConnectionPill />);

    expect(pill()).toContainElement(dot() as HTMLElement);
    expect(pill()?.firstElementChild).toBe(dot());
  });
});

describe("the stale tooltip", () => {
  const stale = (lastError: string | null) => useStore.setState({ connection: "stale", lastError });

  it("explains a stale render with the error that caused it", async () => {
    stale("export failed: unknown node");
    const user = userEvent.setup();
    render(<ConnectionPill />);

    await user.hover(screen.getByRole("button", { name: /Stale/ }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("export failed: unknown node");
  });

  /**
   * The whole reason the pill stops being a span: a tooltip nobody can focus is
   * one half the users of a dev tool never get to read.
   */
  it("can be read without a mouse", async () => {
    stale("export failed: unknown node");
    const user = userEvent.setup();
    render(<ConnectionPill />);

    await user.tab();

    expect(screen.getByRole("button", { name: /Stale/ })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("export failed: unknown node");
  });

  it("keeps a visible ring on the control it just became", () => {
    stale("export failed: unknown node");

    render(<ConnectionPill />);

    expect(screen.getByRole("button", { name: /Stale/ })).toHaveClass("focus-visible:focus-ring");
  });

  /** Stale with nothing to explain is still just a statement of fact. */
  it("stays a plain label while there is no error to put in it", () => {
    stale(null);
    render(<ConnectionPill />);

    expect(pill()).toHaveTextContent("Stale");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * `lastError` outlives the state that set it — a stream that dropped after a
   * refused export still holds the message. Only `stale` reads it.
   */
  it("does not grow one for the other two states, error or no error", () => {
    for (const connection of ["live", "disconnected"] as const) {
      useStore.setState({ connection, lastError: "export failed: unknown node" });
      const { unmount } = render(<ConnectionPill />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();

      unmount();
    }
  });
});
