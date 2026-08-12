/**
 * The v1 zabloo component set — own components/props/rules, NOT a web UI kit.
 *
 * Each primitive is a function component that resolves its `variant` (an
 * authoring-time concept — decision 2026-08-03 §6) against the project theme
 * and emits the host primitive with fully resolved style/states. `Row`/`Column`
 * and `Accordion` are authoring sugar that emit a `Container`, and `List`/`Grid`
 * sugar over the `Repeat` — composites and variants never reach the IR.
 */

import type {
  Bindable,
  Dim,
  Easing,
  GroupBehavior,
  ImageFit,
  Layout,
  OverlayAnchor,
  OverlayTrigger,
  ScrollAxis,
  SliderAxis,
  Style,
} from "@zabloo/format";
import { INDEX_SEGMENT, ITEM_ALIAS } from "@zabloo/format";
import {
  Children,
  createElement,
  type FC,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { CommonProps } from "./host.js";
import { useVariant } from "./theme.js";

export interface ContainerProps extends CommonProps {
  /** Cross-child behavior the SDK enforces generically (decision 2026-08-03). */
  group?: GroupBehavior;
  /** Initially selected index of an `"exclusive-select"` group (default: 0). */
  selected?: number;
  /** Selected value of an `"exclusive-check"` group — see `<RadioGroup>`. */
  value?: Bindable<string | number>;
  children?: ReactNode;
}

export interface TextProps extends CommonProps {
  /** Static text content. */
  children?: string | number | Array<string | number>;
  /** Data-path binding, e.g. `bind="player.gold"` — mutually exclusive with children. */
  bind?: string;
}

export interface ButtonProps extends CommonProps {
  /** Named action the game subscribes to (C# event / signal / Blueprint). */
  onClick?: string;
  children?: ReactNode;
}

export interface CollapseProps extends CommonProps {
  /** Initial open state (default: true). The SDK owns the runtime state. */
  open?: boolean;
  /** First child = header (always visible, tapping toggles); rest = content. */
  children?: ReactNode;
}

export interface ScrollViewProps extends CommonProps {
  /**
   * Scrollable axis — the one children are measured unconstrained on. Default:
   * "vertical". `"both"` frees both axes, which is what a map or a big grid
   * needs; it does not turn a column into a row (that is `layout.direction`).
   */
  axis?: ScrollAxis;
  /**
   * Overlay position indicator painted by the SDK, visible only while there is
   * something to scroll. Default: true. Turn it off where the content itself
   * says there is more (a strip of chips cut by the edge). Styling it is a
   * deferred, compatible extension — the boolean becomes a union.
   */
  scrollbar?: boolean;
  children?: ReactNode;
}

export interface OverlayProps extends CommonProps {
  /**
   * Blocks input to everything below (lower overlays included) and confines focus
   * navigation to this subtree. Default: true. `false` — a toast, a tooltip —
   * paints above but leaves the layer's own rect inert: only its children take
   * events and everything else passes through to the tree.
   */
  modal?: boolean;
  /** Explicit stacking inside the layer; ties break by document order. Default: 0. */
  z?: number;
  /** Named action fired on a dismiss request (Escape / gamepad B / backdrop tap). */
  onDismiss?: string;
  /** Self-dismiss delay in ms, counted from the moment it enters the layer. */
  autoCloseMs?: number;
  /**
   * Places this overlay against another node's rect, and optionally ties it to
   * that node's hover/focus. The raw primitive takes the IR object as it is; the
   * three composites below spread it over flat props.
   */
  anchor?: OverlayAnchor;
  children?: ReactNode;
}

/** Where an overlay's content sits on the layer — sugar over `justify`/`align`. */
export type OverlayPosition =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Props shared by the three overlay composites — a modal is always modal, hence the Omit. */
interface OverlaySugarProps extends Omit<OverlayProps, "modal" | "anchor"> {
  /**
   * Placement of the content. On the layer by default; AROUND the anchor when
   * there is one, where `top-left` reads as "above, flush with its left edge".
   */
  position?: OverlayPosition;
  /**
   * `id` of the node this overlay hangs from. The layer placement is still
   * emitted, so an SDK that predates anchoring shows the same overlay where
   * `position` says on the layer.
   */
  anchor?: string;
  /** Distance from the anchor's edge. Default: 8. Ignored without an anchor. */
  offset?: Dim;
  /** What puts it in the layer: `visible` alone, or the anchor's hover/focus. */
  trigger?: OverlayTrigger;
}

export interface ModalProps extends OverlaySugarProps {
  /** The panel that holds the content. Its `style` is the card; `style` is the backdrop. */
  panel?: Omit<ContainerProps, "children">;
}

export interface ToastProps extends OverlaySugarProps {
  /** The pill that holds the message. */
  panel?: Omit<ContainerProps, "children">;
  /** Style of the auto-wrapped message, when `children` is a bare string. */
  label?: Style;
}

export interface TooltipProps extends OverlaySugarProps {
  /** The bubble that holds the hint. */
  panel?: Omit<ContainerProps, "children">;
  /** Style of the auto-wrapped hint, when `children` is a bare string. */
  label?: Style;
}

export interface ImageProps extends CommonProps {
  /**
   * Path to the image, relative to the project's `src/assets/` (Flutter-style
   * convention): `"logo.png"`, `"icons/coin.png"`. `zabloo export` reads the file,
   * inlines it in the envelope's asset manifest and rewrites this prop to its
   * `asset:<id>` ref — so the path is authoring input, never a runtime lookup, and
   * it cannot be a data binding.
   */
  src: string;
  /** How the source fills the layout rect. Default: "contain". */
  fit?: ImageFit;
}

/** Props shared by the two-state controls that lower to the `Toggle` primitive. */
export interface ToggleControlProps extends CommonProps {
  /**
   * Initial state, or a READ/WRITE data-path binding (`{ bind: "settings.sfx" }`):
   * the SDK writes the new value back and notifies the game.
   */
  checked?: Bindable<boolean>;
  /** Named action fired after every change (like `<Button onClick>`). */
  onChange?: string;
  /** Indicator size in px — the box side / the switch track height. Default: 22. */
  size?: number;
  /** Label: rendered next to the indicator, and tapping it toggles too. */
  children?: ReactNode;
}

export interface CheckboxProps extends ToggleControlProps {
  /** Box style in both states. */
  box?: Style;
  /** Box style while checked, merged over `box`. */
  checkedBox?: Style;
  /** The mark drawn inside a checked box. */
  mark?: Style;
}

export interface SwitchProps extends ToggleControlProps {
  /** Track style in both states. */
  track?: Style;
  /** Track style while checked, merged over `track`. */
  checkedTrack?: Style;
  /** The knob that sits at the start (off) or the end (on) of the track. */
  knob?: Style;
}

export interface RadioProps extends Omit<CheckboxProps, "checked"> {
  /** This option's value. Checked while it equals the `<RadioGroup>` value. */
  value: string | number;
}

export interface SliderProps extends CommonProps {
  /**
   * Current value, or a READ/WRITE data-path binding (`{ bind: "settings.volume" }`):
   * the SDK writes every new value back and notifies the game. Default: `min`.
   */
  value?: Bindable<number>;
  /** Range ends. Default: 0 and 1 — the unit interval a volume or a ratio lives in. */
  min?: number;
  max?: number;
  /** Quantization step from `min`. Absent = continuous (arrows still move by 5%). */
  step?: number;
  /** Track orientation. Vertical runs bottom-to-top, like a fader. Default: "horizontal". */
  axis?: SliderAxis;
  /** Named action fired on every change — the live hook (a volume preview). */
  onChange?: string;
  /** Named action fired when the gesture ends: the value the player settled on. */
  onCommit?: string;
  /** Track length along its axis, in px. Default: 200. */
  length?: number;
  /** Track thickness across its axis, in px. Default: 6. */
  thickness?: number;
  /** Thumb size, in px. Default: 18. */
  thumbSize?: number;
  /** The filled part of the track, from the start to the value. */
  fill?: Style;
  /** The handle that rides the track. */
  thumb?: Style;
}

export interface TextInputProps extends CommonProps {
  /**
   * Current text, or a READ/WRITE data-path binding (`{ bind: "profile.name" }`):
   * the SDK writes every edit back and notifies the game. Default: "".
   */
  value?: Bindable<string>;
  /**
   * Hint shown while the field is empty. Style it through the `empty` state —
   * `states={{ empty: { style: { color: "{color.muted}" } } }}` — which is the same
   * text paint the value uses, not a second color knob.
   */
  placeholder?: string;
  /** Named action fired on every edit — the live hook (a search that filters as you type). */
  onChange?: string;
  /** Named action fired when the player confirms the field (Enter). */
  onSubmit?: string;
  /** Cap on what the PLAYER can type. A longer value from the game is shown whole. */
  maxLength?: number;
  /** Field width along its line, in px. Default: 220. */
  width?: number;
  /** Space between the box and the text, in px. Default: 8. */
  padding?: number;
}

export interface RadioGroupProps extends Omit<ContainerProps, "group"> {
  /**
   * The selected value — usually a read/write binding (`{ bind: "settings.quality" }`).
   * A `<Radio>` is checked while its `value` equals this one.
   */
  value?: Bindable<string | number>;
}

export interface SelectProps extends Omit<ContainerProps, "group" | "value"> {
  /**
   * REQUIRED: the dropdown hangs off the closed button by this `id`, and an anchor
   * relation is the one thing in v1 that addresses another node by name.
   */
  id: string;
  /**
   * The selected value — usually a read/write binding (`{ bind: "settings.lang" }`):
   * picking an option writes it back and notifies the game, exactly like a
   * `<RadioGroup>`, which is the same `"exclusive-check"` group underneath.
   */
  value?: Bindable<string | number>;
  /** Named action fired after every change, like `<RadioGroup>`'s options. */
  onChange?: string;
  /** The `<Option>`s. They live in the dropdown, never in the closed button. */
  children?: ReactNode;
  /** Width of the closed button and of the dropdown below it, in px. Default: 220. */
  width?: number;
  /**
   * Cap on the dropdown's height, in px. Past it the list scrolls — which is what
   * a long list of languages needs. Default: 240.
   */
  maxHeight?: number;
  /** Which side of the button the list opens on. Default: "bottom" (it flips when it must). */
  position?: OverlayPosition;
  /** Style of the closed button, merged over the default box. */
  button?: Style;
  /** Style of the label inside the closed button — it shows the VALUE (see the docs). */
  label?: Style;
  /** Style of the dropdown panel, merged over the default. */
  panel?: Style;
}

export interface OptionProps extends CommonProps {
  /** This option's value. Selected while it equals the `<Select>`'s. */
  value: string | number;
  /** The row's content — usually a `<Text>`. */
  children?: ReactNode;
  /** Size of the check mark's box, in px. Default: 16. */
  size?: number;
  /** The mark shown on the selected row. */
  mark?: Style;
}

export interface ProgressBarProps extends CommonProps {
  /**
   * Progress in 0..1 (clamped), usually a read binding (`{ bind: "player.hp" }`):
   * `SetData` moves the bar. Give the node a `transition` and it glides there
   * instead of jumping — the tween is on the value, so the fill is never behind.
   */
  value?: Bindable<number>;
  /** Style of the fill, merged over the default bar. */
  fill?: Style;
  /** Bar thickness in px — height for a row bar, width for a column one. Default: 8. */
  size?: number;
}

export interface SpinnerProps extends CommonProps {
  /** How many beads to build when you pass no children of your own. Default: 3. */
  dots?: number;
  /** Bead diameter in px (generated beads only). Default: 8. */
  size?: number;
  /** Full cycle in ms — themeable (`"{motion.loop}"`); 0 freezes it. Default: 900. */
  period?: Dim;
  /** Opacity multiplier at the wave's dimmest, 0..1. Default: 0.25. */
  min?: number;
  /** Curve of the ramp up and back down. Default: "ease-in-out". */
  easing?: Easing;
  /** Style of each generated bead, merged over the default dot. */
  dot?: Style;
  /** Your own beads, in wave order — replaces the generated dots entirely. */
  children?: ReactNode;
}

export interface BadgeProps extends CommonProps {
  /**
   * The counter: a literal or a read binding (`{ bind: "inbox.unread" }`). There is
   * no "hide at zero" — the IR has no expressions; bind `visible` to a flag the game
   * owns if the badge should disappear.
   */
  count?: Bindable<string | number>;
  /** Style of the label, merged over the default. */
  label?: Style;
  /** Custom content instead of the counter (an icon, a `<Row>`). */
  children?: ReactNode;
}

/**
 * Wraps a host primitive with variant resolution (variant never reaches the IR).
 * The theme's motion defaults are resolved here too: a node's own `transition`
 * always wins, so authoring stays explicit while the theme sets the baseline.
 */
function primitive<P extends CommonProps>(type: string): FC<P> {
  const Component = (props: P) => {
    const { variant, style, states, transition, ...rest } = props;
    const resolved = useVariant(type, variant, { style, states, transition });
    return createElement(type, {
      ...rest,
      style: resolved.style,
      states: resolved.states,
      transition: resolved.transition,
    });
  };
  Component.displayName = type;
  return Component as FC<P>;
}

export const Container: FC<ContainerProps> = primitive<ContainerProps>("Container");

/**
 * A run of text, sized by the font (a leaf with an intrinsic size, like `<Image>`).
 *
 * It is multiline by default: it wraps to the width the flexbox offers it, and `\n`
 * always breaks. Everything else is plain style, with no Text-specific props —
 * `style.wrap`, `textAlign`, `textAlignY`, `lineHeight`, `overflow` and `maxLines`,
 * so a `variant` themes them and `states` overrides them like any other style.
 */
export const Text: FC<TextProps> = primitive<TextProps>("Text");
export const Button: FC<ButtonProps> = primitive<ButtonProps>("Button");
export const Collapse: FC<CollapseProps> = primitive<CollapseProps>("Collapse");

/**
 * A window onto content bigger than itself. It is a normal flex container on
 * both sides — its own size comes from `layout`, and `direction`/`justify`/
 * `align`/`gap`/`padding` lay its children out — with one difference: on the
 * scrollable `axis` the children are measured UNCONSTRAINED, so they take their
 * natural size and that is what the player scrolls through. Size the viewport
 * yourself (`layout.width`/`height`/`grow`); giving it neither a size nor a
 * growing parent leaves it hugging its content, with nothing to scroll.
 *
 * It always clips, paint AND hit-testing, so a row past the edge is neither
 * drawn nor tappable — a `clip: false` on it is ignored. Wheel and drag are
 * handled by the SDK, which owns the scroll position: the offset is runtime
 * state like a Button's `pressed`, never authored and never serialized, and it
 * is re-clamped on every relayout (close a `<Collapse>` inside and the list
 * settles at the new end instead of hanging past it).
 *
 * The node itself has no states and no events: it is not focusable, it has no
 * hover/pressed, and there is no `onScroll` — `states.*` on it would never
 * fire, while the Buttons inside keep theirs (dragging to scroll does not
 * become a click on them). Programmatic ScrollTo, a bindable offset and
 * auto-scrolling to the focused node arrive with gamepad input; inertia,
 * a styleable scrollbar and snapping come after.
 *
 * ```tsx
 * <ScrollView layout={{ width: 460, height: 340, align: "stretch", gap: 4 }}>
 *   {items.map((item) => <ItemRow key={item.id} item={item} />)}
 * </ScrollView>
 * <ScrollView axis="horizontal" scrollbar={false} layout={{ direction: "row", width: 460, gap: 8 }}>
 *   {categories.map((name) => <Chip key={name} name={name} />)}
 * </ScrollView>
 * ```
 */
export const ScrollView: FC<ScrollViewProps> = primitive<ScrollViewProps>("ScrollView");

/**
 * A layer above the whole view, declared where the UI that opens it lives but
 * painted apart (decision 2026-08-11): it leaves its parent's flow, so it neither
 * takes space nor pushes its siblings, and the SDK collects every visible overlay
 * of the view into ONE layer ordered by `(z, document order)`.
 *
 * Its rect IS the view's, so `layout.width`/`height` are ignored (size the child
 * instead) and `layout.justify`/`align`/`padding` place the content; its own
 * `style.background` — with alpha — IS the backdrop, and no background at all
 * makes a transparent layer. Opening and closing is `visible` and nothing else:
 * bind it (`visible={{ bind: "ui.confirmOpen" }}`) and the game moves that boolean
 * with `SetData`, while Escape, a backdrop tap and `autoCloseMs` write `false`
 * back through the same binding and fire `onDismiss`.
 *
 * Unlike `<Toggle>` and `<Slider>` it has no positional slots, so it is exported
 * raw; `<Modal>`, `<Toast>` and `<Tooltip>` below are the ready-made shapes.
 */
export const Overlay: FC<OverlayProps> = primitive<OverlayProps>("Overlay");

/**
 * A textured rectangle, sized by default to the source's own pixels (it is a leaf
 * with an intrinsic size, like `<Text>`) — give it `layout.width`/`height` to size
 * it yourself and `fit` to choose how the picture fills that box.
 *
 * Everything else is plain style, with no Image-specific props: `style.color` tints
 * it, `style.radius` rounds it, and `style.background` shows through while the bytes
 * are still being decoded — that background IS the loading placeholder.
 */
export const Image: FC<ImageProps> = primitive<ImageProps>("Image");

/** `<Container>` with `direction: "row"` (authoring sugar, not a primitive). */
export function Row({ layout, ...rest }: ContainerProps): ReturnType<FC> {
  return createElement(Container, { ...rest, layout: { direction: "row", ...layout } });
}

/** `<Container>` with `direction: "column"` (authoring sugar, not a primitive). */
export function Column({ layout, ...rest }: ContainerProps): ReturnType<FC> {
  return createElement(Container, { ...rest, layout: { direction: "column", ...layout } });
}

/**
 * Accordion — a flattened composite (decision 2026-08-03): NOT an IR type.
 * Emits a column `Container` with `group: "exclusive-open"`; children should be
 * `<Collapse>`s. The SDK enforces "only one open" generically; older SDKs ignore
 * the `group` prop and degrade to independent Collapses.
 */
export function Accordion({ layout, ...rest }: Omit<ContainerProps, "group">): ReturnType<FC> {
  return createElement(Container, {
    ...rest,
    group: "exclusive-open",
    layout: { direction: "column", ...layout },
  });
}

/**
 * The `Toggle` primitive. NOT exported: its indicator slots are positional
 * (`children[0]` checked, `children[1]` unchecked, rest always shown), and the
 * controls below are the supported way to build them — one place to get the
 * convention right.
 */
interface TogglePrimitiveProps extends CommonProps {
  checked?: Bindable<boolean>;
  value?: string | number;
  onChange?: string;
  children?: ReactNode;
}
const Toggle: FC<TogglePrimitiveProps> = primitive<TogglePrimitiveProps>("Toggle");

const TOGGLE_SIZE = 22;
const BOX: Style = { borderWidth: 2, borderColor: "#8b93a8" };
const CHECKED_BOX: Style = { background: "#4f46e5", borderColor: "#4f46e5" };
const MARK: Style = { background: "#ffffff" };
const TRACK: Style = { background: "#2f3446" };
const CHECKED_TRACK: Style = { background: "#4f46e5" };
const KNOB: Style = { background: "#ffffff" };

/** One indicator slot: the WHOLE indicator as it looks in that state. */
function slot(size: number, style: Style, inner?: { size: number; style: Style }): ReactElement {
  return createElement(
    Container,
    { layout: { width: size, height: size, justify: "center", align: "center" }, style },
    inner &&
      createElement(Container, {
        layout: { width: inner.size, height: inner.size },
        style: inner.style,
      }),
  );
}

/**
 * A box that fills with a mark when checked — square for `<Checkbox>`, round for
 * `<Radio>`. Both slots paint the full box, so the checked look is a style of its
 * own slot: no cascade, no per-state styling of descendants.
 */
function boxControl(
  round: boolean,
  { size = TOGGLE_SIZE, box, checkedBox, mark, layout, children, ...rest }: CheckboxProps,
): ReturnType<FC> {
  const markSize = Math.round(size * 0.45);
  const base: Style = { ...BOX, radius: round ? size / 2 : 4, ...box };
  return createElement(
    Toggle,
    { ...rest, layout: { direction: "row", align: "center", gap: 10, ...layout } },
    slot(
      size,
      { ...base, ...CHECKED_BOX, ...checkedBox },
      {
        size: markSize,
        style: { ...MARK, radius: round ? markSize / 2 : 2, ...mark },
      },
    ),
    slot(size, base),
    children,
  );
}

/**
 * Checkbox: an independent boolean. `checked` may be a read/write binding, and
 * `onChange` fires the named action — the two ways the game hears about it.
 */
export function Checkbox(props: CheckboxProps): ReturnType<FC> {
  return boxControl(false, props);
}

/**
 * Switch: the same primitive as `<Checkbox>` with a knob that swaps ends. The
 * knob "moves" because each slot justifies it to a different side — layout, not
 * animation (the transition lands in F7).
 */
export function Switch({
  size = TOGGLE_SIZE,
  track,
  checkedTrack,
  knob,
  layout,
  children,
  ...rest
}: SwitchProps): ReturnType<FC> {
  const width = Math.round(size * 1.8);
  const padding = 3;
  const knobSize = size - padding * 2;
  const base: Style = { radius: size / 2, ...TRACK, ...track };
  const knobStyle: Style = { radius: knobSize / 2, ...KNOB, ...knob };
  const rail = (justify: "start" | "end", style: Style): ReactElement =>
    createElement(
      Container,
      {
        layout: { direction: "row", width, height: size, padding, justify, align: "center" },
        style,
      },
      createElement(Container, {
        layout: { width: knobSize, height: knobSize },
        style: knobStyle,
      }),
    );
  return createElement(
    Toggle,
    { ...rest, layout: { direction: "row", align: "center", gap: 10, ...layout } },
    rail("end", { ...base, ...CHECKED_TRACK, ...checkedTrack }),
    rail("start", base),
    children,
  );
}

/** One option of a `<RadioGroup>`: same control as `<Checkbox>`, round, with a value. */
export function Radio(props: RadioProps): ReturnType<FC> {
  return boxControl(true, props);
}

/**
 * RadioGroup — a flattened composite, like `<Accordion>`: a column `Container`
 * with `group: "exclusive-check"` and the selected `value`. The SDK enforces
 * "only one checked" generically; older SDKs ignore the group and degrade to
 * independent checkboxes.
 */
export function RadioGroup({ layout, ...rest }: RadioGroupProps): ReturnType<FC> {
  return createElement(Container, {
    ...rest,
    group: "exclusive-check",
    layout: { direction: "column", ...layout },
  });
}

const SELECT_WIDTH = 220;
const SELECT_MAX_HEIGHT = 240;
const OPTION_MARK = 16;
const SELECT_BUTTON: Style = {
  background: "#20242f",
  radius: 6,
  borderWidth: 1,
  borderColor: "#3a4055",
};
const SELECT_PANEL: Style = {
  background: "#20242f",
  radius: 6,
  borderWidth: 1,
  borderColor: "#3a4055",
};
const OPTION_MARK_STYLE: Style = { background: "#4f46e5", radius: OPTION_MARK / 2 };
// `focused` after `checked` in the normative merge order, so walking the list
// with the keyboard lights the row you are ON, not the one already chosen —
// without it the two are indistinguishable and the list cannot be navigated.
const OPTION_STATES: NonNullable<CommonProps["states"]> = {
  checked: { style: { background: "#2c3243" } },
  focused: { style: { background: "#3a4157" } },
};

/**
 * One row of a `<Select>`: the same `Toggle` a `<Radio>` lowers to, dressed as a
 * list row instead of a bullet — the mark sits on the selected one and the row
 * itself highlights through `states.checked`, which is the state an
 * `"exclusive-check"` group already derives for its options.
 *
 * Tapping it selects, writes the group's binding and closes the dropdown; the
 * closing is the popover's rule, not the option's (decision 2026-08-12, ZAB-25).
 */
export function Option({
  size = OPTION_MARK,
  mark,
  layout,
  states,
  children,
  ...rest
}: OptionProps): ReturnType<FC> {
  const dot = Math.round(size * 0.5);
  return createElement(
    Toggle,
    {
      ...rest,
      layout: { direction: "row", align: "center", gap: 8, padding: 8, ...layout },
      states: { ...OPTION_STATES, ...states },
    },
    // The two indicator slots, as everywhere: the whole indicator in each state,
    // so nothing styles a descendant by state. Here the "off" one is the space
    // the mark would take, which is what keeps the labels on one column.
    slot(size, {}, { size: dot, style: { ...OPTION_MARK_STYLE, ...mark } }),
    slot(size, {}),
    children,
  );
}

/**
 * A dropdown: a button that opens a list of options in the overlay layer, anchored
 * to itself, and closes when the player picks one.
 *
 * It is a flattened composite and NOT a primitive (decision 2026-08-12, ZAB-25) —
 * a `Button`, a modal `Overlay` anchored to it with `trigger: "press"`, and a
 * `ScrollView` around the `"exclusive-check"` group that `<RadioGroup>` already
 * uses. The selection is ONE value, so it needed no mechanism of its own; what the
 * IR gained is the popover, which is what lets a choice close the list.
 *
 * ```tsx
 * <Select id="lang" value={{ bind: "settings.lang" }} onChange="lang-changed">
 *   <Option value="es"><Text>es</Text></Option>
 *   <Option value="en"><Text>en</Text></Option>
 * </Select>
 * ```
 *
 * **The closed button shows the VALUE**, through a `<Text>` bound to the same path
 * — the IR has no expressions, so there is nothing to look a label up with. Author
 * the display strings as the values when they are for the player to read; an empty
 * value leaves the button blank (there is no placeholder for the same reason).
 */
export function Select({
  id,
  value,
  onChange,
  width = SELECT_WIDTH,
  maxHeight = SELECT_MAX_HEIGHT,
  position = "bottom",
  button,
  label,
  panel,
  layout,
  style,
  children,
  ...rest
}: SelectProps): ReturnType<FC> {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(
      "<Select> needs an `id`: the dropdown is anchored to the button by it, and an " +
        "anchor is the one relation in v1 that addresses another node by name.",
    );
  }
  const bind = typeof value === "object" && value !== null ? value.bind : undefined;
  // The closed face is an ordinary Button — its press opens the popover because it
  // is the anchor of one, never because its type says so — and the dropdown is
  // declared INSIDE it, which is both where an overlay belongs (in place, where the
  // UI that opens it lives) and what keeps `<Select>` one element: an Overlay never
  // joins its parent's flow, so it adds nothing to the button's box.
  return createElement(
    Button,
    {
      ...rest,
      id,
      layout: { direction: "row", align: "center", width, padding: 10, ...layout },
      style: { ...SELECT_BUTTON, ...button, ...style },
    },
    createElement(Text, {
      style: { color: "#e6e8ef", fontSize: 15, ...label },
      ...(bind !== undefined ? { bind } : {}),
    }),
    createElement(
      Overlay,
      {
        modal: true,
        layout: layerLayout(position, undefined, true),
        anchor: { id, at: position, trigger: "press" },
      },
      createElement(
        ScrollView,
        {
          // `stretch` on both the list and the group is what makes an option row
          // as wide as the panel. Without it each row is only as wide as its own
          // label, and the empty rest of the row is a click that does nothing.
          layout: { width, height: maxHeight, padding: 4, align: "stretch" },
          style: { ...SELECT_PANEL, ...panel },
        },
        createElement(
          Container,
          {
            group: "exclusive-check",
            value,
            // `stretch` is what makes the whole ROW the target: without it each
            // option is only as wide as its label, and the empty half of the row
            // is a click that lands on the list and does nothing.
            layout: { direction: "column", align: "stretch" },
          },
          children,
        ),
      ),
    ),
  );
}

