/**
 * Pure resolution of an `"exclusive-select"` group (Tabs) — the positional
 * contract of decision 2026-08-11: `children[0]` is the tab bar (its `Button`
 * children are the tabs, in order) and `children[1..n]` are the panels, one per
 * button. No DOM and no layout tree, so it's unit testable without a canvas
 * (same split as `scroll.ts`).
 *
 * Node-shape agnostic on purpose: callers pass accessors, so this works on the
 * renderer's layout nodes and on plain IR nodes alike.
 */

export interface TabsResolution<N> {
  /** The bar's `Button` children, in bar order — non-buttons (titles, separators) don't count as tabs. */
  buttons: N[];
  /** One panel per button, in the same order. */
  panels: N[];
  /** Non-fatal structural complaint to log once; null when the shape is exact. */
  warning: string | null;
}

/**
 * Splits a group container's children into tab buttons and panels. Tolerant by
 * design — a mismatched authoring shape degrades to the pairs that do line up
 * instead of breaking the view.
 */
export function resolveTabsGroup<N>(
  children: readonly N[],
  typeOf: (node: N) => string,
  childrenOf: (node: N) => readonly N[],
): TabsResolution<N> {
  if (children.length === 0) {
    return { buttons: [], panels: [], warning: "an exclusive-select group needs a tab bar child" };
  }
  const buttons = childrenOf(children[0]).filter((child) => typeOf(child) === "Button");
  const panels = children.slice(1);
  if (buttons.length === 0) {
    return { buttons: [], panels: [], warning: "the tab bar (children[0]) has no Button children" };
  }
  const pairs = Math.min(buttons.length, panels.length);
  const warning =
    buttons.length === panels.length
      ? null
      : `${buttons.length} tab button(s) but ${panels.length} panel(s) — using the first ${pairs}`;
  return { buttons: buttons.slice(0, pairs), panels: panels.slice(0, pairs), warning };
}

/**
 * The initial selection an IR `selected` value resolves to: default 0, clamped
 * into range, non-integers ignored (the SDK owns runtime state — the IR only
 * carries where it starts).
 */
export function clampSelected(value: unknown, count: number): number {
  if (count <= 0) return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  return Math.min(count - 1, Math.max(0, value));
}
