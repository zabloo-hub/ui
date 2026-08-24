// The loader's policy: what is ignored, what warns, and what refuses.
//
// It is a port of `@zabloo/format`'s `readEnvelope` (ZAB-37) — same codes, same
// paths, same frontier — and the port is the point. Before that decision every
// consumer defended itself node by node, which is two implementations of the
// same defence drifting apart; with the repair in the format, robustness is
// inherited. This file is what makes that true for the C++ core as well.
//
// Three properties the rest of the core leans on:
//
// 1. **It never throws.** A truncated file, a hostile payload and a v2 envelope
//    all come back as a fatal diagnostic with a readable message. That is what
//    lets a hot-update fail without touching what is already on screen.
// 2. **The envelope comes back REPAIRED**, not merely reported: a broken view is
//    dropped, a mistyped prop falls to its default, and a dropped POSITIONAL
//    child is replaced by an inert `Container` — removing it would renumber the
//    slots after it and silently change what they mean.
// 3. **Shapes, never vocabularies.** An unknown member of a closed set is a
//    string like any other here; the reader falls back to the default when it
//    reads it. Validating the value would make tomorrow's content today's error.

#pragma once

#include <string_view>
#include <vector>

#include "diagnostics.h"
#include "envelope.h"
#include "json.h"

namespace zabloo {

/**
 * Deepest tree this reader walks. Nothing authored comes close — a real screen
 * nests tens of levels, not hundreds. What does is a corrupt payload, and every
 * pass downstream (this walk, layout, paint, hit-testing) is recursive, so a
 * tree that would overflow the stack has to stop being a tree at the door. The
 * cut is a warning like any other: the subtree goes, the rest of the UI loads.
 */
inline constexpr int MAX_DEPTH = 256;

struct EnvelopeReport {
  /** False when a fatal diagnostic stopped the load; `envelope` is then empty. */
  bool ok = false;
  Envelope envelope;
  std::vector<Diagnostic> diagnostics;
};

/** JSON text in, a repaired envelope plus diagnostics out. Never throws. */
EnvelopeReport read_envelope(std::string_view json_text);

/** The same walk over an already-parsed document. */
EnvelopeReport validate_envelope(JsonRef value);

}  // namespace zabloo
