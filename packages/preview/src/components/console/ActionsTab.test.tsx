/**
 * The log, against the real store.
 *
 * The scroll cases need the same kind of prop the panel's drag cases do: jsdom
 * lays nothing out, so `scrollHeight` and `clientHeight` are zero and every
 * viewport is permanently "at the bottom". `stubViewport` gives it a size and a
 * settable `scrollTop`, which is the one thing the component writes.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ActionKind } from "@/store/actions";
import { useStore } from "@/store/store";
import { ActionsTab } from "./ActionsTab";

/** 12:04:31 on the machine running the test, whatever zone that is. */
const AT = (seconds: number) => new Date(2026, 0, 15, 12, 4, seconds).getTime();

const VIEWPORT = '[data-slot="scroll-area-viewport"]';
const HEIGHT = { scrollHeight: 400, clientHeight: 100 };

beforeEach(() => {
  useStore.setState({ actions: [] });
});

function log(...entries: [ActionKind, string, number][]): void {
  useStore.setState({
    actions: entries.map(([kind, text, seconds]) => ({ kind, text, ts: AT(seconds) })),
  });
}

function stubViewport(el: HTMLElement): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: HEIGHT.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: HEIGHT.clientHeight });
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: 0 });
}

/** Renders the tab and hands back a viewport with a size, ready to scroll. */
function renderLog(): HTMLElement {
  const { container } = render(<ActionsTab />);
  const viewport = container.querySelector<HTMLElement>(VIEWPORT);
  if (viewport === null) throw new Error("the log rendered without a scroll viewport");
  stubViewport(viewport);
  return viewport;
}

function append(kind: ActionKind, text: string): void {
  act(() => {
    useStore.getState().appendAction(kind, text);
  });
}

function scrollTo(viewport: HTMLElement, top: number): void {
  viewport.scrollTop = top;
  fireEvent.scroll(viewport);
}

describe("ActionsTab", () => {
  it("says so rather than showing an empty box", () => {
    render(<ActionsTab />);

    expect(screen.getByText("No actions yet")).toBeInTheDocument();
  });

  it("colours each kind the way the log reads it", () => {
    log(
      ["view", "loaded → controls", 27],
      ["write", "settings.sfx = true", 29],
      ["action", "back", 33],
    );
    render(<ActionsTab />);

    expect(screen.getByText("view")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("write")).toHaveClass("text-log-write");
    expect(screen.getByText("action")).toHaveClass("text-log-action");
  });

  it("prints the wall clock of each line", () => {
    log(["view", "loaded → controls", 27]);
    render(<ActionsTab />);

    expect(screen.getByText("12:04:27")).toBeInTheDocument();
  });

  it("greys the item index off the end of an action", () => {
    log(["action", "buy → shop.items.3 (#3)", 31]);
    render(<ActionsTab />);

    expect(screen.getByText("buy → shop.items.3")).toBeInTheDocument();
    expect(screen.getByText("(#3)")).toHaveClass("text-muted-foreground");
  });

  it("leaves an action without an index alone", () => {
    log(["action", "back", 33]);
    render(<ActionsTab />);

    expect(screen.getByText("back")).toBeInTheDocument();
  });

  it("follows the tail as lines arrive", () => {
    log(["view", "loaded → controls", 27]);
    const viewport = renderLog();

    append("action", "back");

    expect(viewport.scrollTop).toBe(HEIGHT.scrollHeight);
  });

  it("stops following once the user has scrolled up", () => {
    log(["view", "loaded → controls", 27]);
    const viewport = renderLog();

    scrollTo(viewport, 0);
    append("action", "back");

    expect(viewport.scrollTop).toBe(0);
  });

  it("follows again when the user returns to the bottom", () => {
    log(["view", "loaded → controls", 27]);
    const viewport = renderLog();

    scrollTo(viewport, 0);
    append("action", "back");
    scrollTo(viewport, HEIGHT.scrollHeight - HEIGHT.clientHeight);
    append("action", "focus → settings.volume");

    expect(viewport.scrollTop).toBe(HEIGHT.scrollHeight);
  });
});
