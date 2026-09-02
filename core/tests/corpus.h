// The pieces of `golden/` that more than one suite reads.
//
// `test_golden.cpp` replays the corpus against its records; `test_forward_compat.cpp`
// replays the same envelopes against a build that is missing a capability. Both
// need the same three things — the files, the case list, and a `data` entry as
// the channel carries it — and two copies of "what a corpus datum means" is two
// answers to one question waiting to disagree.
//
// What is NOT here is deliberate: the diff, the skip list and the pad replay are
// the golden harness's own, and belong to it.

#pragma once

#include <string>

#include "data.h"
#include "json.h"

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

}  // namespace zabloo::testing