/**
 * The `Slider` primitive. NOT exported, for the same reason `Toggle` isn't: its
 * two slots are positional (`children[0]` fill, `children[1]` thumb) and the
 * sugar below is the one place that convention is written down.
 */
interface SliderPrimitiveProps extends CommonProps {
  value?: Bindable<number>;
  min?: number;
  max?: number;
  step?: number;
  axis?: SliderAxis;
  onChange?: string;
  onCommit?: string;
  children?: ReactNode;
}
const SliderPrimitive: FC<SliderPrimitiveProps> = primitive<SliderPrimitiveProps>("Slider");

const SLIDER_LENGTH = 200;
const SLIDER_THICKNESS = 6;
const SLIDER_THUMB = 18;
const RAIL: Style = { background: "#2f3446" };
const FILL: Style = { background: "#4f46e5" };
const THUMB: Style = { background: "#ffffff" };

/**
 * Slider: a number the player drags. The component itself IS the rail — `style`
 * paints it — and it emits the two slots the SDK positions from the value: the
 * fill (start → value) and the thumb, which rides the rail centered on the
 * value and is normally fatter than it.
 *
 * `value` may be a read/write binding, and the two hooks split the two questions
 * a game asks: `onChange` follows the drag (preview the volume) while `onCommit`
 * fires once the player lets go (apply the expensive setting).
 *
 * ```tsx
 * <Slider value={{ bind: "settings.volume" }} onChange="volume-preview" onCommit="volume-apply" />
 * <Slider min={0} max={100} step={10} axis="vertical" length={120} />
 * ```
 */
