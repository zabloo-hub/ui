/**
 * Variants (decision 2026-08-03, §6): an AUTHORING-TIME concept — they never
 * reach the IR. `<Button variant="primary">` merges the variant's style/states
 * (defined in the project's theme) at emit time, and the envelope receives the
 * node fully resolved, keeping the founding IR rule: resolved per node, no
 * cascade. Same pattern as composites: design-system concepts live in authoring.
 */

import type { StateName, StateOverride, Style } from "@zabloo/format";
import { createContext, createElement, type ReactNode, useContext } from "react";

export interface VariantDef {
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
}

/** Variants keyed by component name, then variant name: `{ Button: { primary: {…} } }`. */
export type ThemeVariants = Record<string, Record<string, VariantDef>>;

export interface ZablooTheme {
  variants?: ThemeVariants;
}

const ThemeContext = createContext<ZablooTheme>({});

/** Provides the project theme to the component tree (the exporter wraps views). */
export function ThemeProvider({ theme, children }: { theme: ZablooTheme; children?: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

/**
 * Resolves a variant into `{ style, states }` merged UNDER the explicit props
 * (explicit always wins). Unknown variants fail loudly — this is authoring time.
 */
export function useVariant(
  component: string,
  variant: string | undefined,
  props: VariantDef,
): VariantDef {
  const theme = useContext(ThemeContext);
  if (variant === undefined) return props;

  const def = theme.variants?.[component]?.[variant];
  if (!def) {
    const known = Object.keys(theme.variants?.[component] ?? {});
    throw new Error(
      `Unknown ${component} variant "${variant}"` +
        (known.length > 0
          ? ` (theme defines: ${known.join(", ")})`
          : " — no variants defined in the theme"),
    );
  }

  const style: Style | undefined =
    def.style || props.style ? { ...def.style, ...props.style } : undefined;

  let states: VariantDef["states"];
  if (def.states || props.states) {
    states = {};
    const names = new Set([
      ...Object.keys(def.states ?? {}),
      ...Object.keys(props.states ?? {}),
    ] as StateName[]);
    for (const name of names) {
      const fromVariant = def.states?.[name]?.style;
      const fromProps = props.states?.[name]?.style;
      states[name] = { style: { ...fromVariant, ...fromProps } };
    }
  }

  return { style, states };
}
