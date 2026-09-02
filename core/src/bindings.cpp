#include "bindings.h"

#include <cmath>
#include <string>
#include <string_view>

#include "data.h"

namespace zabloo {
namespace {

/** The one reserved leaf: a position is not in the data, so it cannot be read. */
constexpr std::string_view INDEX_SEGMENT = "$index";

}  // namespace

ResolvedBind resolve_binding(std::string_view bind, const ItemScope *innermost) {
  ResolvedBind out;
  // Innermost scope first: a nested list's alias shadows the one outside it.
  for (const ItemScope *link = innermost; link != nullptr; link = link->outer) {
    const ItemScope &scope = *link;
    if (scope.alias.empty()) continue;
    if (bind == scope.alias) {
      out.path = scope.path;
      return out;
    }
    if (bind.size() <= scope.alias.size() || bind.compare(0, scope.alias.size(), scope.alias) != 0 ||
        bind[scope.alias.size()] != '.') {
      continue;
    }
    const std::string_view rest = bind.substr(scope.alias.size() + 1);
    if (rest == INDEX_SEGMENT) {
      out.kind = ResolvedBind::Kind::Index;
      out.index = scope.index;
      return out;
    }
    out.path = scope.path + "." + std::string(rest);
    return out;
  }
  out.path = std::string(bind);
  return out;
}

std::string item_path(std::string_view array_path, int index) {
  return std::string(array_path) + "." + std::to_string(index);
}

ItemKey item_key(const DataValue *item, std::string_view key_path) {
  ItemKey out;
  if (item == nullptr || key_path.empty()) return out;
  const DataValue *value = read_path(*item, key_path);
  if (value == nullptr) return out;
  if (value->kind == DataValue::Kind::Text && !value->text.empty()) {
    out.present = true;
    out.text = value->text;
  } else if (value->kind == DataValue::Kind::Number && std::isfinite(value->number)) {
    out.present = true;
    out.is_number = true;
    out.number = value->number;
  }
  return out;
}

std::string item_identity(const ItemKey &key, int index) {
  if (!key.present) return std::to_string(index);
  return "k:" + (key.is_number ? number_to_text(key.number) : key.text);
}

}  // namespace zabloo