export function Slider({
  length = SLIDER_LENGTH,
  thickness = SLIDER_THICKNESS,
  thumbSize = SLIDER_THUMB,
  fill,
  thumb,
  axis,
  layout,
  style,
  ...rest
}: SliderProps): ReturnType<FC> {
  const horizontal = axis !== "vertical";
  const across = { [horizontal ? "height" : "width"]: thickness };
  return createElement(
    SliderPrimitive,
    {
      ...rest,
      ...(axis !== undefined && { axis }),
      layout: {
        [horizontal ? "width" : "height"]: length,
        ...across,
        ...layout,
      },
      style: { radius: thickness / 2, ...RAIL, ...style },
    },
    // The fill takes no size along the axis: the SDK sets that from the value.
    createElement(Container, {
      layout: across,
      style: { radius: thickness / 2, ...FILL, ...fill },
    }),
    createElement(Container, {
      layout: { width: thumbSize, height: thumbSize },
      style: { radius: thumbSize / 2, ...THUMB, ...thumb },
    }),
  );
}

/**
 * The `TextInput` primitive. Unlike `<Toggle>` and `<Slider>` it IS exported (as
 * `<TextInput>` below): it is a leaf with no positional slots to hide, so there is
 * no convention the sugar has to own — only defaults.
 */
