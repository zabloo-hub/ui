#include <cstddef>
#include <string>
#include <vector>

#include "assets.h"
#include "testing.h"
#include "hit.h"
#include "clip.h"
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
  const Batch &batch = *view->paint().batches().front();
  CHECK_EQ(batch.vertex_count(), 8u);
  CHECK_NEAR(batch.colors[3], 0.5, 0.001);
  CHECK_NEAR(batch.colors[19], 0.25, 0.001);
}

TEST(view, a_label_with_no_style_still_paints_its_glyphs) {
  // An undeclared `color` is the default text color, not "nothing to paint" —
  // unlike a background, where absent means the node paints no box at all. The
  // inherited opacity multiplies the glyphs exactly as it does a fill.
  Document document = loaded(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","style":{"opacity":0.5},"layout":{"width":200,"height":50},
      "children":[{"type":"Text","id":"label","text":"Hi"}]}}})");
  View *view = document.view();
  const LayoutNode &label = view->root().children[0];
  CHECK(label.has_text_block);
  CHECK(label.text_block.width > 0.0);

  const std::vector<const Batch *> &batches = view->paint().batches();
  CHECK_EQ(batches.size(), 2u);
  // Two glyphs, and the alpha they carry is the subtree's.
  CHECK_EQ(batches[1]->vertex_count(), 8u);
  if (batches[1]->colors.size() >= 4) CHECK_NEAR(batches[1]->colors[3], 0.5, 0.001);
}

TEST(view, a_wrapped_label_reports_the_lines_it_was_measured_with) {
  // Paint and the snapshot read the block and the placement the measure and the
  // arrange left on the node — never a second computation of either, which is
  // what keeps a recorded baseline the one the tessellator actually used.
  Document document = loaded(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","layout":{"padding":10},
      "children":[{"type":"Text","id":"prose","layout":{"width":60},
                   "text":"uno dos tres"}]}}})",
                             200, 200);
  const LayoutNode &prose = document.view()->root().children[0];
  CHECK(prose.text_block.lines.size() > 1u);
  CHECK_EQ(prose.text_lines.size(), prose.text_block.lines.size());
  // Placed inside the padding box, and stacked a line height apart.
  CHECK_NEAR(prose.text_lines[0].x, prose.rect.x, 0.001);
  CHECK_NEAR(prose.text_lines[1].y - prose.text_lines[0].y, prose.text_block.line_height, 0.001);
  // The node is as tall as the lines it holds, so the box the flexbox reserved
  // is the box the glyphs need.
  CHECK_NEAR(prose.rect.height, prose.text_block.height, 0.001);
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
  // the state it already sent (2026-08-03).
  Document document;
  document.load(BUTTON_VIEW);
  document.set_data("player.gold", DataValue::of_number(1200));
  document.load(BUTTON_VIEW);
  const DataValue *kept = document.data("player.gold");
  CHECK(kept != nullptr);
  if (kept != nullptr) CHECK_NEAR(kept->number, 1200.0, 0.001);

  // Writing the same path again replaces it instead of stacking a second value.
  document.set_data("player.gold", DataValue::of_number(900));
  const DataValue *replaced = document.data("player.gold");
  CHECK(replaced != nullptr);
  if (replaced != nullptr) CHECK_NEAR(replaced->number, 900.0, 0.001);
}

TEST(view, an_unknown_view_id_leaves_what_was_on_screen) {
  Document document = loaded(BUTTON_VIEW);
  const View *before = document.view();
  CHECK(!document.show("nope"));
  CHECK(document.view() == before);
}

// --- bindings (G7) --------------------------------------------------------

namespace {

/** A bound label, a bound row and a bound Toggle — the three shapes of a binding. */
const char *BOUND_VIEW = R"({"v":1,"tokens":{},"views":{"hud":{
  "type":"Container","layout":{"direction":"column","gap":8},
  "children":[
    {"type":"Text","id":"gold","text":{"bind":"player.gold"}},
    {"type":"Text","id":"deep","text":{"bind":"shop.items.1.name"}},
    {"type":"Container","id":"row","visible":{"bind":"flags.premium"},
     "layout":{"width":60,"height":20}},
    {"type":"Toggle","id":"sound","checked":{"bind":"settings.sound"},"onChange":"sound-changed",
     "layout":{"width":40,"height":20}}]}}})";

const LayoutNode &child_of(const View &view, size_t index) {
  return view.root().children[index];
}

}  // namespace

TEST(view, a_bound_text_paints_what_the_data_says_and_nothing_when_it_says_nothing) {
  Document document = loaded(BOUND_VIEW, 200, 200);
  View *view = document.view();
  // No value is the empty string, which still measures one line tall (ZAB-65) —
  // so the label holds its slot and its gaps rather than collapsing them.
  CHECK_EQ(child_of(*view, 0).text_content, std::string(""));
  CHECK(child_of(*view, 0).rect.height > 0.0);

  document.set_data("player.gold", DataValue::of_number(1200));
  view->layout_frame();
  CHECK_EQ(child_of(*view, 0).text_content, std::string("1200"));
  CHECK(child_of(*view, 0).rect.width > 0.0);
}

TEST(view, a_path_addresses_into_the_array_the_game_pushed) {
  Document document = loaded(BOUND_VIEW, 200, 200);
  DataValue items = DataValue::array();
  DataValue second = DataValue::object();
  second.insert("name", DataValue::of_text("Espada"));
  items.push(DataValue::object());
  items.push(std::move(second));
  document.set_data("shop.items", std::move(items));
  document.view()->layout_frame();
  CHECK_EQ(child_of(*document.view(), 1).text_content, std::string("Espada"));
}

TEST(view, a_bound_visible_starts_hidden_and_the_data_reveals_it) {
  Document document = loaded(BOUND_VIEW, 200, 200);
  View *view = document.view();
  // Data-driven visibility means "visible when the data says so" (2026-08-03).
  CHECK(!in_layout(child_of(*view, 2)));
  document.set_data("flags.premium", DataValue::of_bool(true));
  view->layout_frame();
  CHECK(in_layout(child_of(*view, 2)));
  CHECK_NEAR(child_of(*view, 2).rect.width, 60.0, 0.001);

  document.set_data("flags.premium", DataValue::of_bool(false));
  view->layout_frame();
  CHECK(!in_layout(child_of(*view, 2)));
}

TEST(view, data_pushed_before_a_view_existed_is_read_as_it_builds) {
  // The store is the DOCUMENT's, so this is not a special case: the next view
  // simply reads it while it builds. A game pushes its state whenever it has it.
  Document document;
  document.set_data("settings.sound", DataValue::of_bool(true));
  document.set_data("player.gold", DataValue::of_number(7));
  CHECK(document.load(BOUND_VIEW));
  document.view()->set_size(200, 200);
  document.view()->layout_frame();
  CHECK(child_of(*document.view(), 3).checked);
  CHECK_EQ(child_of(*document.view(), 0).text_content, std::string("7"));
}

TEST(view, a_toggle_writes_its_value_back_and_tells_the_game_once) {
  Document document = loaded(BOUND_VIEW, 200, 200);
  View *view = document.view();
  CHECK(view->set_checked("sound", true));
  CHECK(child_of(*view, 3).checked);

  // The return leg of the data channel: the store has it, and the game hears it.
  CHECK(is_truthy(document.data("settings.sound")));
  const std::vector<DataChange> changes = view->drain_data_changes();
  CHECK_EQ(changes.size(), 1u);
  if (!changes.empty()) CHECK_EQ(changes[0].path, std::string("settings.sound"));
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("sound-changed"));

  // Setting it to what it already is moves nothing, so nothing is reported.
  CHECK(view->set_checked("sound", true));
  CHECK(view->drain_data_changes().empty());
  CHECK(view->drain_actions().empty());
}

TEST(view, the_host_channel_says_whether_it_found_the_control) {
  // A `false` means no node of that type carries that id and NOTHING was
  // applied: a game looping over ids must not die because one screen changed.
  Document document = loaded(BOUND_VIEW, 200, 200);
  View *view = document.view();
  CHECK(!view->set_checked("nope", true));
  CHECK(!view->set_checked("gold", true));  // wrong type
  CHECK(!view->set_open("sound", true));
  CHECK(!view->set_selected_tab("sound", 1));
}

// --- Collapse and groups (G7) ---------------------------------------------

namespace {

const char *ACCORDION_VIEW = R"({"v":1,"tokens":{},"views":{"a":{
  "type":"Container","id":"accordion","group":"exclusive-open",
  "layout":{"direction":"column"},
  "children":[
    {"type":"Collapse","id":"one","open":true,"layout":{"direction":"column"},
     "children":[{"type":"Container","id":"one-head","layout":{"width":100,"height":20}},
                 {"type":"Container","id":"one-body","layout":{"width":100,"height":50}}]},
    {"type":"Collapse","id":"two","open":false,"layout":{"direction":"column"},
     "children":[{"type":"Container","id":"two-head","layout":{"width":100,"height":20}},
                 {"type":"Container","id":"two-body","layout":{"width":100,"height":50}}]}]}}})";

const char *TABS_VIEW = R"({"v":1,"tokens":{},"views":{"a":{
  "type":"Container","id":"tabs","group":"exclusive-select","selected":1,
  "layout":{"direction":"column"},
  "children":[
    {"type":"Container","id":"bar","layout":{"direction":"row"},
     "children":[{"type":"Text","id":"title","text":"Ajustes"},
                 {"type":"Button","id":"tab-0","layout":{"width":50,"height":20}},
                 {"type":"Button","id":"tab-1","layout":{"width":50,"height":20}}]},
    {"type":"Container","id":"panel-0","layout":{"width":100,"height":40}},
    {"type":"Container","id":"panel-1","layout":{"width":100,"height":40}}]}}})";

const char *RADIO_VIEW = R"({"v":1,"tokens":{},"views":{"a":{
  "type":"Container","id":"quality","group":"exclusive-check",
  "value":{"bind":"settings.quality"},"onChange":"quality-changed",
  "layout":{"direction":"column"},
  "children":[
    {"type":"Toggle","id":"low","value":"low","onChange":"picked",
     "layout":{"width":40,"height":20}},
    {"type":"Toggle","id":"high","value":"high","layout":{"width":40,"height":20}}]}}})";

}  // namespace

