// The overlay layer's frame-to-frame state: the modal stack and its focus
// bookkeeping, dismiss requests, the enter/exit presence tween, anchoring,
// popovers and `autoCloseMs`.
//
// A port of `renderer-web/src/overlays/layer.ts`. `overlay.h` owns the pure
// rules (what is modal, where an anchored box lands, what the layer contains);
// this owns the state that runs them, frame after frame.
//
// It reads and writes the `View` directly instead of going through an interface.
// The reference declares an `OverlayHost` seam, but that exists to let the module
// be imported without importing the view — a TypeScript problem. Here it would
// buy a virtual call per node per frame and nothing else, so the class simply
// holds the view it belongs to and is its friend.
//
// One difference worth naming, because it is what makes this file so much
// smaller than its reference: the web keeps four identity-keyed maps (presence
// tweens, presence values, exiting entries, armed timers) because a JS renderer
// cannot hang fields off a node it does not own. The core owns its `LayoutNode`s,
// so all four live there and die with the tree — leaving only the modal stack and
// the anchor warnings here.

#pragma once

#include <string>
#include <vector>

#include "clip.h"
#include "layout.h"
#include "overlay.h"

namespace zabloo {

class View;

class OverlayLayer {
 public:
  explicit OverlayLayer(View &view) : view_(view) {}

  /**
   * Keeps focus inside the layer's rules across relayouts: an opening modal
   * remembers the focus it interrupts and hands it to its `autofocus`, and a
   * closing one gives that focus back.
   *
   * Runs on every frame — the single funnel every state change already goes
   * through — so it never misses an overlay opened by a binding, a reload or the
   * game. It replaces the plain `sync_focus` of a view with no layer, and does
   * that job too when there is no modal up.
   */
  void sync_modal_focus();

  /**
   * A dismiss request — Escape, gamepad B, a tap on the backdrop, an
   * `autoCloseMs` timeout.
   *
   * Closing is the core's default behavior: it writes `false` into the bound
   * `visible` path (the read/write binding mechanism of 2026-08-11, which also
   * notifies the game) and fires the declared `onDismiss` action. With a static
   * `visible` there is nothing to write — only the action fires, and closing is
   * the game's call.
   */
  void request_dismiss(LayoutNode &overlay);

  /**
   * The layer's enter/exit fade: one presence tween per Overlay of the view,
   * whether it is up or not — a hidden one has to sit at 0 so that opening it is
   * a change to animate from, instead of the snap a first observation would give.
   *
   * The tween runs on the overlay's OWN `transition`, so this adds no IR surface:
   * without one, presence jumps and the frame looks exactly like it did pre-F7.
   */
  void sync_presence(double now);

  /**
   * Arms `autoCloseMs` while an overlay is in the layer; disarms it when it
   * leaves. Never for a triggered one: what dismisses a hint is leaving its
   * anchor, and a timer would take it from under a pointer still resting there.
   *
   * The clock is the view's injected one, not a system timer: the core never asks
   * what time it is (ZAB-134), so a timeout is a deadline compared once a frame.
   * That is also why an armed timer counts as motion — see `wants_frame`.
   */
  void sync_auto_close(double now);

  /**
   * Whether the timers need the frames to keep coming, for either of two reasons.
   *
   * One is a timeout still counting down. The other is a timeout that fired on
   * THIS frame: the dismiss writes `visible` after the layer was already
   * collected, so the overlay is still on screen when the frame ends, and without
   * another one the adapter would stop processing and leave it there for good.
   * The reference calls `render()` from inside its dismiss for exactly this.
   */
  bool wants_frame() const { return auto_close_armed_ || auto_close_fired_; }

  /** Whether anything is still fading out — when false, the live layer IS the paint layer. */
  bool any_exiting() const { return any_exiting_; }

