/**
 * Variants (decision 2026-08-03, §6): an AUTHORING-TIME concept — they never
 * reach the IR. `<Button variant="primary">` merges the variant's style/states
 * (defined in the project's theme) at emit time, and the envelope receives the
 * node fully resolved, keeping the founding IR rule: resolved per node, no
 * cascade. Same pattern as composites: design-system concepts live in authoring.
 */

import type { StateName, StateOverride, Style, Transition } from "@zabloo/format";
import { createContext, createElement, type ReactNode, useContext } from "react";

export interface VariantDef {
  style?: Style;
  states?: Partial<Record<StateName, StateOverride>>;
  /**
   * Motion for this variant. Unlike `style`, it is not merged field by field —
   * `transition` is one object per node (decision 2026-08-11, ZAB-33), so the
   * most specific declaration wins whole: node prop > variant > theme default.
   */
  transition?: Transition;
}

/** Variants keyed by component name, then variant name: `{ Button: { primary: {…} } }`. */
export type ThemeVariants = Record<string, Record<string, VariantDef>>;

/**
 * Default motion keyed by component name — the same key as `variants`, because
 * it answers the same question ("how does a Button look/move here?") one level
 * up: `{ Button: { duration: "{motion.fast}" } }` gives every Button in the
 * project the same feel without repeating the prop.
 *
 * It is deliberately NOT a single global default: with `duration` tokenized, a
 * theme still tunes every component's motion from one place (`motion.*`), while
 * only the types that actually move carry a `transition` into the envelope.
 * Keying by primitive means the containers the sugar builds (`<Switch>`'s rails,
 * `<Tabs>`' panels) count as `Container` — that is the price of one flat key.
 */
export type ThemeTransitions = Record<string, Transition>;

export interface ZablooTheme {
  variants?: ThemeVariants;
  transitions?: ThemeTransitions;
}

const ThemeContext = createContext<ZablooTheme>({});

/** Provides the project theme to the component tree (the exporter wraps views). */
export function ThemeProvider({ theme, children }: { theme: ZablooTheme; children?: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

/**
 * Resolves a variant into `{ style, states, transition }` merged UNDER the
 * explicit props (explicit always wins). Unknown variants fail loudly — this is
 * authoring time.
 *
 * The theme's default `transition` for the component applies even with no
 * variant: motion is a property of the component type, not of one of its looks.
 */
export function useVariant(
  component: string,
  variant: string | undefined,
  props: VariantDef,
): VariantDef {
  const theme = useContext(ThemeContext);
  if (variant === undefined) {
    const transition = props.transition ?? theme.transitions?.[component];
    return transition === undefined ? props : { ...props, transition };
  }

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

  const transition = props.transition ?? def.transition ?? theme.transitions?.[component];
  return { style, states, ...(transition !== undefined && { transition }) };
}
