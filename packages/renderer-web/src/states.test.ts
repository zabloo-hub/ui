import type { StateName, StateOverride } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { effectiveStyle, type NodeStates, STATE_ORDER } from "./states.js";

const IDLE: NodeStates = {
  hovered: false,
  pressed: false,
  focused: false,
  selected: false,
  checked: false,
};

/** One override per state, each tagged so the winner is identifiable. */
const OVERRIDES: Partial<Record<StateName, StateOverride>> = {
  selected: { style: { background: "#selected" } },
  checked: { style: { background: "#checked" } },
  hover: { style: { background: "#hover" } },
  focused: { style: { background: "#focused" } },
  pressed: { style: { background: "#pressed" } },
};

describe("effectiveStyle", () => {
  it("returns the base style untouched while no state is active", () => {
    const base = { background: "#base" };
    expect(effectiveStyle(base, OVERRIDES, IDLE)).toBe(base);
  });

  it("merges an active state over the base, field by field", () => {
    const style = effectiveStyle({ background: "#base", radius: 8 }, OVERRIDES, {
      ...IDLE,
      hovered: true,
    });
    expect(style).toEqual({ background: "#hover", radius: 8 });
  });

  it("leaves the base alone — a state override never mutates it", () => {
    const base = { background: "#base" };
    effectiveStyle(base, OVERRIDES, { ...IDLE, pressed: true });
    expect(base).toEqual({ background: "#base" });
  });

  it("lets the pointer state win over what the control IS", () => {
    const active = { ...IDLE, selected: true, checked: true, hovered: true };
    expect(effectiveStyle(undefined, OVERRIDES, active)?.background).toBe("#hover");
  });

  it("keeps the focus ring visible under a passing mouse", () => {
    const active = { ...IDLE, hovered: true, focused: true };
    expect(effectiveStyle(undefined, OVERRIDES, active)?.background).toBe("#focused");
  });

  it("gives pressed the last word, for as long as the finger is down", () => {
    const active = { hovered: true, pressed: true, focused: true, selected: true, checked: true };
    expect(effectiveStyle(undefined, OVERRIDES, active)?.background).toBe("#pressed");
  });

  it("ignores states with no override declared", () => {
    const style = effectiveStyle(
      { background: "#base" },
      { pressed: { style: { radius: 2 } } },
      {
        ...IDLE,
        hovered: true,
      },
    );
    expect(style).toEqual({ background: "#base" });
  });

  it("ignores a state the IR declares but the renderer has no runtime state for", () => {
    // `disabled` is in the IR's state set and nothing switches it on yet: it must
    // never match, rather than matching some other flag by accident.
    const style = effectiveStyle(
      undefined,
      { disabled: { style: { opacity: 0.4 } } },
      {
        ...IDLE,
        pressed: true,
        hovered: true,
        focused: true,
      },
    );
    expect(style).toBeUndefined();
  });

  it("orders every state, least to most specific", () => {
    expect(STATE_ORDER).toEqual(["selected", "checked", "hover", "focused", "pressed"]);
  });
});
