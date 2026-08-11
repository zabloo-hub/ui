import type { ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
export const tokens = {
  "color.primary": "#4f46e5",
  "color.panel": "#1f2430",
  "color.border": "#3b4160",
  "color.muted": "#8b93a8",
  "color.text": "#eceff4",
  "radius.md": 8,
  "space.2": 8,
  "space.4": 16,
  // Motion is a token like any other: a "reduce motion" theme sets these to 0 and
  // every overlay opens and closes instantly, without re-emitting the tree.
  "motion.fast": 120,
  "motion.base": 180,
};

export const variants: ThemeVariants = {
  Button: {
    action: {
      style: {
        background: "{color.primary}",
        radius: "{radius.md}",
      },
      states: {
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
        pressed: { style: { background: "#4338ca" } },
      },
    },
    quiet: {
      style: {
        background: "{color.panel}",
        radius: "{radius.md}",
        borderWidth: 1,
        borderColor: "{color.border}",
      },
      states: {
        focused: { style: { borderColor: "#ffffff" } },
        pressed: { style: { background: "#2f3446" } },
      },
    },
  },
};
