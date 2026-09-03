// A `DataValue` as JSON text, both ways — the one marshalling rule of the C ABI.
//
// The core READS JSON (the envelope's own reader) and WRITES numbers without a
// locale (`number_to_text`, `snapshot_number`), and has deliberately no JSON
// writer of its own: nothing in `core/src` reserializes (2026-09-03, G14). The
// bridge is the first thing that has to hand a value BACK as text — a control's
// write to its bound path, drained by a binding that only speaks C — so the
// writer lives here, in `capi/`, and nowhere closer to the core.
//
// Numbers are written as `String(number)` writes them in ECMA-262, which is what
// `number_to_text` already is. It matters more than it looks: a game running
// under a Spanish locale would otherwise see `0,5` where the reference emits
// `0.5`, silently — the exact class of divergence `json.cpp` and `snapshot.cpp`
// document for `strtod` and `printf`.

#pragma once

#include <string>

#include "data.h"
#include "json.h"

namespace zabloo::capi {

/**
 * A parsed JSON value as the data channel carries it — arrays and objects
 * included, because a bound path is an ADDRESS into what was pushed. Absent or
 * `null` is a null value.
 */
DataValue data_from_json(JsonRef value);

/**
 * The value as compact JSON: `true`, `0.35`, `"Sergi"`, `[…]`, `{…}`. Keys and
 * strings are escaped as JSON requires and UTF-8 passes through untouched.
 * `NaN` and the infinities become `null`, as `JSON.stringify` writes them.
 */
std::string json_from_data(const DataValue &value);

}  // namespace zabloo::capi
