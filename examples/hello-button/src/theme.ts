import type { ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
export const tokens = {
  "color.primary": "#4f46e5",
  "color.primary.hover": "#6366f1",
  "color.on-primary": "#ffffff",
  "radius.md": 8,
  "space.2": 8,
  "space.4": 16,
};

// Variants — an authoring-time concept (decision 2026-08-03 §6): resolved at
// export time by @zabloo/react; they never reach the IR.
export const variants: ThemeVariants = {
  Button: {
    primary: {
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: {
        pressed: { style: { background: "{color.primary.hover}" } },
        // Focus ring: inset border (paints inside the layout rect).
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    secondary: {
      style: { background: "#2f3446", radius: "{radius.md}" },
      states: {
        pressed: { style: { background: "#3b4160" } },
        focused: { style: { borderWidth: 2, borderColor: "#8b93a8" } },
      },
    },
  },
};
