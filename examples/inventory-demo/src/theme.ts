import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
export const tokens = {
  "color.bg.panel": "#141822",
  "color.bg.row": "#1f2430",
  "color.bg.row.alt": "#262c3d",
  "color.bg.chip": "#262c3d",
  "color.bg.chip.pressed": "#343c52",
  "color.accent": "#4f46e5",
  "color.accent.pressed": "#6366f1",
  "color.border": "#3b4160",
  "color.text": "#eceff4",
  "color.text.muted": "#9aa4b2",
  "color.gold": "#f4c15b",
  "radius.md": 8,
  "radius.pill": 999,
  "space.1": 4,
  "space.2": 8,
  "space.4": 16,
  // Motion, themeable like color: set these to 0 for a "reduce motion" theme.
  "motion.fast": 120,
};

// Default motion per component (ZAB-36), keyed by PRIMITIVE like `variants`. It
// is what makes this screen a test of transitions × recycling (ZAB-66): the
// favourite Toggle of every row crossfades and the chips and buy buttons fade
// their states, so a row REUSED for another item would be visible as a
// crossfade between two items instead of a clean swap. Scroll it fast, or
// reorder `shop.items` from the console, and nothing should smear.
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
  Toggle: { duration: "{motion.fast}" },
};

// Variants — authoring-time style sets (decision 2026-08-03 §6): resolved by
// @zabloo/react, never present in the IR. Note there is no `ScrollView` variant
// here: the scroller has no states of its own (it is not focusable and has no
// hover/pressed), so everything interactive lives on the rows inside it.
export const variants: ThemeVariants = {
  Button: {
    // Category chip of the horizontal strip.
    chip: {
      style: { background: "{color.bg.chip}", radius: "{radius.pill}" },
      states: {
        pressed: { style: { background: "{color.bg.chip.pressed}" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    // "Buy" button of an item row — inside the scroller, so it also proves that
    // dragging to scroll does not swallow the click on interactive content.
    buy: {
      style: { background: "{color.accent}", radius: "{radius.md}" },
      states: {
        pressed: { style: { background: "{color.accent.pressed}" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
};
