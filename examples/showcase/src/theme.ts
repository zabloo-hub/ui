import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

// The showcase's design tokens — exported into the envelope's flat token
// dictionary, which is the ONLY indirection the IR has (`{color.accent}` is one
// lookup in the SDK, not a cascade). Changing a value here re-themes every view
// without re-emitting a single node, which is why a theme can be hot-updated on
// its own. The `theming` view puts this table on screen.
export const tokens = {
  // Surfaces, from the back of the screen forward.
  "color.bg": "#12151f",
  "color.panel": "#1f2430",
  "color.row": "#232a3d",
  "color.row.alt": "#2b3244",
  "color.border": "#3b4160",
  // One accent, three pressures — base, lighter under the pointer, darker under
  // the finger. A state override is a token swap, not a new colour system.
  "color.accent": "#4f46e5",
  "color.accent.hover": "#6366f1",
  "color.accent.pressed": "#4338ca",
  "color.danger": "#e2544c",
  "color.success": "#3fb27f",
  "color.gold": "#f0c674",
  "color.text": "#eceff4",
  "color.muted": "#9aa4b2",
  "color.on-accent": "#ffffff",
  // The switched-off pair. `disabled` has no built-in look in the format — it is a
  // state like any other — so "off" is a colour decision the theme makes once and
  // every variant below reads from here.
  "color.off": "#262b3a",
  "color.off.text": "#616a80",
  "radius.sm": 4,
  "radius.md": 8,
  "radius.lg": 16,
  "space.1": 4,
  "space.2": 8,
  "space.3": 12,
  "space.4": 16,
  "space.5": 24,
  // Type: a size ramp and a line height. `lineHeight` is a Dim like any other,
  // so leading is themeable — a "large print" theme raises this one number.
  "text.sm": 13,
  "text.md": 15,
  "text.lg": 20,
  "text.xl": 26,
  "text.line": 22,
  // Motion is themeable exactly like colour (ZAB-33): set these to 0 and the
  // whole showcase stops animating without touching a single view.
  "motion.fast": 120,
  "motion.base": 220,
  "motion.slow": 420,
  "motion.loop": 900,
};

// Default motion per component (ZAB-36), keyed by PRIMITIVE like `variants`.
// A node's own `transition` still wins: the theme sets the baseline, authoring
// stays explicit. Containers are left out on purpose — the sugar builds a lot of
// them (a Switch's rails, a Tabs' panels) and they would all start moving.
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
  Toggle: { duration: "{motion.fast}" },
  Slider: { duration: "{motion.base}", easing: "ease-out" },
  TextInput: { duration: "{motion.fast}" },
};

