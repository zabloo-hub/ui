#include "overlay_layer.h"

#include <algorithm>

#include "diagnostics.h"
#include "focus.h"
#include "overlay.h"
#include "view.h"

namespace zabloo {

void OverlayLayer::forget(const LayoutNode &node) {
  for (ModalEntry &entry : modal_stack_) {
    if (entry.previous_focus == &node) entry.previous_focus = nullptr;
  }
  modal_stack_.erase(std::remove_if(modal_stack_.begin(), modal_stack_.end(),
                                    [&node](const ModalEntry &entry) {
                                      return entry.overlay == &node;
                                    }),
                     modal_stack_.end());
}

bool OverlayLayer::warn_once(const std::string &id) {
  if (std::find(warned_anchors_.begin(), warned_anchors_.end(), id) != warned_anchors_.end()) {
    return false;
  }
  warned_anchors_.push_back(id);
  return true;
}

// --- focus ----------------------------------------------------------------

bool OverlayLayer::on_present_layer(const LayoutNode &node) const {
  const std::vector<LayoutNode *> &layer = view_.layer_;
  for (const LayoutNode *current = &node; current != nullptr; current = current->parent) {
    if (current->ir->type != NodeType::Overlay) continue;
    if (std::find(layer.begin(), layer.end(), current) == layer.end()) return false;
  }
  return true;
}

void OverlayLayer::sync_modal_focus() {
  std::vector<LayoutNode *> modals;
  for (LayoutNode *entry : view_.layer_) {
    if (is_modal(*entry)) modals.push_back(entry);
  }
  const auto in_layer = [&modals](const LayoutNode *node) {
    return std::find(modals.begin(), modals.end(), node) != modals.end();
  };

  // Gone from the layer (closed or hidden): the OUTERMOST one that left owns the
  // restore, so closing a whole stack returns to what preceded all of it — and
  // that one is the first of those that left, since the stack is innermost-last.
  LayoutNode *closed_focus = nullptr;
  bool any_left = false;
  for (const ModalEntry &entry : modal_stack_) {
    if (in_layer(entry.overlay)) continue;
    if (!any_left) closed_focus = entry.previous_focus;
    any_left = true;
  }
  modal_stack_.erase(std::remove_if(modal_stack_.begin(), modal_stack_.end(),
                                    [&in_layer](const ModalEntry &entry) {
                                      return !in_layer(entry.overlay);
                                    }),
                     modal_stack_.end());

  bool opened = false;
  for (LayoutNode *modal : modals) {
    const bool known = std::any_of(modal_stack_.begin(), modal_stack_.end(),
                                   [modal](const ModalEntry &entry) {
                                     return entry.overlay == modal;
                                   });
    if (known) continue;
    modal_stack_.push_back(ModalEntry{modal, view_.focus_});
    opened = true;
  }
  // Opening wins over closing: the new modal owns the focus.
  LayoutNode *restored = opened ? nullptr : closed_focus;

  LayoutNode &scope = view_.scope();
  LayoutNode *current = view_.focus_;
  if (current != nullptr && in_layout(*current) && is_within(*current, scope) &&
      on_present_layer(*current)) {
    return;
  }
  // G12 (ZAB-145) adds the one exception between here and the line below: a focus
  // waiting on a virtualized row that is not realized right now is not free to
  // give away (ZAB-70), so scrolling a list must never hand it to the view's
  // `autofocus`. There are no unrealized rows until a `Repeat` builds them.
  //
  // Outside the scope (or gone): the restored node if it still qualifies,
  // otherwise the scope's `autofocus` — and nothing at all if neither does,
  // rather than leaving a node under the modal wearing the focused state.
  LayoutNode *candidate =
      restored != nullptr && in_layout(*restored) && is_focusable(*restored) &&
              is_within(*restored, scope)
          ? restored
          : view_.autofocus(scope);
  view_.set_focus(candidate);
}

// --- dismiss --------------------------------------------------------------

void OverlayLayer::request_dismiss(LayoutNode &overlay) {
  if (overlay.ir->type != NodeType::Overlay) return;
  // A popover's open state is the core's, so closing it is a flag and NOT a write
  // into the game's data: `visible` never held it open in the first place.
  if (is_press_triggered(overlay)) {
    overlay.popover_open = false;
  } else if (overlay.ir->visible.is_bound()) {
    std::string path;
    if (view_.write_path(overlay, overlay.ir->visible.bind, path)) {
      view_.write_data(path, DataValue::of_bool(false));
    }
  }
  if (!overlay.ir->on_dismiss.empty()) view_.fire(overlay, overlay.ir->on_dismiss);
}

// --- the enter/exit fade --------------------------------------------------

void OverlayLayer::sync_presence(double now) {
  const std::vector<LayoutNode *> &layer = view_.layer_;
  any_exiting_ = false;
  for (LayoutNode *overlay : view_.overlays_) {
    if (overlay->presence_anim == nullptr) overlay->presence_anim = std::make_unique<NodeAnim>();
    const bool live = std::find(layer.begin(), layer.end(), overlay) != layer.end();
    const std::optional<ResolvedTransition> transition = view_.transition_of(*overlay);
    const SteppedValue stepped = step_presence(
        overlay->presence_anim.get(), live, transition.has_value() ? &*transition : nullptr, now);
    if (stepped.animating) view_.animating_ = true;
    // Recorded even at 0 — the frame an overlay opens on starts there, and a
    // missing value would paint it fully opaque for exactly that frame, which
    // reads as a flash right before the fade in.
    overlay->presence = stepped.value;
    // Out of the live layer but still visible: it paints, and nothing else. It
    // takes no input, traps no focus and re-arms no timer, because every one of
    // those reads the live layer, which it already left.
    overlay->presence_exiting = !live && stepped.value > 0.0;
    if (overlay->presence_exiting) any_exiting_ = true;
  }
}

// --- autoCloseMs ----------------------------------------------------------

void OverlayLayer::sync_auto_close(double now) {
  const std::vector<LayoutNode *> &layer = view_.layer_;
  auto_close_armed_ = false;
  auto_close_fired_ = false;
  for (LayoutNode *overlay : view_.overlays_) {
    const bool live = std::find(layer.begin(), layer.end(), overlay) != layer.end();
    const std::optional<double> ms = auto_close_ms(*overlay);
    // Never for a triggered overlay: a hint is dismissed by leaving its anchor,
    // and a popover by choosing or dismissing.
    if (!live || !ms.has_value() || is_anchored(*overlay)) {
      overlay->auto_close_at.reset();
      continue;
    }
    // Armed once, not once per frame: re-arming here would keep pushing the
    // deadline forward and the toast would never close.
    if (!overlay->auto_close_at.has_value()) overlay->auto_close_at = now + *ms;
    if (now < *overlay->auto_close_at) {
      auto_close_armed_ = true;
      continue;
    }
    overlay->auto_close_at.reset();
    request_dismiss(*overlay);
    auto_close_fired_ = true;
  }
}

// --- anchoring (2026-08-11, ZAB-46) ---------------------------------------

/**
 * The node an overlay is anchored to, or null.
 *
 * An id that resolves to nothing is authoring error, and the LOAD pass already
 * said so once, naming the view (`unknown-anchor`) — so nothing is reported here,
 * for the same reason an unknown token is not: this runs per overlay per frame.
 * The overlay falls back to the layer placement it still carries, so a typo shows
 * a v1 tooltip instead of nothing at all.
 */
LayoutNode *OverlayLayer::anchor_node(const std::string &id) {
  const auto found = view_.by_id_.find(id);
  return found != view_.by_id_.end() ? found->second : nullptr;
}

bool OverlayLayer::layer_present(const LayoutNode &node) {
  return in_layout(node) && anchor_allows(node);
}

bool OverlayLayer::anchor_allows(const LayoutNode &node) {
  if (!is_anchored(node)) return true;
  const OverlayAnchor &spec = node.ir->anchor;
  LayoutNode *anchor = anchor_node(spec.id);
  if (anchor == nullptr) return true;
  // A tooltip that has lost sight of its anchor is pointing at nothing.
  if (!is_on_screen(*anchor, anchor_clips_)) return false;
  if (spec.trigger == OverlayTrigger::Manual) return true;
  // Hover lights up exactly the focusable set (2026-08-11, ZAB-36), so an anchor
  // that takes no input is never hovered NOR focused and the hint would simply
  // never appear. A popover has the same problem for the same reason: a node that
  // takes no press can never be pressed to open it.
  // Not caught by the load pass, unlike a dangling id: focusability depends on
  // the inherited `disabled` flag, which only the resolve pass settles.
  if (!is_focusable(*anchor) && warn_once(spec.id)) {
    Diagnostic warning;
    warning.level = DiagnosticLevel::Warn;
    warning.code = DiagnosticCode::InvalidProp;
    warning.path = node.ir->id;
    warning.message = "overlay anchor \"" + spec.id + "\" is a " +
                      node_type_name(anchor->ir->type) +
                      ", which takes no input: a triggered overlay anchored to it never shows";
    view_.warnings_.push_back(std::move(warning));
  }
  // A popover is up while the core's own open flag says so — the one piece of
  // overlay state that is not `visible` (2026-08-12, ZAB-25).
  if (spec.trigger == OverlayTrigger::Press) return node.popover_open;
  return anchor->hovered || anchor->focused;
}

void OverlayLayer::arrange_overlay(LayoutNode &overlay, const Rect &view_rect) {
  LayoutNode *anchor = is_anchored(overlay) ? anchor_node(overlay.ir->anchor.id) : nullptr;
  if (anchor == nullptr) {
    arrange(overlay, view_rect);
    return;
  }
  const OverlayAnchor &spec = overlay.ir->anchor;
  const double padding = overlay.resolved.padding;
  const Size content{overlay.natural.x - padding * 2.0, overlay.natural.y - padding * 2.0};
  const Rect box = anchor_box(anchor->rect, content, spec.at,
                              view_.dim(spec.offset, ANCHOR_OFFSET), deflate(view_rect, padding));
  arrange(overlay, Rect{box.x - padding, box.y - padding, box.width + padding * 2.0,
                        box.height + padding * 2.0});
  // The entry's own rect stays the VIEW's: what was placed around the anchor is
  // its content, so an anchored modal still dims and captures the whole screen.
  overlay.rect = view_rect;
}

// --- popovers (2026-08-12, ZAB-25) ----------------------------------------

bool OverlayLayer::toggle_popovers(LayoutNode &anchor) {
  const std::string &id = anchor.ir->id;
  if (id.empty()) return false;
  bool found = false;
  // Any number of them, because `anchor.id` is a plain reference and nothing
  // stops two overlays from hanging off one button.
  for (LayoutNode *overlay : view_.overlays_) {
    if (!is_press_triggered(*overlay) || overlay->ir->anchor.id != id) continue;
    overlay->popover_open = !overlay->popover_open;
    found = true;
  }
  return found;
}

void OverlayLayer::close_enclosing_popover(LayoutNode &node) {
  for (LayoutNode *current = &node; current != nullptr; current = current->parent) {
    if (current->ir->type == NodeType::Overlay && is_press_triggered(*current)) {
      current->popover_open = false;
      return;
    }
  }
}

}  // namespace zabloo
