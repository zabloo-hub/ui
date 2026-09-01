// Clipping: the region a subtree is cut to, and who can be touched through it.
//
// `clip` cuts paint AND input (2026-08-11), so these rules are the ones that keep
// the two from disagreeing — a button scrolled out of its viewport must be as
// unreachable as it is invisible. Both halves are arithmetic over rects, and the
// corpus compares the regions node by node, so a target that intersected them
// differently would answer the same envelope with a different `clip`.

#include <string>
#include <vector>

#include "clip.h"
#include "hit.h"
#include "testing.h"

using namespace zabloo;

namespace {

constexpr Rect RECT{100, 100, 200, 200};

Clip region(double x, double y, double w, double h, double radius = 0.0) {
  return Clip{x, y, w, h, radius};
}

/** A node of a hand-built IR tree: no envelope, no view, no engine. */
Node ir_node(NodeType type, const std::string &id = std::string()) {
  Node node;
  node.type = type;
  node.id = id;
  return node;
}

/** Lays a runtime tree out by hand — the arrange pass's output without running it. */
void place(LayoutNode &node, const Rect &rect, double radius = 0.0) {
  node.rect = rect;
  node.measured = Size{rect.width, rect.height};
  node.resolved.radius = radius;
}

/**
 * A 200×200 viewport at the origin holding two 100-tall rows, the second of them
 * half outside it — the shape every scroll question below is asked against.
 */
struct ScrollTree {
  Node ir;
  LayoutNode tree;

  explicit ScrollTree(double scrolled = 0.0, bool clipping = true, double radius = 0.0) {
    ir = ir_node(NodeType::Container);
    Node scroller = ir_node(clipping ? NodeType::ScrollView : NodeType::Container);
    scroller.children.push_back(ir_node(NodeType::Container, "visible"));
    scroller.children.push_back(ir_node(NodeType::Button, "overflowing"));
    ir.children.push_back(std::move(scroller));

    build_layout_tree(ir, tree);
    place(tree, Rect{0, 0, 400, 400});
    place(tree.children[0], Rect{0, 0, 200, 200}, radius);
    place(tree.children[0].children[0], Rect{0, 0 - scrolled, 200, 100});
    place(tree.children[0].children[1], Rect{0, 150 - scrolled, 200, 100});
  }

  LayoutNode &scroller() { return tree.children[0]; }
};

std::string hit_id(LayoutNode &root, double x, double y) {
  ClipArena arena;
  const LayoutNode *found = hit_test(root, x, y, arena);
  return found == nullptr ? "<none>" : found->ir->id;
}

}  // namespace

// --- intersect_clip -------------------------------------------------------

TEST(clip, an_uninherited_region_is_the_rect_itself) {
  const Clip clip = intersect_clip(nullptr, RECT, 8);
  CHECK_NEAR(clip.x, 100.0, 0.001);
  CHECK_NEAR(clip.y, 100.0, 0.001);
  CHECK_NEAR(clip.width, 200.0, 0.001);
  CHECK_NEAR(clip.height, 200.0, 0.001);
  CHECK_NEAR(clip.radius, 8.0, 0.001);
}

TEST(clip, a_region_is_the_intersection_of_every_clipping_ancestor) {
  const Clip inherited = region(0, 150, 200, 200);
  const Clip clip = intersect_clip(&inherited, RECT, 0);
  CHECK_NEAR(clip.x, 100.0, 0.001);
  CHECK_NEAR(clip.y, 150.0, 0.001);
  CHECK_NEAR(clip.width, 100.0, 0.001);
  CHECK_NEAR(clip.height, 150.0, 0.001);
}

TEST(clip, the_radius_is_capped_to_the_half_extents_like_the_tessellator) {
  CHECK_NEAR(intersect_clip(nullptr, Rect{0, 0, 40, 10}, 999).radius, 5.0, 0.001);
  CHECK_NEAR(intersect_clip(nullptr, RECT, -4).radius, 0.0, 0.001);
}

TEST(clip, the_innermost_rounded_clip_wins_and_a_square_child_keeps_it) {
  const Clip rounded = region(100, 100, 200, 200, 12);
  // A square inner clip does not drop the ancestor's corners…
  CHECK_NEAR(intersect_clip(&rounded, RECT, 0).radius, 12.0, 0.001);
  // …and a rounded one replaces them with its own.
  CHECK_NEAR(intersect_clip(&rounded, RECT, 4).radius, 4.0, 0.001);
}