// Variants — an authoring-time concept (decision 2026-08-04): `@zabloo/react`
// merges them at export time and the envelope receives fully resolved nodes, so
// no SDK has ever heard of "primary". They are keyed by primitive, which is why
// <Checkbox>, <Switch> and <Radio> all read from `Toggle`, and the tab buttons
// from `Button`.
export const variants: ThemeVariants = {
  Button: {
    primary: {
      style: { background: "{color.accent}", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.accent.hover}" } },
        pressed: { style: { background: "{color.accent.pressed}" } },
        // Focus ring: an INSET border, so it paints inside the layout rect and
        // never grows the node nor bleeds over a neighbour (decision 2026-08-06).
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
        // `disabled` merges LAST, so it needs no coordination with the three above:
        // whatever the control was wearing, this is what wins (ZAB-63).
        disabled: { style: { background: "{color.off}" } },
      },
    },
    secondary: {
      style: { background: "{color.row.alt}", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.border}" } },
        pressed: { style: { background: "#454c70" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
        disabled: { style: { background: "{color.off}" } },
      },
    },
    // No fill at rest: the button is its label until you point at it.
    quiet: {
      style: { radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.row}" } },
        pressed: { style: { background: "{color.row.alt}" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
      },
    },
    danger: {
      style: { background: "{color.danger}", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "#ea6d66" } },
        pressed: { style: { background: "#c9433c" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
      },
    },
    chip: {
      style: { background: "{color.row}", radius: "{radius.lg}" },
      states: {
        hover: { style: { background: "{color.row.alt}" } },
        pressed: { style: { background: "{color.border}" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
      },
    },
    // A tab: `selected` is the state the SDK hands the chosen button of an
    // "exclusive-select" group, and it merges UNDER hover/focused/pressed.
    tab: {
      style: { background: "{color.row}", radius: "{radius.md}" },
      states: {
        selected: { style: { background: "{color.accent}" } },
        hover: { style: { background: "{color.row.alt}" } },
        pressed: { style: { background: "{color.accent.pressed}" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
      },
    },
    // The closed face of a <Select>: it already is a box with a border, so its
    // focus ring is that border lit up rather than a second frame.
    setting: {
      states: {
        hover: { style: { borderColor: "{color.border}" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
      },
    },
  },
  Toggle: {
    // The whole row is the target — `states.checked` paints it while the control
    // is on. Merge order: base → checked → hover → focused → pressed.
    row: {
      style: { radius: "{radius.md}" },
      states: {
        checked: { style: { background: "{color.row}" } },
        hover: { style: { background: "{color.row.alt}" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
        pressed: { style: { background: "{color.border}" } },
        // A disabled toggle KEEPS its `checked` state — what it holds and whether
        // you may change it are two statements — and this override outranks it.
        disabled: { style: { background: "{color.off}" } },
      },
    },
  },
  Slider: {
    // Harder case: a slider is a 6 px rail with no box of its own, so its ring is
    // a border along the rail. Without it the focus vanishes between two rows.
    setting: {
      states: {
        focused: { style: { borderWidth: 2, borderColor: "{color.text}" } },
        disabled: { style: { background: "{color.off}" } },
      },
    },
  },
  TextInput: {
    field: {
      style: {
        background: "{color.row}",
        radius: "{radius.md}",
        borderWidth: 1,
        borderColor: "{color.border}",
        color: "{color.text}",
        fontSize: "{text.md}",
      },
      states: {
        // `empty` is a value state, not a colour knob: the placeholder is painted
        // with the field's own text style, dimmed by this override.
        empty: { style: { color: "{color.muted}" } },
        hover: { style: { borderColor: "{color.muted}" } },
        focused: { style: { borderWidth: 2, borderColor: "{color.accent.hover}" } },
        // Over `empty` too: a disabled field's placeholder is not a live hint.
        disabled: { style: { background: "{color.off}", color: "{color.off.text}" } },
      },
    },
  },
  // Text takes variants like every other primitive: the six text properties are
  // plain style, so a heading is a named style set and nothing else.
  Text: {
    title: { style: { color: "{color.text}", fontSize: "{text.xl}" } },
    heading: { style: { color: "{color.text}", fontSize: "{text.lg}" } },
    // A label is not focusable, so `disabled` is the ONLY state it can ever be in
    // — and it gets there by inheritance, from the section that declared it.
    label: {
      style: { color: "{color.text}", fontSize: "{text.md}" },
      states: { disabled: { style: { color: "{color.off.text}" } } },
    },
    body: {
      style: { color: "{color.text}", fontSize: "{text.md}", lineHeight: "{text.line}" },
    },
    muted: { style: { color: "{color.muted}", fontSize: "{text.sm}" } },
    accent: { style: { color: "{color.accent.hover}", fontSize: "{text.md}" } },
  },
  Container: {
    panel: {
      style: {
        background: "{color.panel}",
        radius: "{radius.md}",
        borderWidth: 1,
        borderColor: "{color.border}",
      },
    },
    card: { style: { background: "{color.row}", radius: "{radius.md}" } },
    swatch: { style: { radius: "{radius.sm}" } },
  },
};