const TextInputPrimitive: FC<Omit<TextInputProps, "width" | "padding">> =
  primitive<Omit<TextInputProps, "width" | "padding">>("TextInput");

const FIELD_WIDTH = 220;
const FIELD_PADDING = 8;
const FIELD: Style = { background: "#1b1f2e", radius: 6, color: "#ffffff" };

/**
 * A line of text the player writes. The node itself is the box — `style` paints it
 * and the SDK paints the caret, the selection and the placeholder inside — and its
 * `value` may be a read/write binding, so a `<Text bind>` on the same path follows
 * what is typed.
 *
 * `onChange` fires on every edit (filter a list as you type) and `onSubmit` when the
 * player presses Enter (run the search, accept the name). One line in v1: the
 * content scrolls horizontally to keep the caret in view and a pasted newline
 * becomes a space.
 *
 * ```tsx
 * <TextInput
 *   value={{ bind: "profile.name" }}
 *   placeholder="Tu nombre"
 *   maxLength={16}
 *   onSubmit="name-accept"
 *   states={{ empty: { style: { color: "{color.muted}" } } }}
 * />
 * ```
 */
export function TextInput({
  width = FIELD_WIDTH,
  padding = FIELD_PADDING,
  layout,
  style,
  ...rest
}: TextInputProps): ReturnType<FC> {
  return createElement(TextInputPrimitive, {
    ...rest,
    // A field does not resize with what is typed into it, so it needs a width of
    // its own — `layout` still wins, which is how `grow: 1` fills a row.
    layout: { width, padding, ...layout },
    style: { ...FIELD, ...style },
  });
}

