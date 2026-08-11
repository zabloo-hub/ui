import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
export const tokens = {
  "color.primary": "#4f46e5",
  "color.primary.hover": "#6366f1",
  "color.on-primary": "#ffffff",
  "radius.md": 8,
  "space.2": 8,
  "space.4": 16,
  // Motion is themeable like color: a "reduce motion" theme sets these to 0 and
  // the whole UI stops animating without re-emitting the tree.
  "motion.fast": 120,
  "motion.slow": 240,
  // The Spinner's cycle is motion too: 0 here and the loop freezes.
  "motion.loop": 900,
};

// Default motion per component (ZAB-36), keyed like `variants`: the Collapses
// below animate their open/close without a prop on every one of them. A node's
// own `transition` still wins — see the buttons in the view, which set theirs.
export const transitions: ThemeTransitions = {
  Collapse: { duration: "{motion.slow}", easing: "ease-in-out" },
};

// Variants — an authoring-time concept (decision 2026-08-03 §6): resolved at
// export time by @zabloo/react; they never reach the IR.
export const variants: ThemeVariants = {
  Button: {
    primary: {
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: {
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
