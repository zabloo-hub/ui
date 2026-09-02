// The overlay layer: what it contains and in what order, what a modal does to
// input and to focus, where an anchored box lands, and the two open states that
// are not `visible` — a popover's flag and a fading entry's presence.
//
// A port of `renderer-web/src/overlay.test.ts` and `overlays/layer.test.ts`. The
// reference's second suite runs against an `OverlayHost` seam; the core has no
// such seam (see `overlay_layer.h`), so the state half is driven through a real
// `View` built from a small envelope — which asserts the same rules against more
// of the machine, not less.

#include <string>
#include <vector>

#include "overlay.h"
#include "overlay_layer.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;

namespace {

/** The view rect every overlay in these fixtures is arranged against. */
constexpr double VIEW_W = 100.0;
constexpr double VIEW_H = 100.0;

Document loaded(const std::string &json, double width = VIEW_W, double height = VIEW_H) {
  Document document;
  document.load(json);
  if (document.view() != nullptr) {
    document.view()->set_size(width, height);
    document.view()->layout_frame();
  }
  return document;
}

/** One view around `body`, with no tokens — the shortest envelope that renders. */
std::string envelope(const std::string &body) {
  return R"({"v":1,"views":{"main":)" + body + "}}";
}

/** The ids of a layer, in order — what almost every ordering check compares. */
std::vector<std::string> ids_of(const std::vector<LayoutNode *> &nodes) {
  std::vector<std::string> out;
  out.reserve(nodes.size());
  for (const LayoutNode *node : nodes) out.push_back(node->ir->id);
  return out;
}

std::string join(const std::vector<std::string> &values) {
  std::string out;
  for (const std::string &value : values) {
    if (!out.empty()) out += ",";
    out += value;
  }
  return out;
}

/** The layer of a whole tree, collected the way a test holding only a tree can. */
std::vector<LayoutNode *> layer_of(LayoutNode &root, const Presence &present) {
  std::vector<LayoutNode *> overlays;
  overlays_of(root, overlays);
  return collect_layer(overlays, present);
}

std::vector<LayoutNode *> layer_of(LayoutNode &root) {
  const InLayoutPresence present;
  return layer_of(root, present);
}

/** A node by id, from anywhere in a tree. */
LayoutNode *find(LayoutNode &root, const std::string &id) {
  if (root.ir->id == id) return &root;
  for (LayoutNode &child : root.children) {
    LayoutNode *found = find(child, id);
    if (found != nullptr) return found;
  }
  return nullptr;
}

}  // namespace

// --- what the layer contains, and in what order ---------------------------

TEST(overlay, lifts_overlays_declared_anywhere_in_the_tree_into_one_layer) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Container","children":[{"type":"Overlay","id":"modal"}]},
    {"type":"Button","id":"buy"}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK_EQ(join(ids_of(layer_of(root))), std::string("modal"));
}

TEST(overlay, orders_by_z_breaking_ties_by_document_order) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"first"},
    {"type":"Overlay","id":"toast","z":10},
    {"type":"Overlay","id":"second"},
    {"type":"Overlay","id":"under","z":-1}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK_EQ(join(ids_of(layer_of(root))), std::string("under,first,second,toast"));
}

TEST(overlay, flattens_a_nested_overlay_into_the_same_layer) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"outer","children":[{"type":"Overlay","id":"inner","z":1}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK_EQ(join(ids_of(layer_of(root))), std::string("outer,inner"));
}

