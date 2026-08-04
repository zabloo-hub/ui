import type { ThemeVariants } from "@zabloo/react";

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
};

// Variants — an authoring-time concept: resolved at export time by
// @zabloo/react; they never reach the IR.
export const variants: ThemeVariants = {
  Button: {
    primary: {
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: {
        pressed: { style: { background: "{color.primary.hover}" } },
        focused: { style: { background: "#7c86f2" } },
      },
    },
    secondary: {
      style: { background: "#2f3446", radius: "{radius.md}" },
      states: {
        pressed: { style: { background: "#3b4160" } },
        focused: { style: { background: "#4a5170" } },
      },
    },
  },
};
