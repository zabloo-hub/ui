#include "input_owner.h"

#include <algorithm>
#include <vector>

namespace godot {
namespace {

/** Views in the tree, in the order they entered — the head is the fallback owner. */
std::vector<ZablooView *> &views() {
  static std::vector<ZablooView *> registry;
  return registry;
}

ZablooView *&owner() {
  static ZablooView *current = nullptr;
  return current;
}

}  // namespace

void register_input_view(ZablooView *view) {
  views().push_back(view);
  if (owner() == nullptr) owner() = view;
}

void unregister_input_view(ZablooView *view) {
  std::vector<ZablooView *> &registry = views();
  registry.erase(std::remove(registry.begin(), registry.end(), view), registry.end());
  if (owner() == view) owner() = registry.empty() ? nullptr : registry.front();
}

void claim_input(ZablooView *view) {
  if (owner() == view) return;
  if (std::find(views().begin(), views().end(), view) == views().end()) return;
  owner() = view;
}

bool owns_input(const ZablooView *view) { return owner() == view; }

}  // namespace godot
