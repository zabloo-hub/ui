// Focus: who can take it, where it starts, and where an arrow sends it.
//
// Navigation is AUTOMATIC and SPATIAL (2026-08-04): the runtime moves the focus
// using the live layout rects it already owns, so it survives a relayout, a
// hot-update and a Collapse opening — precisely what baked neighbour wiring
// cannot do. The IR surface is `autofocus` and `states.focused`, and nothing
// else.
//
// The scoring is here, apart from the view, because it is arithmetic over rects
// and the corpus compares it: two targets that pick different winners from the
// same screen would disagree about which node wears `focused`, which is a
// difference the metrics record.

#pragma once

#include <cstddef>

#include "layout.h"

namespace zabloo {

/**
 * The header of a `Collapse` — `children[0]`, the `<summary>` of the model. It
 * is focusable while the Collapse itself is not: what a player presses is the
 * header, and what toggles is its parent.
 */
bool is_collapse_header(const LayoutNode &node);

/**
 * Focusability derives from component identity, with exactly one exception:
 * `disabled` takes a node out of the interaction model (ZAB-63). Answering false
 * is what removes it from navigation AND from hover — the hover set is DEFINED
 * as the focusable one, so a mouse and a pad see the same dead control.
 */
bool is_focusable(const LayoutNode &node);

/**
 * The initial focus of a subtree: the first `autofocus` node in document order
 * that is in layout and focusable.
 *
 * It is answered per frame rather than once at construction, because whether a
 * node is focusable depends on the inherited `disabled` flag — and that is only
 * settled by the resolve pass.
 */
LayoutNode *autofocus_in(LayoutNode &scope);

/**
 * The console-UI score for a candidate at `to` from a focus at `from`, travelling
 * along the unit axis `(dx, dy)`: `projection + 2 × orthogonal`, and negative for
 * a candidate that does not lie in the direction of travel.
 *
 * Lowest wins, and the first of a tie keeps it — so the walk is a function of the
 * rects and of document order, with nothing left to chance.
 */
double navigation_score(const Rect &from, const Rect &to, double dx, double dy);

// There is deliberately no `collect_focusables` here. "Everything focusable in
// this subtree" stopped being answerable from a tree alone once the overlay layer
// landed (G9): a CLOSED popover's options are still `in_layout`, so the answer
// depends on what is in the layer this frame. The view owns that walk
// (`View::candidates_in`), which is the only place that knows.

/**
 * How far a scroller has to move on one axis to bring `[start, start + size)`
 * inside `[view_start, view_start + view_size)`: the minimum, and zero when it
 * already fits.
 *
 * A target LARGER than the viewport aligns its leading edge instead of
 * oscillating — `before` and `after` are both positive there, and the answer is
 * to leave it where it is if it already covers the view.
 *
 * Not wired to anything yet: there are no scroll offsets to move until G6
 * (ZAB-139) gives `ScrollView` its own. It is ported here with the rest of the
 * navigation because it belongs to the same decision (the focus drags the scroll,
 * ZAB-47) and porting it later would separate the rule from its tests.
 */
double reveal_delta(double start, double size, double view_start, double view_size);

}  // namespace zabloo