export interface TabProps extends CommonProps {
  /**
   * Tab label. A bare string/number is wrapped in `<Text>`; pass a node (e.g. a
   * styled `<Text>` or a `<Row>` with an icon) for full control.
   */
  label: ReactNode;
  /** Props for this tab's panel container. The rest of the props style its button. */
  panel?: Omit<ContainerProps, "group" | "selected" | "children">;
  /** Panel content — shown only while this tab is the selected one. */
  children?: ReactNode;
}

/**
 * One tab of a `<Tabs>`. A marker component: it never renders itself — `<Tabs>`
 * reads its props at authoring time and emits the button/panel pair.
 */
export function Tab(_props: TabProps): ReturnType<FC> {
  throw new Error("<Tab> must be a direct child of <Tabs>.");
}

export interface TabsProps extends Omit<ContainerProps, "group" | "children"> {
  /** Initially selected tab (default: 0). The SDK owns the runtime selection. */
  selected?: number;
  /** Props for the tab bar container (`children[0]`) — a row unless overridden. */
  bar?: Omit<ContainerProps, "group" | "selected" | "children">;
  /** `<Tab>` elements, in bar order. */
  children?: ReactNode;
}

/**
 * Tabs — a flattened composite (decision 2026-08-11, extending 2026-08-03 §5):
 * NOT an IR type. Emits a column `Container` with `group: "exclusive-select"`,
 * whose `children[0]` is the tab bar of `Button`s and whose `children[1..n]` are
 * the panels, one per button in bar order. The SDK enforces "exactly one shown"
 * generically — the unselected panels leave the layout — and styles the active
 * button with `states.selected`. Older SDKs ignore the `group` prop and degrade
 * to the bar plus every panel stacked.
 */
export function Tabs({ bar, layout, selected, children, ...rest }: TabsProps): ReturnType<FC> {
  const tabs = Children.toArray(children).map((child, index) => {
    if (!isValidElement(child) || child.type !== Tab) {
      throw new Error("<Tabs> children must all be <Tab> elements.");
    }
    return { props: child.props as TabProps, key: child.key ?? String(index) };
  });
  if (tabs.length === 0) throw new Error("<Tabs> needs at least one <Tab>.");
  if (selected !== undefined && (selected < 0 || selected >= tabs.length)) {
    throw new Error(
      `<Tabs selected={${selected}}> is out of range — there ${
        tabs.length === 1 ? "is 1 tab" : `are ${tabs.length} tabs`
      }.`,
    );
  }

  const buttons = tabs.map(({ props, key }) =>
    createElement(
      Button,
      { key, ...tabButtonProps(props) },
      typeof props.label === "string" || typeof props.label === "number"
        ? createElement(Text, null, props.label)
        : props.label,
    ),
  );
  const panels = tabs.map(({ props, key }) =>
    createElement(Container, { key, ...props.panel }, props.children),
  );

  return createElement(
    Container,
    {
      ...rest,
      group: "exclusive-select",
      ...(selected !== undefined && { selected }),
      layout: { direction: "column", ...layout },
    },
    createElement(Container, { ...bar, layout: { direction: "row", ...bar?.layout } }, buttons),
    ...panels,
  );
}

