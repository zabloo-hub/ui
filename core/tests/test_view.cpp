#include <string>
#include <vector>

#include "testing.h"
#include "view.h"

using namespace zabloo;

namespace {

/** A Button with a label inside it, centered in a 200×100 view. */
const char *BUTTON_VIEW = R"({"v":1,"tokens":{"color.primary":"#4f46e5"},"views":{"menu":{
  "type":"Container","layout":{"direction":"column","padding":10,"gap":10},
  "children":[
    {"type":"Button","id":"buy","layout":{"padding":10,"width":100,"height":40},
     "style":{"background":"{color.primary}","radius":6},
     "states":{"pressed":{"style":{"background":"#4338ca"}},
               "hover":{"style":{"background":"#6366f1"}},
               "focused":{"style":{"borderWidth":2,"borderColor":"#ffffff"}}},
     "autofocus":true,"onClick":"buy",
     "children":[{"type":"Text","text":"Buy"}]},
    {"type":"Button","id":"off","disabled":true,"layout":{"width":100,"height":40},
     "style":{"background":"#333333"},"onClick":"never"}]}}})";

Document loaded(const char *json, double width = 200, double height = 100) {
  Document document;
  document.load(json);
  if (document.view() != nullptr) {
    document.view()->set_size(width, height);
    document.view()->layout_frame();
  }
  return document;
}

}  // namespace

TEST(view, pressing_a_button_and_releasing_on_it_fires_its_action) {
  Document document;
  CHECK(document.load(BUTTON_VIEW));
  View *view = document.view();
  view->set_size(200, 100);
  view->layout_frame();

  // The label is what the pointer lands on; the Button is what gets pressed.
  CHECK(view->pointer_down(40, 25));
  view->layout_frame();
  CHECK(view->root().children[0].pressed);
  CHECK(view->drain_actions().empty());

  CHECK(view->pointer_up(40, 25));
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("buy"));
  CHECK(!view->root().children[0].pressed);
  // Drained means drained: the game reads each action exactly once.
  CHECK(view->drain_actions().empty());
}

TEST(view, a_press_that_leaves_its_control_ends_without_concluding) {
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  view->pointer_down(40, 25);
  view->pointer_up(190, 95);
  CHECK(view->drain_actions().empty());
  CHECK(!view->root().children[0].pressed);
}

TEST(view, a_pointer_that_goes_away_releases_what_it_held) {
  // The same rule a cancelled gesture follows (ZAB-70): it ends, it does not
  // conclude — nothing fires, and nothing stays stuck looking pressed.
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  view->pointer_down(40, 25);
  CHECK(view->pointer_exit());
  CHECK(!view->root().children[0].pressed);
  CHECK(!view->root().children[0].hovered);
  CHECK(view->drain_actions().empty());
}

TEST(view, a_disabled_control_is_out_of_the_interaction_model) {
  // ZAB-63: it takes no pointer, and a press over it falls through rather than
  // being swallowed.
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  const LayoutNode &off = view->root().children[1];
  view->pointer_down(off.rect.x + 5, off.rect.y + 5);
  view->pointer_up(off.rect.x + 5, off.rect.y + 5);
  CHECK(view->drain_actions().empty());
  CHECK(!off.pressed);
  CHECK(off.disabled);
}

TEST(view, the_pressed_and_hover_overrides_reach_the_painted_color) {
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  const LayoutNode &button = view->root().children[0];

  view->layout_frame();
  Color base = *button.resolved.background;

  view->pointer_move(40, 25);
  view->layout_frame();
  const Color hovered = *button.resolved.background;
  CHECK(!(hovered == base));

  view->pointer_down(40, 25);
  view->layout_frame();
  const Color pressed = *button.resolved.background;
  // `pressed` wins over `hover`: it lasts exactly as long as the finger is down.
  CHECK(!(pressed == hovered));
}

