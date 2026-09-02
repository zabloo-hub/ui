// Pointer hit-testing over the laid-out tree — pure, so the rule "a clipped-away
// child receives no input" is testable with no engine at all.
//
// A port of `renderer-web/src/hit.ts`. Hit-testing runs on the same rects the
// paint pass uses (already translated by any ancestor `ScrollView`'s offset)
// under the same regions, which is what keeps `clip` honest: clipping the paint
// alone would leave invisible buttons that still answer a tap (2026-08-11).

#pragma once

#include "clip.h"
#include "layout.h"

namespace zabloo {

/**
 * A `ScrollView` always clips; any node opts in with `clip: true`. A behavior may
 * also turn it on for a frame (`forced_clip`) — a `Collapse` whose box is closing
 * has to cut the content it is closing over, and an author should not have to
 * remember to ask for that. G8 (ZAB-141) is what sets it.
 */
bool clips_children(const LayoutNode &node);

/**
 * The region a node's children inherit; its own is `inherited`.
 *
 * A node that does not clip hands back the very pointer it was given, which is
 * what makes the tessellator's "same region?" comparison cost a pointer and stay
 * faithful to the reference's object identity.
 */
const Clip *child_clip(const LayoutNode &node, const Clip *inherited, ClipArena &arena);

/**
 * Deepest in-flow node under the point; later siblings win, because they paint
 * last.
 *
 * Children are searched even where they overflow their parent's rect: only a
 * clip cuts input, exactly as only a clip cuts paint. Bailing out on the parent's
 * rect instead — what this did before clipping existed — made an overflowing
 * child that IS painted unreachable, the same paint/input mismatch as clipping
 * the paint alone, just in the other direction.
 *
 * `Overlay` subtrees are skipped: they belong to the layer, which `resolve_hit`
 * tests first and against the view rect rather than against this tree's regions.
 */
LayoutNode *hit_test(LayoutNode &root, double x, double y, ClipArena &arena,
                     const Clip *inherited = nullptr);

/**
 * The region a node's OWN rect is subject to: the intersection of every clipping
 * ancestor. Used to re-check a press on release, where the tree walk of
 * `hit_test` would answer a different question — which node is under the pointer
 * NOW, possibly a child of the pressed one.
 *
 * The walk stops at an `Overlay`: a layer entry is laid out against the view
 * rect, so the regions of wherever it was DECLARED never apply to it.
 */
const Clip *effective_clip(const LayoutNode &node, ClipArena &arena);

}  // namespace zabloo