/** A `<Tab>`'s own props style its bar button; `label`/`panel`/`children` do not. */
function tabButtonProps({ label: _label, panel: _panel, children: _children, ...rest }: TabProps) {
  return rest;
}

/**
 * The `ProgressBar` primitive. NOT exported: its fill is a positional slot
 * (`children[0]`), and `<ProgressBar>` below is the supported way to build it —
 * one place to get the convention right, like the Toggle's indicators.
 */
interface ProgressBarPrimitiveProps extends CommonProps {
  value?: Bindable<number>;
  children?: ReactNode;
}
const ProgressBarPrimitive: FC<ProgressBarPrimitiveProps> =
  primitive<ProgressBarPrimitiveProps>("ProgressBar");

/** The `Spinner` primitive — see `<Spinner>`, which builds the beads for you. */
interface SpinnerPrimitiveProps extends CommonProps {
  period?: Dim;
  min?: number;
  easing?: Easing;
  children?: ReactNode;
}
const SpinnerPrimitive: FC<SpinnerPrimitiveProps> = primitive<SpinnerPrimitiveProps>("Spinner");

const BAR_SIZE = 8;
const BAR_TRACK: Style = { background: "#2f3446" };
const BAR_FILL: Style = { background: "#4f46e5" };
const DOT_SIZE = 8;
const DOT: Style = { background: "#c8cede" };
const BADGE: Style = { background: "#ef4444" };
const BADGE_LABEL: Style = { color: "#ffffff", fontSize: 12 };

/**
 * A track that fills to a fraction. The node itself is the track — its `style`
 * paints the groove and its `layout` sizes it — and this sugar adds the fill child
 * the primitive expects; `fill` styles it.
 *
 * The bar is horizontal unless `layout.direction` says `"column"`, and it clips by
 * default so a square fill stays inside a rounded track. `layout.justify: "end"`
 * makes it drain from the other side.
 */
export function ProgressBar({
  value,
  fill,
  size = BAR_SIZE,
  layout,
  style,
  clip,
  ...rest
}: ProgressBarProps): ReturnType<FC> {
  const vertical = layout?.direction === "column";
  const radius = size / 2;
  return createElement(
    ProgressBarPrimitive,
    {
      ...rest,
      ...(value !== undefined && { value }),
      clip: clip ?? true,
      layout: {
        direction: "row",
        ...(vertical ? { width: size } : { height: size }),
        ...layout,
      },
      style: { ...BAR_TRACK, radius, ...style },
    },
    createElement(Container, { style: { ...BAR_FILL, radius, ...fill } }),
  );
}

/**
 * Activity indicator: beads that pulse in a travelling wave, driven by the SDK's
 * loop. It does not spin — v1 has no transform — so the motion is opacity, which
 * every target computes to the same number.
 *
 * With no children it builds `dots` round beads; pass your own (bars of different
 * heights, icons) and they become the beads, in wave order.
 */
export function Spinner({
  dots = 3,
  size = DOT_SIZE,
  dot,
  layout,
  children,
  ...rest
}: SpinnerProps): ReturnType<FC> {
  const beads =
    children ??
    Array.from({ length: Math.max(1, dots) }, (_unused, index) =>
      createElement(Container, {
        key: index,
        layout: { width: size, height: size },
        style: { radius: size / 2, ...DOT, ...dot },
      }),
    );
  return createElement(
    SpinnerPrimitive,
    {
      ...rest,
      layout: { direction: "row", align: "center", gap: Math.round(size * 0.75), ...layout },
    },
    beads,
  );
}

/**
 * Badge — a flattened composite, like `<Accordion>`: a pill `Container` with the
 * counter inside. NOT an IR type; nothing about it needs one, since `<Text>` has
 * been bindable since v1.
 */
export function Badge({
  count,
  label,
  layout,
  style,
  children,
  ...rest
}: BadgeProps): ReturnType<FC> {
  const text =
    typeof count === "object"
      ? createElement(Text, { bind: count.bind, style: { ...BADGE_LABEL, ...label } })
      : createElement(Text, { style: { ...BADGE_LABEL, ...label } }, count ?? "");
  return createElement(
    Container,
    {
      ...rest,
      layout: {
        direction: "row",
        justify: "center",
        align: "center",
        padding: 4,
        ...layout,
      },
      style: { radius: 999, ...BADGE, ...style },
    },
    children ?? text,
  );
}

const BACKDROP: Style = { background: "#00000099" };
const PANEL: Style = { background: "#181b26", radius: 12, borderWidth: 1, borderColor: "#2f3446" };
const TOAST: Style = { background: "#2f3446", radius: 8 };
const TOOLTIP: Style = { background: "#101218", radius: 6, borderWidth: 1, borderColor: "#2f3446" };
const MESSAGE: Style = { color: "#e8ecf5", fontSize: 14 };
const HINT: Style = { color: "#c8cede", fontSize: 12 };
/** Keeps the content off the screen edges — the layer spans the whole view. */
const LAYER_INSET = 24;
/** Stacking bands by convention (the IR imposes no taxonomy): the last one opened wins. */
const TOAST_Z = 10;
const TOOLTIP_Z = 20;

/**
 * The nine placements, as the flex the layer already has. The layer is emitted as
 * a row so `justify` is always the horizontal axis and `align` the vertical one,
 * whatever the content is — the author never has to think about main vs cross.
 */
const PLACEMENT: Record<OverlayPosition, { justify: Layout["justify"]; align: Layout["align"] }> = {
  center: { justify: "center", align: "center" },
  top: { justify: "center", align: "start" },
  bottom: { justify: "center", align: "end" },
  left: { justify: "start", align: "center" },
  right: { justify: "end", align: "center" },
  "top-left": { justify: "start", align: "start" },
  "top-right": { justify: "end", align: "start" },
  "bottom-left": { justify: "start", align: "end" },
  "bottom-right": { justify: "end", align: "end" },
};

/**
 * Margin an anchored overlay keeps from the view's edges: the content is placed
 * against its anchor, so the inset is only what keeps a clamped bubble from
 * touching the screen — not the frame an unanchored layer needs.
 */
const ANCHORED_INSET = 8;

/**
 * The layer's layout for a placement, with the author's `layout` overriding it.
 * The placement travels even when anchored: it is what an SDK that ignores
 * `anchor` falls back to, and what the renderer itself uses when the `id`
 * matches no node.
 */
function layerLayout(
  position: OverlayPosition,
  layout: Layout | undefined,
  anchored: boolean,
): Layout {
  return {
    direction: "row",
    ...PLACEMENT[position],
    padding: anchored ? ANCHORED_INSET : LAYER_INSET,
    ...layout,
  };
}

