// The pad's poll loop against a real `View` — a port of the integration half of
// `renderer-web/src/gamepad.test.ts`.
//
// The rules are pinned down in `test_gamepad.cpp`; what these pin down is that
// the loop READS them and that each intention lands in the same handler the
// keyboard already goes through. Only the pad itself is a stand-in — a snapshot
// a test mutates in place, which is exactly what a poll reads.
//
// The corpus can only record where the player ENDED UP, so the sequences below
// are what says the steps on the way there were the right ones: a hold that
// repeats on the clock, an A that activates on its release edge and not before,
// and a cable pulled mid-gesture.

#include <string>
#include <vector>

#include "pad.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;

namespace {

/** One poll's worth of time — any frame-sized step reads the pad once. */
constexpr double FRAME_MS = 16.0;

/** A column of three buttons, the first focused, each with an action of its own. */
const char *MENU = R"({"v":1,"views":{"menu":{
  "type":"Container","layout":{"direction":"column","gap":10},
  "children":[
    {"type":"Button","id":"play","autofocus":true,"layout":{"width":80,"height":20},
     "onClick":"play"},
    {"type":"Button","id":"options","layout":{"width":80,"height":20},"onClick":"options"},
    {"type":"Button","id":"quit","layout":{"width":80,"height":20},"onClick":"quit"}]}}})";

/** A modal bound to `ui.open`, with a dismiss hook — B's whole job. */
const char *MODAL = R"({"v":1,"views":{"main":{"type":"Container","children":[
  {"type":"Button","id":"open","autofocus":true,"layout":{"width":40,"height":20}},
  {"type":"Overlay","id":"modal","visible":{"bind":"ui.open"},"onDismiss":"closed",
   "children":[{"type":"Button","id":"accept","autofocus":true,
                "layout":{"width":20,"height":20}}]}]}}})";

/** A focusable row inside a scroller with twice the content its viewport shows. */
const char *LIST = R"({"v":1,"views":{"list":{
  "type":"ScrollView","id":"list","axis":"vertical",
  "layout":{"direction":"column","width":200,"height":200},
  "children":[
    {"type":"Button","id":"row-0","autofocus":true,"layout":{"width":200,"height":100}},
    {"type":"Container","layout":{"width":200,"height":100}},
    {"type":"Container","layout":{"width":200,"height":100}},
    {"type":"Container","layout":{"width":200,"height":100}}]}}})";

/** A bound Slider with both hooks, focused — the axis keys are the pad's too. */
const char *SLIDER = R"({"v":1,"views":{"panel":{"type":"Container","children":[
  {"type":"Slider","id":"brightness","layout":{"width":200,"height":20},
   "value":{"bind":"settings.brightness"},"min":0,"max":100,"step":10,
   "onChange":"brightness-preview","onCommit":"brightness-apply","autofocus":true,
   "children":[
     {"type":"Container","layout":{"height":4}},
     {"type":"Container","layout":{"width":20,"height":20}}]}]}}})";

Document loaded(const char *json, double width = 200, double height = 200) {
  Document document;
  document.load(json);
  if (document.view() != nullptr) {
    document.view()->set_size(width, height);
    document.view()->layout_frame();
  }
  return document;
}

/**
 * A view and the pad plugged into it: the snapshot a test presses buttons on,
 * the controller reading it, and the clock they share.
 */
struct Rig {
  explicit Rig(View &view) : view(view) {
    // Shaped the way a standard-mapping pad reports itself, all at rest.
    pad.buttons.assign(17, false);
    pad.axes.assign(4, 0.0);
    controller.connect(clock);
  }

  /** Moves the clock and gives the loop the one frame that span is worth. */
  void advance(double ms) {
    clock += ms;
    view.set_now(clock);
    controller.poll(view, pad, clock);
    view.layout_frame();
  }

  /** Pulls the cable. Nothing is polled after it — there is no pad to poll. */
  void disconnect() {
    controller.disconnect(&view);
    view.layout_frame();
  }

  void press(size_t button) { pad.buttons[button] = true; }
  void release(size_t button) { pad.buttons[button] = false; }
  void axis(size_t index, double value) { pad.axes[index] = value; }

