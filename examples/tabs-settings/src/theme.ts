import type { ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
export const tokens = {
  "color.bg.panel": "#1f2430",
  "color.bg.tab": "#262c3d",
  "color.bg.tab.active": "#4f46e5",
  "color.bg.tab.pressed": "#6366f1",
  "color.border": "#3b4160",
  "color.text": "#eceff4",
  "color.text.muted": "#9aa4b2",
  "radius.md": 8,
  "space.2": 8,
  "space.4": 16,
};

// Variants — an authoring-time concept (decision 2026-08-03 §6): resolved at
// export time by @zabloo/react; they never reach the IR. The `tab` variant is
// what makes the active tab readable: `states.selected` is the state the SDK
// gives the chosen button of an "exclusive-select" group (decision 2026-08-11).
export const variants: ThemeVariants = {
  Button: {
    tab: {
      style: { background: "{color.bg.tab}", radius: "{radius.md}" },
      states: {
        selected: { style: { background: "{color.bg.tab.active}" } },
        pressed: { style: { background: "{color.bg.tab.pressed}" } },
        // Focus ring: inset border (paints inside the layout rect).
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
};
