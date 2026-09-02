#include "pad.h"

#include "view.h"

namespace zabloo {
namespace {

/**
 * The caret key a horizontal direction stands in for.
 *
 * Only the horizontal ones reach a field at all: ←/→ walk the caret and hand the
 * direction back at the end of the text, while ↑/↓ always navigate (decision
 * 2026-08-11, ZAB-26). The reference asks the field about all four and is told
 * no for the vertical pair; here the question is not asked, because `edit_key`
 * settles a composition in flight before it answers and a direction that a field
 * can never claim must not disturb one.
 */
KeyIntent caret_intent(const PadDirection &direction) {
  KeyIntent intent;
  intent.key = direction.dx > 0.0 ? EditKey::Right : EditKey::Left;
  return intent;
}

}  // namespace

void PadController::connect(double now) { time_ = now; }

bool PadController::poll(View &view, const PadSnapshot &pad, double now) {
  const double elapsed = now - time_;
  time_ = now;
  const PadIntent intent = read_pad(pad, held_);
  held_ = intent.direction;
  bool changed = direction(view, intent, now);
  changed = buttons(view, intent) || changed;
  return scroll(view, intent, elapsed) || changed;
}

bool PadController::disconnect(View *view) {
  const bool pressing = press_;
  const bool nudging = repeat_.has_value();
  held_.reset();
  repeat_.reset();
  press_ = false;
  back_ = false;
  if (view == nullptr) return false;
  bool changed = false;
  if (pressing) changed = view->cancel_focused_press();
  // A Slider being nudged when the pad went away still settles: the value it
  // stopped at is on screen and was written into its bound path on every step.
  if (nudging) changed = view->settle_slider_keys() || changed;
  return changed;
}

/**
 * A held direction on the repeat clock. An OS gives the arrow keys their repeat
 * for free; a pad has to be told, which is the whole of `step_repeat`.
 */
bool PadController::direction(View &view, const PadIntent &intent, double now) {
  const PadRepeatStep step = step_repeat(repeat_, intent.direction, now);
  const bool released = repeat_.has_value() && !step.state.has_value();
  repeat_ = step.state;
  // Letting go of the direction ends a Slider gesture, the same commit the
  // release of an arrow key fires — both ways of moving a slider settle alike.
  bool changed = released && view.settle_slider_keys();
  if (!step.fire || !step.state.has_value()) return changed;
  const PadDirection &moved = step.state->direction;
  // The keyboard's own cascade, in the same order: the focused field's caret
  // first, and only then the focus itself — which, on a Slider, is where the
  // value gets nudged along its own axis.
  if (moved.dx != 0.0 && view.edit_key(caret_intent(moved))) return true;
  return view.move_focus(moved.dx, moved.dy) || changed;
}

/** A (press the focused node) and B (back), on their edges — a hold is not a stream. */
bool PadController::buttons(View &view, const PadIntent &intent) {
  bool changed = false;
  if (intent.press != press_) {
    press_ = intent.press;
    changed = view.press_focused(intent.press);
  }
  if (intent.back != back_) {
    back_ = intent.back;
    // B is Escape: a dismiss request for the modal that owns input, and nothing
    // at all when no overlay is up.
    if (intent.back) changed = view.dismiss_top_modal() || changed;
  }
  return changed;
}

/** The right stick scrolls the ScrollView the focus lives in — px per second, not per frame. */
bool PadController::scroll(View &view, const PadIntent &intent, double elapsed) {
  if (intent.scroll.x == 0.0 && intent.scroll.y == 0.0) return false;
  const PadScroll delta = scroll_delta(intent.scroll, elapsed);
  return view.scroll_focused_by(delta.x, delta.y);
}

}  // namespace zabloo
