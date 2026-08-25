// The `ViewSnapshot`: serializable metrics of ONE frame, and the cross-target
// contract of ZAB-134 — the same envelope loaded here and in the web renderer
// must produce the same document, byte for byte.
//
// A port of `packages/renderer-web/src/snapshot.ts`, and a deliberately literal
// one: the interesting property is not that it writes JSON, it is that it writes
// THE SAME JSON — same key order, same omissions, same quantization. The corpus
// under `golden/` is the arbiter, and `core/tests/test_golden.cpp` is what runs
// it against this, on a bare CPU with no engine and no GPU.
//
// It answers what a screenshot could not explain: where every rect landed, what
// left the layout, which states are active, what the paint inputs resolved to.
// Pixels are deliberately absent — those are the golden IMAGES, which need a GPU
// and stay a manual step.
//
// Three rules keep a diff readable, and they are the whole reason this is a
// module and not a printf in the tests:
//
// 1. **Stable order.** Keys are written in a fixed order, never the order they
//    happened to be filled in, so re-rendering an unchanged tree is byte-identical.
// 2. **Absent means default.** A field only appears when it says something — an
//    unfocused node carries no `states`, a zero border no `borderWidth`.
// 3. **Rounded once, here.** Numbers are quantized to `SNAPSHOT_PRECISION`
//    decimals, so the last bits of a multiply never rewrite a golden file — and
//    so this FPU and the one that recorded them can compare the same digits.

#pragma once

#include <string>

#include "view.h"

namespace zabloo {

/** Decimals kept on every number of a snapshot. The corpus is recorded at this. */
inline constexpr int SNAPSHOT_PRECISION = 3;

/**
 * The bytes that land in a golden file: the snapshot as JSON, two-space indent,
 * trailing newline — exactly what `JSON.stringify(snapshot, null, 2)` writes on
 * the reference side.
 *
 * Call it on a view that has been laid out at least once: it reports the frame
 * that is on screen, and a tree nobody arranged has no frame to report.
 */
std::string snapshot_view(const View &view);

/**
 * One number as a snapshot writes it: quantized to `SNAPSHOT_PRECISION` decimals,
 * trailing zeros trimmed, locale-free.
 *
 * Public because whoever COMPARES two snapshots has to render a number the same
 * way the file spells it — a diff that reports `132.00001` for a byte that reads
 * `132` sends the reader hunting in the wrong place.
 */
std::string snapshot_number(double value);

}  // namespace zabloo