/** The anchor object the IR carries, or nothing at all when there is no `id`. */
function anchorOf(
  anchor: string | undefined,
  position: OverlayPosition,
  offset: Dim | undefined,
  trigger: OverlayTrigger | undefined,
): { anchor: OverlayAnchor } | undefined {
  if (anchor === undefined) return undefined;
  return {
    anchor: {
      id: anchor,
      at: position,
      ...(offset !== undefined && { offset }),
      ...(trigger !== undefined && { trigger }),
    },
  };
}

/** A bare string/number message becomes a `<Text>`; a node is used as it is. */
function message(children: ReactNode, style: Style): ReactNode {
  return typeof children === "string" || typeof children === "number"
    ? createElement(Text, { style }, children)
    : children;
}

/**
 * A modal dialog: a full-view layer that dims what it covers, captures input and
 * traps focus, with the content in a centered panel.
 *
 * The component IS the backdrop — `style` paints it (dim by default), which is why
 * there is no `backdrop` prop — and `panel` styles the card inside it. Give a child
 * `autofocus` and it takes the focus when the modal opens; the SDK gives it back
 * when it closes.
 *
 * ```tsx
 * <Modal visible={{ bind: "ui.confirmQuit" }} onDismiss="quit-cancelled" transition={{ duration: 150 }}>
 *   <Text>¿Salir de la partida?</Text>
 *   <Row layout={{ gap: 8 }}>
 *     <Button onClick="quit-confirm" autofocus><Text>Salir</Text></Button>
 *     <Button onClick="quit-cancelled"><Text>Cancelar</Text></Button>
 *   </Row>
 * </Modal>
 * ```
 */
export function Modal({
  position = "center",
  panel,
  layout,
  style,
  anchor,
  offset,
  trigger,
  children,
  ...rest
}: ModalProps): ReturnType<FC> {
  return createElement(
    Overlay,
    {
      ...rest,
      modal: true,
      layout: layerLayout(position, layout, anchor !== undefined),
      style: { ...BACKDROP, ...style },
      ...anchorOf(anchor, position, offset, trigger),
    },
    createElement(
      Container,
      {
        ...panel,
        layout: { padding: 20, gap: 12, ...panel?.layout },
        style: { ...PANEL, ...panel?.style },
      },
      children,
    ),
  );
}

/**
 * The `Repeat` primitive. NOT exported, for the same reason `Toggle` and `Slider`
 * are not: its slots are positional (`children[0]` template, `children[1..]` empty
 * state) and `<List>`/`<Grid>` are the one place that convention is written down.
 */
interface RepeatPrimitiveProps extends CommonProps {
  items?: string;
  as?: string;
  keyPath?: string;
  children?: ReactNode;
}
const Repeat: FC<RepeatPrimitiveProps> = primitive<RepeatPrimitiveProps>("Repeat");

/**
 * Builds the binding paths of the current element inside a template. Call it for a
 * field (`item("price.amount")` → `"item.price.amount"`) or bare for the whole
 * element (`item()` → `"item"`), and read `$index` for its position.
 *
 * It exists so the alias lives in ONE place: rename `as` and every binding in the
 * template follows, which is what makes nested lists (each with its own alias)
 * readable.
 */
export interface ItemRef {
  (path?: string): string;
  /** The element's position in the array — a number the data does not contain. */
  readonly $index: string;
}

/** An item template: nodes that bind by hand, or a function given the item's paths. */
export type ItemTemplate = ReactNode | ((item: ItemRef) => ReactNode);

/** Props shared by the two ways of laying repeated items out. */
export interface RepeatProps extends CommonProps {
  /**
   * Data path of the array to repeat, e.g. `"shop.items"`. Always a binding: the
   * game owns the data and the document carries only structure.
   */
  items: string;
  /**
   * Alias the template binds against (`"it"` → `bind="it.name"`). Default: `"item"`.
   * Declared rather than reserved so a nested list can still reach the outer
   * element — pick a name that is not a root of your data, which it would shadow.
   */
  as?: string;
  /**
   * Path RELATIVE to the item naming its stable identity (`"id"`, `"meta.sku"`).
   * Absent = identity is positional. It is what keeps per-item state (focus, a
   * checked Toggle, a scroll offset) with the item across a `SetData` that
   * reorders, and what lets the renderer recycle instances. Named `keyPath`
   * because React owns `key`.
   */
  keyPath?: string;
  /** Shown while the array is empty, absent or not an array at all. */
  empty?: ReactNode;
}

export interface ListProps extends RepeatProps {
  /** Item flow. Default: "vertical". */
  axis?: "vertical" | "horizontal";
  /** The item template — a single node, or a function that receives its paths. */
  children?: ItemTemplate;
}

export interface GridProps extends RepeatProps {
  /** Items per line. The grid's geometry is resolved from it at authoring time. */
  columns: number;
  /**
   * Width of one cell in px. Give this OR `layout.width` — the grid solves the
   * other one so exactly `columns` cells fit per line.
   */
  itemWidth?: number;
  /** Props for the cell container that sizes each column. */
  cell?: Omit<ContainerProps, "children">;
  /** The item template — any number of nodes; the cell holds them. */
  children?: ItemTemplate;
}

function itemRef(alias: string): ItemRef {
  const ref = (path?: string): string =>
    path === undefined || path.length === 0 ? alias : `${alias}.${path}`;
  return Object.assign(ref, { $index: `${alias}.${INDEX_SEGMENT}` });
}

/** Resolves the template to its root nodes — running the render-prop, if it is one. */
function templateNodes(children: ItemTemplate | undefined, alias: string): ReactNode[] {
  const rendered = typeof children === "function" ? children(itemRef(alias)) : children;
  return Children.toArray(rendered);
}

/**
 * A data-driven list: the template is emitted ONCE and the SDK instantiates it per
 * element of the bound array (the `Repeat` primitive — decision 2026-08-11, ZAB-29).
 * The list node IS the flex container of the items, so `layout` (gap, padding,
 * justify, align) lays them out like any other container.
 *
 * ```tsx
 * <List items="shop.items" as="it" keyPath="id" layout={{ gap: 8 }}
 *       empty={<Text>Nothing here yet</Text>}>
 *   {(it) => (
 *     <Row layout={{ gap: 12, align: "center" }}>
 *       <Text bind={it("name")} />
 *       <Text bind={it("price")} />
 *       <Button onClick="buy"><Text>Buy</Text></Button>
 *     </Row>
 *   )}
 * </List>
 * ```
 *
 * The template is a single node because `children[0]` IS the template and
 * `children[1..]` are the empty state — the positional convention of the primitive.
 */
export function List({ axis, empty, as, layout, children, ...rest }: ListProps): ReturnType<FC> {
  const nodes = templateNodes(children, as ?? ITEM_ALIAS);
  if (nodes.length === 0) throw new Error("<List> needs an item template as its children.");
  if (nodes.length > 1 || isFragment(nodes[0])) {
    throw new Error(
      "A <List> template is a single node — wrap the items' contents in a <Row> or <Column>.",
    );
  }
  return createElement(
    Repeat,
    {
      ...rest,
      ...(as !== undefined && { as }),
      layout: { direction: axis === "horizontal" ? "row" : "column", ...layout },
    },
    nodes[0],
    empty,
  );
}

