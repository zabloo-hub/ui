#include "focus.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace zabloo {

bool is_collapse_header(const LayoutNode &node) {
  return node.parent != nullptr && node.parent->ir->type == NodeType::Collapse &&
         !node.parent->children.empty() && &node.parent->children[0] == &node;
}

bool is_focusable(const LayoutNode &node) {
  if (node.disabled) return false;
  switch (node.ir->type) {
    case NodeType::Button:
    case NodeType::Toggle:
    case NodeType::Slider:
    case NodeType::TextInput: return true;
    default: return is_collapse_header(node);
  }
}

LayoutNode *autofocus_in(LayoutNode &scope) {
  if (!in_layout(scope)) return nullptr;
  if (scope.ir->autofocus && is_focusable(scope)) return &scope;
  for (LayoutNode &child : scope.children) {
    LayoutNode *found = autofocus_in(child);
    if (found != nullptr) return found;
  }
  return nullptr;
}

void collect_focusables(LayoutNode &scope, std::vector<LayoutNode *> &out) {
  if (!in_layout(scope)) return;  // a pruned subtree has stale rects
  if (is_focusable(scope)) out.push_back(&scope);
  for (LayoutNode &child : scope.children) collect_focusables(child, out);
}

namespace {

double center_x(const Rect &rect) { return rect.x + rect.width / 2.0; }
double center_y(const Rect &rect) { return rect.y + rect.height / 2.0; }

}  // namespace

double navigation_score(const Rect &from, const Rect &to, double dx, double dy) {
  const double delta_x = center_x(to) - center_x(from);
  const double delta_y = center_y(to) - center_y(from);
  const double projection = delta_x * dx + delta_y * dy;
  // Half a pixel of travel is the threshold: a candidate whose centre sits on
  // the axis is beside the focus, not ahead of it.
  if (projection <= 0.5) return -1.0;
  const double orthogonal = std::fabs(delta_x * dy) + std::fabs(delta_y * dx);
  return projection + orthogonal * 2.0;
}

double reveal_delta(double start, double size, double view_start, double view_size) {
  const double before = view_start - start;
  const double after = start + std::max(0.0, size) - (view_start + view_size);
  if (before > 0.0 && after > 0.0) return 0.0;
  if (before > 0.0) return -before;
  return after > 0.0 ? std::min(after, -before) : 0.0;
}

}  // namespace zabloo