TEST(view, autofocus_puts_the_focus_ring_on_from_the_first_frame) {
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  CHECK(view->focus() != nullptr);
  if (view->focus() != nullptr) CHECK_EQ(view->focus()->ir->id, std::string("buy"));
  CHECK_NEAR(view->root().children[0].resolved.border_width, 2.0, 0.001);
}

TEST(view, painting_multiplies_opacity_down_the_subtree) {
  // 2026-08-06: a parent at 0.5 over a child at 0.5 paints at 0.25, as a
  // per-vertex alpha and not as a render to texture.
  Document document = loaded(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","style":{"background":"#ffffff","opacity":0.5},
      "layout":{"width":100,"height":100},
      "children":[{"type":"Container","style":{"background":"#ffffff","opacity":0.5},
                   "layout":{"width":50,"height":50}}]}}})");
  View *view = document.view();
  const Batch &batch = view->paint().batches().front();
  CHECK_EQ(batch.vertex_count(), 8u);
  CHECK_NEAR(batch.colors[3], 0.5, 0.001);
  CHECK_NEAR(batch.colors[19], 0.25, 0.001);
}

TEST(view, a_refused_hot_update_costs_the_update_and_not_the_session) {
  Document document;
  CHECK(document.load(BUTTON_VIEW));
  const View *before = document.view();
  CHECK(before != nullptr);

  // A truncated push, and one built for a version this reader does not implement.
  CHECK(!document.load("{\"v\":1,\"views\":"));
  CHECK(document.view() == before);
  CHECK(!document.load(R"({"v":2,"views":{"menu":{"type":"Container"}}})"));
  CHECK(document.view() == before);
  CHECK_EQ(document.diagnostics().size(), 1u);
  if (!document.diagnostics().empty()) {
    CHECK_EQ(diagnostic_code_name(document.diagnostics()[0].code),
             std::string("unsupported-version"));
  }
}

TEST(view, a_hot_update_keeps_the_view_that_was_on_screen) {
  Document document;
  document.load(R"({"v":1,"tokens":{},"views":{
      "first":{"type":"Container","layout":{"width":10,"height":10}},
      "menu":{"type":"Container","layout":{"width":20,"height":20}}}})");
  CHECK(document.show("menu"));
  CHECK_EQ(document.view()->id(), std::string("menu"));

  document.load(R"({"v":1,"tokens":{},"views":{
      "first":{"type":"Container","layout":{"width":10,"height":10}},
      "menu":{"type":"Container","layout":{"width":30,"height":30}}}})");
  CHECK_EQ(document.view()->id(), std::string("menu"));

  // Gone from the new envelope: the first view takes over rather than nothing.
  document.load(R"({"v":1,"tokens":{},"views":{
      "first":{"type":"Container","layout":{"width":10,"height":10}}}})");
  CHECK_EQ(document.view()->id(), std::string("first"));
}

TEST(view, pushed_data_outlives_the_content_it_was_pushed_for) {
  // Cached on the DOCUMENT, not the view: a content swap must not cost the game
  // the state it already sent (2026-08-03). Reading it into bindings is G7's.
  Document document;
  document.load(BUTTON_VIEW);
  DataValue gold;
  gold.kind = DataValue::Kind::Number;
  gold.number = 1200;
  document.set_data("player.gold", gold);
  document.load(BUTTON_VIEW);
  const DataValue *kept = document.data("player.gold");
  CHECK(kept != nullptr);
  if (kept != nullptr) CHECK_NEAR(kept->number, 1200.0, 0.001);

  // Writing the same path again replaces it instead of stacking a second entry.
  document.set_data("player.gold", gold);
  CHECK_EQ(document.data().size(), 1u);
}

TEST(view, an_unknown_view_id_leaves_what_was_on_screen) {
  Document document = loaded(BUTTON_VIEW);
  const View *before = document.view();
  CHECK(!document.show("nope"));
  CHECK(document.view() == before);
}
