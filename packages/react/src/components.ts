/**
 * The v1 zabloo component set — own components/props/rules, NOT a web UI kit.
 *
 * `Container`, `Text` and `Button` are host components: the reconciler receives
 * their type string directly and emits IR primitives. `Row`/`Column` are authoring
 * sugar (plain function components) that emit a `Container` — they never reach
 * the IR (decision 2026-08-01: closed vocabulary of 3 primitives).
 */

import type { Bindable } from "@zabloo/format";
import { createElement, type FC, type ReactNode } from "react";
import type { CommonProps } from "./host.js";

export interface ContainerProps extends CommonProps {
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

// Host components: the string IS the IR primitive type. Cast so JSX sees a
// normal typed component.
export const Container = "Container" as unknown as FC<ContainerProps>;
export const Text = "Text" as unknown as FC<TextProps>;
export const Button = "Button" as unknown as FC<ButtonProps>;
export const Collapse = "Collapse" as unknown as FC<CollapseProps>;

/** `<Container>` with `direction: "row"` (authoring sugar, not a primitive). */
export function Row({ layout, ...rest }: ContainerProps): ReturnType<FC> {
  return createElement(Container, { ...rest, layout: { direction: "row", ...layout } });
}

/** `<Container>` with `direction: "column"` (authoring sugar, not a primitive). */
export function Column({ layout, ...rest }: ContainerProps): ReturnType<FC> {
  return createElement(Container, { ...rest, layout: { direction: "column", ...layout } });
}

/** Re-exported prop aliases for user components. */
export type { CommonProps } from "./host.js";

/** Convenience alias: a bindable value (static or `{ bind: "path" }`). */
export type { Bindable };
