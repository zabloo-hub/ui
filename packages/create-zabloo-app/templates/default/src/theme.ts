import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
// The in-game SDK resolves "{color.primary}" with one flat lookup, so themes
// can hot-update without re-emitting the tree.
export const tokens = {
  "color.primary": "#4f46e5",
  "color.primary.hover": "#6366f1",
  "color.on-primary": "#ffffff",
  "color.surface": "#1f2430",
  "color.muted": "#9aa4b2",
  "color.gold": "#facc15",
  "radius.md": 8,
  "space.2": 8,
  "space.4": 16,
  // Motion is a token like any other, so it is themeable like color: set these
  // to 0 for a "reduce motion" theme and the whole UI stops animating, with no
  // change to the tree.
  "motion.fast": 120,
  "motion.slow": 240,
};

// Default motion per component — the same key as `variants`, one level up: every
// Button in the project moves like this without repeating the prop. A node's own
// `transition` still wins.
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
  Toggle: { duration: "{motion.fast}" },
  Collapse: { duration: "{motion.slow}", easing: "ease-in-out" },
};

// Variants — an authoring-time concept: resolved at export time by
// @zabloo/react; they never reach the IR.
export const variants: ThemeVariants = {
  Button: {
    primary: {
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: {
        // Hover and pressed are the same idea one step apart, and with the
        // theme's transition they fade instead of snapping.
        hover: { style: { background: "{color.primary.hover}" } },
        pressed: { style: { background: "#4338ca" } },
        // Focus ring: inset border (paints inside the layout rect).
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    secondary: {
      style: { background: "#2f3446", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "#3b4160" } },
        pressed: { style: { background: "#454c70" } },
        focused: { style: { borderWidth: 2, borderColor: "#8b93a8" } },
      },
    },
  },
};
