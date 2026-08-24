// What the loader found, addressed to whoever authored the envelope.
//
// The `code` strings are the CONTRACT, not the prose: this reader has to emit
// the same code for the same input as `@zabloo/format`'s `readEnvelope`, because
// the corpus tests both against the same expectation. The `message` beside it is
// free to read better over time.

#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace zabloo {

/** `fatal` aborts the load; `warn` was repaired and the envelope still loads. */
enum class DiagnosticLevel : uint8_t { Warn, Fatal };

/**
 * The stable identity of a problem — what a consumer switches on.
 *
 * The frontier between the two levels is one question: *is there any tree left
 * to render?* Only what leaves none is fatal (2026-08-12).
 */
enum class DiagnosticCode : uint8_t {
  // Fatal: nothing renders.
  InvalidJson,
  NotAnObject,
  MissingVersion,
  UnsupportedVersion,
  MissingViews,
  NoUsableViews,
  // Warn: repaired, and the rest of the UI loads.
  InvalidTokens,
  InvalidToken,
  InvalidAssets,
  InvalidAsset,
  InvalidNode,
  InvalidProp,
  InvalidBinding,
  TooDeep,
  DuplicateId,
  UnknownToken,
  UnknownAsset,
  UnknownAnchor,
};

/** The wire spelling — `"invalid-node"`, `"unsupported-version"`. */
const char *diagnostic_code_name(DiagnosticCode code);

struct Diagnostic {
  DiagnosticLevel level = DiagnosticLevel::Warn;
  DiagnosticCode code = DiagnosticCode::InvalidProp;
  /**
   * Where it is, as a path into the envelope — `views["hud"].children[2].text`.
   * Map keys are bracketed because view ids, asset ids and token names carry
   * dots of their own. Empty is the envelope itself.
   */
  std::string path;
  /** Self-contained: it already names the path, the field and the reason. */
  std::string message;
};

/** True if any diagnostic in `list` stopped the load. */
bool has_fatal(const std::vector<Diagnostic> &list);

}  // namespace zabloo
