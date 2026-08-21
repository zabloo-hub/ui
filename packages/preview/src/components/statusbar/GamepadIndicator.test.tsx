/**
 * The gamepad icon. Everything worth testing here is a consequence of the API's
 * one rule (see the component): the page learns about a pad from an EVENT it may
 * have missed, or from a list that may be empty for reasons that have nothing to
 * do with what is plugged in.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamepadIndicator } from "@/components/statusbar/GamepadIndicator";

const icon = () => document.querySelector('[data-slot="gamepad-indicator"]');

/** `navigator.getGamepads` does not exist in jsdom, so it is installed per test. */
function pads(...connected: boolean[]): void {
  const list = connected.map((state) => ({ connected: state }) as Gamepad);
  Object.defineProperty(navigator, "getGamepads", {
    value: () => list,
    configurable: true,
  });
}

function fire(type: "gamepadconnected" | "gamepaddisconnected"): void {
  act(() => {
    window.dispatchEvent(new Event(type));
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "getGamepads");
});

describe("GamepadIndicator", () => {
  it("is faint until a pad has spoken — including where the API is missing", () => {
    render(<GamepadIndicator />);

    expect(icon()).toHaveAttribute("data-connected", "false");
    expect(icon()).toHaveClass("text-faint");
  });

  /** The `gamepadconnected` of a pad pressed before this mounted is already gone. */
  it("asks the API at mount rather than waiting for an event that fired already", () => {
    pads(true);

    render(<GamepadIndicator />);

    expect(icon()).toHaveAttribute("data-connected", "true");
    expect(icon()).toHaveClass("text-indigo");
  });

  it("lights up on gamepadconnected", () => {
    render(<GamepadIndicator />);

    fire("gamepadconnected");

    expect(icon()).toHaveAttribute("data-connected", "true");
    expect(icon()).toHaveClass("text-indigo");
  });

  it("goes out on gamepaddisconnected", () => {
    pads(true);
    render(<GamepadIndicator />);

    pads();
    fire("gamepaddisconnected");

    expect(icon()).toHaveAttribute("data-connected", "false");
  });

  /** The event names the pad that left, not what is left. */
  it("stays lit when one of two pads leaves", () => {
    pads(true, true);
    render(<GamepadIndicator />);

    pads(true);
    fire("gamepaddisconnected");

    expect(icon()).toHaveAttribute("data-connected", "true");
  });

  it("says what a pad is for, on hover", async () => {
    const user = userEvent.setup();
    render(<GamepadIndicator />);

    await user.hover(screen.getByRole("button", { name: "No gamepad detected" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "d-pad / stick: focus · A: pressB: back · right stick: scroll",
    );
  });
});
