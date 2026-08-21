/**
 * The console frame, against the real store: what the header shows, and what the
 * three controls on it write back.
 *
 * `userEvent` and not `fireEvent` for the tabs — Radix activates a trigger on
 * pointer-down, so a synthetic click alone never selects one.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_LAYOUT } from "@/store/layout";
import type { Problem } from "@/store/problems";
import { useStore } from "@/store/store";
import { Console } from "./Console";

const FATAL: Problem = { severity: "fatal", code: "missing-node", path: "views.a", reason: "gone" };
const WARN: Problem = { severity: "warn", code: "repaired", path: "views.b", reason: "patched" };

beforeEach(() => {
  useStore.setState({ layout: DEFAULT_LAYOUT, actions: [], problems: [] });
});

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
const chevron = () => screen.getByRole("button", { name: /console$/ });
const layout = () => useStore.getState().layout;

describe("Console", () => {
  it("opens on the remembered tab", () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, consoleTab: "stats" } });
    render(<Console />);

    expect(tab("Stats")).toHaveAttribute("data-state", "active");
    expect(tab("Actions")).toHaveAttribute("data-state", "inactive");
  });

  it("remembers the tab you pick", async () => {
    render(<Console />);

    await userEvent.click(tab("Problems"));

    expect(layout().consoleTab).toBe("problems");
    expect(tab("Problems")).toHaveAttribute("data-state", "active");
  });

  it("opens the console when you pick a tab on a collapsed one", async () => {
    useStore.setState({ layout: { ...DEFAULT_LAYOUT, consoleOpen: false } });
    render(<Console />);

    await userEvent.click(tab("Stats"));

    expect(layout()).toMatchObject({ consoleTab: "stats", consoleOpen: true });
  });

  it("counts the fatals on the Problems tab, and only the fatals", () => {
    useStore.setState({ problems: [FATAL, WARN] });
    render(<Console />);

    expect(tab("Problems")).toHaveTextContent("Problems1");
  });

  it("shows no badge when nothing is fatal", () => {
    useStore.setState({ problems: [WARN] });
    render(<Console />);

    expect(tab("Problems")).toHaveTextContent(/^Problems$/);
  });

  it("empties the log from Clear", async () => {
    act(() => {
      useStore.getState().appendAction("action", "buy");
    });
    render(<Console />);

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(useStore.getState().actions).toEqual([]);
  });

  it("offers Clear on the Actions tab alone", async () => {
    render(<Console />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();

    await userEvent.click(tab("Problems"));

    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("collapses to the header row and remembers it", async () => {
    render(<Console />);
    expect(chevron()).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(chevron());

    expect(layout().consoleOpen).toBe(false);
    expect(chevron()).toHaveAttribute("aria-expanded", "false");
    // The tabs stay, their bodies do not.
    expect(tab("Actions")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  it("mounts the tab you are on, and nothing else", () => {
    act(() => {
      useStore.getState().appendAction("view", "loaded → controls");
    });
    render(<Console />);

    expect(screen.getByRole("tabpanel")).toHaveTextContent("loaded → controls");
  });
});
