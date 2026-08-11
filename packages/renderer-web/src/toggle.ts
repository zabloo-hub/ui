/**
 * Pure Toggle semantics (ZAB-23) shared by the build pass, the input handlers
 * and `setData`. No DOM — kept separate so it's unit testable without a canvas,
 * and so the Unity SDK has an unambiguous reference for the same rules.
 */

/**
 * How visible each child is at a given `checked` progress (0 = unchecked,
 * 1 = checked): `children[0]` is the checked indicator, `children[1]` the
 * unchecked one, `children[2..]` (the label) is always fully shown.
 *
 * The two indicator slots SHARE one box — the layout pass lays `children[1]` on
 * top of `children[0]` instead of after it — so the swap is a cross-fade rather
 * than one subtree replacing another (decision 2026-08-11, ZAB-36, extending the
 * two-slot model of ZAB-23). With no `transition` the progress is only ever 0 or
 * 1, which is exactly the pre-F7 look: one indicator, fully opaque.
 *
 * Paint stays implicit — the check/knob is still composed, not a new draw
 * command — and the multiplier composes with the slot's own `opacity` the same
 * way the Spinner's wave does (2026-08-06).
 */
export function slotOpacity(index: number, progress: number): number {
  const checked = progress > 1 ? 1 : progress > 0 ? progress : 0; // NaN → 0
  if (index === 0) return checked;
  if (index === 1) return 1 - checked;
  return 1;
}

/**
 * Whether an option is the selected one of an `"exclusive-check"` group.
 * Compared by value, tolerating the string/number split that data channels
 * blur (a game pushing `2` selects the option authored as `"2"`): content
 * bound to live game data must not hinge on which side did the parsing.
 */
export function isSelected(selected: unknown, value: unknown): boolean {
  // Absent first: "no selection yet" and "option without a value" must never
  // match each other, however equal `undefined === undefined` looks.
  if (selected === undefined || selected === null || value === undefined || value === null) {
    return false;
  }
  if (selected === value) return true;
  const comparable = (v: unknown) => typeof v === "string" || typeof v === "number";
  return comparable(selected) && comparable(value) && String(selected) === String(value);
}

/**
 * The state a tap produces. A standalone Toggle flips; an option of an
 * `"exclusive-check"` group only ever turns ON — tapping the selected radio
 * keeps it selected instead of leaving the group empty (radio semantics: the
 * selection is one value, and "none" is not one of the options).
 */
export function nextChecked(checked: boolean, inExclusiveGroup: boolean): boolean {
  return inExclusiveGroup ? true : !checked;
}
