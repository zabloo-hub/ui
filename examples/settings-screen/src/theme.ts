import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// Design tokens — exported into the IR envelope's flat token dictionary. One
// screen's worth of vocabulary: the surfaces (panel, tab, row), the accent every
// control fills with, and the two text weights a settings list needs.
export const tokens = {
  "color.bg.panel": "#1f2430",
  "color.bg.tab": "#262c3d",
  "color.bg.tab.active": "#4f46e5",
  "color.bg.tab.pressed": "#6366f1",
  "color.bg.row": "#232a3d",
  "color.accent": "#4f46e5",
  "color.accent.hover": "#6366f1",
  "color.border": "#3b4160",
  "color.text": "#eceff4",
  "color.text.muted": "#9aa4b2",
  "color.on-accent": "#ffffff",
  "radius.md": 8,
  "space.2": 8,
  "space.3": 12,
  "space.4": 16,
  // Motion, themeable like color: set these to 0 for a "reduce motion" theme.
  "motion.fast": 120,
  "motion.slow": 240,
};

// Default motion per component. The bar's buttons and the toggles fade between
// states; the Slider glides when the value arrives from the game, never while
// the player is dragging it. The PANELS still snap — a panel entering or
// leaving the layout is an enter/exit animation, which is deferred past v1.
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
  Toggle: { duration: "{motion.fast}" },
  Slider: { duration: "{motion.slow}", easing: "ease-out" },
};

// Variants — an authoring-time concept: resolved at export time by
// @zabloo/react; they never reach the IR. They are keyed by PRIMITIVE, so
// <Checkbox>/<Switch> both key off `Toggle` and the tab buttons off `Button`.
export const variants: ThemeVariants = {
  Button: {
    // What makes the active tab readable: `states.selected` is the state the SDK
    // gives the chosen button of an "exclusive-select" group.
    tab: {
      style: { background: "{color.bg.tab}", radius: "{radius.md}" },
      states: {
        selected: { style: { background: "{color.bg.tab.active}" } },
        hover: { style: { background: "#303751" } },
        pressed: { style: { background: "{color.bg.tab.pressed}" } },
        // Focus ring: inset border (paints inside the layout rect).
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    primary: {
      style: { background: "{color.accent}", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.accent.hover}" } },
        pressed: { style: { background: "#4338ca" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    secondary: {
      style: { background: "#2f3446", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.border}" } },
        pressed: { style: { background: "#454c70" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
    // The closed face of a <Select>. A screen that claims to be keyboard
    // navigable has to SHOW where the focus is on every stop, and the dropdown's
    // button is a box that already has a border: the ring is that border lit up.
    setting: {
      states: {
        hover: { style: { borderColor: "{color.border}" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
  // Same reason, harder case: a slider is a 6px rail with no box of its own, so
  // its ring is a border along the rail. Without it the focus vanishes between
  // one toggle and the next.
  Slider: {
    setting: {
      states: {
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
    },
  },
  Toggle: {
    // The whole row is the target — `states.checked` styles it while the control
    // is on (merge order: base → checked → focused → pressed).
    row: {
      style: { radius: "{radius.md}" },
      states: {
        checked: { style: { background: "{color.bg.row}" } },
        hover: { style: { background: "#262d40" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
        pressed: { style: { background: "#2f3446" } },
      },
    },
  },
};
