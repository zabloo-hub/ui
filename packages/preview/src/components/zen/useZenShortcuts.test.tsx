/**
 * Escape as the way out of zen — and, mostly, the two times it must keep its
 * hands off. Both cases are the same bug seen twice: Escape already means
 * something to whatever has the focus, and a global handler that fires anyway
 * cancels an edit or swallows a menu's own close.
 */

import { act, fireEvent, renderHook } from "@testing-library/react";
import { DEFAULT_LAYOUT, useStore } from "@/store";
import { useZenShortcuts } from "./useZenShortcuts";

const zen = (): boolean => useStore.getState().layout.zen;
const pressEscape = (): void => {
  fireEvent.keyDown(window, { key: "Escape" });
};

/** An element parked on `<body>`, the way a Radix portal or a focused field is. */
const parked = (make: (element: HTMLElement) => void): HTMLElement => {
  const element = document.createElement("div");
  make(element);
  document.body.append(element);
  return element;
};

beforeEach(() => {
  useStore.setState({ layout: { ...DEFAULT_LAYOUT, zen: true } });
  document.body.replaceChildren();
});

describe("useZenShortcuts", () => {
  it("leaves zen on Escape", () => {
    renderHook(() => useZenShortcuts());

    act(pressEscape);

    expect(zen()).toBe(false);
  });

  it("ignores every other key", () => {
    renderHook(() => useZenShortcuts());

    act(() => fireEvent.keyDown(window, { key: "Enter" }));

    expect(zen()).toBe(true);
  });

  it("stands down while the focus is in a field", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    renderHook(() => useZenShortcuts());

    act(pressEscape);

    expect(zen()).toBe(true);
  });

  it("stands down while a Radix surface is open", () => {
    parked((element) => element.setAttribute("data-state", "open"));
    renderHook(() => useZenShortcuts());

    act(pressEscape);

    expect(zen()).toBe(true);
  });

  it("does not mind a Radix surface that is closed", () => {
    parked((element) => element.setAttribute("data-state", "closed"));
    renderHook(() => useZenShortcuts());

    act(pressEscape);

    expect(zen()).toBe(false);
  });

  it("installs no global handler outside zen, and takes it back down on the way out", () => {
    useStore.setState({ layout: DEFAULT_LAYOUT });
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    renderHook(() => useZenShortcuts());

    expect(add).not.toHaveBeenCalledWith("keydown", expect.any(Function));

    act(() => useStore.getState().setZen(true));
    expect(add).toHaveBeenCalledWith("keydown", expect.any(Function));

    act(pressEscape);
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});