  View &view;
  PadSnapshot pad;
  PadController controller;
  double clock = 0.0;
};

std::string focus_id(const View &view) {
  return view.focus() != nullptr ? view.focus()->ir->id : std::string("(none)");
}

/** The action names fired since the last drain, joined so a mismatch prints them. */
std::string action_names(View &view) {
  std::string out;
  for (const ActionEvent &event : view.drain_actions()) {
    if (!out.empty()) out += ",";
    out += event.name;
  }
  return out;
}

}  // namespace

// --- the d-pad ------------------------------------------------------------

TEST(pad, the_dpad_moves_the_focus_through_the_same_spatial_step_as_the_arrows) {
  Document document = loaded(MENU);
  View &view = *document.view();
  Rig rig(view);
  CHECK_EQ(focus_id(view), "play");

  rig.press(PAD_DPAD_DOWN);
  rig.advance(FRAME_MS);

  CHECK_EQ(focus_id(view), "options");
  CHECK(view.focus()->focused);
}

TEST(pad, a_held_direction_repeats_on_the_keyboards_own_clock) {
  Document document = loaded(MENU);
  View &view = *document.view();
  Rig rig(view);

  // The first fire is the press itself.
  rig.press(PAD_DPAD_DOWN);
  rig.advance(FRAME_MS);
  CHECK_EQ(focus_id(view), "options");

  // Held through the delay: not one step early…
  rig.advance(PAD_REPEAT_DELAY_MS - 1.0);
  CHECK_EQ(focus_id(view), "options");

  // …then one step exactly on the delay, and one per period after it.
  rig.advance(1.0);
  CHECK_EQ(focus_id(view), "quit");
  rig.press(PAD_DPAD_UP);
  rig.release(PAD_DPAD_DOWN);
  rig.advance(FRAME_MS);
  // Changing direction restarts the cycle, so this one is a press, not a repeat.
  CHECK_EQ(focus_id(view), "options");
  rig.advance(PAD_REPEAT_DELAY_MS);
  CHECK_EQ(focus_id(view), "play");
}

TEST(pad, unplugging_stops_a_repeat_the_instant_it_happens) {
  Document document = loaded(MENU);
  View &view = *document.view();
  Rig rig(view);
  rig.press(PAD_DPAD_DOWN);
  rig.advance(FRAME_MS);
  CHECK_EQ(focus_id(view), "options");

  rig.disconnect();
  // The clock runs past the delay and the period, and nothing polls it.
  rig.clock += PAD_REPEAT_DELAY_MS + PAD_REPEAT_RATE_MS;
  CHECK_EQ(focus_id(view), "options");
}

// --- A and B --------------------------------------------------------------

TEST(pad, a_presses_the_focused_control_and_activates_it_on_the_release_edge) {
  Document document = loaded(MENU);
  View &view = *document.view();
  Rig rig(view);

  rig.press(PAD_BUTTON_A);
  rig.advance(FRAME_MS);
  CHECK(view.root().children[0].pressed);
  // A hold is not a stream, and it is not a tap yet either.
  CHECK_EQ(action_names(view), "");
  rig.advance(FRAME_MS);
  CHECK_EQ(action_names(view), "");

  rig.release(PAD_BUTTON_A);
  rig.advance(FRAME_MS);
  CHECK(!view.root().children[0].pressed);
  CHECK_EQ(action_names(view), "play");
}

TEST(pad, unplugging_mid_hold_cancels_the_press_the_way_a_pointer_leaving_does) {
  Document document = loaded(MENU);
  View &view = *document.view();
  Rig rig(view);
  rig.press(PAD_BUTTON_A);
  rig.advance(FRAME_MS);
  CHECK(view.root().children[0].pressed);

  rig.disconnect();

  CHECK(!view.root().children[0].pressed);
  // Pulling a cable is not how a player buys something.
  CHECK_EQ(action_names(view), "");
}

