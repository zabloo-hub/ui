/**
 * The v1 zabloo component set — own components/props/rules, NOT a web UI kit.
 *
 * Each primitive is a function component that resolves its `variant` (an
 * authoring-time concept — decision 2026-08-03 §6) against the project theme
 * and emits the host primitive with fully resolved style/states. `Row`/`Column`
 * and `Accordion` are authoring sugar that emit a `Container` — composites and
 * variants never reach the IR.
 */

import type { GroupBehavior, ScrollAxis } from "@zabloo/format";
import { Children, createElement, type FC, isValidElement, type ReactNode } from "react";
import type { CommonProps } from "./host.js";
import { useVariant } from "./theme.js";

export interface ContainerProps extends CommonProps {
  /** Cross-child behavior the SDK enforces generically (decision 2026-08-03). */
  group?: GroupBehavior;
  /** Initially selected index of an `"exclusive-select"` group (default: 0). */
  selected?: number;
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