TEST(overlay, drops_overlays_under_something_hidden_nested_ones_included) {
  // A bound `visible` builds the subtree — a static `false` never builds at all —
  // so this is what a closed panel with an overlay inside really looks like.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Container","id":"panel","visible":{"bind":"ui.panel"},
     "children":[{"type":"Overlay","id":"inside-a-closed-panel"}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(layer_of(root).empty());

  document.set_data("ui.panel", DataValue::of_bool(true));
  document.view()->layout_frame();
  CHECK_EQ(join(ids_of(layer_of(root))), std::string("inside-a-closed-panel"));
}

TEST(overlay, drops_overlays_inside_a_section_the_parents_state_took_out_of_layout) {
  Document document = loaded(envelope(R"({"type":"Collapse","open":false,"children":[
    {"type":"Button","id":"header"},
    {"type":"Container","id":"body","children":[{"type":"Overlay","id":"in-content"}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(layer_of(root).empty());
}

TEST(overlay, orders_by_the_document_whatever_order_the_overlays_are_handed_in) {
  // The view does not hand these in tree order: it keeps the set as it builds and
  // releases nodes (ZAB-73). Document order is recovered from the tree itself.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"first"},
    {"type":"Container","children":[{"type":"Overlay","id":"nested"}]},
    {"type":"Overlay","id":"second"},
    {"type":"Overlay","id":"under","z":-1}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const std::vector<LayoutNode *> shuffled{find(root, "second"), find(root, "under"),
                                           find(root, "nested"), find(root, "first")};
  const InLayoutPresence present;
  CHECK_EQ(join(ids_of(collect_layer(shuffled, present))),
           std::string("under,first,nested,second"));
}

TEST(overlay, drops_an_overlay_whose_ancestors_are_gone_even_handed_in_directly) {
  Document document = loaded(envelope(R"({"type":"Collapse","open":false,"children":[
    {"type":"Button","id":"header"},
    {"type":"Container","id":"body","children":[{"type":"Overlay","id":"in-content"}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  // Handed in directly, so no walk ever passes the closed section: presence has to
  // be asked of the whole chain up to the root.
  const std::vector<LayoutNode *> direct{find(root, "in-content")};
  const InLayoutPresence present;
  CHECK(collect_layer(direct, present).empty());
}

// --- the IR defaults an overlay is read with -------------------------------

TEST(overlay, applies_the_ir_defaults_modal_order_zero_no_auto_close) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"plain"},
    {"type":"Overlay","id":"loud","modal":false,"z":10,"autoCloseMs":4000}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  LayoutNode &plain = *find(root, "plain");
  LayoutNode &loud = *find(root, "loud");

  CHECK(is_modal(plain));
  CHECK_EQ(plain.ir->z, 0.0);
  CHECK(!auto_close_ms(plain).has_value());

  CHECK(!is_modal(loud));
  CHECK_EQ(loud.ir->z, 10.0);
  CHECK_EQ(auto_close_ms(loud).value_or(0.0), 4000.0);
}

TEST(overlay, ignores_a_non_positive_auto_close_a_typo_is_not_close_immediately) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"zero","autoCloseMs":0},
    {"type":"Overlay","id":"negative","autoCloseMs":-1}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(!auto_close_ms(*find(root, "zero")).has_value());
  CHECK(!auto_close_ms(*find(root, "negative")).has_value());
}

TEST(overlay, is_not_modal_and_has_no_timeout_for_anything_that_is_not_an_overlay) {
  Document document = loaded(envelope(R"({"type":"Button","id":"b"})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(!is_modal(root));
  CHECK(!auto_close_ms(root).has_value());
  CHECK(!is_anchored(root));
}

TEST(overlay, reads_the_anchor_its_placement_and_its_trigger) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Button","id":"target"},
    {"type":"Overlay","id":"plain","anchor":{"id":"target"}},
    {"type":"Overlay","id":"tip","anchor":{"id":"target","at":"right","trigger":"hover"}},
    {"type":"Overlay","id":"menu","anchor":{"id":"target","trigger":"press"}},
    {"type":"Overlay","id":"future","anchor":{"id":"target","at":"diagonal","trigger":"blink"}},
    {"type":"Overlay","id":"nameless","anchor":{"at":"top"}}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());

  // The IR default is BELOW the anchor, shown by `visible` alone.
  CHECK(is_anchored(*find(root, "plain")));
  CHECK(find(root, "plain")->ir->anchor.at == AnchorAt::Bottom);
  CHECK(find(root, "plain")->ir->anchor.trigger == OverlayTrigger::Manual);

  CHECK(is_hover_triggered(*find(root, "tip")));
  CHECK(find(root, "tip")->ir->anchor.at == AnchorAt::Right);
  CHECK(is_press_triggered(*find(root, "menu")));

  // Read loosely, like the rest of the IR: a placement and a trigger this build
  // does not know fall back to the defaults, so newer content degrades to a
  // tooltip in the wrong-ish place — never to no tooltip at all.
  CHECK(is_anchored(*find(root, "future")));
  CHECK(find(root, "future")->ir->anchor.at == AnchorAt::Bottom);
  CHECK(!is_hover_triggered(*find(root, "future")));
  CHECK(!is_press_triggered(*find(root, "future")));

  // An `anchor` with no id anchors nothing.
  CHECK(!is_anchored(*find(root, "nameless")));
}

// --- anchored placement ----------------------------------------------------

namespace {

/** An anchor in the middle of the view, with room on every side. */
const Rect ANCHOR{40, 50, 20, 20};
const Size TIP{10, 6};
const Rect BOUNDS{0, 0, VIEW_W, VIEW_H};

Rect place(AnchorAt at, const Rect &target = ANCHOR, const Rect &bounds = BOUNDS) {
  return anchor_box(target, TIP, at, 4.0, bounds);
}

}  // namespace

TEST(overlay, puts_the_content_on_the_named_side_centered_on_the_anchors_span) {
  const Rect top = place(AnchorAt::Top);
  CHECK_NEAR(top.x, 45.0, 0.001);
  CHECK_NEAR(top.y, 40.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Bottom).y, 74.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Left).x, 26.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Left).y, 57.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Right).x, 64.0, 0.001);
}

TEST(overlay, reads_a_corner_as_the_same_side_flush_with_that_edge_of_the_anchor) {
  // `top-left` means ABOVE, flush with the anchor's left edge — a side plus an
  // alignment, never a diagonal.
  CHECK_NEAR(place(AnchorAt::TopLeft).x, 40.0, 0.001);
  CHECK_NEAR(place(AnchorAt::TopLeft).y, 40.0, 0.001);
  CHECK_NEAR(place(AnchorAt::TopRight).x, 50.0, 0.001);
  CHECK_NEAR(place(AnchorAt::BottomLeft).y, 74.0, 0.001);
  CHECK_NEAR(place(AnchorAt::BottomRight).x, 50.0, 0.001);
  CHECK_NEAR(place(AnchorAt::BottomRight).y, 74.0, 0.001);
}

TEST(overlay, centers_on_the_anchor_for_center_ignoring_the_offset) {
  CHECK_NEAR(place(AnchorAt::Center).x, 45.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Center).y, 57.0, 0.001);
}

TEST(overlay, flips_to_the_opposite_side_when_the_preferred_one_does_not_fit) {
  const Rect top{40, 0, 20, 20};
  CHECK_NEAR(place(AnchorAt::Top, top).y, 24.0, 0.001);
  // And the alignment survives the flip: a corner keeps its edge.
  CHECK_NEAR(place(AnchorAt::TopRight, top).x, 50.0, 0.001);
  CHECK_NEAR(place(AnchorAt::TopRight, top).y, 24.0, 0.001);
}

TEST(overlay, keeps_the_preferred_side_when_neither_fits_and_clamps_it_in) {
  const Rect tall{40, 0, 20, 100};
  CHECK_NEAR(place(AnchorAt::Top, tall).y, 0.0, 0.001);
}

TEST(overlay, slides_along_the_other_axis_instead_of_flipping) {
  // A bubble follows its word: flipping it sideways would move it away from what
  // it points at, so the cross axis only ever slides.
  const Rect edge{95, 50, 20, 20};
  CHECK_NEAR(place(AnchorAt::Top, edge).x, 90.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Top, edge).y, 40.0, 0.001);
}

