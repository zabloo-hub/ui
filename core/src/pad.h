// The gamepad's poll loop (2026-08-12, ZAB-47), a port of
// `renderer-web/src/input/pad.ts`: the state that turns a held button into an
// edge, the repeat clock, and where each intention lands.
//
// `gamepad.h` owns the RULES; this owns the loop that runs them. Every
// intention it produces is one the keyboard already produces, and it is served
// by the very same `View` handler the equivalent key goes through — which is
// what keeps "navigate with the d-pad" and "navigate with the arrows" from
// drifting apart.
//
// It lives in the core, not in the adapter, and that is what the corpus rests
// on: a `pad` script replays against a native binary with no engine, no device
// and no window (G3). What the adapter is left with is reading the device and
// deciding when to poll.
//
// It is NOT owned by the `View`, and that is deliberate. Everything here is
// DEVICE state — which way the stick is pushed, which buttons were down on the
// previous poll — and a `View` is disposable: a hot-update rebuilds it. Clearing
// this along with it would be the actual bug, because `press_` is what turns a
// held button into an edge, so zeroing it mid-hold would make the very next poll
// read A as newly pressed and press whatever the new tree focused — a control
// the player never aimed at. Held across a reload it stays held, and the
// node-keyed half of a press is rebuilt with the view, which is what makes the
// release land on nothing.

#pragma once

#include <optional>

#include "gamepad.h"

namespace zabloo {

class View;

class PadController {
 public:
  /**
   * A pad arrived. The instant matters: the scroll stick moves px per SECOND, so
   * the first poll measures its frame against this.
   */
  void connect(double now);

  /**
   * One poll: read the pad, then hand each intention to the handler that owns
   * it. Answers whether anything changed, so the adapter only redraws when
   * something did.
   */
  bool poll(View &view, const PadSnapshot &pad, double now);

  /**
   * The pad went away. Two closing rules, the same ones that already govern the
   * pointer: a press in flight CANCELS (pulling a cable is not how a player buys
   * something), and a Slider being nudged SETTLES — the value it stopped at is
   * on screen. `view` may be null when there is nothing left to tell.
   */
  bool disconnect(View *view);

  /** Whether a direction is being held right now — the repeat clock is running. */
  bool holding() const { return repeat_.has_value(); }

 private:
  bool direction(View &view, const PadIntent &intent, double now);
  bool buttons(View &view, const PadIntent &intent);
  bool scroll(View &view, const PadIntent &intent, double elapsed);

  /** The pad's state on the previous poll: what turns a held button into an edge. */
  std::optional<PadDirection> held_;
  std::optional<PadRepeat> repeat_;
  bool press_ = false;
  bool back_ = false;
  /** When the previous poll ran — the scroll stick moves px per SECOND, not per frame. */
  double time_ = 0.0;
};

}  // namespace zabloo
