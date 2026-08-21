/**
 * One button that says where you ARE and offers where you would go, which is two
 * different channels answering to the same click: the icon and `aria-pressed`
 * report the current theme, the label names the action.
 *
 * Getting those two the wrong way round is the bug this file exists to catch —
 * a label that read "Dark theme" while pressed would leave a screen reader with
 * no way to know what the button does.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStore } from "@/store";
import { ThemeToggle } from "./ThemeToggle";

const button = () => screen.getByRole("button", { name: /Switch to (dark|light) theme/ });
const icon = () => button().querySelector("svg");

beforeEach(() => {
  useStore.setState({ theme: "light" });
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle", () => {
  it("offers the theme you are not in, and draws the one you are", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(icon()).toHaveClass("lucide-sun");
  });

  it("draws itself toggled once dark is on", () => {
    useStore.setState({ theme: "dark" });

    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(icon()).toHaveClass("lucide-moon");
  });

  it("writes the theme to the store, and swaps its icon with it", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(button());

    expect(useStore.getState().theme).toBe("dark");
    expect(icon()).toHaveClass("lucide-moon");
  });

  it("goes back, so the one button is the whole control", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(button());
    await user.click(button());

    expect(useStore.getState().theme).toBe("light");
    expect(icon()).toHaveClass("lucide-sun");
  });

  /** V16's `useThemeClass` owns `<html>`; this only ever writes the store. */
  it("leaves the document alone", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(button());

    expect(document.documentElement).not.toHaveClass("dark");
  });
});
