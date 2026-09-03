// Performance bench (G15, ZAB-148) — the WALL-CLOCK half, and the counter dump
// the budget table is written from.
//
// Not part of the regular run: every case here returns immediately unless
// `BENCH` is set in the environment (`scons bench`), because its numbers are for
// a human comparing a before and an after on one machine — CI asserting on wall
// clock would flake. It is the same gate, and the same name, the reference bench
// uses (`BENCH=1 pnpm bench`).
//
// It rides the same staging as the budgets, so the frame CI holds a ceiling on
// and the frame timed here are the same frame. Two things it deliberately does
// not measure:
//
// - **Allocation per frame.** The reference reads V8's sampling heap profiler;
//   there is no equally honest counter here, and a malloc hook would measure the
//   allocator rather than the renderer. What stands in for it is
//   `buffer_growths`, which is zero in a steady frame by construction and is
//   asserted as such in `test_budgets.cpp`.
// - **Anything past the ViewSnapshot.** Draw calls reaching a GPU, textures
//   uploaded, frames per second — those need an engine, and they are measured in
//   `examples/godot-playground` (its `bench` view) on a real export.

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "corpus.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;
using zabloo::testing::find_node;
using zabloo::testing::perf_scene_names;
using zabloo::testing::Staged;

namespace {

/** Frames timed per measurement, after a warmup. The reference's number too. */
constexpr int FRAMES = 1000;
constexpr int WARMUP = 30;

bool enabled() { return std::getenv("BENCH") != nullptr; }

/** Milliseconds per iteration of `tick`, warmed up first. */
template <typename Tick>
double measure(Tick tick) {
  for (int i = 0; i < WARMUP; i++) tick();
  const auto start = std::chrono::steady_clock::now();
  for (int i = 0; i < FRAMES; i++) tick();
  const auto elapsed = std::chrono::steady_clock::now() - start;
  return std::chrono::duration<double, std::milli>(elapsed).count() / FRAMES;
}

void report(const std::string &name, double ms, const std::string &extra = {}) {
  std::printf("[bench] %s: %.3f ms/frame%s%s\n", name.c_str(), ms, extra.empty() ? "" : " — ",
              extra.c_str());
}

std::string show(const FrameStats &stats) {
  char buffer[256];
  std::snprintf(buffer, sizeof(buffer),
                "{draw_calls:%u, vertices:%u, indices:%u, atlases:%u, atlas_bytes:%zu, "
                "resolved:%u, text_layouts:%u, buffer_growths:%u, repaint_only:%s}",
                stats.draw_calls, stats.vertices, stats.indices, stats.atlases, stats.atlas_bytes,
                stats.resolved, stats.text_layouts, stats.buffer_growths,
                stats.repaint_only ? "true" : "false");
  return buffer;
}

Staged scene(const std::string &name) {
  std::string failure;
  Staged staged = zabloo::testing::stage_perf_scene(name, failure);
  if (staged.view == nullptr) std::printf("[bench] %s: %s\n", name.c_str(), failure.c_str());
  return staged;
}

Staged corpus(const std::string &name) {
  std::string failure;
  Staged staged =
      zabloo::testing::stage_corpus_case(zabloo::testing::corpus_cases().get(name), failure);
  if (staged.view == nullptr) std::printf("[bench] %s: %s\n", name.c_str(), failure.c_str());
  return staged;
}

/** One whole frame at the instant the clock already stands at. */
void full_frame(View &view) {
  view.layout_frame();
  view.paint();
}

}  // namespace

TEST(bench, relayout_full_pipeline_frame_on_the_settings_scene) {
  if (!enabled()) return;
  Staged staged = corpus("settings");
  if (staged.view == nullptr) return;
  View &view = *staged.view;
  report("settings full relayout", measure([&view] { full_frame(view); }), show(view.stats()));
}

TEST(bench, relayout_full_pipeline_frame_on_a_populated_screen) {
  if (!enabled()) return;
  Staged staged = scene("dense-loop");
  if (staged.view == nullptr) return;
  View &view = *staged.view;
  report("dense screen full relayout", measure([&view] { full_frame(view); }), show(view.stats()));
}