TEST(overlay, clamps_against_the_bounds_it_is_given) {
  // The overlay's own padding IS that margin — `deflate` is what hands it in.
  const Rect inset = deflate(BOUNDS, 8.0);
  CHECK_NEAR(inset.x, 8.0, 0.001);
  CHECK_NEAR(inset.width, 84.0, 0.001);
  CHECK_NEAR(place(AnchorAt::Top, Rect{95, 50, 20, 20}, inset).x, 82.0, 0.001);
  // Neither side fits this one, so it clamps — to the inset, not to the view:
  // against the raw view rect it would sit at y = 0, flush with the screen.
  CHECK_NEAR(place(AnchorAt::Top, Rect{40, 9, 20, 88}, inset).y, 8.0, 0.001);
}

TEST(overlay, puts_content_wider_than_the_bounds_at_their_edge_instead_of_off_both) {
  const Rect huge = anchor_box(ANCHOR, Size{200, 6}, AnchorAt::Top, 4.0, BOUNDS);
  CHECK_NEAR(huge.x, 0.0, 0.001);
  CHECK_NEAR(huge.width, 200.0, 0.001);
}

// --- the enter/exit fade ---------------------------------------------------

namespace {

/** Linear, so every assertion below is the fraction of the duration, and no more. */
ResolvedTransition linear(double duration) {
  ResolvedTransition transition;
  transition.duration = duration;
  transition.easing = Easing::Linear;
  return transition;
}

}  // namespace

TEST(overlay, snaps_on_the_first_step_so_an_already_open_modal_does_not_fade_in) {
  NodeAnim anim;
  const ResolvedTransition fade = linear(100.0);
  CHECK_NEAR(step_presence(&anim, true, &fade, 0.0).value, 1.0, 0.001);
}

TEST(overlay, fades_in_when_it_enters_the_layer) {
  NodeAnim anim;
  const ResolvedTransition fade = linear(100.0);
  step_presence(&anim, false, &fade, 0.0);
  const SteppedValue started = step_presence(&anim, true, &fade, 0.0);
  CHECK_NEAR(started.value, 0.0, 0.001);
  CHECK(started.animating);
  CHECK_NEAR(step_presence(&anim, true, &fade, 50.0).value, 0.5, 0.001);
  CHECK_NEAR(step_presence(&anim, true, &fade, 100.0).value, 1.0, 0.001);
  CHECK(!step_presence(&anim, true, &fade, 100.0).animating);
}

TEST(overlay, keeps_painting_a_closed_overlay_for_one_transition) {
  // The exit outlives the `visible` that closed it — and what outlives it is
  // pixels, nothing else.
  NodeAnim anim;
  const ResolvedTransition fade = linear(100.0);
  step_presence(&anim, true, &fade, 0.0);
  CHECK_NEAR(step_presence(&anim, false, &fade, 0.0).value, 1.0, 0.001);
  CHECK_NEAR(step_presence(&anim, false, &fade, 40.0).value, 0.6, 0.001);
  CHECK_NEAR(step_presence(&anim, false, &fade, 100.0).value, 0.0, 0.001);
}

TEST(overlay, is_instant_without_a_transition_exactly_the_pre_f7_frame) {
  NodeAnim anim;
  step_presence(&anim, false, nullptr, 0.0);
  CHECK_NEAR(step_presence(&anim, true, nullptr, 0.0).value, 1.0, 0.001);
  CHECK_NEAR(step_presence(&anim, false, nullptr, 0.0).value, 0.0, 0.001);
}

TEST(overlay, reopening_mid_exit_leaves_from_the_opacity_on_screen) {
  // Over a FULL duration, which is the CSS interruption model of ZAB-33: "what
  // was left" gives unnaturally quick returns in the common case.
  NodeAnim anim;
  const ResolvedTransition fade = linear(100.0);
  step_presence(&anim, true, &fade, 0.0);
  step_presence(&anim, false, &fade, 0.0);
  CHECK_NEAR(step_presence(&anim, false, &fade, 50.0).value, 0.5, 0.001);
  step_presence(&anim, true, &fade, 50.0);
  CHECK_NEAR(step_presence(&anim, true, &fade, 100.0).value, 0.75, 0.001);
  CHECK_NEAR(step_presence(&anim, true, &fade, 150.0).value, 1.0, 0.001);
}

// --- the modal, the trap and what is within it -----------------------------

TEST(overlay, top_modal_is_the_highest_MODAL_not_the_highest_overlay) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"dialog","z":0},
    {"type":"Overlay","id":"toast","modal":false,"z":10}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const std::vector<LayoutNode *> layer = layer_of(root);
  CHECK_EQ(join(ids_of(layer)), std::string("dialog,toast"));
  CHECK(top_modal(layer) == find(root, "dialog"));
  CHECK(&focus_scope(root, layer) == find(root, "dialog"));
}

TEST(overlay, top_modal_is_the_last_one_opened_when_several_are_stacked) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"outer","children":[{"type":"Overlay","id":"inner"}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(top_modal(layer_of(root)) == find(root, "inner"));
}

TEST(overlay, there_is_no_modal_while_only_non_modal_overlays_are_up) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"toast","modal":false}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(top_modal(layer_of(root)) == nullptr);
  // Without one the scope is the whole view: a non-modal overlay never traps.
  CHECK(&focus_scope(root, layer_of(root)) == &root);
}

TEST(overlay, is_within_holds_for_the_node_itself_and_for_any_descendant) {
  Document document = loaded(envelope(R"({"type":"Container","id":"root","children":[
    {"type":"Overlay","id":"modal","children":[
      {"type":"Container","id":"panel","children":[{"type":"Button","id":"ok"}]}]},
    {"type":"Button","id":"outside"}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  LayoutNode &modal = *find(root, "modal");
  CHECK(is_within(modal, modal));
  CHECK(is_within(*find(root, "ok"), modal));
  CHECK(!is_within(*find(root, "outside"), modal));
  CHECK(is_within(*find(root, "outside"), root));
}

// --- input -----------------------------------------------------------------

namespace {

/** A modal with one button in it, over a button of the tree. */
const char *CAPTURE = R"({"type":"Container","children":[
  {"type":"Button","id":"below","layout":{"width":100,"height":100}},
  {"type":"Overlay","id":"modal","layout":{"justify":"start","align":"start"},"children":[
    {"type":"Button","id":"accept","layout":{"width":20,"height":20}}]}]})";

