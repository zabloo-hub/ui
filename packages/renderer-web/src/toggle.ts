/**
 * Pure Toggle semantics (ZAB-23) shared by the build pass, the input handlers
 * and `setData`. No DOM — kept separate so it's unit testable without a canvas,
 * and so the Unity SDK has an unambiguous reference for the same rules.
 */

/**
 * Which indicator slot is in layout: `children[0]` only while checked,
 * `children[1]` only while unchecked, `children[2..]` (the label) always.
 * Paint stays implicit — the check/knob is composed, not a new draw command.
 */
export function slotShown(index: number, checked: boolean): boolean {
  if (index === 0) return checked;
  if (index === 1) return !checked;
  return true;
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
