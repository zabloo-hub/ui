#include <vector>

#include "diagnostics.h"

namespace zabloo {

const char *diagnostic_code_name(DiagnosticCode code) {
  switch (code) {
    case DiagnosticCode::InvalidJson: return "invalid-json";
    case DiagnosticCode::NotAnObject: return "not-an-object";
    case DiagnosticCode::MissingVersion: return "missing-version";
    case DiagnosticCode::UnsupportedVersion: return "unsupported-version";
    case DiagnosticCode::MissingViews: return "missing-views";
    case DiagnosticCode::NoUsableViews: return "no-usable-views";
    case DiagnosticCode::InvalidTokens: return "invalid-tokens";
    case DiagnosticCode::InvalidToken: return "invalid-token";
    case DiagnosticCode::InvalidAssets: return "invalid-assets";
    case DiagnosticCode::InvalidAsset: return "invalid-asset";
    case DiagnosticCode::InvalidNode: return "invalid-node";
    case DiagnosticCode::InvalidProp: return "invalid-prop";
    case DiagnosticCode::InvalidBinding: return "invalid-binding";
    case DiagnosticCode::TooDeep: return "too-deep";
    case DiagnosticCode::DuplicateId: return "duplicate-id";
    case DiagnosticCode::UnknownToken: return "unknown-token";
    case DiagnosticCode::UnknownAsset: return "unknown-asset";
    case DiagnosticCode::UnknownAnchor: return "unknown-anchor";
  }
  return "invalid-prop";
}

bool has_fatal(const std::vector<Diagnostic> &list) {
  for (const Diagnostic &diagnostic : list) {
    if (diagnostic.level == DiagnosticLevel::Fatal) return true;
  }
  return false;
}

}  // namespace zabloo