LayerHit hit_at(View &view, LayoutNode &root, double x, double y) {
  ClipArena arena;
  std::vector<LayoutNode *> overlays;
  overlays_of(root, overlays);
  const InLayoutPresence present;
  return resolve_hit(root, collect_layer(overlays, present), x, y, arena);
}

}  // namespace

TEST(overlay, goes_to_the_tree_while_the_layer_is_empty) {
  Document document = loaded(envelope(R"({"type":"Button","id":"only",
    "layout":{"width":100,"height":100}})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 50, 50);
  CHECK(hit.kind == LayerHit::Kind::Node);
  CHECK(hit.node == &root);
}

TEST(overlay, gives_the_event_to_a_modals_child_not_to_what_it_covers) {
  Document document = loaded(envelope(CAPTURE));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 10, 10);
  CHECK(hit.kind == LayerHit::Kind::Node);
  CHECK(hit.node == find(root, "accept"));
}

TEST(overlay, captures_for_a_modal_a_point_on_no_child_is_a_backdrop_tap) {
  // Never a fall-through: the button underneath must not see it.
  Document document = loaded(envelope(CAPTURE));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 80, 80);
  CHECK(hit.kind == LayerHit::Kind::Backdrop);
  CHECK(hit.node == find(root, "modal"));
}

TEST(overlay, hides_a_lower_overlays_children_behind_the_modal_above_them) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"lower","modal":false,"layout":{"justify":"start","align":"start"},
     "children":[{"type":"Button","id":"buried","layout":{"width":40,"height":40}}]},
    {"type":"Overlay","id":"modal","z":1}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 10, 10);
  CHECK(hit.kind == LayerHit::Kind::Backdrop);
  CHECK(hit.node == find(root, "modal"));
}

TEST(overlay, lets_input_through_a_non_modal_overlay_its_own_rect_is_inert) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Button","id":"below","layout":{"width":100,"height":100}},
    {"type":"Overlay","id":"toast","modal":false,"layout":{"justify":"start","align":"start"},
     "children":[{"type":"Button","id":"undo","layout":{"width":20,"height":20}}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  // Away from its child: straight through to the tree.
  LayerHit hit = hit_at(*document.view(), root, 80, 80);
  CHECK(hit.kind == LayerHit::Kind::Node);
  CHECK(hit.node == find(root, "below"));
  // On its child: its children still take their events.
  hit = hit_at(*document.view(), root, 10, 10);
  CHECK(hit.kind == LayerHit::Kind::Node);
  CHECK(hit.node == find(root, "undo"));
}

TEST(overlay, keeps_looking_below_a_non_modal_overlay_for_the_modal_underneath_it) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"modal","z":0},
    {"type":"Overlay","id":"toast","modal":false,"z":10}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 50, 50);
  CHECK(hit.kind == LayerHit::Kind::Backdrop);
  CHECK(hit.node == find(root, "modal"));
}

TEST(overlay, misses_when_the_point_is_outside_every_rect) {
  // The view's root always fills the viewport, so the miss is a point off it.
  Document document = loaded(envelope(R"({"type":"Button","id":"small",
    "layout":{"width":10,"height":10}})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(hit_at(*document.view(), root, 150, 150).kind == LayerHit::Kind::Miss);
}

TEST(overlay, skips_a_hover_triggered_overlay_so_a_hint_never_takes_the_pointer) {
  // Taking it would steal the hover from the very anchor holding the hint up, and
  // the two would flicker against each other.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Button","id":"below","layout":{"width":100,"height":100}},
    {"type":"Overlay","id":"tip","modal":true,
     "anchor":{"id":"below","at":"bottom","trigger":"hover"}}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 50, 50);
  CHECK(hit.kind == LayerHit::Kind::Node);
  CHECK(hit.node == find(root, "below"));
}

TEST(overlay, still_gives_a_manually_triggered_anchored_overlay_its_events) {
  // A popover is a surface, not a hint: it takes input like any other overlay,
  // which is what lets the player pick something inside it.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Button","id":"below","layout":{"width":100,"height":100}},
    {"type":"Overlay","id":"menu","modal":true,"anchor":{"id":"below","at":"bottom"}}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  const LayerHit hit = hit_at(*document.view(), root, 50, 50);
  CHECK(hit.kind == LayerHit::Kind::Backdrop);
  CHECK(hit.node == find(root, "menu"));
}

// --- an anchor that comes and goes -----------------------------------------

TEST(overlay, an_anchor_out_of_layout_is_not_on_screen) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Container","id":"panel","visible":{"bind":"ui.panel"},
     "children":[{"type":"Button","id":"target","layout":{"width":20,"height":20}}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  ClipArena arena;
  CHECK(!is_on_screen(*find(root, "target"), arena));

  document.set_data("ui.panel", DataValue::of_bool(true));
  document.view()->layout_frame();
  CHECK(is_on_screen(*find(root, "target"), arena));
}

TEST(overlay, an_anchor_scrolled_out_of_its_scroller_is_not_on_screen) {
  // A tooltip hanging over the edge of a list whose row has scrolled past is
  // pointing at nothing.
  // Wrapped, because the view's root is arranged into the whole viewport and a
  // scroller that fills the screen has nothing to scroll.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"ScrollView","id":"list","layout":{"height":40,"direction":"column"},
     "scrollbar":false,"children":[
      {"type":"Container","id":"first","layout":{"width":40,"height":40}},
      {"type":"Container","id":"second","layout":{"width":40,"height":40}},
      {"type":"Container","id":"third","layout":{"width":40,"height":40}}]}]})"));
  View &view = *document.view();
  LayoutNode &root = const_cast<LayoutNode &>(view.root());
  ClipArena arena;
  CHECK(is_on_screen(*find(root, "first"), arena));
  CHECK(!is_on_screen(*find(root, "third"), arena));

  view.set_scroll("list", 0, 80);
  view.layout_frame();
  CHECK(!is_on_screen(*find(root, "first"), arena));
  CHECK(is_on_screen(*find(root, "third"), arena));
}

