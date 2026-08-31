#include "groups.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace zabloo {

TabsGroup resolve_tabs_group(const std::vector<NodeType> &bar_children, size_t child_count) {
  TabsGroup out;
  if (child_count == 0) {
    out.warning = "an exclusive-select group needs a tab bar child";
    return out;
  }
  std::vector<size_t> buttons;
  for (size_t i = 0; i < bar_children.size(); i++) {
    if (bar_children[i] == NodeType::Button) buttons.push_back(i);
  }
  if (buttons.empty()) {
    out.warning = "the tab bar (children[0]) has no Button children";
    return out;
  }
  const size_t panels = child_count - 1;
  const size_t pairs = std::min(buttons.size(), panels);
  if (buttons.size() != panels) {
    out.warning = std::to_string(buttons.size()) + " tab button(s) but " +
                  std::to_string(panels) + " panel(s) — using the first " +
                  std::to_string(pairs);
  }
  for (size_t i = 0; i < pairs; i++) {
    out.buttons.push_back(buttons[i]);
    out.panels.push_back(i + 1);
  }
  return out;
}

int clamp_selected(const std::optional<double> &value, size_t count) {
  if (count == 0) return 0;
  // Not an integer is not an index: it falls back to the first tab rather than
  // being rounded into one the author never named.
  if (!value.has_value() || !std::isfinite(*value) || *value != std::floor(*value)) return 0;
  const double clamped = std::min(static_cast<double>(count) - 1.0, std::max(0.0, *value));
  return static_cast<int>(clamped);
}

DataValue scalar_value(const Scalar &scalar) {
  switch (scalar.kind) {
    case Scalar::Kind::Number: return DataValue::of_number(scalar.number);
    case Scalar::Kind::Text: return DataValue::of_text(scalar.text);
    case Scalar::Kind::None: break;
  }
  return DataValue();
}

bool is_selected(const DataValue *selected, const DataValue *value) {
  // Absent first: "no selection yet" and "option without a value" must never
  // match each other.
  // A boolean is deliberately NOT comparable across the split: the reference
  // only ever stringifies a string or a number, so `true` never selects the
  // option authored as `"true"`.
  const auto comparable = [](const DataValue *v) {
    return v->kind == DataValue::Kind::Text || v->kind == DataValue::Kind::Number;
  };
  if (selected == nullptr || value == nullptr) return false;
  if (selected->kind == DataValue::Kind::Null || value->kind == DataValue::Kind::Null) return false;
  if (selected->kind == value->kind) {
    switch (selected->kind) {
      case DataValue::Kind::Bool: return selected->boolean == value->boolean;
      case DataValue::Kind::Number: return selected->number == value->number;
      case DataValue::Kind::Text: return selected->text == value->text;
      default: break;
    }
  }
  // Across the string/number split, compared as the reference does: by the
  // string each side stringifies to, never by re-parsing one of them. `2` and
  // `"2"` are the same option; `2` and `"2.0"` are not, in both targets alike.
  if (!comparable(selected) || !comparable(value)) return false;
  const auto text = [](const DataValue *v) {
    return v->kind == DataValue::Kind::Text ? v->text : number_to_text(v->number);
  };
  return text(selected) == text(value);
}

bool next_checked(bool checked, bool in_exclusive_group) {
  return in_exclusive_group ? true : !checked;
}

double slot_opacity(size_t index, double progress) {
  // NaN falls to 0, which is what the reference's chain of comparisons does.
  const double checked = progress > 1.0 ? 1.0 : (progress > 0.0 ? progress : 0.0);
  if (index == 0) return checked;
  if (index == 1) return 1.0 - checked;
  return 1.0;
}

}  // namespace zabloo