TEST(view, a_collapse_shows_its_content_from_children_one_on) {
  Document document = loaded(ACCORDION_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &one = view->root().children[0];
  const LayoutNode &two = view->root().children[1];
  // `children[0]` is the header — always visible — and the rest enters and leaves
  // the layout with display:none semantics (the `<details>` model).
  CHECK(in_layout(one.children[1]));
  CHECK(!in_layout(two.children[1]));
  CHECK_NEAR(one.rect.height, 70.0, 0.001);
  CHECK_NEAR(two.rect.height, 20.0, 0.001);
}

TEST(view, opening_one_section_of_an_accordion_closes_its_siblings) {
  Document document = loaded(ACCORDION_VIEW, 200, 200);
  View *view = document.view();
  CHECK(view->set_open("two", true));
  view->layout_frame();
  CHECK(view->root().children[1].open);
  // Enforced GENERICALLY from the `group` on the parent: a composite is never an
  // IR type (2026-08-03 §5).
  CHECK(!view->root().children[0].open);
  CHECK(!in_layout(view->root().children[0].children[1]));

  // Closing one does not open anything: exclusivity is about opening.
  CHECK(view->set_open("two", false));
  view->layout_frame();
  CHECK(!view->root().children[1].open);
  CHECK(!view->root().children[0].open);
}

TEST(view, pressing_a_collapse_header_toggles_the_section_it_opens) {
  Document document = loaded(ACCORDION_VIEW, 200, 200);
  View *view = document.view();
  // The header is focusable, the Collapse is not: what is pressed is the header,
  // what toggles is its parent.
  CHECK(view->move_focus(0, 1));
  CHECK(view->focus() == &view->root().children[0].children[0]);
  view->press_focused(true);
  view->press_focused(false);
  CHECK(!view->root().children[0].open);
}

TEST(view, the_selected_tab_is_the_only_panel_in_layout_and_wears_selected) {
  Document document = loaded(TABS_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &bar = view->root().children[0];
  // A `Text` in the bar is decoration: it does not shift the tab indices.
  CHECK(!bar.children[1].selected);
  CHECK(bar.children[2].selected);
  CHECK(!in_layout(view->root().children[1]));
  CHECK(in_layout(view->root().children[2]));

  CHECK(view->set_selected_tab("tabs", 0));
  view->layout_frame();
  CHECK(bar.children[1].selected);
  CHECK(in_layout(view->root().children[1]));
  CHECK(!in_layout(view->root().children[2]));
}

TEST(view, activating_a_tab_button_moves_the_selection_and_fires_its_action) {
  Document document = loaded(TABS_VIEW, 200, 200);
  View *view = document.view();
  // Straight to the first tab button: nothing before it in the bar takes input.
  CHECK(view->move_focus(0, 1));
  CHECK(view->focus() == &view->root().children[0].children[1]);
  view->press_focused(true);
  view->press_focused(false);
  view->layout_frame();
  CHECK_EQ(view->root().selected_index, 0);
  CHECK(in_layout(view->root().children[1]));
}

TEST(view, a_radio_group_holds_one_value_and_the_options_derive_from_it) {
  Document document;
  document.set_data("settings.quality", DataValue::of_text("high"));
  CHECK(document.load(RADIO_VIEW));
  View *view = document.view();
  view->set_size(200, 200);
  view->layout_frame();
  CHECK(!view->root().children[0].checked);
  CHECK(view->root().children[1].checked);

  // Choosing the other option moves the GROUP's value, writes it back, and fires
  // both hooks: the option's own first, then the group's (ZAB-64).
  CHECK(view->set_checked("low", true));
  CHECK(view->root().children[0].checked);
  CHECK(!view->root().children[1].checked);
  const DataValue *written = document.data("settings.quality");
  CHECK(written != nullptr);
  if (written != nullptr) CHECK_EQ(written->text, std::string("low"));
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 2u);
  if (actions.size() == 2) {
    CHECK_EQ(actions[0].name, std::string("picked"));
    CHECK_EQ(actions[1].name, std::string("quality-changed"));
  }
}

TEST(view, re_picking_the_selected_radio_reports_nothing_and_never_empties_it) {
  Document document;
  document.set_data("settings.quality", DataValue::of_text("low"));
  CHECK(document.load(RADIO_VIEW));
  View *view = document.view();
  view->set_size(200, 200);
  view->layout_frame();

  CHECK(view->set_checked("low", true));
  CHECK(view->root().children[0].checked);
  // Nothing moved, so nothing is reported — not the option's hook, not the
  // group's, not a write.
  CHECK(view->drain_actions().empty());
  CHECK(view->drain_data_changes().empty());

  // And a radio never turns OFF: a group is not left empty.
  CHECK(view->set_checked("low", false));
  CHECK(view->root().children[0].checked);
}

// --- focus, navigation and `disabled` (G7) --------------------------------

namespace {

/** A row of three buttons over a fourth, with the middle one the game can switch off. */
const char *NAV_VIEW = R"({"v":1,"tokens":{},"views":{"a":{
  "type":"Container","layout":{"direction":"column","gap":10},
  "children":[
    {"type":"Container","id":"row","layout":{"direction":"row","gap":10},
     "children":[
       {"type":"Button","id":"left","autofocus":true,"layout":{"width":40,"height":20}},
       {"type":"Button","id":"middle","disabled":{"bind":"ui.off"},
        "layout":{"width":40,"height":20},"onClick":"middle"},
       {"type":"Button","id":"right","layout":{"width":40,"height":20}}]},
    {"type":"Button","id":"under","layout":{"width":40,"height":20}}]}}})";

const LayoutNode &nav(const View &view, size_t index) {
  return view.root().children[0].children[index];
}

// --- images ---------------------------------------------------------------

namespace {

/**
 * Two images over one set of bytes, one sized by the manifest and one not, plus
 * a ref that resolves to nothing. The bytes are not a real PNG: the core decodes
 * nothing, so nothing here depends on them being one.
 */
const char *IMAGE_VIEW = R"({"v":1,"tokens":{"color.tint":"#f87171"},"assets":{
  "icons/coin.png":{"hash":"aaa","mime":"image/png","size":3,"width":32,"height":16,"data":"AAEC"},
  "icons/gold.png":{"hash":"aaa","mime":"image/png","size":3,"width":32,"height":16,"data":"AAEC"},
  "icons/blank.png":{"hash":"bbb","mime":"image/png","size":3,"data":"TQ=="}},
  "views":{"gallery":{"type":"Container","layout":{"direction":"column"},"children":[
    {"type":"Image","id":"intrinsic","src":"asset:icons/coin.png"},
    {"type":"Image","id":"twin","src":"asset:icons/gold.png"},
    {"type":"Image","id":"sizeless","src":"asset:icons/blank.png"},
    {"type":"Image","id":"gone","src":"asset:icons/missing.png",
     "style":{"background":"#1e293b"}},
    {"type":"Image","id":"tinted","src":"asset:icons/coin.png","fit":"cover",
     "layout":{"width":40,"height":40},"style":{"color":"{color.tint}"}}]}}})";

const LayoutNode *find(const LayoutNode &node, const char *id) {
  if (node.ir->id == id) return &node;
  for (const LayoutNode &child : node.children) {
    const LayoutNode *found = find(child, id);
    if (found != nullptr) return found;
  }
  return nullptr;
}

}  // namespace

TEST(view, the_arrows_walk_the_focus_by_the_rects_on_screen) {
  Document document = loaded(NAV_VIEW, 300, 200);
  View *view = document.view();
  CHECK(view->focus() == &nav(*view, 0));
  CHECK(view->move_focus(1, 0));
  CHECK(view->focus() == &nav(*view, 1));
  CHECK(view->move_focus(1, 0));
  CHECK(view->focus() == &nav(*view, 2));
  // Nothing further right: the focus stays where it is rather than wrapping.
  CHECK(!view->move_focus(1, 0));
  CHECK(view->focus() == &nav(*view, 2));
  CHECK(view->move_focus(-1, 0));
  CHECK(view->focus() == &nav(*view, 1));
  // Down leaves the row: the walk is over live rects, not over the document.
  CHECK(view->move_focus(0, 1));
  CHECK(view->focus() == &view->root().children[1]);
}

TEST(view, a_control_the_game_switches_off_lets_go_of_what_it_held) {
  Document document = loaded(NAV_VIEW, 300, 200);
  View *view = document.view();
  view->move_focus(1, 0);
  CHECK(view->focus() == &nav(*view, 1));
  view->press_focused(true);
  CHECK(nav(*view, 1).pressed);

  document.set_data("ui.off", DataValue::of_bool(true));
  view->layout_frame();
  // The focus goes to NOTHING rather than to a neighbour: the player did not ask
  // to move. The gesture is cancelled, not concluded (ZAB-63).
  CHECK(view->focus() == nullptr);
  CHECK(!nav(*view, 1).pressed);
  CHECK(view->drain_actions().empty());

  // And it is out of the walk entirely: the arrows step straight over it.
  CHECK(view->move_focus(1, 0));
  CHECK(view->focus() == &nav(*view, 0));
  CHECK(view->move_focus(1, 0));
  CHECK(view->focus() == &nav(*view, 2));
}

TEST(view, a_disabled_section_takes_its_children_with_it) {
  // `disabled` INHERITS: one prop on a section switches off the form inside it,
  // which is the case it exists for. The label goes with it — the only state a
  // node that is not focusable at all can be in.
  Document document = loaded(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","id":"section","disabled":true,"layout":{"direction":"column"},
      "children":[{"type":"Text","id":"label","text":"Ajustes"},
                  {"type":"Button","id":"inside","layout":{"width":40,"height":20}}]}}})",
                                200, 200);
  const View *view = document.view();
  CHECK(view->root().disabled);
  CHECK(view->root().children[0].disabled);
  CHECK(view->root().children[1].disabled);
  CHECK(view->focus() == nullptr);
}

TEST(view, a_focus_whose_node_leaves_the_layout_falls_back_to_the_autofocus) {
  Document document = loaded(TABS_VIEW, 200, 200);
  View *view = document.view();
  // Nothing declares `autofocus` here, so a focus with nowhere to be is nothing
  // at all — never a node the player cannot see.
  CHECK(view->focus() == nullptr);
  CHECK(view->move_focus(0, 1));
  CHECK(view->focus() != nullptr);
}

