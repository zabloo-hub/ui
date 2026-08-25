#include <cstddef>
#include <optional>

#include "states.h"

namespace zabloo {

const StateName STATE_ORDER[static_cast<size_t>(StateName::Count)] = {
    StateName::Empty,   StateName::Selected, StateName::Checked,  StateName::Hover,
    StateName::Focused, StateName::Pressed,  StateName::Disabled,
};

namespace {

bool is_active(StateName name, const NodeStates &states) {
  switch (name) {
    case StateName::Empty: return states.empty;
    case StateName::Selected: return states.selected;
    case StateName::Checked: return states.checked;
    case StateName::Hover: return states.hovered;
    case StateName::Focused: return states.focused;
    case StateName::Pressed: return states.pressed;
    case StateName::Disabled: return states.disabled;
    case StateName::Count: break;
  }
  return false;
}

template <typename T>
void take(T &into, const T &from) {
  if (from.present()) into = from;
}

template <typename T>
void take_optional(std::optional<T> &into, const std::optional<T> &from) {
  if (from.has_value()) into = from;
}

void merge(Style &into, const Style &from) {
  take(into.background, from.background);
  take(into.border_color, from.border_color);
  take(into.color, from.color);
  take(into.radius, from.radius);
  take(into.border_width, from.border_width);
  take(into.font_size, from.font_size);
  take(into.line_height, from.line_height);
  take_optional(into.opacity, from.opacity);
  take_optional(into.max_lines, from.max_lines);
  take_optional(into.text_align, from.text_align);
  take_optional(into.text_align_y, from.text_align_y);
  take_optional(into.overflow, from.overflow);
  take_optional(into.wrap, from.wrap);
}

}  // namespace

Style effective_style(const Node &node, const NodeStates &states) {
  Style merged = node.style;
  for (const StateName name : STATE_ORDER) {
    const size_t index = static_cast<size_t>(name);
    if (!node.has_state[index] || !is_active(name, states)) continue;
    merge(merged, node.state_style[index]);
  }
  return merged;
}

}  // namespace zabloo
