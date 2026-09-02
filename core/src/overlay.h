// The overlay layer: how `Overlay` nodes leave the tree's flow and become ONE
// layer above the view (2026-08-11, ZAB-19), and what that does to input and to
// focus.
//
// A port of `renderer-web/src/overlay.ts`. Everything here is pure tree and rect
// math over layout nodes — no engine, no clock, no state — so the layering rules
// are tested with nothing but a tree, the same split `clip.h` and `scroll.h`
// follow. The state that runs them frame to frame is `overlay_layer.h`.
//
// The three rules it encodes:
// - **Paint:** the whole tree first, then every present Overlay of the view in
//   `(z, document order)`. Nested overlays flatten into the same layer.
// - **Input:** the layer is hit-tested top-down before the tree. A `modal`
//   overlay CAPTURES — nothing below it (lower overlays included) sees the
//   event, and a point that lands on no child of it is a tap on the backdrop.
//   A non-modal one is inert: only its children take events.
// - **Focus:** the trap derives from `modal` — while a modal is up, only its
//   subtree offers navigation candidates.
//
// Plus the two things an overlay does that no other node does: it **fades in and
// out** of the layer (`step_presence`), which is why a closing modal outlives the
// `visible` that closed it by exactly one transition, and it can be **anchored**
// to another node's rect (`anchor_box`, 2026-08-11, ZAB-46) — the one placement
// in v1 that is relative to a rect the node does not contain.
//
// An anchored overlay may also be a **popover** (`trigger: "press"`, 2026-08-12,
// ZAB-25): the anchor's press opens it and the core owns that state, so a dismiss
// or a selection inside can close it. That is the whole of `<Select>` — the
// dropdown is a `Button`, a modal anchored `Overlay` and an `"exclusive-check"`
// group, with no primitive of its own.

#pragma once

#include <optional>
#include <vector>

#include "clip.h"
#include "layout.h"
#include "transition.h"

