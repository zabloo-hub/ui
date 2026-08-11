/**
 * The v1 zabloo component set — own components/props/rules, NOT a web UI kit.
 *
 * Each primitive is a function component that resolves its `variant` (an
 * authoring-time concept — decision 2026-08-03 §6) against the project theme
 * and emits the host primitive with fully resolved style/states. `Row`/`Column`
 * and `Accordion` are authoring sugar that emit a `Container` — composites and
 * variants never reach the IR.
 */

import type { Bindable, GroupBehavior, ScrollAxis, Style } from "@zabloo/format";
import {
  Children,
  createElement,
  type FC,
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
  /** Scrollable axis. Default: "vertical". */
  axis?: ScrollAxis;
  /** Overlay position indicator painted by the SDK. Default: true. */
  scrollbar?: boolean;
  children?: ReactNode;
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

export interface RadioGroupProps extends Omit<ContainerProps, "group"> {
  /**
   * The selected value — usually a read/write binding (`{ bind: "settings.quality" }`).
   * A `<Radio>` is checked while its `value` equals this one.
   */
  value?: Bindable<string | number>;
}

/** Wraps a host primitive with variant resolution (variant never reaches the IR). */
function primitive<P extends CommonProps>(type: string): FC<P> {
  const Component = (props: P) => {
    const { variant, style, states, ...rest } = props;
    const resolved = useVariant(type, variant, { style, states });
    return createElement(type, { ...rest, style: resolved.style, states: resolved.states });
  };
  Component.displayName = type;
  return Component as FC<P>;
}

export const Container: FC<ContainerProps> = primitive<ContainerProps>("Container");
export const Text: FC<TextProps> = primitive<TextProps>("Text");
export const Button: FC<ButtonProps> = primitive<ButtonProps>("Button");
export const Collapse: FC<CollapseProps> = primitive<CollapseProps>("Collapse");
export const ScrollView: FC<ScrollViewProps> = primitive<ScrollViewProps>("ScrollView");

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

/** Re-exported prop aliases for user components. */
export type { CommonProps } from "./host.js";
