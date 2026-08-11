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
import { createElement, type FC, type ReactNode } from "react";
import type { CommonProps } from "./host.js";
import { useVariant } from "./theme.js";

export interface ContainerProps extends CommonProps {
  /** Cross-child behavior the SDK enforces generically (decision 2026-08-03). */
  group?: GroupBehavior;
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

/** Re-exported prop aliases for user components. */
export type { CommonProps } from "./host.js";
