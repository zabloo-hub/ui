/**
 * The whole state of the chrome, as the eleven slices add up to it, plus the two
 * shapes every slice creator is handed.
 *
 * The slices are FLAT — `set({ theme })`, not `set({ theme: { theme } })` — which
 * is zustand's own slice pattern and what makes a selector as cheap as reading a
 * field. The price is that no two slices may name a field the same, so the ones
 * that would have collided on `entries` keep their plural instead (`actions`,
 * `problems`) and their setters carry the slice in the name (`appendAction`,
 * `replaceProblems`). Nothing else is namespaced.
 *
 * Type-only cycle ahead: this module names the slice interfaces and the slice
 * modules name `Setter`/`Getter` from here. Both directions are `import type` and
 * erase completely, so there is no cycle at runtime — and the alternative, giving
 * every slice a hand-written narrow view of the state, buys nothing but drift.
 */

import type { ActionsSlice } from "./actions";
import type { BindingsSlice } from "./bindings";
import type { ConnectionSlice } from "./connection";
import type { EnvelopeSlice } from "./envelope";
import type { LayoutSlice } from "./layout";
import type { ProblemsSlice } from "./problems";
import type { RuntimeSlice } from "./runtime";
import type { StatsSlice } from "./stats";
import type { ThemeSlice } from "./theme";
import type { ViewportSlice } from "./viewport";
import type { ViewsSlice } from "./views";

export type PreviewState = ThemeSlice &
  ViewsSlice &
  ViewportSlice &
  ConnectionSlice &
  BindingsSlice &
  ActionsSlice &
  ProblemsSlice &
  StatsSlice &
  LayoutSlice &
  EnvelopeSlice &
  RuntimeSlice;

/** zustand's `set`, narrowed to the shallow-merge form every slice here uses. */
export type Setter = (partial: Partial<PreviewState>) => void;

export type Getter = () => PreviewState;