TEST(view, a_malformed_tab_group_says_so_once_and_pairs_what_it_can) {
  // A structural complaint is a property of the DOCUMENT, so it is reported with
  // the load's own diagnostics rather than on every tap that reads the group.
  Document document = loaded(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","id":"tabs","group":"exclusive-select","layout":{"direction":"column"},
      "children":[
        {"type":"Container","id":"bar","layout":{"direction":"row"},
         "children":[{"type":"Button","id":"t0","layout":{"width":40,"height":20}},
                     {"type":"Button","id":"t1","layout":{"width":40,"height":20}}]},
        {"type":"Container","id":"only-panel","layout":{"width":80,"height":30}}]}}})",
                                200, 200);
  const View *view = document.view();
  CHECK_EQ(view->warnings().size(), 1u);
  // Two buttons and one panel: the pair that exists still works.
  CHECK(view->root().children[0].children[0].selected);
  CHECK(in_layout(view->root().children[1]));
}

TEST(view, an_image_measures_the_manifests_pixels_with_nothing_decoded) {
  Document document = loaded(IMAGE_VIEW, 200, 200);
  const LayoutNode &root = document.view()->root();
  const LayoutNode *intrinsic = find(root, "intrinsic");
  CHECK(intrinsic != nullptr);
  CHECK_EQ(intrinsic->rect.width, 32.0);
  CHECK_EQ(intrinsic->rect.height, 16.0);
}

TEST(view, an_image_whose_manifest_carries_no_size_reserves_nothing_yet) {
  // Not a bug: layout has nothing to reserve the box with until the adapter
  // reports what it decoded, through `ImageLibrary::adopt_size`.
  Document document = loaded(IMAGE_VIEW, 200, 200);
  const LayoutNode *sizeless = find(document.view()->root(), "sizeless");
  CHECK(sizeless != nullptr);
  CHECK_EQ(sizeless->rect.width, 0.0);
  CHECK_EQ(sizeless->rect.height, 0.0);
}

TEST(view, a_size_reported_by_the_adapter_lays_the_image_out_on_the_next_frame) {
  Document document = loaded(IMAGE_VIEW, 200, 200);
  View *view = document.view();
  ImageLibrary &images = view->images();
  ImageAsset *blank = nullptr;
  for (const auto &asset : images.all()) {
    if (asset->hash == "bbb") blank = asset.get();
  }
  CHECK(blank != nullptr);
  CHECK(images.adopt_size(*blank, 20, 10));

  view->layout_frame();
  const LayoutNode *sizeless = find(view->root(), "sizeless");
  CHECK_EQ(sizeless->rect.width, 20.0);
  CHECK_EQ(sizeless->rect.height, 10.0);
}

TEST(view, a_dangling_ref_costs_the_texture_and_not_the_node) {
  // The node keeps its box and paints its own background — which is the
  // placeholder, authored rather than a `loading` state (ZAB-13).
  Document document = loaded(IMAGE_VIEW, 200, 200);
  const LayoutNode *gone = find(document.view()->root(), "gone");
  CHECK(gone != nullptr);
  CHECK(gone->resolved.background.has_value());
  // Warned once at load, with the node's path on it — never per frame.
  int warnings = 0;
  for (const Diagnostic &diagnostic : document.diagnostics()) {
    if (diagnostic.code == DiagnosticCode::UnknownAsset) warnings++;
  }
  CHECK_EQ(warnings, 1);
}

TEST(view, two_ids_over_the_same_bytes_paint_in_one_batch) {
  Document document = loaded(IMAGE_VIEW, 200, 200);
  const GeometryBuilder &geometry = document.view()->paint();
  // Solids, then ONE batch for the shared hash — `intrinsic`, `twin` and
  // `tinted` all name it — and none for the ref that does not resolve.
  int image_batches = 0;
  for (const Batch *batch : geometry.batches()) {
    if (batch->kind == TextureKind::Image && !batch->empty()) image_batches++;
  }
  CHECK_EQ(image_batches, 1);
}

TEST(view, an_undeclared_color_leaves_the_pixels_alone_and_a_declared_one_tints_them) {
  Document document = loaded(IMAGE_VIEW, 200, 200);
  const GeometryBuilder &geometry = document.view()->paint();
  const Batch *image = nullptr;
  for (const Batch *batch : geometry.batches()) {
    if (batch->kind == TextureKind::Image) image = batch;
  }
  CHECK(image != nullptr);
  // `intrinsic` paints first and has no `color`: white, i.e. the image as it is.
  CHECK_EQ(image->colors[0], 1.0f);
  CHECK_EQ(image->colors[1], 1.0f);
  CHECK_EQ(image->colors[2], 1.0f);
  // `tinted` is the last of the three, and carries {color.tint} = #f87171.
  const size_t last = image->colors.size() - 4;
  CHECK_NEAR(image->colors[last], 248.0 / 255.0, 1e-6);
  CHECK_NEAR(image->colors[last + 1], 113.0 / 255.0, 1e-6);
}

}  // namespace

// --- motion (G8, ZAB-141) -------------------------------------------------
//
// The engine's arithmetic is proved in `test_transition.cpp`; what these check is
// that a real frame drives it — the clock reaching it, the values landing on the
// node, the layout pass seeing them, and the state being dropped when a subtree
// leaves the layout under a motion.

namespace {

/**
 * Two hoverable buttons that tween, a bound bar, and a Collapse that animates
 * inside a panel the data can hide.
 *
 * The Collapse's header carries its height in a CHILD rather than declaring one:
 * the closed box is measured from the header's NATURAL size — what its content
 * asks for, before any declared height replaces it — which is what the reference
 * reads too.
 */
const char *MOTION_VIEW = R"({"v":1,"tokens":{"motion.slow":100},"views":{"motion":{
  "type":"Container","layout":{"direction":"column"},
  "children":[
    {"type":"Button","id":"fade","onClick":"noop","autofocus":true,
     "transition":{"duration":"{motion.slow}","easing":"linear"},
     "layout":{"width":100,"height":40},
     "style":{"background":"#000000","opacity":1},
     "states":{"hover":{"style":{"background":"#ffffff","opacity":0.5}},
               "focused":{"style":{"borderWidth":2,"borderColor":"#ffffff"}}}},
    {"type":"Button","id":"other","onClick":"noop","layout":{"width":100,"height":40}},
    {"type":"ProgressBar","id":"bar","value":{"bind":"job.progress"},
     "transition":{"duration":"{motion.slow}","easing":"linear"},
     "layout":{"direction":"row","width":200,"height":10},
     "children":[{"type":"Container","id":"bar-fill","style":{"background":"#ffffff"}}]},
    {"type":"Container","id":"panel","visible":{"bind":"ui.shown"},
     "layout":{"direction":"column"},
     "children":[
       {"type":"Collapse","id":"section","open":false,
        "transition":{"duration":"{motion.slow}","easing":"linear"},
        "layout":{"direction":"column","width":200},
        "children":[
          {"type":"Container","id":"head","layout":{"direction":"column"},
           "children":[{"type":"Container","layout":{"width":200,"height":20}}]},
          {"type":"Container","id":"body","layout":{"width":200,"height":80}}]}]}]}}})";

/** One frame at `now`, so a test reads like the clock it is describing. */
void frame_at(View &view, double now) {
  view.set_now(now);
  view.layout_frame();
}

/** The `section`, once `ui.shown` has let its panel into the layout. */
const LayoutNode &section_of(const View &view) { return view.root().children[3].children[0]; }

}  // namespace

TEST(view, a_state_change_tweens_the_resolved_values_and_asks_for_frames_while_it_does) {
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  const LayoutNode &button = view->root().children[0];
  // Settled at rest: a mount snaps, so nothing is moving before anything moves.
  CHECK(!view->animating());
  CHECK_EQ(button.resolved.opacity, 1.0);

  // The pointer arrives: the frame the state flips still paints the OLD value.
  view->pointer_move(50, 20);
  frame_at(*view, 0);
  CHECK(view->animating());
  CHECK_EQ(button.resolved.opacity, 1.0);

  frame_at(*view, 50);
  CHECK_NEAR(button.resolved.opacity, 0.75, 1e-9);
  CHECK(button.resolved.background.has_value());
  CHECK_NEAR(button.resolved.background->r, 0.5, 1e-6);
  CHECK(view->animating());

  frame_at(*view, 100);
  CHECK_NEAR(button.resolved.opacity, 0.5, 1e-9);
  // Landed: the adapter stops being asked for frames, which is the whole point of
  // frames on demand — motion costs them for exactly as long as it lasts.
  CHECK(!view->animating());
}

TEST(view, a_node_with_no_transition_snaps_which_is_the_pre_f7_behavior) {
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  const LayoutNode &button = view->root().children[0];
  const Color idle = *button.resolved.background;

  view->pointer_move(40, 25);
  frame_at(*view, 0);
  CHECK(!(*button.resolved.background == idle));
  CHECK(!view->animating());
}

TEST(view, a_border_on_its_way_out_holds_its_colour_instead_of_flashing_magenta) {
  // The bug ZAB-36 found in the reference: `borderWidth` tweens 2 → 0 while an
  // undeclared `borderColor` would drop to the missing-colour magenta halfway out.
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  const LayoutNode &button = view->root().children[0];
  CHECK(view->focus() == &button);  // autofocus, so the ring is already on
  CHECK_NEAR(button.resolved.border_width, 2.0, 1e-9);

  CHECK(view->move_focus(0, 1));  // down to the other button: the ring starts out
  frame_at(*view, 0);
  frame_at(*view, 50);
  CHECK_NEAR(button.resolved.border_width, 1.0, 1e-9);
  CHECK(button.resolved.border_color.has_value());
  const Color white{1.0f, 1.0f, 1.0f, 1.0f};
  CHECK(*button.resolved.border_color == white);
}

TEST(view, a_progress_bar_tweens_its_value_and_the_arrange_derives_the_fill_from_it) {
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  const LayoutNode &bar = view->root().children[2];
  // No data yet: a binding pointing at nothing is an EMPTY bar, never a full one.
  CHECK_EQ(bar.progress, 0.0);
  CHECK_EQ(bar.children[0].rect.width, 0.0);

  document.set_data("job.progress", DataValue::of_number(0.5));
  frame_at(*view, 0);
  CHECK_EQ(bar.progress, 0.0);  // the frame it moves still shows the old value
  CHECK(view->animating());

  frame_at(*view, 50);
  CHECK_NEAR(bar.progress, 0.25, 1e-9);
  // The VALUE is what tweened; the rect is derived from it by the same arrange
  // pass as always (2026-08-11 §4), so there is still one layout pass per frame.
  CHECK_NEAR(bar.children[0].rect.width, 50.0, 1e-9);

  frame_at(*view, 100);
  CHECK_NEAR(bar.progress, 0.5, 1e-9);
  CHECK_NEAR(bar.children[0].rect.width, 100.0, 1e-9);
  CHECK(!view->animating());
}