namespace zabloo {

/** Distance kept from the anchor's edge when the node declares none. */
inline constexpr double ANCHOR_OFFSET = 8.0;

/** Is this node an `Overlay` that captures the input below it? Default: yes. */
bool is_modal(const LayoutNode &node);

/**
 * The node's `autoCloseMs`, or absent for an overlay that stays up.
 *
 * A non-positive timeout is a typo, not "close immediately" — the validator lets
 * any number through (forms, never vocabularies), so the meaning is decided here.
 */
std::optional<double> auto_close_ms(const LayoutNode &node);

/** Whether this node is an `Overlay` with an anchor that names something. */
bool is_anchored(const LayoutNode &node);

/**
 * Whether this overlay rides its anchor's hover/focus. Such an overlay is also
 * INERT to input (see `resolve_hit`): a bubble that took the pointer would steal
 * the hover from the very anchor holding it up, and the two would flicker
 * against each other for as long as the pointer sat between them.
 */
bool is_hover_triggered(const LayoutNode &node);

/**
 * Whether this overlay is a POPOVER: opened and closed by its anchor's press,
 * with the core owning that state (2026-08-12, ZAB-25). Unlike a hover-triggered
 * one it is a surface, not a hint — it takes input normally, which is what lets
 * the player pick something inside it.
 */
bool is_press_triggered(const LayoutNode &node);

/**
 * Whether a node still counts for the layer. The live layer is `in_layout` plus
 * whatever the anchor allows; the paint pass widens it to the overlays that are
 * still fading out, and that is the ONLY difference between the two — an overlay
 * on its way out is pixels, never input.
 */
class Presence {
 public:
  virtual ~Presence() = default;
  virtual bool present(const LayoutNode &node) const = 0;
};

/** The default: in layout, and nothing else. */
class InLayoutPresence : public Presence {
 public:
  bool present(const LayoutNode &node) const override { return in_layout(node); }
};

/**
 * The `overlays` that are present, flattened into one layer ordered by
 * `(z, document order)`.
 *
 * Hidden overlays contribute nothing — no layer, no backdrop, no input blocking
 * — and neither does anything under them, which is why presence is asked of the
 * whole chain up to the root and not of the entry alone: an overlay inside a
 * closed Collapse is as absent as one with `visible: false`.
 *
 * The candidates come in as a list rather than being walked for, because the
 * view keeps that set as it builds the tree (ZAB-73): re-walking a thousand-row
 * list once a frame to find three panels is the walk, not the finding.
 */
std::vector<LayoutNode *> collect_layer(const std::vector<LayoutNode *> &overlays,
                                        const Presence &present);

/** The Overlays hanging under `root`, present or not — for tests and for anyone
 * holding a tree and nothing else. The view uses its own registry instead. */
void overlays_of(LayoutNode &root, std::vector<LayoutNode *> &out);

/**
 * How present an overlay is this frame, 0 (gone) to 1 (fully up) — the
 * enter/exit fade, multiplied onto the whole layer entry when it paints.
 *
 * It is behavior driving the interpolation engine with endpoints it computes
 * (2026-08-11 §5), exactly like the ProgressBar's fraction: the node's own
 * `transition` decides the duration and curve, so an overlay without one appears
 * and disappears instantly — the pre-F7 behavior, unchanged. `visible` itself
 * never animates; what animates is the overlay's presence in the layer, which is
 * why the `visible` binding stays the single mechanism and the IR gains nothing.
 *
 * The first step of a track snaps, so a modal that is already open when the view
 * loads does not fade in — mounting snaps, like everywhere else. Its state must
 * therefore live outside the node's own `anim`, which the resolve pass drops
 * whenever a node leaves layout: there would be no exit to animate if the exit
 * erased its own starting point.
 */
SteppedValue step_presence(NodeAnim *anim, bool live, const ResolvedTransition *transition,
                           double now);

/** The modal that owns input and focus right now: the highest one in the layer. */
LayoutNode *top_modal(const std::vector<LayoutNode *> &layer);

/**
 * The subtree focus navigation is confined to: the topmost modal, or the whole
 * view when there is none. Non-modal overlays never trap — their children join
 * the normal navigation like any other node.
 */
LayoutNode &focus_scope(LayoutNode &root, const std::vector<LayoutNode *> &layer);

/** Whether `node` is `ancestor` or lives inside it. */
bool is_within(const LayoutNode &node, const LayoutNode &ancestor);

/**
 * Whether a node is actually on screen right now: in layout with every ancestor
 * in layout, and not entirely clipped away by one of them (scrolled out of a
 * `ScrollView`). It is what decides whether an anchored overlay still has
 * something to point at — a tooltip hanging over the edge of a list whose row
 * has scrolled past is pointing at nothing.
 *
 * It reads the rects of the frame that has already been laid out, so a scroll
 * takes the tooltip away one frame later — invisible at 60fps, and the
 * alternative would be laying the tree out twice per frame to answer a question
 * about a bubble.
 */
bool is_on_screen(LayoutNode &node, ClipArena &arena);

/**
 * The `"exclusive-check"` groups inside a subtree, outermost first — a popover's
 * own lists. Descending stops at each group: a nested one belongs to that
 * group's options, and the popover closes on ITS selection, not on its
 * children's.
 */
void check_groups_in(LayoutNode &node, std::vector<LayoutNode *> &out);

/**
 * Where the focus goes when a popover opens: the option the group already holds,
 * so a list of twenty languages opens ON the one in use instead of at the top.
 * Null when nothing is selected — the caller falls back to `autofocus`.
 *
 * It reads `checked`, which an `"exclusive-check"` group derives from its value,
 * so it needs no second notion of "the current one".
 */
LayoutNode *selected_option_in(LayoutNode &overlay);

/** A rect's content box: the same inset the measure pass reserved for `padding`. */
Rect deflate(const Rect &rect, double padding);

/**
 * Where an anchored overlay's content goes: `at` around `anchor`, `offset` px
 * away, flipped to the opposite side when the preferred one does not fit and the
 * other does, and finally clamped into `bounds` (the view, inset by the
 * overlay's own padding).
 *
 * Flip before clamp, and never both on the same axis for the same reason: a
 * bubble that does not fit above belongs below, whereas one that runs off the
 * side of the screen only needs sliding — flipping it there would move it away
 * from the word it points at. `center` neither flips nor offsets: it is placed
 * ON the anchor.
 */
Rect anchor_box(const Rect &anchor, const Size &size, AnchorAt at, double offset,
                const Rect &bounds);

/** What a pointer landed on, once the layer has had its say. */
struct LayerHit {
  enum class Kind { Miss, Node, Backdrop };

  Kind kind = Kind::Miss;
  /** The node under the point, for `Node`; the capturing overlay, for `Backdrop`. */
  LayoutNode *node = nullptr;
};

/**
 * Resolves a point against the layer first (top-down) and only then the tree.
 * A modal stops the walk: either one of its children took the event, or the
 * point is a backdrop tap — which never falls through to what it covers.
 *
 * A hover-triggered overlay is skipped entirely: it is a hint held up by its
 * anchor's hover, so taking the pointer would end it (2026-08-11, ZAB-46).
 *
 * Both walks go through `hit_test`, so clipping cuts input here too.
 */
LayerHit resolve_hit(LayoutNode &root, const std::vector<LayoutNode *> &layer, double x, double y,
                     ClipArena &arena);

}  // namespace zabloo
