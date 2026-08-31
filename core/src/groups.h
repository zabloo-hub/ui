// Cross-child behavior: the `group` vocabulary and the Toggle's two slots.
//
// Composites are not IR types (2026-08-03 §5). What a `<Tabs>` or a
// `<RadioGroup>` flattens to is a plain `Container` carrying a `group`, and the
// SDK enforces it GENERICALLY — which is what keeps the vocabulary closed at 13
// primitives and lets an old SDK render an unknown group as ordinary siblings.
//
// Three behaviors, one state each: `exclusive-open` governs a Collapse's `open`,
// `exclusive-select` a tab bar's `selected`, and `exclusive-check` a radio
// group's `checked`. The rules here are pure so they are testable without a
// frame, and so the port has one reference and not two readings of it.

#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "data.h"
#include "envelope.h"

namespace zabloo {

/**
 * A tab group's buttons and their panels (2026-08-11, ZAB-22): `children[0]` is
 * the bar and its `Button` children are the tabs, `children[1..n]` the panels.
 *
 * Positional, because explicit wiring — a Button naming the id of what it
 * controls — was already rejected as logic in the JSON (2026-08-03). Anything in
 * the bar that is NOT a Button is decoration and does not shift the indices,
 * which is the one place the convention would otherwise be fragile.
 */
struct TabsGroup {
  /** Indices into the BAR's children, in order. Trimmed to the pairs that exist. */
  std::vector<size_t> buttons;
  /** Indices into the GROUP's children (so always ≥ 1), paired with `buttons`. */
  std::vector<size_t> panels;
  /** A structural complaint, reported once per build rather than once per tap. */
  std::string warning;
};

/**
 * Resolves the group's structure. `bar_children` is the type of each child of
 * `children[0]`; `child_count` the group's own.
 */
TabsGroup resolve_tabs_group(const std::vector<NodeType> &bar_children, size_t child_count);

/** The initial selection an IR `selected` resolves to: 0 by default, clamped. */
int clamp_selected(const std::optional<double> &value, size_t count);

/**
 * Whether an option is the selected one of an `"exclusive-check"` group.
 *
 * Compared BY VALUE, tolerating the string/number split that data channels blur
 * (a game pushing `2` selects the option authored as `"2"`): content bound to
 * live game data must not hinge on which side did the parsing. Absent never
 * matches absent, however equal two missing values look — a group with no
 * selection must not light up the options that declare no value.
 */
bool is_selected(const DataValue *selected, const DataValue *value);

/**
 * The state a tap produces. A standalone Toggle flips; an option of an
 * `"exclusive-check"` group only ever turns ON — tapping the selected radio
 * keeps it selected instead of leaving the group empty (the selection is one
 * value, and "none" is not one of the options).
 */
bool next_checked(bool checked, bool in_exclusive_group);

/**
 * How visible each child of a Toggle is at a given `checked` progress (0 =
 * unchecked, 1 = checked): `children[0]` is the checked indicator,
 * `children[1]` the unchecked one, and `children[2..]` (the label) is always
 * fully shown.
 *
 * The two indicator slots SHARE one box — the layout pass lays `children[1]` on
 * top of `children[0]` instead of after it — so the swap is a cross-fade rather
 * than one subtree replacing another (2026-08-11, ZAB-36). With no `transition`
 * the progress is only ever 0 or 1, which is exactly the pre-F7 look: one
 * indicator, fully opaque. Paint stays implicit, and the multiplier composes
 * with the slot's own `opacity` the way inherited opacity does (2026-08-06).
 */
double slot_opacity(size_t index, double progress);

/** The `Scalar` an option or a group declares, as a value the store can compare. */
DataValue scalar_value(const Scalar &scalar);

}  // namespace zabloo
