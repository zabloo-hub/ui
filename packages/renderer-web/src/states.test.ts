import type { StateName, StateOverride } from "@zabloo/format";
import { describe, expect, it } from "vitest";
import { effectiveStyle, type NodeStates, STATE_ORDER } from "./states.js";

const IDLE: NodeStates = {
  hovered: false,
  pressed: false,
  focused: false,
  selected: false,
  checked: false,
  empty: false,
  disabled: false,
};

/** One override per state, each tagged so the winner is identifiable. */
const OVERRIDES: Partial<Record<StateName, StateOverride>> = {
  empty: { style: { background: "#empty" } },
  selected: { style: { background: "#selected" } },
  checked: { style: { background: "#checked" } },
  hover: { style: { background: "#hover" } },
  focused: { style: { background: "#focused" } },
  pressed: { style: { background: "#pressed" } },
  disabled: { style: { background: "#disabled" } },
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
    const active = {
      hovered: true,
      pressed: true,
      focused: true,
      selected: true,
      checked: true,
      empty: true,
      disabled: false,
    };
    expect(effectiveStyle(undefined, OVERRIDES, active)?.background).toBe("#pressed");
  });

  it("lets anything the author says about a focused field beat the placeholder", () => {
    expect(effectiveStyle(undefined, OVERRIDES, { ...IDLE, empty: true })?.background).toBe(
      "#empty",
    );
    const focused = { ...IDLE, empty: true, focused: true };
    expect(effectiveStyle(undefined, OVERRIDES, focused)?.background).toBe("#focused");
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

  it("ignores a state name the renderer has no runtime flag for", () => {
    // Forward tolerance: a state this build never activates is one it must not
    // match by accident against some other flag.
    const style = effectiveStyle(
      undefined,
      { future: { style: { opacity: 0.4 } } } as Partial<Record<StateName, StateOverride>>,
      { ...IDLE, pressed: true, hovered: true, focused: true },
    );
    expect(style).toBeUndefined();
  });

  it("gives disabled the last word over the value the control holds", () => {
    // A disabled Toggle is still checked and a disabled field still empty, so the
    // one thing `disabled` must outrank is what the control IS (ZAB-63).
    const active = { ...IDLE, disabled: true, checked: true, selected: true, empty: true };
    expect(effectiveStyle(undefined, OVERRIDES, active)?.background).toBe("#disabled");
  });

  it("dresses a node that carries no other state — an inherited disabled", () => {
    // The label of a disabled section: not focusable, so `disabled` is the only
    // state it can ever be in.
    const style = effectiveStyle({ color: "#base" }, OVERRIDES, { ...IDLE, disabled: true });
    expect(style).toEqual({ color: "#base", background: "#disabled" });
  });

  it("orders every state, least to most specific", () => {
    expect(STATE_ORDER).toEqual([
      "empty",
      "selected",
      "checked",
      "hover",
      "focused",
      "pressed",
      "disabled",
    ]);
  });
});