TEST(view, a_collapse_animates_its_own_height_and_keeps_its_content_in_layout_meanwhile) {
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  document.set_data("ui.shown", DataValue::of_bool(true));
  frame_at(*view, 0);
  const LayoutNode &section = section_of(*view);
  CHECK_EQ(section.rect.height, 20.0);  // closed: the header's box

  CHECK(view->set_open("section", true));
  // The pending frame, and the one price of interpolating declared inputs: the
  // content enters layout so THIS measure can learn the open height, and the box
  // holds shut meanwhile instead of popping open (`collapse.h`). It is only ever
  // paid on the FIRST opening — closing already knows both ends.
  frame_at(*view, 0);
  CHECK(section.children[1].section_shown);
  CHECK_EQ(section.rect.height, 20.0);
  CHECK(section.forced_clip);
  CHECK(view->animating());

  // Now the height is known, so this is the frame the tween starts — and the frame
  // a tween starts still paints the old value.
  frame_at(*view, 0);
  CHECK_EQ(section.rect.height, 20.0);

  frame_at(*view, 50);
  CHECK_NEAR(section.rect.height, 60.0, 1e-9);  // halfway between 20 and 100
  CHECK(section.forced_clip);

  frame_at(*view, 100);
  CHECK_NEAR(section.rect.height, 100.0, 1e-9);
  // Settled: the override goes away and the box is whatever the content asks for.
  CHECK(!section.forced_clip);
  CHECK(!view->animating());
}

TEST(view, a_closing_collapse_drops_its_content_only_once_the_box_has_shut) {
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  document.set_data("ui.shown", DataValue::of_bool(true));
  frame_at(*view, 0);
  const LayoutNode &section = section_of(*view);
  CHECK(view->set_open("section", true));
  frame_at(*view, 0);  // pending
  frame_at(*view, 0);  // the open tween starts
  frame_at(*view, 100);
  CHECK_NEAR(section.rect.height, 100.0, 1e-9);

  // Closing pays no pending frame: the content is already in layout, so both ends
  // are known and the tween starts on the very next one.
  CHECK(view->set_open("section", false));
  frame_at(*view, 100);
  frame_at(*view, 150);
  // Mid-close the content is STILL in layout — it is what the shrinking box clips.
  CHECK(section.children[1].section_shown);
  CHECK_NEAR(section.rect.height, 60.0, 1e-9);

  frame_at(*view, 200);
  CHECK(!section.children[1].section_shown);
  CHECK_EQ(section.rect.height, 20.0);
}

TEST(view, a_subtree_that_leaves_the_layout_lands_on_its_logical_state) {
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  document.set_data("ui.shown", DataValue::of_bool(true));
  frame_at(*view, 0);
  const LayoutNode &section = section_of(*view);

  CHECK(view->set_open("section", true));
  frame_at(*view, 0);  // pending
  frame_at(*view, 0);  // the open tween starts
  frame_at(*view, 100);
  // The body declares no transition of its own, so it never allocates the state.
  CHECK(section.children[1].anim == nullptr);

  CHECK(view->set_open("section", false));
  frame_at(*view, 100);
  CHECK(section.collapse_animating);

  // Hidden mid-close: a Collapse taken out of layout lands on its logical state
  // rather than staying halfway through a motion nobody saw.
  document.set_data("ui.shown", DataValue::of_bool(false));
  frame_at(*view, 120);
  CHECK(!section.collapse_animating);
  CHECK(!section.forced_clip);
  CHECK(!section.children[1].section_shown);
  CHECK(!view->animating());
}

// --- scrolling and the gestures that drive it -----------------------------

namespace {

/** A 200×200 viewport over four 100-tall rows: 400 px of content, 200 of reach. */
const char *SCROLL_VIEW = R"({"v":1,"views":{"list":{
  "type":"ScrollView","id":"list","axis":"vertical",
  "layout":{"direction":"column","width":200,"height":200},
  "children":[
    {"type":"Button","id":"row-0","layout":{"width":200,"height":100},
     "autofocus":true,"onClick":"pick-0"},
    {"type":"Container","id":"row-1","layout":{"width":200,"height":100}},
    {"type":"Container","id":"row-2","layout":{"width":200,"height":100}},
    {"type":"Button","id":"row-3","layout":{"width":200,"height":100},"onClick":"pick-3"}]}}})";

double offset_y(const View &view) { return view.root().scroll_offset.y; }

}  // namespace

TEST(view, the_reach_is_the_content_past_the_viewport_and_the_offset_lives_inside_it) {
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();
  CHECK_NEAR(view->root().scroll_max.y, 200.0, 0.001);
  // A vertical scroller has no horizontal reach, whatever its content does.
  CHECK_NEAR(view->root().scroll_max.x, 0.0, 0.001);

  CHECK(view->set_scroll("list", 0, 120));
  CHECK_NEAR(offset_y(*view), 120.0, 0.001);
  // Clamped at both ends: the host channel cannot put the content anywhere the
  // player could not have.
  CHECK(view->set_scroll("list", 0, 9999));
  CHECK_NEAR(offset_y(*view), 200.0, 0.001);
  CHECK(view->set_scroll("list", 0, -50));
  CHECK_NEAR(offset_y(*view), 0.0, 0.001);
  // No such scroller: nothing applied, and the game hears so rather than dying.
  CHECK(!view->set_scroll("nope", 0, 50));
}

TEST(view, a_viewport_that_grows_past_its_content_pulls_the_offset_back_with_it) {
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();
  view->set_scroll("list", 0, 200);
  CHECK_NEAR(offset_y(*view), 200.0, 0.001);

  // The whole 400 px of content now fits, so there is nowhere left to scroll to.
  view->set_size(200, 400);
  view->layout_frame();
  CHECK_NEAR(view->root().scroll_max.y, 0.0, 0.001);
  CHECK_NEAR(offset_y(*view), 0.0, 0.001);
}

TEST(view, a_wheel_notch_moves_the_scroller_under_the_pointer_and_nothing_else) {
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();

  CHECK(view->pointer_wheel(100, 100, 0, 60));
  CHECK_NEAR(offset_y(*view), 60.0, 0.001);
  // The axis a vertical scroller does not enable has a zero bound, so the clamp
  // simply drops it — the same 1:1 mapping the reference gives a browser's deltas.
  CHECK(!view->pointer_wheel(100, 100, 40, 0));
  CHECK_NEAR(view->root().scroll_offset.x, 0.0, 0.001);
  // Already at the end: nothing moves, and the caller hears that nothing did.
  view->set_scroll("list", 0, 200);
  CHECK(!view->pointer_wheel(100, 100, 0, 60));
  // Off the tree entirely.
  CHECK(!view->pointer_wheel(-40, -40, 0, 60));
}

TEST(view, a_drag_scrolls_only_once_it_beats_the_threshold_and_then_taps_nothing) {
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();

  // Row 1 is no control, so the press falls through and takes hold of the scroll.
  view->pointer_down(100, 150);
  CHECK_NEAR(offset_y(*view), 0.0, 0.001);
  // Under the threshold this is still a tap: nothing has moved yet.
  CHECK(!view->pointer_move(100, 148));
  CHECK_NEAR(offset_y(*view), 0.0, 0.001);
  // Past it, the content follows the finger — upwards, so the offset grows.
  view->pointer_move(100, 120);
  CHECK_NEAR(offset_y(*view), 30.0, 0.001);
  view->layout_frame();

  view->pointer_up(100, 120);
  // A scroll gesture concludes nothing: no action left the view.
  CHECK(view->drain_actions().empty());
}

TEST(view, a_press_on_a_row_control_beats_the_drag_and_still_fires_its_action) {
  // The exit criterion of this ticket in one case: a scrollable list whose rows
  // are still buttons.
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();

  view->pointer_down(100, 50);
  CHECK(view->root().children[0].pressed);
  // A little travel with a control held is not a scroll: the drag never started.
  view->pointer_move(100, 40);
  CHECK_NEAR(offset_y(*view), 0.0, 0.001);

  view->pointer_up(100, 40);
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("pick-0"));
}

TEST(view, a_control_scrolled_out_from_under_the_finger_loses_its_tap) {
  // Released over the same coordinates, but the button is no longer there — and
  // "no longer there" includes cut away by the region, not just moved off it.
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();

  view->pointer_down(100, 50);
  CHECK(view->root().children[0].pressed);
  view->set_scroll("list", 0, 200);
  view->layout_frame();

  view->pointer_up(100, 50);
  CHECK(view->drain_actions().empty());
  CHECK(!view->root().children[0].pressed);
}

TEST(view, a_cancelled_gesture_ends_without_concluding_anything) {
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();

  view->pointer_down(100, 50);
  CHECK(view->root().children[0].pressed);
  CHECK(view->pointer_cancel());
  CHECK(!view->root().children[0].pressed);
  CHECK(view->drain_actions().empty());
  // And a release afterwards has nothing left to conclude either.
  view->pointer_up(100, 50);
  CHECK(view->drain_actions().empty());

  // A drag in flight goes the same way, and the offset it already moved stays:
  // the content really is where the player left it.
  view->pointer_down(100, 150);
  view->pointer_move(100, 100);
  CHECK_NEAR(offset_y(*view), 50.0, 0.001);
  CHECK(view->pointer_cancel());
  view->pointer_move(100, 40);
  CHECK_NEAR(offset_y(*view), 50.0, 0.001);
}

TEST(view, the_focus_drags_the_scroll_with_it_but_only_when_it_is_navigation) {
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();
  CHECK(view->focus() != nullptr);

  // Row 3 sits at 300..400 with a 200 px viewport: the smallest move that brings
  // its far edge in is 200 — which is also the whole reach.
  CHECK(view->move_focus(0, 1));
  CHECK_NEAR(offset_y(*view), 200.0, 0.001);
  view->layout_frame();

  // A pointer press does not: the player is already looking at what they touched.
  view->set_scroll("list", 0, 0);
  view->layout_frame();
  view->pointer_down(100, 50);
  view->pointer_up(100, 50);
  view->drain_actions();
  CHECK_NEAR(offset_y(*view), 0.0, 0.001);
}

