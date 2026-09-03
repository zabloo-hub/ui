// Performance budgets for the core (G15, ZAB-148) — the DETERMINISTIC half.
//
// Draw calls, geometry, atlas memory and the frame's own work counters are exact
// counts of what the renderer does, so CI can hold the line on them; the
// wall-clock half lives in `bench.cpp`, because asserting time in CI flakes.
// `docs/performance.md` consolidates both targets' numbers.
//
// Two layers, and they measure different things:
//
// - **The golden corpus** is a floor: seventeen small scenes that must not start
//   costing more than they do. Cheap, and it catches the crude regressions (a
//   clip that stops batching, a leak of atlases).
// - **The realistic scenes** (`golden/perf/`) are what a real screen looks like —
//   a thousand-row list, a wall of wrapped prose, a panel mid-transition, a
//   populated screen with something animating on it — at 960×600 instead of
//   480×320. They are the SAME files the web renderer budgets against
//   (`packages/renderer-web/src/perf/scenes.ts`), which is the whole point: the
//   frame CI holds a ceiling on in the browser and the one it holds a ceiling on
//   here are literally the same frame.
//
// The numbers are budgets, not snapshots: each is comfortably above what the
// scene costs today (the observed value is next to it), so they fail on a
// REGRESSION and not on an honest new case.

#include <cstdint>
#include <string>
#include <vector>

#include "json.h"
#include "staging.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;
using zabloo::testing::find_node;
using zabloo::testing::perf_motion_ms;
using zabloo::testing::perf_scene_names;
using zabloo::testing::Staged;

namespace {

/** Solids + one per atlas/image per clip group, and each overlay opens a paint root. */
constexpr uint32_t CORPUS_DRAW_CALLS = 24;
constexpr uint32_t CORPUS_VERTICES = 2000;
/** Point sizes a scene needs at once (the library caps at 8 — see `glyphs.h`). */
constexpr uint32_t CORPUS_ATLASES = 3;
/**
 * CPU-side atlas bytes: 3 × 1024² × LA8. Half the web's ceiling for the same
 * three atlases, because these are two bytes a pixel and the browser's are four
 * — the divergence `FrameStats::atlas_bytes` documents.
 */
constexpr size_t CORPUS_ATLAS_BYTES = 3u * 1024u * 1024u * 2u;

/** A realistic scene's ceilings, with what it costs today beside it. */
struct SceneBudget {
  const char *name;
  uint32_t draw_calls;
  uint32_t vertices;
  uint32_t resolved;
};

/**
 * The margin is deliberate and roughly 2×: these scenes are meant to grow a
 * little as the catalog does, and a budget that has to be edited on every honest
 * change stops being read.
 */
const SceneBudget SCENE_BUDGETS[] = {
    {"list", 12, 6000, 120},
    {"text", 12, 13000, 60},
    {"motion", 12, 3000, 180},
    {"dense-loop", 12, 8000, 160},
    {"dense-caret", 12, 8000, 160},
};

/**
 * Shared by every realistic scene: three point sizes is the most any of them asks
 * for (the text wall), and the ceiling is what a fourth size — or an atlas that
 * had to grow — would cross.
 */
constexpr uint32_t SCENE_ATLASES = 4;
constexpr size_t SCENE_ATLAS_BYTES = 4u * 1024u * 1024u * 2u;

const SceneBudget &budget_for(const std::string &name) {
  for (const SceneBudget &budget : SCENE_BUDGETS) {
    if (name == budget.name) return budget;
  }
  static const SceneBudget missing{"", 0, 0, 0};
  return missing;
}

/**
 * One report per scene, carrying every number rather than one per metric: a scene
 * that goes over usually goes over on more than one, and the useful thing to read
 * is the whole frame it produced.
 */
void check_within(const std::string &name, const FrameStats &stats, const SceneBudget &budget) {
  if (stats.draw_calls <= budget.draw_calls && stats.vertices <= budget.vertices &&
      stats.resolved <= budget.resolved && stats.atlases <= SCENE_ATLASES &&
      stats.atlas_bytes <= SCENE_ATLAS_BYTES) {
    return;
  }
  zabloo::testing::report(
      __FILE__, __LINE__,
      name + " is over budget: " + std::to_string(stats.draw_calls) + " draw calls (max " +
          std::to_string(budget.draw_calls) + "), " + std::to_string(stats.vertices) +
          " vertices (max " + std::to_string(budget.vertices) + "), " +
          std::to_string(stats.resolved) + " resolved (max " + std::to_string(budget.resolved) +
          "), " + std::to_string(stats.atlases) + " atlases, " +
          std::to_string(stats.atlas_bytes) + " atlas bytes");
}

/** Mounts a scene, reporting rather than crashing when it will not. */
Staged staged_scene(const std::string &name) {
  std::string failure;
  Staged staged = zabloo::testing::stage_perf_scene(name, failure);
  if (staged.view == nullptr) zabloo::testing::report(__FILE__, __LINE__, name + ": " + failure);
  return staged;
}

}  // namespace

