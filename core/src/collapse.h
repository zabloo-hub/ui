// The Collapse's open/close motion — pure, so its endpoints are testable without
// an engine (the role `progress.h` plays for the bar).
//
// This is the frontier case of the transitions decision (2026-08-11, ZAB-33 §5):
// the content is IN FLOW, so it cannot be kept alive past its own removal the way
// an Overlay can. What animates instead is the Collapse's OWN height — a numeric
// change of a node that never disappears — between the header's box and the height
// measured with the content in. The content stays in layout for as long as the
// tween runs and is clipped by the shrinking box; it leaves layout only once the
// box is closed, which is what makes the closed state cost nothing.
//
// The endpoints come from the LAST measure pass, never from this frame's: the
// engine interpolates declared inputs before layout runs, so asking layout for the
// answer first would be the measure→animate→re-measure loop the decision rules out.
// The consequence is one frame of setup when a Collapse opens for the first time —
// see `collapse_target`.

#pragma once

namespace zabloo {

/** The box a closed Collapse shows: its header, inside its own padding. */
double closed_height(double header_height, double padding);

/**
 * The height the tween is heading to this frame.
 *
 * `natural_height` is what the last measure pass computed for the node with the
 * content in layout — so the frame the content enters, it is still the closed box
 * and the target is the closed box: the Collapse holds shut for that one frame
 * instead of popping open, and the real height (which that same frame's measure is
 * about to compute) starts the tween on the next one. Closing never pays it: the
 * content was already in layout, so its height is known.
 */
double collapse_target(bool open, double natural_height, double closed);

}  // namespace zabloo