TEST(view, a_collapse_mid_motion_really_cuts_the_content_it_is_closing_over) {
  // The seam between G8 and G6: the motion sets `forced_clip` and the clip rules
  // read it, so a box animating smaller than its own content cuts it — without
  // the author ever asking for a clip, and without either half knowing about the
  // other beyond that one flag.
  Document document = loaded(MOTION_VIEW, 400, 300);
  View *view = document.view();
  document.set_data("ui.shown", DataValue::of_bool(true));
  const LayoutNode &section = section_of(*view);

  CHECK(!clips_children(section));  // at rest it clips nothing
  CHECK(view->set_open("section", true));
  frame_at(*view, 0);  // pending
  frame_at(*view, 0);  // the tween starts
  frame_at(*view, 50);

  CHECK(section.collapse_animating);
  CHECK(clips_children(section));
  ClipArena arena;
  const Clip *region = child_clip(section, nullptr, arena);
  CHECK(region != nullptr);
  if (region != nullptr) {
    // The region is the box as it stands THIS frame — mid-tween, so shorter than
    // the content it holds, which is the whole point of forcing the clip.
    CHECK_NEAR(region->height, section.rect.height, 0.001);
    CHECK(region->height < section.natural.y);
  }

  frame_at(*view, 200);  // settled open
  CHECK(!section.collapse_animating);
  CHECK(!clips_children(section));
}

TEST(view, a_new_press_ends_whatever_gesture_was_still_in_flight) {
  // Nothing should be able to make a press advance the PREVIOUS drag by the jump
  // between where that one was left and where this one lands.
  Document document = loaded(SCROLL_VIEW, 200, 200);
  View *view = document.view();

  view->pointer_down(100, 150);
  view->pointer_move(100, 100);
  CHECK_NEAR(offset_y(*view), 50.0, 0.001);
  view->layout_frame();

  // No release: the next press arrives with the old gesture still on the books.
  view->pointer_down(100, 190);
  CHECK_NEAR(offset_y(*view), 50.0, 0.001);
}

// --- Slider: the gestures and the two hooks (2026-08-11, ZAB-24) -----------
//
// The corpus records where the fill and the thumb landed; what it cannot record
// is the SEQUENCE — that the value is written on every move and settled once at
// the end, and that a gesture in the player's hand does not glide.

namespace {

/**
 * Two sliders in a 200×200 view. `volume` is a 200×20 rail across the top, in
 * tens, with both hooks and a bound value; `tall` is a 20×100 fader under it.
 *
 * Its thumb is 20 wide, so the travel is the middle 180px: a point at x is the
 * fraction `(x - 10) / 180`.
 */
const char *SLIDER_VIEW = R"({"v":1,"tokens":{"motion.slow":100},"views":{"panel":{
  "type":"Container","layout":{"direction":"column"},
  "children":[
    {"type":"Slider","id":"volume","layout":{"width":200,"height":20},
     "value":{"bind":"settings.volume"},"disabled":{"bind":"ui.dead"},
     "min":0,"max":100,"step":10,
     "transition":{"duration":"{motion.slow}","easing":"linear"},
     "onChange":"volume-preview","onCommit":"volume-apply","autofocus":true,
     "children":[
       {"type":"Container","id":"fill","layout":{"height":4}},
       {"type":"Container","id":"thumb","layout":{"width":20,"height":20}}]},
    {"type":"Slider","id":"tall","layout":{"width":20,"height":100},"axis":"vertical",
     "children":[
       {"type":"Container","layout":{"width":6}},
       {"type":"Container","layout":{"width":20,"height":20}}]}]}}})";

const LayoutNode &volume_of(const View &view) { return view.root().children[0]; }
const LayoutNode &tall_of(const View &view) { return view.root().children[1]; }

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

TEST(view, a_tap_on_the_track_jumps_the_value_and_the_release_settles_it) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &volume = volume_of(*view);
  // An empty store leaves the control at its minimum.
  CHECK_EQ(volume.slider_value, 0.0);

  // (100 - 10) / 180 = 0.5 of 0..100, on the grid of tens.
  CHECK(view->pointer_down(100, 10));
  CHECK_EQ(volume.slider_value, 50.0);
  CHECK(volume.pressed);
  CHECK(volume.focused);  // the pointer and the arrows share one focus
  // Live: the value is written into its bound path and `onChange` fires, but the
  // gesture has not ended, so `onCommit` has not.
  const std::vector<DataChange> changes = view->drain_data_changes();
  CHECK_EQ(changes.size(), 1u);
  if (!changes.empty()) {
    CHECK_EQ(changes[0].path, std::string("settings.volume"));
    CHECK_EQ(changes[0].value.number, 50.0);
  }
  CHECK_EQ(action_names(*view), std::string("volume-preview"));

  CHECK(view->pointer_up(100, 10));
  CHECK(!volume.pressed);
  CHECK_EQ(action_names(*view), std::string("volume-apply"));
}

TEST(view, a_drag_writes_on_every_move_and_commits_exactly_once) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &volume = volume_of(*view);

  view->pointer_down(10, 10);   // the minimum: nothing moved, nothing fired
  CHECK_EQ(volume.slider_value, 0.0);
  CHECK(view->drain_data_changes().empty());
  CHECK_EQ(action_names(*view), std::string(""));

  // No drag threshold: a slider follows the finger from the first pixel.
  CHECK(view->pointer_move(64, 10));
  CHECK_EQ(volume.slider_value, 30.0);
  view->pointer_move(154, 10);
  CHECK_EQ(volume.slider_value, 80.0);
  CHECK_EQ(view->drain_data_changes().size(), 2u);
  CHECK_EQ(action_names(*view), std::string("volume-preview,volume-preview"));

  view->pointer_up(154, 10);
  CHECK_EQ(action_names(*view), std::string("volume-apply"));
}

TEST(view, a_gesture_that_leaves_the_value_where_it_found_it_does_not_commit) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  document.set_data("settings.volume", DataValue::of_number(50));
  view->layout_frame();
  CHECK_EQ(volume_of(*view).slider_value, 50.0);

  view->pointer_down(100, 10);  // the value it already had
  view->pointer_up(100, 10);
  CHECK_EQ(action_names(*view), std::string(""));
  CHECK(view->drain_data_changes().empty());
}

TEST(view, a_bound_value_reads_off_the_channel_and_clamps_to_the_range) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &volume = volume_of(*view);

  document.set_data("settings.volume", DataValue::of_number(43));
  view->layout_frame();
  CHECK_EQ(volume.slider_value, 40.0);  // snapped to the grid of tens

  // A numeric STRING moves it too: the game may have pushed a value that crossed
  // a text field or a JSON payload, and a bound control must not hinge on which
  // side did the parsing.
  document.set_data("settings.volume", DataValue::of_text("70"));
  view->layout_frame();
  CHECK_EQ(volume.slider_value, 70.0);

  // Anything else is no value at all, which leaves the control at its minimum.
  document.set_data("settings.volume", DataValue::of_text("loud"));
  view->layout_frame();
  CHECK_EQ(volume.slider_value, 0.0);
  document.set_data("settings.volume", DataValue::of_number(999));
  view->layout_frame();
  CHECK_EQ(volume.slider_value, 100.0);
}

TEST(view, a_cancelled_slider_gesture_settles_and_a_disabled_one_does_not) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  view->pointer_down(100, 10);
  view->drain_actions();
  // The one exception to "a cancel ends without concluding": the number is on
  // screen and already written, so the game gets its "apply" event.
  CHECK(view->pointer_cancel());
  CHECK(!volume_of(*view).pressed);
  CHECK_EQ(action_names(*view), std::string("volume-apply"));

  // A control the game kills under the finger is the other reading: the value
  // never became the player's, so the gesture is cancelled and not settled.
  view->pointer_down(154, 10);
  view->drain_actions();
  document.set_data("ui.dead", DataValue::of_bool(true));
  CHECK(document.load(R"({"v":1,"views":{"panel":{"type":"Container","children":[
    {"type":"Slider","id":"volume","layout":{"width":200,"height":20},
     "disabled":{"bind":"ui.dead"},"onCommit":"volume-apply",
     "children":[{"type":"Container"},
                  {"type":"Container","layout":{"width":20,"height":20}}]}]}}})"));
  View *reloaded = document.view();
  reloaded->set_size(200, 200);
  reloaded->layout_frame();
  reloaded->pointer_down(100, 10);
  CHECK(reloaded->drain_actions().empty());  // it never took the press at all
}

TEST(view, a_keyboard_gesture_on_a_control_the_game_kills_is_cancelled_too) {
  // The spec says a gesture in flight when the game disables the control is
  // cancelled and never committed (`docs/components/slider.md`), and it does not
  // say "the pointer's". A held arrow must not settle a control that just died.
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  view->move_focus(1, 0);
  CHECK_EQ(action_names(*view), std::string("volume-preview"));

  document.set_data("ui.dead", DataValue::of_bool(true));
  view->layout_frame();  // `prune_disabled` runs here
  CHECK(!view->settle_slider_keys());
  CHECK_EQ(action_names(*view), std::string(""));
}

TEST(view, the_axis_arrows_adjust_the_slider_and_the_cross_ones_keep_navigating) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &volume = volume_of(*view);
  CHECK(volume.focused);  // autofocus

  CHECK(view->move_focus(1, 0));
  CHECK_EQ(volume.slider_value, 10.0);
  CHECK(volume.focused);  // it adjusted, it did not move
  CHECK(view->move_focus(1, 0));
  CHECK_EQ(volume.slider_value, 20.0);
  // Live on every press, settled once when the key comes up.
  CHECK_EQ(action_names(*view), std::string("volume-preview,volume-preview"));
  CHECK(view->settle_slider_keys());
  CHECK_EQ(action_names(*view), std::string("volume-apply"));
  CHECK(!view->settle_slider_keys());  // the gesture is over, not repeatable

  // The cross axis is not the slider's: it navigates to the fader below.
  CHECK(view->move_focus(0, 1));
  CHECK(tall_of(*view).focused);
  CHECK_EQ(volume.slider_value, 20.0);
}