// --- popovers --------------------------------------------------------------

namespace {

/** A trigger button and the menu of three options it anchors. */
const char *SELECT = R"({"type":"Container","layout":{"direction":"column"},"children":[
  {"type":"Button","id":"trigger","layout":{"width":60,"height":20}},
  {"type":"Overlay","id":"menu","modal":true,
   "anchor":{"id":"trigger","at":"bottom","trigger":"press"},
   "layout":{"justify":"start","align":"start"},"children":[
    {"type":"Container","id":"group","group":"exclusive-check","value":"b",
     "layout":{"direction":"column"},"onChange":"picked","children":[
      {"type":"Toggle","id":"opt-a","value":"a","layout":{"width":60,"height":16}},
      {"type":"Toggle","id":"opt-b","value":"b","layout":{"width":60,"height":16}},
      {"type":"Toggle","id":"opt-c","value":"c","layout":{"width":60,"height":16}}]}]}]})";

}  // namespace

TEST(overlay, opens_on_its_selection_so_a_long_list_lands_where_the_player_left_it) {
  Document document = loaded(envelope(SELECT));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(selected_option_in(*find(root, "menu")) == find(root, "opt-b"));
}

TEST(overlay, has_no_selection_to_open_on_when_the_group_holds_none) {
  Document document = loaded(envelope(R"({"type":"Overlay","id":"menu","children":[
    {"type":"Container","id":"group","group":"exclusive-check","children":[
      {"type":"Toggle","id":"opt-a","value":"a"},
      {"type":"Toggle","id":"opt-b","value":"b"}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  CHECK(selected_option_in(root) == nullptr);
}

TEST(overlay, reads_the_outer_groups_selection_not_a_nested_groups_own) {
  // Descending stops at each group: a nested one belongs to that group's options,
  // and the popover closes on ITS selection, not on its children's.
  Document document = loaded(envelope(R"({"type":"Overlay","id":"menu","children":[
    {"type":"Container","id":"outer","group":"exclusive-check","value":"x","children":[
      {"type":"Toggle","id":"outer-x","value":"x"},
      {"type":"Container","id":"inner","group":"exclusive-check","value":"y","children":[
        {"type":"Toggle","id":"inner-y","value":"y"}]}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  std::vector<LayoutNode *> groups;
  check_groups_in(root, groups);
  CHECK_EQ(groups.size(), 1u);
  CHECK(selected_option_in(root) == find(root, "outer-x"));
}

// --- the layer's state, frame to frame -------------------------------------
//
// The reference drives these against a fake `OverlayHost`; the core has no such
// seam, so they run against a real `View` — which asserts the same rules against
// more of the machine, not less.

namespace {

/** A modal bound to `ui.open`, over a button of the tree that starts focused. */
const char *MODAL = R"({"v":1,"views":{"main":{"type":"Container","children":[
  {"type":"Button","id":"open","autofocus":true,"layout":{"width":40,"height":20}},
  {"type":"Overlay","id":"modal","visible":{"bind":"ui.open"},"onDismiss":"closed",
   "layout":{"justify":"start","align":"start"},"children":[
    {"type":"Button","id":"accept","autofocus":true,"layout":{"width":20,"height":20}}]}]}}})";

/** Opens or closes a bound flag and settles the frame it changes. */
void flip(Document &document, const char *path, bool value) {
  document.set_data(path, DataValue::of_bool(value));
  document.view()->layout_frame();
}

std::string focus_id(const View &view) {
  return view.focus() != nullptr ? view.focus()->ir->id : std::string("(none)");
}

}  // namespace

TEST(overlay, a_modal_hands_the_focus_to_its_autofocus_and_remembers_what_it_interrupted) {
  Document document = loaded(MODAL);
  View &view = *document.view();
  CHECK_EQ(focus_id(view), std::string("open"));

  flip(document, "ui.open", true);
  CHECK_EQ(focus_id(view), std::string("accept"));

  // And gives it back when it closes.
  flip(document, "ui.open", false);
  CHECK_EQ(focus_id(view), std::string("open"));
}

TEST(overlay, a_closing_stack_returns_to_what_preceded_all_of_it) {
  Document document = loaded(R"({"v":1,"views":{"main":{"type":"Container","children":[
    {"type":"Button","id":"open","autofocus":true,"layout":{"width":40,"height":20}},
    {"type":"Overlay","id":"outer","visible":{"bind":"ui.outer"},
     "layout":{"justify":"start","align":"start"},"children":[
      {"type":"Button","id":"outer-ok","autofocus":true,"layout":{"width":20,"height":20}},
      {"type":"Overlay","id":"inner","visible":{"bind":"ui.inner"},
       "layout":{"justify":"start","align":"start"},"children":[
        {"type":"Button","id":"inner-ok","autofocus":true,"layout":{"width":20,"height":20}}]}]}]}}})");
  View &view = *document.view();
  flip(document, "ui.outer", true);
  CHECK_EQ(focus_id(view), std::string("outer-ok"));
  flip(document, "ui.inner", true);
  CHECK_EQ(focus_id(view), std::string("inner-ok"));

  // Both at once: the OUTERMOST one that left owns the restore.
  document.set_data("ui.outer", DataValue::of_bool(false));
  document.set_data("ui.inner", DataValue::of_bool(false));
  view.layout_frame();
  CHECK_EQ(focus_id(view), std::string("open"));
}

