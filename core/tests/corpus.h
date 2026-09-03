// The pieces of `golden/` that more than one suite reads.
//
// `test_golden.cpp` replays the corpus against its records; `test_forward_compat.cpp`
// replays the same envelopes against a build that is missing a capability. Both
// need the same three things — the files, the case list, and a `data` entry as
// the channel carries it — and two copies of "what a corpus datum means" is two
// answers to one question waiting to disagree.
//
// Since G15 that is three suites and one more thing: `test_budgets.cpp` mounts the
// same cases to read what the frame COST, so MOUNTING one moved in here too — pad
// replay included. A case is `(envelope, data, viewport, clock, pad)`, and a
// second copy of that sequence would be a second definition of "the frame the
// corpus records", drifting the first time one of them learnt something.
//
// What is NOT here is deliberate: the diff and the skip list are the golden
// harness's own, and belong to it.

#pragma once

#include <string>
#include <vector>

#include "data.h"
#include "json.h"
#include "layout.h"
#include "view.h"

namespace zabloo::testing {

/** A file under `golden/`, by path relative to it. Empty if it is missing. */
std::string corpus_file(const std::string &relative);

/** `golden/cases.json`, parsed once and held for the life of the process. */
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
 *
 * They are not corpus cases: `golden/perf/README.md` draws that line.
 */
Staged stage_perf_scene(const std::string &name, std::string &failure);

/** The first node in the tree carrying this authored `id`, or null. */
const LayoutNode *find_node(const LayoutNode &root, std::string_view id);

}  // namespace zabloo::testing
