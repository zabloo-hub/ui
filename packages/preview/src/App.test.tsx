import { render, screen } from "@testing-library/react";
import { App } from "@/App";

/**
 * The smoke test of the scaffold: the four regions of the stack are on the page.
 * It asserts the CONTRACT the rest of the milestone builds on — the region names
 * and the fact that there are four of them — not any markup inside them, which is
 * still empty and belongs to V7–V13.
 *
 * The session is mocked away: `App` mounts it (V6) and jsdom has no
 * `EventSource`, so the real one would open the dev loop's stream for two
 * assertions about markup. What it does is proved in `session/`.
 */
vi.mock("@/session", () => ({ useSession: () => {} }));

describe("App", () => {
  it("renders the four regions of the chrome", () => {
    const { container } = render(<App />);

    for (const region of ["topbar", "stage", "console", "statusbar"]) {
      expect(container.querySelector(`[data-region="${region}"]`)).toBeInTheDocument();
    }
  });

  it("gives each region a landmark of its own", () => {
    render(<App />);

    expect(screen.getByRole("banner")).toHaveAttribute("data-region", "topbar");
    expect(screen.getByRole("main")).toHaveAttribute("data-region", "stage");
    expect(screen.getByRole("region", { name: "Console" })).toHaveAttribute(
      "data-region",
      "console",
    );
    expect(screen.getByRole("contentinfo")).toHaveAttribute("data-region", "statusbar");
  });
});