/**
 * A transient message that floats over the UI without stealing it: non-modal, so
 * the layer is inert to input and the player keeps using what is underneath, and
 * self-closing after `autoCloseMs` (the SDK clears the bound `visible` and fires
 * `onDismiss`, exactly like Escape does on a modal).
 *
 * A bare string is wrapped in a `<Text>`; pass nodes for an icon plus a label. Its
 * `z` puts it above modals by convention, so a confirmation still shows while a
 * dialog is up.
 *
 * ```tsx
 * <Toast visible={{ bind: "ui.saved" }} onDismiss="toast-closed" transition={{ duration: 200 }}>
 *   Partida guardada
 * </Toast>
 * ```
 */
export function Toast({
  position = "bottom",
  panel,
  label,
  autoCloseMs = 3000,
  z = TOAST_Z,
  layout,
  anchor,
  offset,
  trigger,
  children,
  ...rest
}: ToastProps): ReturnType<FC> {
  return createElement(
    Overlay,
    {
      ...rest,
      modal: false,
      z,
      autoCloseMs,
      layout: layerLayout(position, layout, anchor !== undefined),
      ...anchorOf(anchor, position, offset, trigger),
    },
    createElement(
      Container,
      {
        ...panel,
        layout: { direction: "row", align: "center", gap: 8, padding: 12, ...panel?.layout },
        style: { ...TOAST, ...panel?.style },
      },
      message(children, { ...MESSAGE, ...label }),
    ),
  );
}

/**
 * A hint bubble over the UI: the same non-modal layer as a `<Toast>`, smaller and
 * without a timer.
 *
 * With an `anchor` it hangs from that node's rect — flipping to the other side
 * when it does not fit and sliding to stay on screen — and it shows itself while
 * the anchor is hovered or focused, which is the same hint for a mouse and for a
 * gamepad (decision 2026-08-11, ZAB-46):
 *
 * ```tsx
 * <Button id="jump-btn" onClick="jump"><Text>Saltar</Text></Button>
 * <Tooltip anchor="jump-btn" position="top">Pulsa A para saltar</Tooltip>
 * ```
 *
 * Without one it is placed on the layer and shown by its `visible` binding, which
 * the game moves with `SetData` when it decides the hint applies — the v1 tooltip,
 * unchanged. `trigger="manual"` is the same thing with an anchor: a bubble the game
 * opens, hanging from a control.
 *
 * ```tsx
 * <Tooltip visible={{ bind: "ui.hint" }} position="top">Pulsa A para saltar</Tooltip>
 * ```
 */
export function Tooltip({
  position = "top",
  panel,
  label,
  z = TOOLTIP_Z,
  layout,
  anchor,
  offset,
  // A tooltip hanging from a control is a hint about that control: showing it
  // while the player is on it is the whole point, and `visible` is still there
  // for the game to gate it. `trigger="manual"` opts out.
  trigger = anchor === undefined ? undefined : "hover",
  children,
  ...rest
}: TooltipProps): ReturnType<FC> {
  return createElement(
    Overlay,
    {
      ...rest,
      modal: false,
      z,
      layout: layerLayout(position, layout, anchor !== undefined),
      ...anchorOf(anchor, position, offset, trigger),
    },
    createElement(
      Container,
      {
        ...panel,
        layout: { direction: "row", align: "center", gap: 6, padding: 8, ...panel?.layout },
        style: { ...TOOLTIP, ...panel?.style },
      },
      message(children, { ...HINT, ...label }),
    ),
  );
}

/**
 * A list that wraps into lines of `columns` cells — the same `Repeat`, laid out as a
 * wrapping row (decision 2026-08-11, ZAB-32: `wrap` joins the layout subset).
 *
 * ```tsx
 * <Grid items="inventory.slots" columns={4} itemWidth={72} layout={{ gap: 8 }}>
 *   {(slot) => <Text bind={slot("name")} />}
 * </Grid>
 * ```
 *
 * The geometry is arithmetic, not a percentage: v1 has no fractional dims, so the
 * grid solves `itemWidth` from `layout.width` (or the other way round) at authoring
 * time and each cell carries the resulting px. That is also why `gap`/`padding` must
 * be numbers here — a token only resolves inside the SDK, too late for this sum.
 */
export function Grid({
  columns,
  itemWidth,
  cell,
  empty,
  as,
  layout,
  children,
  ...rest
}: GridProps): ReturnType<FC> {
  const nodes = templateNodes(children, as ?? ITEM_ALIAS);
  if (nodes.length === 0) throw new Error("<Grid> needs an item template as its children.");
  const { width, cellWidth } = gridGeometry(columns, itemWidth, layout);
  return createElement(
    Repeat,
    {
      ...rest,
      ...(as !== undefined && { as }),
      // direction/wrap are the grid itself, not defaults: the geometry above is
      // solved for a wrapping row, so they are not the author's to override.
      layout: { ...layout, direction: "row", wrap: true, width },
    },
    createElement(Container, { ...cell, layout: { ...cell?.layout, width: cellWidth } }, ...nodes),
    empty,
  );
}

/** The px a `<Grid>` needs so exactly `columns` cells fit on a line. */
function gridGeometry(
  columns: number,
  itemWidth: number | undefined,
  layout: GridProps["layout"],
): { width: number; cellWidth: number } {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(`<Grid columns={${columns}}> must be an integer >= 1.`);
  }
  const gap = numericDim(layout?.gap, "gap");
  const padding = numericDim(layout?.padding, "padding");
  const around = gap * (columns - 1) + padding * 2;
  if (itemWidth !== undefined) {
    if (!Number.isFinite(itemWidth) || itemWidth <= 0) {
      throw new Error(`<Grid itemWidth={${itemWidth}}> must be a positive number of px.`);
    }
    // Rounded UP so the line always has room for the last cell: summing the cells
    // one by one and summing them as `columns * itemWidth` need not land on the
    // same float, and a hair too little would push a cell to the next line.
    return { width: Math.ceil(columns * itemWidth + around), cellWidth: itemWidth };
  }
  const width = numericDim(layout?.width, "width");
  if (width <= 0) {
    throw new Error(
      "<Grid> needs its geometry: pass `itemWidth`, or a numeric `layout.width` to divide.",
    );
  }
  // Floored for the mirror-image reason: an inexact division would otherwise make
  // the cells add up to slightly MORE than the line. The leftover px stay as slack.
  const cellWidth = Math.floor((width - around) / columns);
  if (cellWidth <= 0) {
    throw new Error(
      `<Grid columns={${columns}}> does not fit in ${width}px with gap ${gap} and padding ${padding}.`,
    );
  }
  return { width, cellWidth };
}

function numericDim(value: Dim | undefined, name: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `<Grid> resolves its cell width at authoring time, so layout.${name} must be a ` +
        `number of px here (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

function isFragment(node: ReactNode): boolean {
  return isValidElement(node) && node.type === Fragment;
}

/** Re-exported prop aliases for user components. */
export type { CommonProps } from "./host.js";
