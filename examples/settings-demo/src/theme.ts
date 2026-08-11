import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
export const tokens = {
  "color.primary": "#4f46e5",
  "color.on": "#22c55e",
  "color.panel": "#1f2430",
  "color.border": "#3b4160",
  "color.muted": "#8b93a8",
  "color.text": "#eceff4",
  "radius.md": 8,
  "space.2": 8,
  "space.4": 16,
  // Motion, themeable like color: set these to 0 for a "reduce motion" theme.
  "motion.fast": 120,
  "motion.slow": 240,
};

// Default motion per component (ZAB-36). The Toggle crossfades between its two
// indicators — the switch's knob included — and the Slider glides when the value
// arrives from the game, never while the player is dragging it.
export const transitions: ThemeTransitions = {
  Toggle: { duration: "{motion.fast}" },
  Slider: { duration: "{motion.slow}", easing: "ease-out" },
};

// Variants are keyed by PRIMITIVE, so the controls key off `Toggle` — the type
// <Checkbox>/<Switch>/<Radio> all lower to. `states.checked` styles the row
// while the control is on (merge order: base → checked → focused → pressed).
export const variants: ThemeVariants = {
  Toggle: {
    row: {
      style: { radius: "{radius.md}" },
      states: {
        checked: { style: { background: "#232a3d" } },
        hover: { style: { background: "#262d40" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
        pressed: { style: { background: "#2f3446" } },
      },
    },
  },
};
