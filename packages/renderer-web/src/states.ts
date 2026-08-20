/**
 * How a node's runtime state collapses into one style — pure, so the precedence
 * order is unit-testable without a canvas and the Unity SDK has an unambiguous
 * reference for the same rule.
 *
 * There is no cascade: each node resolves its OWN base style plus the overrides
 * of the states it is currently in (decision 2026-08-04). The order below is the
 * whole contract, and it matters because states overlap — a pressed button is
 * usually also hovered and focused.
 */

import type { StateName, StateOverride, Style } from "@zabloo/format";

/** The runtime flags the renderer owns, keyed by component identity. */
interface NodeStates {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
  /** The chosen button of an `"exclusive-select"` group (a tab). */
  selected: boolean;
  /** A Toggle's own value (in an `"exclusive-check"` group, the group's). */
  checked: boolean;
  /** A TextInput holding no text — what styles its placeholder (ZAB-26). */
  empty: boolean;
  /**
   * Out of the interaction model, its own or an ancestor's (ZAB-63). The only
   * state a node that is not focusable can be in, which is what lets the labels
   * of a disabled section dim with the controls in it.
   */
  disabled: boolean;
}

/**
 * Least to most specific — later wins.
 *
 * Value states go first: what the control IS is the baseline, and how the
 * pointer or the focus is treating it right now paints over that. `empty` opens
 * them because it is the emptiest statement a control makes about its value (a
 * placeholder must lose to anything the author says about a selected or focused
 * field). `hover` sits under `focused` so a focus ring is never hidden by a mouse
 * passing by, and `pressed` wins over those because it lasts exactly as long as
 * the finger is down.
 *
 * `disabled` closes the list (ZAB-63). Its place only matters against the VALUE
 * states — a disabled node takes no input, so hover/focused/pressed can never be
 * active alongside it, while a disabled Toggle is still `checked` and a disabled
 * field still `empty`. Last is what lets one override speak for the whole control
 * whatever value it happens to hold.
 */
const STATE_ORDER: readonly StateName[] = [
  "empty",
  "selected",
  "checked",
  "hover",
  "focused",
  "pressed",
  "disabled",
];

function isActive(name: StateName, states: NodeStates): boolean {
  switch (name) {
    case "empty":
      return states.empty;
    case "selected":
      return states.selected;
    case "checked":
      return states.checked;
    case "hover":
      return states.hovered;
    case "focused":
      return states.focused;
    case "pressed":
      return states.pressed;
    case "disabled":
      return states.disabled;
    default:
      return false;
  }
}

/**
 * The style to resolve this frame: the base with every active state's override
 * merged over it, in `STATE_ORDER`. Returns the base itself when no state is
 * active, so an untouched node allocates nothing.
 */
function effectiveStyle(
  base: Style | undefined,
  // Keyed loosely, like the renderer reads the IR: an unknown state name is just
  // one this build never activates (forward tolerance), not a parse error.
  overrides: Readonly<Record<string, StateOverride | undefined>> | undefined,
  states: NodeStates,
): Style | undefined {
  if (!overrides) return base;
  let style = base;
  for (const name of STATE_ORDER) {
    const override = overrides[name]?.style;
    if (override && isActive(name, states)) style = { ...style, ...override };
  }
  return style;
}

export type { NodeStates };
export { effectiveStyle, STATE_ORDER };