TEST(overlay, a_modal_confines_the_navigation_to_its_own_subtree) {
  Document document = loaded(MODAL);
  View &view = *document.view();
  flip(document, "ui.open", true);
  CHECK_EQ(focus_id(view), std::string("accept"));
  // The button underneath is a candidate no arrow can reach: the trap derives
  // from `modal`, with no field of its own.
  CHECK(!view.move_focus(0, -1));
  CHECK(!view.move_focus(0, 1));
  CHECK_EQ(focus_id(view), std::string("accept"));
}

TEST(overlay, a_dismiss_writes_false_into_the_bound_visible_and_fires_on_dismiss) {
  Document document = loaded(MODAL);
  View &view = *document.view();
  flip(document, "ui.open", true);
  view.drain_data_changes();

  CHECK(view.dismiss_top_modal());
  const std::vector<DataChange> changes = view.drain_data_changes();
  CHECK_EQ(changes.size(), 1u);
  if (!changes.empty()) {
    CHECK_EQ(changes[0].path, std::string("ui.open"));
    CHECK(changes[0].value.kind == DataValue::Kind::Bool);
    CHECK(!changes[0].value.boolean);
  }
  const std::vector<ActionEvent> actions = view.drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("closed"));

  view.layout_frame();
  CHECK_EQ(focus_id(view), std::string("open"));
  // Nothing is up any more, so there is nothing left to dismiss.
  CHECK(!view.dismiss_top_modal());
}

TEST(overlay, a_tap_on_the_backdrop_dismisses_and_never_falls_through) {
  Document document = loaded(MODAL);
  View &view = *document.view();
  flip(document, "ui.open", true);
  view.drain_actions();

  // Away from the panel, which sits at the top-left corner.
  CHECK(view.pointer_down(80, 80));
  CHECK(view.drain_actions().empty());  // dismissed on release, like a button
  CHECK(view.pointer_up(80, 80));
  const std::vector<ActionEvent> actions = view.drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("closed"));
  // The button underneath never saw it.
  CHECK(view.pressed() == nullptr);
}

TEST(overlay, a_backdrop_press_that_never_concludes_dismisses_nothing) {
  Document document = loaded(MODAL);
  View &view = *document.view();
  flip(document, "ui.open", true);
  view.drain_actions();

  CHECK(view.pointer_down(80, 80));
  CHECK(view.pointer_cancel());
  CHECK(view.drain_actions().empty());
  view.layout_frame();
  CHECK_EQ(focus_id(view), std::string("accept"));  // still up
}

TEST(overlay, autoCloseMs_dismisses_on_the_injected_clock_and_disarms_when_it_leaves) {
  Document document = loaded(R"({"v":1,"views":{"main":{"type":"Container","children":[
    {"type":"Overlay","id":"toast","modal":false,"visible":{"bind":"ui.toast"},
     "autoCloseMs":3000,"onDismiss":"gone"}]}}})");
  View &view = *document.view();
  flip(document, "ui.toast", true);
  // An armed timeout is something that will change with no further input, so the
  // adapter has to keep asking for frames.
  CHECK(view.animating());

  view.set_now(2999);
  view.layout_frame();
  CHECK(view.drain_actions().empty());

  view.set_now(3000);
  view.layout_frame();
  const std::vector<ActionEvent> actions = view.drain_actions();
  CHECK_EQ(actions.size(), 1u);
  if (!actions.empty()) CHECK_EQ(actions[0].name, std::string("gone"));
  // It wrote its own `visible` too, so the next frame has nothing armed.
  view.layout_frame();
  CHECK(!view.animating());
}

TEST(overlay, autoCloseMs_arms_once_not_once_per_frame) {
  Document document = loaded(R"({"v":1,"views":{"main":{"type":"Container","children":[
    {"type":"Overlay","id":"toast","modal":false,"visible":{"bind":"ui.toast"},
     "autoCloseMs":1000,"onDismiss":"gone"}]}}})");
  View &view = *document.view();
  flip(document, "ui.toast", true);
  // Re-arming on every frame would keep pushing the deadline forward and the
  // toast would never close.
  for (double t = 100; t < 1000; t += 100) {
    view.set_now(t);
    view.layout_frame();
  }
  view.set_now(1000);
  view.layout_frame();
  CHECK_EQ(view.drain_actions().size(), 1u);
}

TEST(overlay, a_toast_closed_before_its_time_never_fires_late) {
  Document document = loaded(R"({"v":1,"views":{"main":{"type":"Container","children":[
    {"type":"Overlay","id":"toast","modal":false,"visible":{"bind":"ui.toast"},
     "autoCloseMs":1000,"onDismiss":"gone"}]}}})");
  View &view = *document.view();
  flip(document, "ui.toast", true);
  flip(document, "ui.toast", false);
  view.drain_actions();
  view.set_now(5000);
  view.layout_frame();
  CHECK(view.drain_actions().empty());
}

TEST(overlay, an_entry_that_leaves_the_layer_paints_out_its_fade_and_takes_no_input) {
  Document document = loaded(R"({"v":1,"views":{"main":{"type":"Container","children":[
    {"type":"Button","id":"below","autofocus":true,"layout":{"width":100,"height":100}},
    {"type":"Overlay","id":"modal","visible":{"bind":"ui.open"},
     "transition":{"duration":100,"easing":"linear"},
     "style":{"background":"#00000099"}}]}}})");
  View &view = *document.view();
  LayoutNode &modal = *find(const_cast<LayoutNode &>(view.root()), "modal");
  // It fades IN: hidden at mount means it sits at 0, so opening it is a change to
  // animate from rather than the snap a first observation would give.
  flip(document, "ui.open", true);
  CHECK_NEAR(modal.presence, 0.0, 0.001);
  view.set_now(100);
  view.layout_frame();
  CHECK_NEAR(modal.presence, 1.0, 0.001);

  document.set_data("ui.open", DataValue::of_bool(false));
  view.layout_frame();
  CHECK(modal.presence_exiting);
  CHECK_NEAR(modal.presence, 1.0, 0.001);  // the exit outlives its `visible`
  CHECK_EQ(view.paint_layer().size(), 1u);  // still painted
  // But it is out of the LIVE layer, so the button underneath answers again.
  CHECK(view.pointer_down(50, 50));
  CHECK(view.pressed() == find(const_cast<LayoutNode &>(view.root()), "below"));
  view.pointer_up(50, 50);

  // The exit started at 100 and lasts one duration, so this is where it lands.
  view.set_now(200);
  view.layout_frame();
  CHECK(!modal.presence_exiting);
  CHECK(view.paint_layer().empty());
}