TEST(view, a_vertical_slider_grows_upward_and_its_arrows_follow_the_track) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &tall = tall_of(*view);
  // The fader sits at y 20..120; its thumb is 20 tall, so the travel is 20..100.
  CHECK_EQ(tall.rect.height, 100.0);

  view->pointer_down(tall.rect.x + 10, tall.rect.y + 90);  // near the BOTTOM
  CHECK_NEAR(tall.slider_value, 0.0, 1e-9);
  view->pointer_move(tall.rect.x + 10, tall.rect.y + 10);  // near the TOP
  CHECK_NEAR(tall.slider_value, 1.0, 1e-9);
  view->pointer_up(tall.rect.x + 10, tall.rect.y + 10);

  // Up means MORE, like the track does. Continuous, so an arrow borrows 5%.
  view->move_focus(0, 1);
  CHECK_NEAR(tall.slider_value, 0.95, 1e-9);
  view->move_focus(0, -1);
  CHECK_NEAR(tall.slider_value, 1.0, 1e-9);
}

TEST(view, set_value_is_a_whole_gesture_and_snaps_to_the_grid) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  CHECK(!view->set_value("nope", 1));
  CHECK(!view->set_value("fill", 1));  // there IS a node, and it is not a Slider

  CHECK(view->set_value("volume", 43));
  CHECK_EQ(volume_of(*view).slider_value, 40.0);
  // The game's gesture and the player's produce the same thing: the write, the
  // live hook and the settle, in that order.
  CHECK_EQ(view->drain_data_changes().size(), 1u);
  CHECK_EQ(action_names(*view), std::string("volume-preview,volume-apply"));
}

TEST(view, the_game_moves_the_slider_with_a_glide_and_the_finger_moves_it_at_once) {
  Document document = loaded(SLIDER_VIEW, 200, 200);
  View *view = document.view();
  const LayoutNode &volume = volume_of(*view);

  document.set_data("settings.volume", DataValue::of_number(100));
  frame_at(*view, 0);
  CHECK_EQ(volume.slider_value, 100.0);
  CHECK_EQ(volume.slider_display, 0.0);  // the frame it moves still paints the old value
  CHECK(view->animating());
  frame_at(*view, 50);
  CHECK_NEAR(volume.slider_display, 50.0, 1e-9);
  frame_at(*view, 100);
  CHECK_EQ(volume.slider_display, 100.0);
  CHECK(!view->animating());

  // The value in the player's hand does NOT glide: a thumb trailing the finger
  // reads as a broken control, not as juice.
  view->pointer_down(10, 10);
  frame_at(*view, 100);
  CHECK_EQ(volume.slider_value, 0.0);
  CHECK_EQ(volume.slider_display, 0.0);
  CHECK(!view->animating());
}

// --- TextInput (ZAB-26, G11) ----------------------------------------------

namespace {

/**
 * Two fields in a 300×200 view: one with a literal value and a `maxLength`, one
 * empty with a placeholder and a bound value. Boxes are 200 wide with 8 of
 * padding, so the content box is 184 and a long value has somewhere to scroll.
 */
const char *FIELD_VIEW = R"({"v":1,"views":{"form":{
  "type":"Container","layout":{"direction":"column","padding":8,"gap":8},
  "children":[
    {"type":"TextInput","id":"name","value":"Sergi","placeholder":"Tu nombre",
     "maxLength":8,"onChange":"name-changed","onSubmit":"name-accepted",
     "layout":{"width":200,"padding":8},"style":{"color":"#e2e8f0"},
     "autofocus":true},
    {"type":"TextInput","id":"city","value":{"bind":"form.city"},
     "placeholder":"Ciudad","layout":{"width":200,"padding":8},
     "style":{"color":"#e2e8f0"},
     "states":{"empty":{"style":{"color":"#64748b"}}}}]}}})";

KeyIntent key(EditKey which, bool shift = false, bool shortcut = false) {
  KeyIntent intent;
  intent.key = which;
  intent.shift = shift;
  intent.shortcut = shortcut;
  return intent;
}

}  // namespace

TEST(view, a_field_measures_one_line_tall_and_takes_its_width_from_its_layout) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  const LayoutNode &name = view->root().children[0];
  // A field must not grow with what is typed into it, so the intrinsic width is
  // zero and the declared 200 is what stands.
  CHECK_EQ(name.rect.width, 200.0);
  // What it asked for is its own padding and NOTHING of its content: "Sergi" is
  // five glyphs wide and contributes none of them.
  CHECK_EQ(name.natural.x, 16.0);
  // One line plus its own padding: the height never depends on the content
  // either, which is what keeps a form from reflowing as it is filled in.
  CHECK(name.rect.height > 16.0);
  CHECK_EQ(name.rect.height, view->root().children[1].rect.height);
}

TEST(view, a_field_is_seeded_with_its_value_and_the_caret_lands_at_the_end) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  const FieldState &name = *view->root().children[0].field;
  CHECK_EQ(name.text, std::string("Sergi"));
  // Settled: this is the field's initial value, so the caret sits where someone
  // who had just typed it would have left it.
  CHECK_EQ(name.selection.anchor, size_t(5));
  CHECK_EQ(name.selection.focus, size_t(5));
}

TEST(view, an_empty_field_wears_the_empty_state_and_loses_it_at_the_first_character) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  const LayoutNode &city = view->root().children[1];
  // The placeholder is a STATE, not a colour of its own: `empty` is what dresses
  // it, so an override reaches it through the ordinary merge (ZAB-26).
  CHECK(city.resolved.color.has_value());
  if (city.resolved.color.has_value()) CHECK(city.resolved.color->r < 0.5f);

  CHECK(view->move_focus(0, 1));
  CHECK(view->insert_text("B"));
  view->layout_frame();
  CHECK_EQ(city.field->text, std::string("B"));
  // Holding text, the field is back to its own colour.
  CHECK(city.resolved.color.has_value());
  if (city.resolved.color.has_value()) CHECK(city.resolved.color->r > 0.5f);
}

TEST(view, typing_writes_the_bound_path_and_fires_the_live_hook) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  CHECK(view->move_focus(0, 1));
  CHECK(view->insert_text("Bar"));

  const std::vector<DataChange> changes = view->drain_data_changes();
  CHECK_EQ(changes.size(), 1u);
  if (!changes.empty()) {
    CHECK_EQ(changes[0].path, std::string("form.city"));
    CHECK_EQ(changes[0].value.text, std::string("Bar"));
  }
  // The field with no binding has nothing to write, but still says it changed.
  CHECK(view->move_focus(0, -1));
  CHECK(view->insert_text("!"));
  CHECK(view->drain_data_changes().empty());
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("name-changed"));
}

TEST(view, max_length_bounds_what_is_typed_and_never_what_the_game_pushes) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  // "Sergi" is 5 of the 8 allowed, so a six-character paste lands three.
  CHECK(view->insert_text(" Zamora"));
  CHECK_EQ(view->root().children[0].field->text, std::string("Sergi Za"));

  // The game's own string is shown whole: the limit is on the PLAYER, not on
  // what the data is allowed to hold (decision 2026-08-11, ZAB-26).
  CHECK(view->set_text("name", "un nombre larguísimo de verdad"));
  CHECK_EQ(view->root().children[0].field->text,
           std::string("un nombre larguísimo de verdad"));
}

TEST(view, a_write_from_the_game_keeps_the_caret_and_a_build_settles_it) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  // Built with no data, so the bound field is empty and its caret is at 0.
  CHECK_EQ(view->root().children[1].field->selection.focus, size_t(0));

  document.set_data("form.city", DataValue::of_text("Barcelona"));
  view->layout_frame();
  const FieldState &city = *view->root().children[1].field;
  CHECK_EQ(city.text, std::string("Barcelona"));
  // NOT settled: a write from the game is not a gesture, so the caret the player
  // left is kept and only clamped into the new text.
  CHECK_EQ(city.selection.focus, size_t(0));

  // Shorter data pulls a caret past the end back inside it.
  CHECK(view->move_focus(0, 1));
  view->edit_key(key(EditKey::End));
  CHECK_EQ(view->root().children[1].field->selection.focus, size_t(9));
  document.set_data("form.city", DataValue::of_text("Bar"));
  view->layout_frame();
  CHECK_EQ(view->root().children[1].field->selection.focus, size_t(3));
}

TEST(view, the_arrows_walk_the_caret_and_hand_the_key_back_at_the_ends) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();

  CHECK(view->edit_key(key(EditKey::Left)));
  CHECK_EQ(view->root().children[0].field->selection.focus, size_t(4));
  // Shift drags the focus alone, so the same key also shrinks a selection.
  CHECK(view->edit_key(key(EditKey::Left, true)));
  CHECK_EQ(view->root().children[0].field->selection.anchor, size_t(4));
  CHECK_EQ(view->root().children[0].field->selection.focus, size_t(3));

  CHECK(view->edit_key(key(EditKey::Home)));
  // Against the end with nothing selected, the field lets go: the key falls
  // through to spatial navigation instead of trapping the player (ZAB-26).
  CHECK(!view->edit_key(key(EditKey::Left)));
  // Up and down never belong to a single-line field at all — the deliberate
  // difference from the Slider, which never releases its own axis.
  CHECK(!view->edit_key(key(EditKey::Other)));
}

TEST(view, backspace_and_delete_edit_the_buffer_and_enter_submits) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  view->drain_actions();

  CHECK(view->edit_key(key(EditKey::Backspace)));
  CHECK_EQ(view->root().children[0].field->text, std::string("Serg"));
  CHECK(view->edit_key(key(EditKey::Home)));
  CHECK(view->edit_key(key(EditKey::Delete)));
  CHECK_EQ(view->root().children[0].field->text, std::string("erg"));

  view->drain_actions();
  CHECK(view->edit_key(key(EditKey::Submit)));
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("name-accepted"));

  // A held Enter is the OS repeating a key, not a second submission.
  KeyIntent held = key(EditKey::Submit);
  held.repeat = true;
  CHECK(view->edit_key(held));
  CHECK(view->drain_actions().empty());
}

TEST(view, select_all_replaces_the_whole_field_with_what_is_typed_next) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  // Copy, cut and paste are the platform's: an unclaimed shortcut falls through
  // so the adapter can read the clipboard and come back through `insert_text`.
  CHECK(!view->edit_key(key(EditKey::Other, false, true)));
  CHECK(view->edit_key(key(EditKey::SelectAll, false, true)));
  CHECK_EQ(view->root().children[0].field->selection.anchor, size_t(0));
  CHECK_EQ(view->root().children[0].field->selection.focus, size_t(5));
  CHECK_EQ(view->field_selection_text(), std::string("Sergi"));

  CHECK(view->insert_text("Ana"));
  CHECK_EQ(view->root().children[0].field->text, std::string("Ana"));
}