TEST(clip, disjoint_regions_collapse_to_nothing_visible) {
  const Clip elsewhere = region(0, 0, 50, 50);
  const Clip empty = intersect_clip(&elsewhere, RECT, 0);
  CHECK(is_empty_clip(&empty));
  const Clip full = intersect_clip(nullptr, RECT, 0);
  CHECK(!is_empty_clip(&full));
  // No region at all is not an empty one: everything is visible.
  CHECK(!is_empty_clip(nullptr));
}

// --- clip_contains --------------------------------------------------------

TEST(clip, without_a_region_every_point_is_visible) {
  CHECK(clip_contains(nullptr, -1000, 1000));
}

TEST(clip, a_square_region_accepts_its_own_edges_and_nothing_past_them) {
  const Clip square = region(100, 100, 200, 200);
  CHECK(clip_contains(&square, 200, 200));
  CHECK(clip_contains(&square, 100, 300));
  CHECK(!clip_contains(&square, 99, 200));
  CHECK(!clip_contains(&square, 200, 301));
}

TEST(clip, a_rounded_region_cuts_its_corners_and_keeps_its_straight_edges) {
  const Clip rounded = region(100, 100, 200, 200, 40);
  // (105, 105) is inside the rect but outside the arc: 35 on each axis, and
  // hypot(35, 35) ≈ 49.5 > 40.
  CHECK(!clip_contains(&rounded, 105, 105));
  CHECK(clip_contains(&rounded, 132, 132));
  CHECK(clip_contains(&rounded, 100, 200));
}

// --- hit_test -------------------------------------------------------------

TEST(hit, the_deepest_node_under_the_point_answers) {
  ScrollTree fixture;
  CHECK_EQ(hit_id(fixture.tree, 50, 50), std::string("visible"));
}

TEST(hit, a_child_overflowing_its_viewport_is_as_unreachable_as_it_is_invisible) {
  ScrollTree fixture;
  ClipArena arena;
  // y = 220 lands inside the overflowing row (150..250) and outside the scroller,
  // so the walk stops there and the root answers for itself.
  const LayoutNode *found = hit_test(fixture.tree, 50, 220, arena);
  CHECK(found == &fixture.tree);
}

TEST(hit, scrolling_a_child_into_the_viewport_makes_it_reachable) {
  ScrollTree fixture(100);
  // The same row now sits at 50..150 in view space.
  CHECK_EQ(hit_id(fixture.tree, 50, 100), std::string("overflowing"));
}

TEST(hit, later_siblings_win_because_they_paint_last) {
  Node ir = ir_node(NodeType::Container);
  ir.children.push_back(ir_node(NodeType::Container, "first"));
  ir.children.push_back(ir_node(NodeType::Container, "second"));
  LayoutNode tree;
  build_layout_tree(ir, tree);
  place(tree, Rect{0, 0, 100, 100});
  place(tree.children[0], Rect{0, 0, 100, 100});
  place(tree.children[1], Rect{0, 0, 100, 100});

  CHECK_EQ(hit_id(tree, 50, 50), std::string("second"));
}

TEST(hit, an_overlay_subtree_never_answers_because_it_belongs_to_the_layer) {
  Node ir = ir_node(NodeType::Container);
  Node overlay = ir_node(NodeType::Overlay, "confirm");
  overlay.children.push_back(ir_node(NodeType::Button, "ok"));
  ir.children.push_back(std::move(overlay));
  LayoutNode tree;
  build_layout_tree(ir, tree);
  place(tree, Rect{0, 0, 400, 400});
  place(tree.children[0], Rect{0, 0, 200, 200});
  place(tree.children[0].children[0], Rect{0, 0, 200, 200});

  ClipArena arena;
  CHECK(hit_test(tree, 50, 50, arena) == &tree);
}

TEST(hit, a_node_out_of_layout_takes_no_input_either) {
  ScrollTree fixture;
  fixture.scroller().children[0].visible_flag = false;
  ClipArena arena;
  const LayoutNode *found = hit_test(fixture.tree, 50, 50, arena);
  CHECK(found == &fixture.scroller());
}

TEST(hit, an_overflowing_child_of_an_UNCLIPPED_parent_is_reachable) {
  // The other half of the same rule: only a clip cuts input, exactly as only a
  // clip cuts paint. Bailing out on the parent's rect instead — what this did
  // before ZAB-7 — left a child that IS painted unable to be pressed.
  Node ir = ir_node(NodeType::Container);
  Node card = ir_node(NodeType::Container);
  card.children.push_back(ir_node(NodeType::Button, "tall"));
  ir.children.push_back(std::move(card));
  LayoutNode tree;
  build_layout_tree(ir, tree);
  place(tree, Rect{0, 0, 400, 400});
  place(tree.children[0], Rect{0, 0, 200, 100});
  place(tree.children[0].children[0], Rect{0, 0, 200, 300});

  CHECK_EQ(hit_id(tree, 50, 200), std::string("tall"));
}