// --- popovers, driven through the view -------------------------------------

TEST(overlay, pressing_the_anchor_toggles_its_popover_without_eating_its_action) {
  Document document = loaded(envelope(SELECT));
  View &view = *document.view();
  LayoutNode &root = const_cast<LayoutNode &>(view.root());
  LayoutNode &menu = *find(root, "menu");
  CHECK(!menu.popover_open);

  // A `<Select>` trigger is an ordinary Button that happens to be an anchor.
  view.pointer_down(10, 10);
  view.pointer_up(10, 10);
  view.layout_frame();
  CHECK(menu.popover_open);
  CHECK_EQ(view.paint_layer().size(), 1u);
  // It opens ON its selection, and the focus goes there.
  CHECK_EQ(focus_id(view), std::string("opt-b"));

  // The same press closes it.
  view.pointer_down(10, 10);
  view.pointer_up(10, 10);
  view.layout_frame();
  CHECK(!menu.popover_open);
  CHECK(view.paint_layer().empty());
}

TEST(overlay, a_closed_popover_offers_none_of_its_options_to_the_navigation) {
  // Its subtree stays `in_layout` — the open flag lives on the overlay, not on
  // the layout flags — so the layer is what has to prune it.
  Document document = loaded(envelope(SELECT));
  View &view = *document.view();
  view.move_focus(0, 1);
  CHECK_EQ(focus_id(view), std::string("trigger"));
  CHECK(!view.move_focus(0, 1));
}

TEST(overlay, choosing_an_option_closes_the_popover_it_was_chosen_in) {
  Document document = loaded(envelope(SELECT));
  View &view = *document.view();
  LayoutNode &root = const_cast<LayoutNode &>(view.root());
  LayoutNode &menu = *find(root, "menu");
  view.pointer_down(10, 10);
  view.pointer_up(10, 10);
  view.layout_frame();
  CHECK(menu.popover_open);

  // The third option, in the menu the trigger opened below itself.
  LayoutNode &option = *find(root, "opt-c");
  const double x = option.rect.x + 2;
  const double y = option.rect.y + 2;
  view.pointer_down(x, y);
  view.pointer_up(x, y);
  view.layout_frame();
  CHECK(!menu.popover_open);
  CHECK(find(root, "opt-c")->checked);
}

TEST(overlay, re_picking_the_option_already_selected_still_closes_the_menu) {
  // A dropdown that stayed open on "I meant this one" would be a dead end.
  Document document = loaded(envelope(SELECT));
  View &view = *document.view();
  LayoutNode &root = const_cast<LayoutNode &>(view.root());
  LayoutNode &menu = *find(root, "menu");
  view.pointer_down(10, 10);
  view.pointer_up(10, 10);
  view.layout_frame();
  view.drain_actions();

  LayoutNode &option = *find(root, "opt-b");
  const double x = option.rect.x + 2;
  const double y = option.rect.y + 2;
  view.pointer_down(x, y);
  view.pointer_up(x, y);
  view.layout_frame();
  CHECK(!menu.popover_open);
  // Nothing moved, so nothing is reported — the menu closing is the popover's
  // rule, not the group's.
  CHECK(view.drain_actions().empty());
}

TEST(overlay, a_dismiss_closes_a_popover_with_its_flag_and_not_with_a_data_write) {
  // `visible` never held it open in the first place: the open state is the core's.
  Document document = loaded(envelope(SELECT));
  View &view = *document.view();
  LayoutNode &menu = *find(const_cast<LayoutNode &>(view.root()), "menu");
  view.pointer_down(10, 10);
  view.pointer_up(10, 10);
  view.layout_frame();
  view.drain_data_changes();

  CHECK(view.dismiss_top_modal());
  CHECK(!menu.popover_open);
  CHECK(view.drain_data_changes().empty());
}

TEST(overlay, a_hover_triggered_overlay_shows_only_while_its_anchor_is_lit) {
  // Hover OR focus: the equivalent on a pad IS the focus, so the hint reaches a
  // gamepad with no second mechanism.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Button","id":"help","layout":{"width":40,"height":20}},
    {"type":"Overlay","id":"tip","modal":false,
     "anchor":{"id":"help","at":"bottom","trigger":"hover"}}]})"));
  View &view = *document.view();
  view.layout_frame();
  CHECK(view.paint_layer().empty());

  view.pointer_move(10, 10);
  view.layout_frame();
  CHECK_EQ(view.paint_layer().size(), 1u);

  view.pointer_move(90, 90);
  view.layout_frame();
  CHECK(view.paint_layer().empty());

  // The focus lights it up just the same, with the pointer nowhere near.
  view.move_focus(0, 1);
  view.layout_frame();
  CHECK_EQ(view.paint_layer().size(), 1u);
}

TEST(overlay, an_anchored_overlay_leaves_the_layer_when_its_anchor_does) {
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Container","id":"panel","visible":{"bind":"ui.panel"},"children":[
      {"type":"Button","id":"help","layout":{"width":40,"height":20}}]},
    {"type":"Overlay","id":"tip","modal":false,"anchor":{"id":"help","at":"bottom"}}]})"));
  View &view = *document.view();
  CHECK(view.paint_layer().empty());
  flip(document, "ui.panel", true);
  CHECK_EQ(view.paint_layer().size(), 1u);
  flip(document, "ui.panel", false);
  CHECK(view.paint_layer().empty());
}