TEST(budgets, every_golden_scene_stays_inside_the_corpus_budgets) {
  const JsonRef cases = zabloo::testing::corpus_cases();
  CHECK(cases.size() > 0);
  for (uint32_t i = 0; i < cases.size(); i++) {
    // A refusal records a LOAD and not a frame: there is nothing to budget.
    if (cases.at(i).get("refuses").exists()) continue;
    const std::string name(cases.key_at(i));
    std::string failure;
    Staged staged = zabloo::testing::stage_corpus_case(cases.at(i), failure);
    if (staged.view == nullptr) {
      zabloo::testing::report(__FILE__, __LINE__, name + ": " + failure);
      continue;
    }
    staged.view->paint();
    const FrameStats stats = staged.view->stats();
    if (stats.draw_calls > CORPUS_DRAW_CALLS || stats.vertices > CORPUS_VERTICES ||
        stats.atlases > CORPUS_ATLASES || stats.atlas_bytes > CORPUS_ATLAS_BYTES) {
      zabloo::testing::report(__FILE__, __LINE__,
                              name + " is over the corpus budget: " +
                                  std::to_string(stats.draw_calls) + " draw calls, " +
                                  std::to_string(stats.vertices) + " vertices, " +
                                  std::to_string(stats.atlases) + " atlases");
    }
  }
}

TEST(budgets, every_realistic_scene_stays_inside_its_budget) {
  for (const std::string &name : perf_scene_names()) {
    Staged staged = staged_scene(name);
    if (staged.view == nullptr) continue;
    staged.view->paint();
    check_within(name, staged.view->stats(), budget_for(name));
  }
}

TEST(budgets, a_thousand_rows_cost_a_screenful_scrolled_or_not) {
  Staged staged = staged_scene("list");
  if (staged.view == nullptr) return;
  View &view = *staged.view;

  // Deep into the list, where a renderer that had quietly stopped windowing would
  // be carrying a thousand realized rows.
  for (int i = 0; i < 20; i++) {
    view.pointer_wheel(400, 300, 0, 120);
    staged.advance(16);
  }
  view.paint();
  check_within("list scrolled", view.stats(), budget_for("list"));

  // The whole point of virtualization: the frame's work is bounded by the
  // VIEWPORT, not by the array. 1.000 items, a screenful of rows realized.
  const LayoutNode *rows = find_node(view.root(), "rows");
  CHECK(rows != nullptr);
  if (rows != nullptr) CHECK(rows->children.size() <= 40);
}

