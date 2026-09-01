#include "hit.h"

#include <vector>

namespace zabloo {

bool clips_children(const LayoutNode &node) {
  return node.ir->type == NodeType::ScrollView || node.ir->clip || node.forced_clip;
}

const Clip *child_clip(const LayoutNode &node, const Clip *inherited, ClipArena &arena) {
  if (!clips_children(node)) return inherited;
  return arena.intern(intersect_clip(inherited, node.rect, node.resolved.radius));
}

LayoutNode *hit_test(LayoutNode &root, double x, double y, ClipArena &arena,
                     const Clip *inherited) {
  if (!in_flow(root) || !clip_contains(inherited, x, y)) return nullptr;

  const Clip *clip = child_clip(root, inherited, arena);
  // Outside this node's own region: it prunes the subtree. When the node does not
  // clip, `clip == inherited` and this only ever costs a re-check.
  if (!is_empty_clip(clip) && clip_contains(clip, x, y)) {
    // Last child first: later siblings paint over earlier ones.
    for (size_t i = root.children.size(); i > 0; i--) {
      LayoutNode *found = hit_test(root.children[i - 1], x, y, arena, clip);
      if (found != nullptr) return found;
    }
  }
  return root.rect.contains(x, y) ? &root : nullptr;
}

const Clip *effective_clip(const LayoutNode &node, ClipArena &arena) {
  // Up to and INCLUDING the enclosing Overlay: its own clip still applies to its
  // children.
  std::vector<const LayoutNode *> ancestors;
  for (const LayoutNode *current = node.parent; current != nullptr;
       current = current->parent) {
    ancestors.push_back(current);
    if (current->ir->type == NodeType::Overlay) break;
  }

  // Outermost first, each region narrowing the one above it.
  const Clip *clip = nullptr;
  for (size_t i = ancestors.size(); i > 0; i--) {
    clip = child_clip(*ancestors[i - 1], clip, arena);
  }
  return clip;
}

}  // namespace zabloo
