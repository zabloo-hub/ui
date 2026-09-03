// Staging a view for a test: the corpus's cases and the perf scenes, mounted the
// same way.
//
// It exists because two suites need the very same setup for different reasons.
// `test_golden.cpp` mounts a corpus case to compare its `ViewSnapshot` against
// `golden/metrics/`; `test_budgets.cpp` mounts one — and the realistic scenes of
// `golden/perf/` — to read what the frame COST. A second copy of the mount would
// be a second definition of "the frame the corpus records", and the two would
// drift the first time one of them learnt something.

#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "data.h"
#include "json.h"
#include "layout.h"
#include "view.h"

namespace zabloo::testing {

/**
 * A mounted view and the document that owns it.
 *
 * Held by value and returned by move, which is safe for exactly the reason
 * `Document`'s members are behind pointers: its envelope, its store and its view
 * keep their addresses, so the `View *` here stays good across the move.
 */
struct Staged {
  Document document;
  /** Null when the envelope was refused — `failure` says why. */
  View *view = nullptr;
  /** Where the injected clock stands. Every `advance` moves it. */
  double clock = 0.0;

  /** Moves the clock by `ms` and runs one frame at the new instant. */
  void advance(double ms);
};

/** File contents under `golden/`, or an empty string. */
std::string corpus_file(const std::string &relative);

/** `golden/cases.json`, parsed once for the life of the process. */
JsonRef corpus_cases();

/**
 * A corpus `data` entry as the channel carries it.
 *
 * Arrays and objects included: a path is an ADDRESS into what the game pushed
 * (`shop.items.1.name` is one push and two segments of walking), so a channel
 * that only carried scalars could not express the corpus at all.
 */
DataValue to_data_value(JsonRef value);

/**
 * Mounts one corpus case: envelope, seed data, viewport, clock and pad, in the
 * order `golden/README.md` fixes. The view it hands back is sitting on the frame
 * the case records.
 */
Staged stage_corpus_case(JsonRef spec, std::string &failure);

/** The names in `golden/perf/scenes.json`, in the order the file lists them. */
const std::vector<std::string> &perf_scene_names();

/** The duration every transition in the `motion` scene runs at. */
double perf_motion_ms();

/**
 * Mounts one realistic scene from `golden/perf/`, settled — the same two frames
 * a corpus case gets, because a `Repeat` measures its instances on the frame the
 * data arrives and windows them on the next.
 */
Staged stage_perf_scene(const std::string &name, std::string &failure);

/** The first node in the tree carrying this authored `id`, or null. */
const LayoutNode *find_node(const LayoutNode &root, std::string_view id);

}  // namespace zabloo::testing
