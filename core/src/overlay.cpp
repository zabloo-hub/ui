#include "overlay.h"

#include <algorithm>
#include <cmath>

#include "hit.h"

namespace zabloo {
namespace {

bool is_overlay(const LayoutNode &node) { return node.ir->type == NodeType::Overlay; }

/** The anchor of an Overlay node, or null for anything else — including an
 * `anchor` with no `id`, which anchors nothing. */
const OverlayAnchor *anchor_of(const LayoutNode &node) {
  if (!is_overlay(node)) return nullptr;
  const OverlayAnchor &anchor = node.ir->anchor;
  if (!anchor.present || anchor.id.empty()) return nullptr;
  return &anchor;
}

/** Which side of the anchor the content takes, and how it aligns along it. */
enum class Side { On, Top, Bottom, Left, Right };

struct Placement {
  Side side = Side::Top;
  double align = 0.5;
};

Placement placement(AnchorAt at) {
  switch (at) {
    case AnchorAt::Center: return {Side::On, 0.5};
    case AnchorAt::Top: return {Side::Top, 0.5};
    case AnchorAt::Bottom: return {Side::Bottom, 0.5};
    case AnchorAt::Left: return {Side::Left, 0.5};
    case AnchorAt::Right: return {Side::Right, 0.5};
    case AnchorAt::TopLeft: return {Side::Top, 0.0};
    case AnchorAt::TopRight: return {Side::Top, 1.0};
    case AnchorAt::BottomLeft: return {Side::Bottom, 0.0};
    case AnchorAt::BottomRight: return {Side::Bottom, 1.0};
  }
  return {Side::Top, 0.5};
}

Side opposite(Side side) {
  switch (side) {
    case Side::Top: return Side::Bottom;
    case Side::Bottom: return Side::Top;
    case Side::Left: return Side::Right;
    case Side::Right: return Side::Left;
    case Side::On: return Side::On;
  }
  return Side::On;
}

/** The content's near edge on the side's own axis. */
double side_start(Side side, const Rect &anchor, const Size &size, double offset) {
  switch (side) {
    case Side::Top: return anchor.y - offset - size.y;
    case Side::Bottom: return anchor.y + anchor.height + offset;
    case Side::Left: return anchor.x - offset - size.x;
    case Side::Right: return anchor.x + anchor.width + offset;
    case Side::On: return 0.0;
  }
  return 0.0;
}

/** Whether that side has room inside `bounds` — what decides the flip. */
bool fits(Side side, const Rect &anchor, const Size &size, double offset, const Rect &bounds) {
  const double start = side_start(side, anchor, size, offset);
  switch (side) {
    case Side::Top: return start >= bounds.y;
    case Side::Bottom: return start + size.y <= bounds.y + bounds.height;
    case Side::Left: return start >= bounds.x;
    case Side::Right: return start + size.x <= bounds.x + bounds.width;
    case Side::On: return true;
  }
  return true;
}

/** Slides a span inside the bounds; content wider than them starts at their edge. */
double clamp_axis(double start, double size, double bounds_start, double bounds_size) {
  if (size >= bounds_size) return bounds_start;
  return std::min(std::max(start, bounds_start), bounds_start + bounds_size - size);
}

/**
 * The node's position in the document, as the child index of each step down from
 * the root. Comparing two of these is comparing document order — the order a
 * walk would have found them in, recovered without the walk.
 */
std::vector<uint32_t> document_path(const LayoutNode &node) {
  std::vector<uint32_t> path;
  for (const LayoutNode *current = &node; current->parent != nullptr; current = current->parent) {
    const std::vector<LayoutNode> &siblings = current->parent->children;
    // The children live in a vector the parent owns, so the index is the offset.
    path.push_back(static_cast<uint32_t>(current - siblings.data()));
  }
  std::reverse(path.begin(), path.end());
  return path;
}

/** Whether every node from `node` up to the root is present. */
bool chain_present(const LayoutNode &node, const Presence &present) {
  for (const LayoutNode *current = &node; current != nullptr; current = current->parent) {
    if (!present.present(*current)) return false;
  }
  return true;
}

/**
 * The overlay's own rect is backdrop, never a target: only its children can be
 * hit. The layer starts a fresh clipping scope — an Overlay is arranged against
 * the view rect, so the clips where it was declared don't apply — but its OWN
 * clip does.
 */
LayoutNode *hit_children(LayoutNode &overlay, double x, double y, ClipArena &arena) {
  const Clip *clip = child_clip(overlay, nullptr, arena);
  for (size_t i = overlay.children.size(); i > 0; i--) {
    LayoutNode *found = hit_test(overlay.children[i - 1], x, y, arena, clip);
    if (found != nullptr) return found;
  }
  return nullptr;
}

LayoutNode *checked_option(LayoutNode &node) {
  for (LayoutNode &child : node.children) {
    // A nested group owns its own options, exactly as `group_options` reads it.
    if (child.ir->type == NodeType::Container &&
        child.ir->group == GroupBehavior::ExclusiveCheck) {
      continue;
    }
    if (child.ir->type == NodeType::Toggle && child.checked && in_layout(child)) return &child;
    LayoutNode *found = checked_option(child);
    if (found != nullptr) return found;
  }
  return nullptr;
}

}  // namespace

bool is_modal(const LayoutNode &node) { return is_overlay(node) && node.ir->modal; }

std::optional<double> auto_close_ms(const LayoutNode &node) {
  if (!is_overlay(node)) return std::nullopt;
  const std::optional<double> &declared = node.ir->auto_close_ms;
  if (!declared.has_value() || !(*declared > 0.0)) return std::nullopt;
  return declared;
}

bool is_anchored(const LayoutNode &node) { return anchor_of(node) != nullptr; }

bool is_hover_triggered(const LayoutNode &node) {
  const OverlayAnchor *anchor = anchor_of(node);
  return anchor != nullptr && anchor->trigger == OverlayTrigger::Hover;
}

bool is_press_triggered(const LayoutNode &node) {
  const OverlayAnchor *anchor = anchor_of(node);
  return anchor != nullptr && anchor->trigger == OverlayTrigger::Press;
}

std::vector<LayoutNode *> collect_layer(const std::vector<LayoutNode *> &overlays,
                                        const Presence &present) {
  struct Entry {
    LayoutNode *node;
    std::vector<uint32_t> path;
    double z;
  };
  std::vector<Entry> found;
  for (LayoutNode *node : overlays) {
    if (!chain_present(*node, present)) continue;
    found.push_back(Entry{node, document_path(*node), node->ir->z});
  }
  // Stable so that two entries the comparison calls equal — which only happens
  // for one node handed in twice — keep the order they were given in.
  std::stable_sort(found.begin(), found.end(), [](const Entry &a, const Entry &b) {
    if (a.z != b.z) return a.z < b.z;
    // Lexicographic, so an ancestor sorts before the descendant it contains.
    return std::lexicographical_compare(a.path.begin(), a.path.end(), b.path.begin(),
                                        b.path.end());
  });
  std::vector<LayoutNode *> layer;
  layer.reserve(found.size());
  for (const Entry &entry : found) layer.push_back(entry.node);
  return layer;
}

void overlays_of(LayoutNode &root, std::vector<LayoutNode *> &out) {
  // Keep descending through an overlay: a nested one is legal and joins the same
  // layer, ordered like any other entry.
  if (is_overlay(root)) out.push_back(&root);
  for (LayoutNode &child : root.children) overlays_of(child, out);
}

SteppedValue step_presence(NodeAnim *anim, bool live, const ResolvedTransition *transition,
                           double now) {
  return step_value(anim, TrackKey::Presence, live ? 1.0 : 0.0, transition, now);
}

LayoutNode *top_modal(const std::vector<LayoutNode *> &layer) {
  for (size_t i = layer.size(); i > 0; i--) {
    if (is_modal(*layer[i - 1])) return layer[i - 1];
  }
  return nullptr;
}

LayoutNode &focus_scope(LayoutNode &root, const std::vector<LayoutNode *> &layer) {
  LayoutNode *modal = top_modal(layer);
  return modal != nullptr ? *modal : root;
}

bool is_within(const LayoutNode &node, const LayoutNode &ancestor) {
  for (const LayoutNode *current = &node; current != nullptr; current = current->parent) {
    if (current == &ancestor) return true;
  }
  return false;
}

bool is_on_screen(LayoutNode &node, ClipArena &arena) {
  for (const LayoutNode *current = &node; current != nullptr; current = current->parent) {
    if (!in_layout(*current)) return false;
  }
  const Clip *clip = effective_clip(node, arena);
  if (clip == nullptr) return true;
  const Clip cut = intersect_clip(clip, node.rect, 0.0);
  return !is_empty_clip(&cut);
}

void check_groups_in(LayoutNode &node, std::vector<LayoutNode *> &out) {
  if (node.ir->type == NodeType::Container && node.ir->group == GroupBehavior::ExclusiveCheck) {
    out.push_back(&node);
    return;
  }
  for (LayoutNode &child : node.children) check_groups_in(child, out);
}

LayoutNode *selected_option_in(LayoutNode &overlay) {
  std::vector<LayoutNode *> groups;
  check_groups_in(overlay, groups);
  for (LayoutNode *group : groups) {
    LayoutNode *found = checked_option(*group);
    if (found != nullptr) return found;
  }
  return nullptr;
}

Rect deflate(const Rect &rect, double padding) {
  if (padding <= 0.0) return rect;
  return Rect{rect.x + padding, rect.y + padding, std::max(0.0, rect.width - padding * 2.0),
              std::max(0.0, rect.height - padding * 2.0)};
}

Rect anchor_box(const Rect &anchor, const Size &size, AnchorAt at, double offset,
                const Rect &bounds) {
  const Placement placed = placement(at);
  Rect box{0.0, 0.0, size.x, size.y};
  if (placed.side == Side::On) {
    box.x = anchor.x + (anchor.width - size.x) * 0.5;
    box.y = anchor.y + (anchor.height - size.y) * 0.5;
  } else {
    const Side preferred = placed.side;
    const Side side = fits(preferred, anchor, size, offset, bounds) ||
                              !fits(opposite(preferred), anchor, size, offset, bounds)
                          ? preferred
                          : opposite(preferred);
    if (side == Side::Top || side == Side::Bottom) {
      box.y = side_start(side, anchor, size, offset);
      box.x = anchor.x + (anchor.width - size.x) * placed.align;
    } else {
      box.x = side_start(side, anchor, size, offset);
      box.y = anchor.y + (anchor.height - size.y) * placed.align;
    }
  }
  box.x = clamp_axis(box.x, size.x, bounds.x, bounds.width);
  box.y = clamp_axis(box.y, size.y, bounds.y, bounds.height);
  return box;
}

LayerHit resolve_hit(LayoutNode &root, const std::vector<LayoutNode *> &layer, double x, double y,
                     ClipArena &arena) {
  // Topmost entry first: it is the one painted over the rest.
  for (size_t i = layer.size(); i > 0; i--) {
    LayoutNode &overlay = *layer[i - 1];
    if (!is_overlay(overlay) || !in_layout(overlay) || is_hover_triggered(overlay)) continue;
    LayoutNode *found = hit_children(overlay, x, y, arena);
    if (found != nullptr) return LayerHit{LayerHit::Kind::Node, found};
    if (is_modal(overlay) && overlay.rect.contains(x, y)) {
      return LayerHit{LayerHit::Kind::Backdrop, &overlay};
    }
  }
  LayoutNode *found = hit_test(root, x, y, arena);
  return found != nullptr ? LayerHit{LayerHit::Kind::Node, found} : LayerHit{};
}

}  // namespace zabloo