  /**
   * The layer's predicate: in layout, and — for an anchored overlay — with its
   * anchor still on screen and, when it rides its hover, under the pointer or the
   * focus. Everything the layer owns (input, focus, timers, the presence tween's
   * target) reads it through the live layer, so the two capabilities of ZAB-46
   * need no wiring of their own anywhere else.
   */
  bool layer_present(const LayoutNode &node);

  /**
   * Lays one layer entry out. Unanchored, the entry IS the view: its own flex
   * places the content anywhere on the layer. Anchored, the content goes where
   * `anchor_box` puts it around the anchor, while the entry's own rect stays the
   * view's — that is what keeps a modal popover dimming and capturing the whole
   * screen while its panel hangs off a button.
   *
   * The content is sized from `natural`, so `layout.width`/`height` on an Overlay
   * stay ignored (a layer is not sized — size the child), and `padding` keeps
   * meaning "margin from the view's edges": it is taken out of the box and given
   * back around it, so the same number does the same job anchored or not.
   */
  void arrange_overlay(LayoutNode &overlay, const Rect &view_rect);

  /**
   * Pressing the anchor toggles its popovers — the same press that opens a
   * dropdown closes it, so a trigger button behaves like one. Returns whether it
   * had any, so the caller knows the press meant something beyond its action.
   */
  bool toggle_popovers(LayoutNode &anchor);

  /** Closes the popover this node lives in, if any — what a selection inside does. */
  void close_enclosing_popover(LayoutNode &node);

  /**
   * A released node's identity dies with it. Everything else the layer keeps is a
   * field ON the node, so this is only the modal stack — which points at nodes
   * from the outside. Nothing releases a node yet; G12 (ZAB-145) is what will.
   */
  void forget(const LayoutNode &node);

 private:
  View &view_;

  /** An open modal and the focus it interrupted, innermost last. */
  struct ModalEntry {
    LayoutNode *overlay = nullptr;
    LayoutNode *previous_focus = nullptr;
  };
  std::vector<ModalEntry> modal_stack_;
  /** Anchor ids already reported — the warning is per author error, not per frame. */
  std::vector<std::string> warned_anchors_;
  /** Regions resolved while answering `is_on_screen`; owned so nothing else is stomped. */
  ClipArena anchor_clips_;
  bool auto_close_armed_ = false;
  bool auto_close_fired_ = false;
  bool any_exiting_ = false;

  /**
   * Whether every Overlay above this node is actually up. A node inside a closed
   * popover stays `in_layout` — the open flag lives on the overlay, not on the
   * layout flags — but nothing paints it, so the focus must not rest there.
   */
  bool on_present_layer(const LayoutNode &node) const;
  LayoutNode *anchor_node(const std::string &id);
  bool anchor_allows(const LayoutNode &node);
  /** Reports an author error once. True the first time, so a caller can add detail. */
  bool warn_once(const std::string &id);
};

/**
 * The LIVE layer's predicate — what owns input, the focus trap and the timers.
 *
 * The `const` on `present` is the promise that collecting a layer does not
 * disturb the tree; the layer this holds is a reference, so an anchor warning
 * still reaches the view. That is the whole difference between the two.
 */
class LayerPresence : public Presence {
 public:
  explicit LayerPresence(OverlayLayer &layer) : layer_(layer) {}
  bool present(const LayoutNode &node) const override { return layer_.layer_present(node); }

 private:
  OverlayLayer &layer_;
};

/**
 * The PAINTED layer's: the live one plus whatever is still fading out. The only
 * widening of the rule anywhere — an overlay on its way out is pixels and never
 * input, so nothing but the paint pass may ask this.
 */
class PaintPresence : public Presence {
 public:
  explicit PaintPresence(OverlayLayer &layer) : layer_(layer) {}
  bool present(const LayoutNode &node) const override {
    return layer_.layer_present(node) || node.presence_exiting;
  }

 private:
  OverlayLayer &layer_;
};

}  // namespace zabloo