TEST(pad, b_is_a_dismiss_request_for_the_modal_that_owns_the_input) {
  Document document = loaded(MODAL);
  View &view = *document.view();
  document.set_data("ui.open", DataValue::of_bool(true));
  view.layout_frame();
  Rig rig(view);

  rig.press(PAD_BUTTON_B);
  rig.advance(FRAME_MS);

  CHECK_EQ(action_names(view), "closed");
}

TEST(pad, b_does_nothing_at_all_while_no_overlay_is_up) {
  // An Escape this view did not use belongs to the game's own pause menu, and
  // the same goes for a B — so it must not swallow one either.
  Document document = loaded(MODAL);
  View &view = *document.view();
  Rig rig(view);

  rig.press(PAD_BUTTON_B);
  CHECK(!rig.controller.poll(view, rig.pad, FRAME_MS));
  rig.release(PAD_BUTTON_B);
  rig.advance(FRAME_MS);

  CHECK_EQ(action_names(view), "");
}

// --- the right stick ------------------------------------------------------

TEST(pad, the_right_stick_scrolls_the_scroller_the_focus_lives_in_in_px_per_second) {
  Document document = loaded(LIST);
  View &view = *document.view();
  Rig rig(view);
  CHECK_EQ(focus_id(view), "row-0");

  rig.axis(PAD_AXIS_RIGHT_Y, 1.0);
  rig.advance(500.0);

  // Full deflection for half a second: half the speed, or the end of the content
  // if that comes first — the same clamp the wheel goes through.
  const double reach = view.root().scroll_max.y;
  const double expected = PAD_SCROLL_SPEED / 2.0 < reach ? PAD_SCROLL_SPEED / 2.0 : reach;
  CHECK_NEAR(view.root().scroll_offset.y, expected, 0.001);
}

TEST(pad, a_stick_resting_in_its_dead_zone_leaves_the_scroller_alone) {
  Document document = loaded(LIST);
  View &view = *document.view();
  Rig rig(view);

  rig.axis(PAD_AXIS_RIGHT_Y, 0.1);
  rig.advance(500.0);

  CHECK_EQ(view.root().scroll_offset.y, 0.0);
}

TEST(pad, a_stick_with_no_scroller_under_the_focus_scrolls_nothing) {
  Document document = loaded(MENU);
  View &view = *document.view();
  Rig rig(view);
  rig.axis(PAD_AXIS_RIGHT_Y, 1.0);
  CHECK(!rig.controller.poll(view, rig.pad, 500.0));
}

// --- the Slider -----------------------------------------------------------

TEST(pad, the_axis_direction_nudges_the_focused_slider_and_the_release_commits) {
  Document document = loaded(SLIDER);
  View &view = *document.view();
  document.set_data("settings.brightness", DataValue::of_number(60));
  view.layout_frame();
  Rig rig(view);

  rig.press(PAD_DPAD_RIGHT);
  rig.advance(FRAME_MS);
  // One step of 10 over the bound 60, written back on the data channel.
  const std::vector<DataChange> writes = view.drain_data_changes();
  CHECK_EQ(writes.size(), 1u);
  if (!writes.empty()) {
    CHECK_EQ(writes[0].path, std::string("settings.brightness"));
    CHECK_EQ(writes[0].value.number, 70.0);
  }
  // Still mid-gesture: the live hook has fired and the expensive one has not.
  CHECK_EQ(action_names(view), "brightness-preview");

  rig.release(PAD_DPAD_RIGHT);
  rig.advance(FRAME_MS);
  CHECK_EQ(action_names(view), "brightness-apply");
}

TEST(pad, a_slider_gesture_still_settles_when_the_pad_is_unplugged_mid_nudge) {
  Document document = loaded(SLIDER);
  View &view = *document.view();
  document.set_data("settings.brightness", DataValue::of_number(60));
  view.layout_frame();
  Rig rig(view);
  rig.press(PAD_DPAD_RIGHT);
  rig.advance(FRAME_MS);
  CHECK_EQ(action_names(view), "brightness-preview");

  rig.disconnect();

  // `onCommit` is "the value the player left it at", and 70 is on screen — the
  // one place an ended gesture concludes rather than merely stopping.
  CHECK_EQ(action_names(view), "brightness-apply");
}
