// How a node's runtime state collapses into one style.
//
// There is no cascade: each node resolves its OWN base style plus the overrides
// of the states it is currently in (2026-08-04). The order below is the whole
// contract, and it is normative — the web renderer's `states.ts` and this file
// have to agree, or the same envelope paints two different screens.

#pragma once

#include <cstddef>

#include "envelope.h"

namespace zabloo {

/** The runtime flags the core owns, keyed by component identity. */
struct NodeStates {
  bool hovered = false;
  bool pressed = false;
  bool focused = false;
  /** The chosen button of an `"exclusive-select"` group (a tab). */
  bool selected = false;
  /** A Toggle's own value (in an `"exclusive-check"` group, the group's). */
  bool checked = false;
  /** A TextInput holding no text — what styles its placeholder (ZAB-26). */
  bool empty = false;
  /**
   * Out of the interaction model, its own or an ancestor's (ZAB-63). The only
   * state a node that is not focusable can be in, which is what lets the labels
   * of a disabled section dim along with the controls in it.
   */
  bool disabled = false;
};

/**
 * Least to most specific — later wins:
 *
 *   base → empty → selected → checked → hover → focused → pressed → disabled
 *
 * Value states go first: what the control IS is the baseline, and how the
 * pointer or the focus is treating it right now paints over that. `hover` sits
 * under `focused` so a focus ring is never hidden by a mouse passing by, and
 * `pressed` wins over both because it lasts exactly as long as the finger is
 * down. `disabled` closes the list: a disabled node takes no input, so its place
 * only matters against the VALUE states — a disabled Toggle is still `checked`
 * — and being last is what lets one override speak for the whole control
 * whatever value it happens to hold.
 */
extern const StateName STATE_ORDER[static_cast<size_t>(StateName::Count)];

/**
 * The style to resolve this frame: the base with every active state's override
 * merged over it, in `STATE_ORDER`. Field by field, which is what `Object.assign`
 * means where the reference implementation spreads objects — an override only
 * speaks for the props it declares.
 */
Style effective_style(const Node &node, const NodeStates &states);

}  // namespace zabloo
