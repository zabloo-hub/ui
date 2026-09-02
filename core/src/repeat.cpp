#include "repeat.h"

#include <algorithm>
#include <cmath>

namespace zabloo {

const Node *item_template(const Node &ir) {
  return ir.children.empty() ? nullptr : &ir.children[0];
}

const DataValue *items_of(const DataValue *value) {
  return value != nullptr && value->kind == DataValue::Kind::Array ? value : nullptr;
}

void window_slots(const DataValue *items, std::string_view key_path, int first, int count,
                  std::vector<ItemSlot> &out) {
  out.clear();
  if (items == nullptr) return;
  const int size = static_cast<int>(items->items.size());
  const int end = std::min(size, first + count);
  // Only a KEYED list can collide: a positional identity is unique by
  // construction, so an unkeyed window has nothing to remember and this stays a
  // walk with no set behind it — which matters, because a scroll runs it every
  // frame.
  const bool keyed = !key_path.empty();
  std::unordered_set<std::string> seen;
  for (int index = std::max(0, first); index < end; index++) {
    const ItemKey key =
        keyed ? item_key(&items->items[static_cast<size_t>(index)], key_path) : ItemKey();
    std::string identity = item_identity(key, index);
    // A key two elements share cannot identify either: the second falls back to
    // its position, which the `k:` prefix keeps disjoint from the keyed space.
    if (keyed) {
      if (seen.count(identity) > 0) identity = item_identity(ItemKey(), index);
      seen.insert(identity);
    }
    ItemSlot slot;
    slot.index = index;
    slot.identity = std::move(identity);
    out.push_back(std::move(slot));
  }
}

int items_per_line(double content, double item, double gap) {
  if (!(content > 0.0) || !(item > 0.0)) return 1;
  return std::max(1, static_cast<int>(std::floor((content + gap) / (item + gap))));
}

int line_count(int items, int per_line) {
  if (per_line <= 0) return 0;
  return (items + per_line - 1) / per_line;
}

namespace {

int clamp_line(double line, int lines) {
  const double capped = std::min(static_cast<double>(lines - 1), std::max(0.0, line));
  return static_cast<int>(capped);
}

}  // namespace

ItemSpan visible_span(int item_count, const ItemMetrics &metrics, double view_start,
                      double view_length, int buffer) {
  ItemSpan span;
  span.per_line = std::max(1, metrics.per_line);
  const int lines = line_count(item_count, span.per_line);
  const double gap = std::max(0.0, metrics.gap);
  const double stride = metrics.extent + gap;
  span.reserved =
      lines > 0 ? lines * metrics.extent + gap * static_cast<double>(lines - 1) : 0.0;
  // Nothing to window against: an empty array, or a size no frame has measured
  // yet. Realizing everything is the honest answer to both.
  if (lines == 0 || !(stride > 0.0)) {
    span.count = item_count;
    return span;
  }
  const int first_line = clamp_line(std::floor(view_start / stride) - buffer, lines);
  const int last_line =
      clamp_line(std::floor((view_start + std::max(0.0, view_length)) / stride) + buffer, lines);
  span.first = first_line * span.per_line;
  span.count = std::min(item_count, (last_line + 1) * span.per_line) - span.first;
  span.lead = first_line * stride;
  return span;
}

}  // namespace zabloo