TEST(bench, the_caret_repaint_against_a_full_frame_of_the_same_scene) {
  if (!enabled()) return;
  Staged staged = scene("dense-caret");
  if (staged.view == nullptr) return;
  View &view = *staged.view;
  const LayoutNode *field = find_node(view.root(), "message");
  if (field == nullptr) {
    std::printf("[bench] the composer field is not on screen\n");
    return;
  }
  view.pointer_down(field->rect.x + 20.0, field->rect.y + field->rect.height / 2.0);
  view.pointer_up(field->rect.x + 20.0, field->rect.y + field->rect.height / 2.0);
  view.insert_text("Zabloo");
  staged.advance(16);

  // A blink asks for the frame it FLIPS on, twice a period, and each of those is
  // a repaint: the clock moves and the geometry is re-tessellated, and no pass
  // before it runs. This is what leaving a field focused actually costs.
  double clock = view.now();
  const double flip = measure([&view, &clock] {
    clock += 265.0;
    view.set_now(clock);
    view.paint();
  });
  report("caret flip repaint", flip, show(view.stats()));
  const double full = measure([&view] { full_frame(view); });
  report("same scene, full frame", full, show(view.stats()));
  if (full > 0.0) {
    std::printf("[bench] caret flip is %.1f%% of a full frame\n", (flip / full) * 100.0);
  }
}

TEST(bench, animation_frame_a_spinner_running_over_a_populated_screen) {
  if (!enabled()) return;
  Staged staged = scene("dense-loop");
  if (staged.view == nullptr) return;
  View &view = *staged.view;
  // The wave must actually be running, or the loop measures skipped frames.
  const LayoutNode *bead = find_node(view.root(), "bead-0");
  const double before = bead != nullptr ? bead->resolved.opacity : 0.0;
  staged.advance(160);
  if (bead != nullptr && bead->resolved.opacity == before) {
    std::printf("[bench] the spinner is not moving — the measurement below is of still frames\n");
  }
  report("spinner animation frame", measure([&staged, &view] {
           staged.advance(16);
           view.paint();
         }),
         show(view.stats()));
}

TEST(bench, repeat_a_thousand_unequal_rows_scrolled) {
  if (!enabled()) return;
  Staged staged = scene("list");
  if (staged.view == nullptr) return;
  View &view = *staged.view;
  const LayoutNode *rows = find_node(view.root(), "rows");
  std::printf("[bench] rows realized after settle: %zu\n",
              rows != nullptr ? rows->children.size() : 0u);

  // Steady-state scrolling: every wheel is a frame, plus any window re-plan the
  // drift check schedules — that cost belongs to the number.
  report("1000-row scroll frame", measure([&staged, &view] {
           view.pointer_wheel(400, 300, 0, 40);
           staged.advance(16);
           view.paint();
         }),
         show(view.stats()));
  rows = find_node(view.root(), "rows");
  std::printf("[bench] rows realized deep in the list: %zu\n",
              rows != nullptr ? rows->children.size() : 0u);
}

TEST(bench, text_a_wall_of_wrapped_prose_relaid_out_every_frame) {
  if (!enabled()) return;
  Staged staged = scene("text");
  if (staged.view == nullptr) return;
  View &view = *staged.view;
  report("wrapped prose full relayout", measure([&view] { full_frame(view); }), show(view.stats()));
}

TEST(bench, the_cost_of_every_golden_scene) {
  if (!enabled()) return;
  const JsonRef cases = zabloo::testing::corpus_cases();
  for (uint32_t i = 0; i < cases.size(); i++) {
    if (cases.at(i).get("refuses").exists()) continue;
    const std::string name(cases.key_at(i));
    Staged staged = corpus(name);
    if (staged.view == nullptr) continue;
    staged.view->paint();
    std::printf("[bench] %s: %s\n", name.c_str(), show(staged.view->stats()).c_str());
  }
}

TEST(bench, the_cost_of_every_realistic_scene) {
  if (!enabled()) return;
  for (const std::string &name : perf_scene_names()) {
    Staged staged = scene(name);
    if (staged.view == nullptr) continue;
    staged.view->paint();
    std::printf("[bench] %s: %s\n", name.c_str(), show(staged.view->stats()).c_str());
  }
}