TEST(budgets, a_frame_mid_transition_costs_the_same_as_one_at_rest) {
  Staged staged = staged_scene("motion");
  if (staged.view == nullptr) return;
  View &view = *staged.view;

  // A frame after each mutation, all three still at instant zero. The reference's
  // handle renders on every write of its own accord; here the adapter owns the
  // frames, so the test has to give them — and it matters, because the rows enter
  // the layout on the first of them and a node entering layout SNAPS. Without it
  // the bars would take 0.9 for a mount value and there would be nothing in
  // flight left to measure.
  view.set_open("section", true);
  view.layout_frame();
  staged.document.set_data("ui.armed", DataValue::of_bool(true));
  view.layout_frame();
  staged.document.set_data("job.progress", DataValue::of_number(0.9));
  view.layout_frame();
  // Half way through: the Collapse's height, twelve toggles' backgrounds and
  // twelve bars' fills are all mid-flight on this frame.
  staged.advance(perf_motion_ms() / 2.0);

  // The bar's main axis is its `direction`, which defaults to column — so the
  // fill grows in HEIGHT, and being between nothing and all of it is what says
  // this frame was caught in flight rather than at either end.
  const LayoutNode *fill = find_node(view.root(), "fill-0");
  CHECK(fill != nullptr);
  if (fill != nullptr) {
    CHECK(fill->rect.height > 0.0);
    CHECK(fill->rect.height < 7.2);
  }

  view.paint();
  check_within("motion mid-transition", view.stats(), budget_for("motion"));
}

TEST(budgets, a_steady_animation_frame_allocates_no_geometry_and_rewraps_no_text) {
  Staged staged = staged_scene("dense-loop");
  if (staged.view == nullptr) return;
  View &view = *staged.view;

  // The Spinner keeps the pipeline running, so these are FULL frames — the regime
  // the builder's buffer reuse and the wrap cache were built for.
  for (int i = 0; i < 10; i++) staged.advance(16);
  view.paint();
  const FrameStats settled = view.stats();
  CHECK(settled.resolved > 0);
  CHECK(!settled.repaint_only);

  staged.advance(16);
  view.paint();
  const FrameStats next = view.stats();
  // Zero, not "a few": the builder's vectors keep their capacity across frames
  // and a `Text` whose input did not move keeps its block. Anything above zero
  // here is a frame throwing both away.
  CHECK_EQ(next.buffer_growths, 0u);
  CHECK_EQ(next.text_layouts, 0u);
  // And the frame is the same frame: same geometry, same draw calls.
  CHECK_EQ(next.draw_calls, settled.draw_calls);
  CHECK_EQ(next.vertices, settled.vertices);
}

TEST(budgets, a_paint_with_no_layout_behind_it_is_a_repaint) {
  Staged staged = staged_scene("dense-caret");
  if (staged.view == nullptr) return;
  View &view = *staged.view;

  const LayoutNode *field = find_node(view.root(), "message");
  CHECK(field != nullptr);
  if (field == nullptr) return;
  view.pointer_down(field->rect.x + 20.0, field->rect.y + field->rect.height / 2.0);
  view.pointer_up(field->rect.x + 20.0, field->rect.y + field->rect.height / 2.0);
  view.insert_text("Hola");
  staged.advance(16);
  view.paint();
  const FrameStats full = view.stats();
  CHECK(!full.repaint_only);
  CHECK(full.resolved > 0);

  // What the adapter asks for when a caret flips: the clock moves and the
  // geometry is re-tessellated, but no pass before it runs. Nothing resolved,
  // nothing re-wrapped, no geometry reallocated.
  view.set_now(view.now() + 265.0);
  view.paint();
  const FrameStats flip = view.stats();
  CHECK(flip.repaint_only);
  CHECK_EQ(flip.resolved, 0u);
  CHECK_EQ(flip.text_layouts, 0u);
  CHECK_EQ(flip.buffer_growths, 0u);
  // The scene is the same scene: the caret is the only geometry that can move.
  CHECK(flip.vertices >= full.vertices - 4u);
  CHECK(flip.vertices <= full.vertices + 4u);
}
