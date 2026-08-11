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
export interface NodeStates {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
  /** The chosen button of an `"exclusive-select"` group (a tab). */
  selected: boolean;
  /** A Toggle's own value (in an `"exclusive-check"` group, the group's). */
  checked: boolean;
}

/**
 * Least to most specific — later wins.
 *
 * Value states go first: what the control IS is the baseline, and how the
 * pointer or the focus is treating it right now paints over that. `hover` sits
 * under `focused` so a focus ring is never hidden by a mouse passing by, and
 * `pressed` wins over everything because it lasts exactly as long as the finger
 * is down. `disabled` is declared in the IR but has no runtime state yet, so it
 * never matches here.
 */
export const STATE_ORDER: readonly StateName[] = [
  "selected",
  "checked",
  "hover",
  "focused",
  "pressed",
];

function isActive(name: StateName, states: NodeStates): boolean {
  switch (name) {
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
    default:
      return false;
  }
}

/**
 * The style to resolve this frame: the base with every active state's override
 * merged over it, in `STATE_ORDER`. Returns the base itself when no state is
 * active, so an untouched node allocates nothing.
 */
export function effectiveStyle(
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
