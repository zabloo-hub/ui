// Who gets the keys, when a scene has more than one `ZablooView` in it.
//
// A port of the rule in `renderer-web/src/input/ownership.ts`, minus the half
// that is about a browser. The pointer is scoped by construction — `_gui_input`
// only reaches the Control the mouse is over — but the KEYBOARD is not: an
// unhandled key travels the whole scene tree, so two views side by side would
// each move their own focus on every arrow. That asymmetry is the bug.
//
// It lives in the adapter and not in the core on purpose: it is about a PROCESS
// and its input routing, which is the one thing a `ViewSnapshot` cannot describe
// and therefore the one thing the golden corpus cannot arbitrate. The core knows
// about one view at a time, which is exactly right.
//
// The owner is the first view added, and touching a view takes it — so a scene
// with a single view behaves exactly as if the rule were not here.

#pragma once

namespace godot {

class ZablooView;

/** A view that has just entered the tree. The first one to arrive owns input. */
void register_input_view(ZablooView *view);
/** A view leaving: ownership falls back to the oldest one left, or to none. */
void unregister_input_view(ZablooView *view);
/**
 * The player touched this view, so it takes the keyboard. A view that is not
 * registered claims nothing.
 */
void claim_input(ZablooView *view);
bool owns_input(const ZablooView *view);

}  // namespace godot
