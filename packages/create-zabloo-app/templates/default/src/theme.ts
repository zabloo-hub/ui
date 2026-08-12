import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary.
// The in-game SDK resolves "{color.primary}" with one flat lookup, so themes
// can hot-update without re-emitting the tree.
export const tokens = {
  "color.primary": "#4f46e5",
  "color.primary.hover": "#6366f1",
  "color.on-primary": "#ffffff",
  "color.surface": "#1f2430",
  "color.surface.raised": "#262c3d",
  "color.text": "#eceff4",
  "color.muted": "#9aa4b2",
  "color.border": "#3b4160",
  "color.gold": "#facc15",
  "radius.md": 8,
  "space.2": 8,
  "space.3": 12,
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
  // The slider glides when the value arrives from the game, never while the
  // player is dragging it.
  Slider: { duration: "{motion.slow}", easing: "ease-out" },
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
    // The closed face of a <Select>. A screen meant to be navigable with the
    // keyboard has to SHOW where the focus is on every stop, and this button
    // already has a border: the ring is that border lit up.
    setting: {
      states: {
        hover: { style: { borderColor: "{color.muted}" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    // Used by the settings view: `states.selected` is the state the SDK gives
    // the chosen button of an "exclusive-select" group — what a tab bar is.
    tab: {
      style: { background: "{color.surface.raised}", radius: "{radius.md}" },
      states: {
        selected: { style: { background: "{color.primary}" } },
        hover: { style: { background: "#303751" } },
        pressed: { style: { background: "{color.primary.hover}" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
  // Same reason as `Button.setting`, harder case: a slider is a thin rail with
  // no box of its own, so its focus ring is a border along the rail.
  Slider: {
    setting: {
      states: {
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
  // Variants are keyed by PRIMITIVE, so <Checkbox>/<Switch> both key off the
  // `Toggle` they lower to. `row` makes the whole line the target — label
  // included — and `states.checked` styles it while the control is on.
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