TEST(hit, clip_true_cuts_without_a_ScrollView_and_nothing_cuts_without_it) {
  Node ir = ir_node(NodeType::Container);
  Node card = ir_node(NodeType::Container);
  card.clip = true;
  card.children.push_back(ir_node(NodeType::Button, "overflowing"));
  ir.children.push_back(std::move(card));
  LayoutNode tree;
  build_layout_tree(ir, tree);
  place(tree, Rect{0, 0, 400, 400});
  place(tree.children[0], Rect{0, 0, 200, 100});
  place(tree.children[0].children[0], Rect{0, 0, 200, 300});

  CHECK_EQ(hit_id(tree, 50, 200), std::string(""));
  // The same tree with the flag off reaches the child that overflows it.
  ir.children[0].clip = false;
  CHECK_EQ(hit_id(tree, 50, 200), std::string("overflowing"));
}

TEST(hit, the_rounded_corner_of_a_viewport_is_cut_from_the_input_too) {
  ScrollTree rounded(0, true, 40);
  CHECK_EQ(hit_id(rounded.tree, 5, 5), std::string(""));
  ScrollTree square;
  CHECK_EQ(hit_id(square.tree, 5, 5), std::string("visible"));
}

// --- effective_clip -------------------------------------------------------

TEST(hit, a_node_with_no_clipping_ancestor_is_cut_by_nothing) {
  ScrollTree fixture;
  ClipArena arena;
  CHECK(effective_clip(fixture.tree, arena) == nullptr);
  // The scroller's OWN rect is not cut by the scroller: it cuts its children.
  CHECK(effective_clip(fixture.scroller(), arena) == nullptr);
}

TEST(hit, every_clipping_ancestor_narrows_the_region_and_the_innermost_rounds_it) {
  Node ir = ir_node(NodeType::Container);
  Node card = ir_node(NodeType::Container);
  card.clip = true;
  Node scroller = ir_node(NodeType::ScrollView);
  scroller.children.push_back(ir_node(NodeType::Button, "inner"));
  card.children.push_back(std::move(scroller));
  ir.children.push_back(std::move(card));
  LayoutNode tree;
  build_layout_tree(ir, tree);
  place(tree, Rect{0, 0, 400, 400});
  place(tree.children[0], Rect{0, 0, 120, 400});
  place(tree.children[0].children[0], Rect{0, 50, 200, 200}, 8);
  place(tree.children[0].children[0].children[0], Rect{0, 0, 50, 50});

  ClipArena arena;
  const Clip *clip = effective_clip(tree.children[0].children[0].children[0], arena);
  CHECK(clip != nullptr);
  if (clip != nullptr) {
    CHECK_NEAR(clip->x, 0.0, 0.001);
    CHECK_NEAR(clip->y, 50.0, 0.001);
    CHECK_NEAR(clip->width, 120.0, 0.001);
    CHECK_NEAR(clip->height, 200.0, 0.001);
    CHECK_NEAR(clip->radius, 8.0, 0.001);
  }
}

TEST(hit, the_walk_stops_at_an_Overlay_but_the_overlays_own_clip_still_counts) {
  Node ir = ir_node(NodeType::ScrollView);
  Node overlay = ir_node(NodeType::Overlay, "confirm");
  overlay.children.push_back(ir_node(NodeType::Button, "ok"));
  ir.children.push_back(std::move(overlay));
  LayoutNode tree;
  build_layout_tree(ir, tree);
  // Declared inside a scroller, but arranged against the view rect.
  place(tree, Rect{0, 0, 50, 50});
  place(tree.children[0], Rect{0, 0, 400, 400});
  place(tree.children[0].children[0], Rect{0, 0, 100, 100});

  ClipArena arena;
  CHECK(effective_clip(tree.children[0].children[0], arena) == nullptr);

  ir.children[0].clip = true;
  const Clip *clip = effective_clip(tree.children[0].children[0], arena);
  CHECK(clip != nullptr);
  if (clip != nullptr) {
    CHECK_NEAR(clip->width, 400.0, 0.001);
    CHECK_NEAR(clip->height, 400.0, 0.001);
  }
}

TEST(clip, an_arena_reuses_its_slots_and_a_reset_hands_them_all_back) {
  // Identity is the contract the tessellator groups by, so two interned regions
  // are two addresses — and a reset starts handing the same ones out again.
  ClipArena arena;
  const Clip *first = arena.intern(region(0, 0, 10, 10));
  const Clip *second = arena.intern(region(0, 0, 10, 10));
  CHECK(first != second);
  arena.reset();
  CHECK(arena.intern(region(0, 0, 20, 20)) == first);
}