TEST(view, a_composition_is_shown_and_only_told_to_the_game_once_it_settles) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  CHECK(view->move_focus(0, 1));
  view->drain_data_changes();

  // Each update REPLACES the previous one — the platform reports the composing
  // string, not the whole value, so appending would spell "kkoko".
  CHECK(view->set_composition("k"));
  CHECK(view->set_composition("ko"));
  CHECK_EQ(view->root().children[1].field->text, std::string("ko"));
  // The field shows it and the game hears nothing: half a syllable is not a value.
  CHECK(view->drain_data_changes().empty());

  CHECK(view->end_composition());
  const std::vector<DataChange> changes = view->drain_data_changes();
  CHECK_EQ(changes.size(), 1u);
  if (!changes.empty()) CHECK_EQ(changes[0].value.text, std::string("ko"));
}

TEST(view, a_pointer_places_the_caret_and_a_drag_selects_backwards_too) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  const LayoutNode &name = view->root().children[0];
  const double content_left = name.rect.x + 8;
  const double middle = name.rect.y + name.rect.height / 2;

  // A press inside a field takes the pointer and focuses it, whatever else it
  // might have started — a screen of fields is scrollable, and a selection drag
  // must not become a scroll of the list.
  // Inside the box but past the end of the run: the caret snaps to the last seam.
  CHECK(view->pointer_down(content_left + 150, middle));
  CHECK(view->focus() == &name);
  CHECK_EQ(name.field->selection.anchor, size_t(5));

  CHECK(view->pointer_move(content_left, middle));
  // The anchor stays where the press landed, so dragging back selects backwards.
  CHECK_EQ(name.field->selection.anchor, size_t(5));
  CHECK_EQ(name.field->selection.focus, size_t(0));
  CHECK(view->pointer_up(content_left, middle));
  CHECK_EQ(view->field_selection_text(), std::string("Sergi"));
  // A selection concludes by existing: nothing fired, nothing settled.
  CHECK(view->drain_actions().empty());
  CHECK(view->drain_data_changes().empty());
}

TEST(view, content_longer_than_the_box_scrolls_to_keep_the_caret_in_view) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  CHECK(view->set_text("name", "un valor mucho más largo de lo que cabe en la caja"));
  view->layout_frame();
  // `set_text` leaves the caret at the end, so the run slid left under the edge.
  const double scrolled = view->root().children[0].field->scroll;
  CHECK(scrolled > 0.0);

  // Home brings it back by the smallest move that shows the caret again, and the
  // pass is idempotent: a frame that changed nothing recomputes the same offset.
  view->edit_key(key(EditKey::Home));
  view->layout_frame();
  CHECK_EQ(view->root().children[0].field->scroll, 0.0);
  view->layout_frame();
  CHECK_EQ(view->root().children[0].field->scroll, 0.0);
}

TEST(view, an_id_that_names_no_field_is_answered_and_nothing_is_applied) {
  Document document = loaded(FIELD_VIEW, 300, 200);
  View *view = document.view();
  CHECK(!view->set_text("nope", "x"));
  CHECK(view->drain_data_changes().empty());
}

// --- Repeat: expansion, identity and the window (G12, ZAB-145) -------------

namespace {

/**
 * A keyed list of 40px rows inside a 100px scroller, plus an empty state.
 *
 * The numbers are chosen so the window is easy to reason about: stride 40 with no
 * gap, a viewport that shows two and a half rows, and the two buffer lines on each
 * side that `visible_span` keeps.
 */
const char *LIST_VIEW = R"({"v":1,"views":{"list":{
  "type":"Container","children":[
    {"type":"ScrollView","id":"scroller","axis":"vertical",
     "layout":{"direction":"column","width":100,"height":100},
     "children":[
       {"type":"Repeat","id":"rows","items":{"bind":"shop.items"},"as":"it","key":"id",
        "layout":{"direction":"column"},
        "children":[
          {"type":"Button","id":"row","onClick":"buy","layout":{"width":100,"height":40},
           "children":[{"type":"Text","id":"label","text":{"bind":"it.name"}}]},
          {"type":"Text","id":"nothing","text":"empty"}]}]}]}}})";

/** `[{id, name}, …]` — the shape a keyed list arrives in. */
DataValue named_rows(const std::vector<std::pair<std::string, std::string>> &rows) {
  DataValue out = DataValue::array();
  for (const auto &[id, name] : rows) {
    DataValue row = DataValue::object();
    row.insert("id", DataValue::of_text(id));
    row.insert("name", DataValue::of_text(name));
    out.push(std::move(row));
  }
  return out;
}

DataValue counted_rows(int count) {
  std::vector<std::pair<std::string, std::string>> rows;
  for (int i = 0; i < count; i++) {
    rows.emplace_back(std::to_string(i), "row " + std::to_string(i));
  }
  return named_rows(rows);
}

/** The `Repeat` of `LIST_VIEW` — the scroller is what wraps it. */
const LayoutNode &rows_of(const View &view) { return view.root().children[0].children[0]; }

/** What a row's bound label reads right now — the item its instance points at. */
std::string label_of(const LayoutNode &instance) {
  return instance.children[0].text_content;
}

}  // namespace

TEST(view, a_repeat_shows_its_empty_state_only_while_there_is_nothing_to_repeat) {
  Document document;
  document.load(LIST_VIEW);
  View *view = document.view();
  view->set_size(200, 200);
  view->layout_frame();

  // Absent data is the empty case, exactly like an array of zero elements or a
  // value of the wrong shape (2026-08-11, ZAB-29).
  const LayoutNode &rows = rows_of(*view);
  CHECK_EQ(rows.children.size(), 1u);
  CHECK(rows.children[0].section_shown);

  document.set_data("shop.items", named_rows({{"a", "Poción"}, {"b", "Espada"}}));
  view->layout_frame();
  CHECK_EQ(rows.children.size(), 3u);
  CHECK_EQ(label_of(rows.children[0]), std::string("Poción"));
  CHECK_EQ(label_of(rows.children[1]), std::string("Espada"));
  // The empty state stays built and stays LAST — it is out of layout, not gone.
  CHECK(!rows.children[2].section_shown);

  document.set_data("shop.items", DataValue::of_text("not an array"));
  view->layout_frame();
  CHECK_EQ(rows.children.size(), 1u);
  CHECK(rows.children[0].section_shown);
}

TEST(view, a_keyed_instance_travels_with_its_item_when_the_array_reorders) {
  Document document;
  document.load(LIST_VIEW);
  View *view = document.view();
  view->set_size(200, 200);
  document.set_data("shop.items", named_rows({{"a", "Poción"}, {"b", "Espada"}}));
  view->layout_frame();

  const LayoutNode &rows = rows_of(*view);
  const LayoutNode *was_first = &rows.children[0];
  const LayoutNode *was_second = &rows.children[1];

  document.set_data("shop.items", named_rows({{"b", "Espada"}, {"a", "Poción"}}));
  view->layout_frame();

  // The very same nodes, in the other order: what reordering moves is the
  // instance, and with it every piece of state the view keyed by node identity.
  CHECK(&rows.children[0] == was_second);
  CHECK(&rows.children[1] == was_first);
  CHECK_EQ(label_of(rows.children[0]), std::string("Espada"));
  CHECK_EQ(label_of(rows.children[1]), std::string("Poción"));
}

TEST(view, without_a_key_identity_is_the_position_and_stays_there) {
  // The author said the row IS the position, so an insert leaves each instance
  // where it was and hands it another element.
  const char *unkeyed = R"({"v":1,"views":{"list":{
    "type":"Container","children":[
      {"type":"Repeat","id":"rows","items":{"bind":"shop.items"},"as":"it",
       "children":[{"type":"Text","id":"label","text":{"bind":"it.name"}}]}]}}})";
  Document document;
  document.load(unkeyed);
  View *view = document.view();
  view->set_size(200, 200);
  document.set_data("shop.items", named_rows({{"a", "Poción"}, {"b", "Espada"}}));
  view->layout_frame();

  const LayoutNode &rows = view->root().children[0];
  const LayoutNode *first = &rows.children[0];

  document.set_data("shop.items", named_rows({{"b", "Espada"}, {"a", "Poción"}}));
  view->layout_frame();
  CHECK(&rows.children[0] == first);
  CHECK_EQ(rows.children[0].text_content, std::string("Espada"));
}

TEST(view, an_action_from_inside_an_item_says_which_one) {
  Document document;
  document.load(LIST_VIEW);
  View *view = document.view();
  view->set_size(200, 200);
  document.set_data("shop.items", named_rows({{"a", "Poción"}, {"b", "Espada"}}));
  view->layout_frame();

  const LayoutNode &second = rows_of(*view).children[1];
  view->pointer_down(second.rect.x + 5, second.rect.y + 5);
  view->pointer_up(second.rect.x + 5, second.rect.y + 5);

  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (actions.empty()) return;
  CHECK_EQ(actions[0].name, std::string("buy"));
  // The absolute path of the item, its raw key and its position (ZAB-29) — the
  // path is what the game writes back through, so it is an address and not a name.
  CHECK_EQ(actions[0].item_path, std::string("shop.items.1"));
  CHECK_EQ(actions[0].item_index, 1);
  CHECK(actions[0].has_key);
  CHECK_EQ(actions[0].key_text, std::string("b"));
}

TEST(view, an_action_from_the_document_itself_carries_no_item) {
  Document document = loaded(BUTTON_VIEW);
  View *view = document.view();
  view->pointer_down(40, 25);
  view->pointer_up(40, 25);
  const std::vector<ActionEvent> actions = view->drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK(actions[0].item_path.empty());
}

