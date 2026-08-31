#include <cstddef>
#include <string>
#include <vector>

#include "assets.h"
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

  const std::vector<Batch> &batches = view->paint().batches();
  CHECK_EQ(batches.size(), 2u);
  // Two glyphs, and the alpha they carry is the subtree's.
  CHECK_EQ(batches[1].vertex_count(), 8u);
  if (batches[1].colors.size() >= 4) CHECK_NEAR(batches[1].colors[3], 0.5, 0.001);
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
  for (const Batch &batch : geometry.batches()) {
    if (batch.kind == TextureKind::Image && !batch.empty()) image_batches++;
  }
  CHECK_EQ(image_batches, 1);
}

TEST(view, an_undeclared_color_leaves_the_pixels_alone_and_a_declared_one_tints_them) {
  Document document = loaded(IMAGE_VIEW, 200, 200);
  const GeometryBuilder &geometry = document.view()->paint();
  const Batch *image = nullptr;
  for (const Batch &batch : geometry.batches()) {
    if (batch.kind == TextureKind::Image) image = &batch;
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