TEST(overlay, an_anchor_that_resolves_to_nothing_degrades_to_the_layer_placement) {
  // The load pass already named the typo once; the overlay still shows, where its
  // own `justify`/`align` put it.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"tip","modal":false,"anchor":{"id":"nowhere","at":"bottom"},
     "layout":{"justify":"end","align":"end"},"children":[
      {"type":"Container","id":"bubble","layout":{"width":20,"height":10}}]}]})"));
  View &view = *document.view();
  CHECK_EQ(view.paint_layer().size(), 1u);
  LayoutNode &bubble = *find(const_cast<LayoutNode &>(view.root()), "bubble");
  CHECK_NEAR(bubble.rect.x, VIEW_W - 20, 0.001);
  CHECK_NEAR(bubble.rect.y, VIEW_H - 10, 0.001);
}

TEST(overlay, an_anchored_modal_keeps_the_whole_screen_while_its_panel_hangs_off_a_button) {
  Document document = loaded(envelope(SELECT));
  View &view = *document.view();
  LayoutNode &root = const_cast<LayoutNode &>(view.root());
  view.pointer_down(10, 10);
  view.pointer_up(10, 10);
  view.layout_frame();

  // The entry's own rect is still the view's — that is what keeps the backdrop
  // and the capture over everything.
  LayoutNode &menu = *find(root, "menu");
  CHECK_NEAR(menu.rect.width, VIEW_W, 0.001);
  CHECK_NEAR(menu.rect.height, VIEW_H, 0.001);
  // While the content sits just below the trigger.
  LayoutNode &group = *find(root, "group");
  CHECK_NEAR(group.rect.y, find(root, "trigger")->rect.y + 20 + ANCHOR_OFFSET, 0.001);
}

TEST(overlay, the_frame_a_timeout_fires_on_asks_for_one_more) {
  // The dismiss writes `visible` mid-frame, AFTER the layer was collected, so the
  // toast is still on screen when this frame ends. Without another frame the
  // adapter would stop processing and it would stay there for good — which is what
  // the reference's `render()` inside `requestDismiss` is for.
  Document document = loaded(R"({"v":1,"views":{"main":{"type":"Container","children":[
    {"type":"Overlay","id":"toast","modal":false,"visible":{"bind":"ui.toast"},
     "autoCloseMs":1000}]}}})");
  View &view = *document.view();
  flip(document, "ui.toast", true);

  view.set_now(1000);
  view.layout_frame();
  CHECK_EQ(view.paint_layer().size(), 1u);  // still up this frame
  CHECK(view.animating());                  // so it must ask for the next one

  view.layout_frame();
  CHECK(view.paint_layer().empty());
  CHECK(!view.animating());
}

TEST(overlay, a_non_modal_overlay_never_traps_and_its_children_navigate_normally) {
  // Declared in place, so its Button joins the walk like any other node.
  Document document = loaded(envelope(R"({"type":"Container","layout":{"direction":"column"},
    "children":[
      {"type":"Button","id":"first","autofocus":true,"layout":{"width":40,"height":20}},
      {"type":"Button","id":"second","layout":{"width":40,"height":20}},
      {"type":"Overlay","id":"toast","modal":false,
       "layout":{"justify":"end","align":"end"},"children":[
        {"type":"Button","id":"undo","layout":{"width":40,"height":20}}]}]})"));
  View &view = *document.view();
  CHECK_EQ(focus_id(view), std::string("first"));
  CHECK(view.move_focus(0, 1));
  CHECK_EQ(focus_id(view), std::string("second"));
  CHECK(view.move_focus(0, 1));
  CHECK_EQ(focus_id(view), std::string("undo"));
}

TEST(overlay, a_layer_is_not_sized_so_an_overlays_own_width_and_height_are_ignored) {
  // Size the child instead: the entry's rect is the view's, anchored or not.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"Overlay","id":"panel","layout":{"width":10,"height":10}},
    {"type":"Button","id":"target","layout":{"width":20,"height":20}},
    {"type":"Overlay","id":"tip","layout":{"width":10,"height":10},
     "anchor":{"id":"target","at":"bottom"},"children":[
      {"type":"Container","id":"bubble","layout":{"width":30,"height":8}}]}]})"));
  LayoutNode &root = const_cast<LayoutNode &>(document.view()->root());
  LayoutNode &panel = *find(root, "panel");
  CHECK_NEAR(panel.rect.width, VIEW_W, 0.001);
  CHECK_NEAR(panel.rect.height, VIEW_H, 0.001);
  LayoutNode &tip = *find(root, "tip");
  CHECK_NEAR(tip.rect.width, VIEW_W, 0.001);
  // And the anchored content is sized from what it ASKED for, not from the 10×10
  // the entry declared: the bubble keeps its own 30×8.
  LayoutNode &bubble = *find(root, "bubble");
  CHECK_NEAR(bubble.rect.width, 30.0, 0.001);
  CHECK_NEAR(bubble.rect.height, 8.0, 0.001);
}

TEST(overlay, an_anchored_overlay_survives_a_long_run_of_frames) {
  // Two hundred frames of the clipped-anchor path, which is the one that resolves
  // regions every frame. It does not measure the arena — nothing exposes its size
  // — so what it guards is that the path stays correct under repetition; the bound
  // itself is the `reset()` in `anchor_allows` and the reason written beside it.
  Document document = loaded(envelope(R"({"type":"Container","children":[
    {"type":"ScrollView","id":"list","layout":{"height":40},"children":[
      {"type":"Button","id":"target","layout":{"width":20,"height":20}}]},
    {"type":"Overlay","id":"tip","modal":false,"anchor":{"id":"target","at":"right"}}]})"));
  View &view = *document.view();
  for (int frame = 0; frame < 200; frame++) {
    view.set_now(frame * 16.0);
    view.layout_frame();
  }
  CHECK_EQ(view.paint_layer().size(), 1u);
}