TEST(view, a_long_list_realizes_a_window_and_reserves_the_rest) {
  Document document;
  document.load(LIST_VIEW);
  View *view = document.view();
  view->set_size(200, 200);
  document.set_data("shop.items", counted_rows(40));
  // The first frame measures the rows; the second is the one that can window
  // them, which is the settling frame the corpus gives every case.
  view->layout_frame();
  view->layout_frame();

  const LayoutNode &rows = rows_of(*view);
  CHECK(rows.virtual_span.has_value());
  if (!rows.virtual_span.has_value()) return;
  // Viewport 100 over a stride of 40 covers lines 0..2, plus two buffer lines.
  CHECK_EQ(rows.virtual_span->first, 0);
  CHECK_EQ(rows.virtual_span->count, 5);
  // The space of the WHOLE array: the scroll bounds must not depend on how much
  // of it exists.
  CHECK_NEAR(rows.virtual_span->reserved, 40 * 40.0, 1e-9);
  CHECK_NEAR(rows.rect.height, 1600.0, 1e-9);
  CHECK_EQ(rows.children.size(), 6u);  // five rows and the empty state

  // Scrolled: another window, offset by the lines it skipped. It takes two
  // frames on purpose — the expansion reads the rects the PREVIOUS frame left,
  // so the scroll moves the content first and the window converges right after,
  // which is exactly what `sync_extent` asks for another frame to do.
  view->set_scroll("scroller", 0, 400);
  view->layout_frame();
  view->layout_frame();
  CHECK_EQ(rows.virtual_span->first, 8);
  CHECK_NEAR(rows.virtual_span->lead, 320.0, 1e-9);
  // The first realized row sits where the tenth row belongs, not at the top.
  CHECK_NEAR(rows.children[0].rect.y, 320.0 - 400.0, 1e-9);
  CHECK_EQ(label_of(rows.children[0]), std::string("row 8"));
}

TEST(view, the_focus_of_an_unrealized_row_is_logical_and_comes_back_with_it) {
  Document document;
  document.load(LIST_VIEW);
  View *view = document.view();
  view->set_size(200, 200);
  document.set_data("shop.items", counted_rows(40));
  view->layout_frame();
  view->layout_frame();

  const LayoutNode &rows = rows_of(*view);
  const LayoutNode *first_row = &rows.children[0];
  view->pointer_down(first_row->rect.x + 5, first_row->rect.y + 5);
  view->pointer_up(first_row->rect.x + 5, first_row->rect.y + 5);
  view->drain_actions();
  CHECK(view->focus() == first_row);

  // Scrolling that row out of the window is the renderer recycling a node, not
  // the player giving up the focus (ZAB-70): nothing wears it, and nothing takes
  // it — least of all whatever the view would otherwise autofocus.
  view->set_scroll("scroller", 0, 600);
  view->layout_frame();
  view->layout_frame();
  CHECK(view->focus() == nullptr);
  CHECK_EQ(label_of(rows.children[0]), std::string("row 13"));

  // Realized again: the item takes it back, at the same node of the row.
  view->set_scroll("scroller", 0, 0);
  view->layout_frame();
  view->layout_frame();
  CHECK(view->focus() != nullptr);
  if (view->focus() == nullptr) return;
  CHECK_EQ(label_of(*view->focus()), std::string("row 0"));
}

TEST(view, the_stick_keeps_scrolling_the_list_a_logical_focus_lives_in) {
  // The other half of ZAB-70's logical focus, and the pad's (ZAB-47): while the
  // focused row is not realized, `focus()` is null — but the focus is not gone,
  // it names the item. If `scroll_focused_by` read only the realized node, the
  // right stick would go dead exactly while the player is scrolling that row out
  // of the window, which is the moment they are most obviously using it.
  Document document;
  document.load(LIST_VIEW);
  View *view = document.view();
  view->set_size(200, 200);
  document.set_data("shop.items", counted_rows(40));
  view->layout_frame();
  view->layout_frame();

  const LayoutNode &rows = rows_of(*view);
  const LayoutNode *first_row = &rows.children[0];
  view->pointer_down(first_row->rect.x + 5, first_row->rect.y + 5);
  view->pointer_up(first_row->rect.x + 5, first_row->rect.y + 5);
  view->drain_actions();
  CHECK(view->focus() != nullptr);
  CHECK(view->scroll_focused_by(0, 40));
  view->layout_frame();

  // Now scroll it clean out of the realized window.
  view->set_scroll("scroller", 0, 600);
  view->layout_frame();
  view->layout_frame();
  CHECK(view->focus() == nullptr);

  const LayoutNode *scroller = view->root().children.empty() ? nullptr : &view->root().children[0];
  CHECK(scroller != nullptr);
  if (scroller == nullptr) return;
  const double before = scroller->scroll_offset.y;
  CHECK(view->scroll_focused_by(0, 40));
  CHECK_NEAR(scroller->scroll_offset.y, before + 40.0, 1e-9);
}

TEST(view, a_recycled_instance_settles_on_its_new_item_in_the_very_first_frame) {
  // ZAB-66: the row is moving to another element, so a frame that showed the old
  // one's colours halfway to the new one's would describe neither. What settles
  // it is both halves at once — re-derive what data drives, and drop the tweens.
  const char *toggles = R"({"v":1,"views":{"list":{
    "type":"Container","children":[
      {"type":"Repeat","id":"rows","items":{"bind":"shop.items"},"as":"it","key":"id",
       "children":[
         {"type":"Toggle","id":"row","checked":{"bind":"it.on"},
          "transition":{"duration":200},
          "layout":{"width":40,"height":20},
          "children":[
            {"type":"Container","id":"on","layout":{"width":16,"height":16}},
            {"type":"Container","id":"off","layout":{"width":16,"height":16}}]}]}]}}})";
  Document document;
  document.load(toggles);
  View *view = document.view();
  view->set_size(200, 200);

  DataValue items = DataValue::array();
  for (const auto &[id, on] : std::vector<std::pair<const char *, bool>>{{"a", true},
                                                                        {"b", false}}) {
    DataValue row = DataValue::object();
    row.insert("id", DataValue::of_text(id));
    row.insert("on", DataValue::of_bool(on));
    items.push(std::move(row));
  }
  document.set_data("shop.items", std::move(items));
  view->layout_frame();

  const LayoutNode &rows = view->root().children[0];
  CHECK_NEAR(rows.children[0].checked_progress, 1.0, 1e-9);
  CHECK_NEAR(rows.children[1].checked_progress, 0.0, 1e-9);

  // Swap the two elements. Each instance travels with its key, so the node that
  // showed "a" is now at position 1 — and it must PAINT its state, not slide
  // towards it from the row it used to be.
  DataValue swapped = DataValue::array();
  for (const auto &[id, on] : std::vector<std::pair<const char *, bool>>{{"b", false},
                                                                        {"a", true}}) {
    DataValue row = DataValue::object();
    row.insert("id", DataValue::of_text(id));
    row.insert("on", DataValue::of_bool(on));
    swapped.push(std::move(row));
  }
  document.set_data("shop.items", std::move(swapped));
  view->set_now(16);
  view->layout_frame();
  CHECK_NEAR(rows.children[0].checked_progress, 0.0, 1e-9);
  CHECK_NEAR(rows.children[1].checked_progress, 1.0, 1e-9);
}

TEST(view, a_write_to_an_items_own_data_keeps_animating) {
  // The other side of the same rule: same identity, no reorder, so nothing was
  // recycled — a value that moves tweens, which is the model of F7 exactly.
  const char *toggles = R"({"v":1,"views":{"list":{
    "type":"Container","children":[
      {"type":"Repeat","id":"rows","items":{"bind":"shop.items"},"as":"it","key":"id",
       "children":[
         {"type":"Toggle","id":"row","checked":{"bind":"it.on"},
          "transition":{"duration":200},
          "layout":{"width":40,"height":20},
          "children":[
            {"type":"Container","id":"on","layout":{"width":16,"height":16}},
            {"type":"Container","id":"off","layout":{"width":16,"height":16}}]}]}]}}})";
  Document document;
  document.load(toggles);
  View *view = document.view();
  view->set_size(200, 200);

  DataValue items = DataValue::array();
  DataValue row = DataValue::object();
  row.insert("id", DataValue::of_text("a"));
  row.insert("on", DataValue::of_bool(false));
  items.push(std::move(row));
  document.set_data("shop.items", std::move(items));
  view->layout_frame();

  const LayoutNode &only = view->root().children[0].children[0];
  CHECK_NEAR(only.checked_progress, 0.0, 1e-9);

  document.set_data("shop.items.0.on", DataValue::of_bool(true));
  // The frame that notices the change is where the tween starts; the next one is
  // where it has run for a while.
  view->layout_frame();
  view->set_now(100);
  view->layout_frame();
  // Halfway through the duration, and therefore neither end of it.
  CHECK(only.checked_progress > 0.0);
  CHECK(only.checked_progress < 1.0);
}

TEST(view, a_nested_list_expands_in_the_same_sweep_and_reaches_the_outer_alias) {
  const char *nested = R"({"v":1,"views":{"list":{
    "type":"Container","children":[
      {"type":"Repeat","id":"cats","items":{"bind":"shop.cats"},"as":"cat","key":"id",
       "children":[
         {"type":"Container","id":"cat-row","children":[
           {"type":"Repeat","id":"items","items":{"bind":"cat.items"},"as":"it","key":"id",
            "children":[
              {"type":"Text","id":"label","text":{"bind":"it.name"}},
              {"type":"Text","id":"none","text":"none"}]}]},
         {"type":"Text","id":"no-cats","text":"no cats"}]}]}}})";
  Document document;
  document.load(nested);
  View *view = document.view();
  view->set_size(200, 200);

  const auto category = [](const char *id, const std::vector<const char *> &names) {
    DataValue cat = DataValue::object();
    cat.insert("id", DataValue::of_text(id));
    DataValue items = DataValue::array();
    for (const char *name : names) {
      DataValue item = DataValue::object();
      item.insert("id", DataValue::of_text(name));
      item.insert("name", DataValue::of_text(std::string(id) + "/" + name));
      items.push(std::move(item));
    }
    cat.insert("items", std::move(items));
    return cat;
  };
  DataValue cats = DataValue::array();
  cats.push(category("a", {"x"}));
  cats.push(category("b", {"y"}));
  document.set_data("shop.cats", std::move(cats));
  // ONE frame: expanding the outer list creates the instances the inner ones live
  // in, and the sweep reaches them right after because it walks the registry by
  // index while `expand` appends to it.
  view->layout_frame();

  const LayoutNode &cats_node = view->root().children[0];
  CHECK_EQ(cats_node.children.size(), 3u);  // two categories and the empty state
  const LayoutNode &first_inner = cats_node.children[0].children[0].children[0];
  CHECK_EQ(first_inner.text_content, std::string("a/x"));

  // Reordering the OUTER list moves one scope link, and the inner instances read
  // through it: a nested chain points AT that link rather than copying it.
  DataValue swapped = DataValue::array();
  swapped.push(category("b", {"y"}));
  swapped.push(category("a", {"x"}));
  document.set_data("shop.cats", std::move(swapped));
  view->layout_frame();
  const LayoutNode &moved_inner = cats_node.children[0].children[0].children[0];
  CHECK_EQ(moved_inner.text_content, std::string("b/y"));
}
