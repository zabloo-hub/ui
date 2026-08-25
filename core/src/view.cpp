#include "view.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace zabloo {
namespace {

/** A `Text` with no `fontSize` of its own. */
constexpr double DEFAULT_FONT_SIZE = 16.0;
/** Above this a glyph atlas stops being an atlas; the same cap the web uses. */
constexpr double MAX_FONT_SIZE = 512.0;

/**
 * Which types take input. `hover` lights up exactly the focusable set
 * (2026-08-11, ZAB-36), so one rule answers both questions rather than two lists
 * drifting apart. The rest of the set — Toggle, Slider, TextInput, a Collapse
 * header — joins as those types land; G2 owns the Button.
 */
bool takes_input(const LayoutNode &node) {
  if (node.disabled) return false;  // out of the interaction model (ZAB-63)
  return node.ir->type == NodeType::Button;
}

/** The same set, before `disabled` is known — see `first_autofocus`. */
bool input_type(const LayoutNode &node) { return node.ir->type == NodeType::Button; }

}  // namespace

// --- leaves ---------------------------------------------------------------

/**
 * Sizing for the childless types.
 *
 * `Text` measures ZERO WIDE and one line tall until G4 (ZAB-137) brings the
 * rasterizer, the atlas and the wrap pass. That is not an arbitrary placeholder:
 * it is exactly what the reference does with an EMPTY string (ZAB-65), so a
 * label still holds its slot and its surrounding gaps, and a row does not
 * re-space itself the day the glyphs arrive — the box grows sideways, nothing
 * moves to a different line. `Image` waits for the manifest in G5 (ZAB-138).
 */
class View::Leaves : public LeafMeasurer {
 public:
  explicit Leaves(View &view) : view_(view) {}

  Size measure_leaf(LayoutNode &node, std::optional<double> available) override {
    (void)available;
    if (node.ir->type != NodeType::Text) return Size{};
    const Style &style = view_.style_of(node);
    const double size = std::min(
        MAX_FONT_SIZE, std::max(1.0, std::round(view_.dim(style.font_size, DEFAULT_FONT_SIZE))));
    return Size{0.0, std::max(0.0, view_.dim(style.line_height, size))};
  }

 private:
  View &view_;
};

// --- view -----------------------------------------------------------------

View::View(const Envelope &envelope, std::string_view view_id) : envelope_(&envelope) {
  const ViewDef *found = envelope.view(view_id);
  id_ = std::string(view_id);
  ir_root_ = found != nullptr ? &found->root : nullptr;
  if (ir_root_ == nullptr) return;
  build_layout_tree(*ir_root_, root_);
  // `autofocus` is the only new field focus needed in the IR (2026-08-04) and it
  // is INITIAL state, like a Collapse's `open` — so it is read once, here.
  // Moving the focus (spatial navigation, the modal scope, dropping it when the
  // node it sits on goes disabled) is G7's (ZAB-140), which is also why this
  // cannot yet ask whether the node is disabled: nothing has resolved that.
  focus_ = first_autofocus(root_);
  if (focus_ != nullptr) focus_->focused = true;
}

LayoutNode *View::first_autofocus(LayoutNode &node) {
  if (node.ir->autofocus && input_type(node)) return &node;
  for (LayoutNode &child : node.children) {
    LayoutNode *found = first_autofocus(child);
    if (found != nullptr) return found;
  }
  return nullptr;
}

void View::set_size(double width, double height) {
  viewport_ = Rect{0.0, 0.0, std::max(0.0, width), std::max(0.0, height)};
}

void View::layout_frame() {
  if (ir_root_ == nullptr) return;
  frame_++;
  sync_flags(root_);
  resolve(root_);
  Leaves leaves(*this);
  measure(root_, leaves, viewport_.width);
  arrange(root_, viewport_);
}

/**
 * `visible` is the single hiding mechanism, with `display:none` semantics — a
 * hidden node leaves the layout, taking its gaps with it.
 *
 * A BOUND `visible` with no data starts hidden: data-driven visibility means
 * "visible when the data says so" (2026-08-03). Reading the data itself is G7
 * (ZAB-140); until then every binding reads as no value, which lands on that
 * same default rather than on a special case.
 */
void View::sync_flags(LayoutNode &node) {
  node.visible_flag = node.ir->visible.is_bound() ? false : node.ir->visible.literal(true);
  node.disabled_flag = node.ir->disabled.is_bound() ? false : node.ir->disabled.literal(false);
  // G7 (ZAB-140) and G10 (ZAB-143) set `section_shown` from a Collapse's `open`
  // and an `"exclusive-select"` group's selection. Until then every section is
  // shown, which is the degradation an SDK that predates those types gives.
  for (LayoutNode &child : node.children) sync_flags(child);
}

const Style &View::style_of(LayoutNode &node) {
  // Stamped with the frame counter rather than invalidated by hand: every state
  // change goes on to lay out again, so "same frame" and "nothing has moved" are
  // the same statement. Three passes ask for this per node (resolve, measure,
  // paint) and the merge is not free (ZAB-73).
  if (node.style_frame == frame_) return node.style_cache;
  NodeStates states;
  states.hovered = node.hovered;
  states.pressed = node.pressed;
  states.focused = node.focused;
  states.disabled = node.disabled;
  node.style_cache = effective_style(*node.ir, states);
  node.style_frame = frame_;
  return node.style_cache;
}

void View::resolve(LayoutNode &node) {
  if (!in_layout(node)) return;
  // Effective `disabled` BEFORE the style resolves, since it is a state the merge
  // has to see this very frame (ZAB-63). It inherits from the parent — one prop
  // on a section answers for every control in it — and an `Overlay` restarts the
  // chain: a layer entry is the top of its own input scope, so a modal declared
  // inside a disabled panel stays operable and dismissable.
  node.disabled = node.disabled_flag || (node.ir->type != NodeType::Overlay &&
                                         node.parent != nullptr && node.parent->disabled);
  const Style &style = style_of(node);
  const Layout &layout = node.ir->layout;
  ResolvedValues &out = node.resolved;

  out.background = optional_color(style.background, MISSING_COLOR);
  // An undeclared border color HOLDS the last one instead of dropping it: the
  // border it paints is on its way out through `borderWidth`, and a focus ring
  // that lost its color halfway would flash the missing-color magenta (ZAB-36).
  const std::optional<Color> border = optional_color(style.border_color, MISSING_COLOR);
  if (border.has_value()) out.border_color = border;
  out.color = optional_color(style.color, DEFAULT_TEXT_COLOR);
  out.opacity = std::min(1.0, std::max(0.0, style.opacity.value_or(1.0)));
  out.radius = dim(style.radius, 0.0);
  out.border_width = dim(style.border_width, 0.0);
  out.gap = dim(layout.gap, 0.0);
  out.padding = dim(layout.padding, 0.0);
  out.width = optional_dim(layout.width);
  out.height = optional_dim(layout.height);

  // G8 (ZAB-141) steps these through the transition engine before they land in
  // `resolved`. The instant path here is what a node with no `transition` does
  // there too, so nothing above this line changes when it arrives.
  for (LayoutNode &child : node.children) resolve(child);
}

double View::dim(const Dim &value, double fallback) const {
  if (value.kind == Dim::Kind::Number) return value.number;
  if (value.kind == Dim::Kind::Token) {
    const TokenValue *token = envelope_->token(value.token);
    // A token the dictionary does not define resolves to "no value" and the
    // property falls back to its default. Not reported here: this runs per node
    // per frame, and the load pass already said it once, naming the node and the
    // property it sits on (2026-08-12).
    if (token != nullptr && token->is_number) return token->number;
  }
  return fallback;
}

std::optional<double> View::optional_dim(const Dim &value) const {
  if (!value.present()) return std::nullopt;
  if (value.kind == Dim::Kind::Number) return value.number;
  const TokenValue *token = envelope_->token(value.token);
  if (token != nullptr && token->is_number) return token->number;
  return std::nullopt;
}

Color View::color(const ColorValue &value, Color fallback) const {
  std::string_view literal;
  if (value.kind == ColorValue::Kind::Literal) {
    literal = value.text;
  } else if (value.kind == ColorValue::Kind::Token) {
    const TokenValue *token = envelope_->token(value.text);
    if (token == nullptr || token->is_number) return fallback;
    literal = token->text;
  } else {
    return fallback;
  }
  Color parsed;
  return parse_color_literal(literal, parsed) ? parsed : fallback;
}

std::optional<Color> View::optional_color(const ColorValue &value, Color fallback) const {
  if (!value.present()) return std::nullopt;
  return color(value, fallback);
}

// --- paint ----------------------------------------------------------------

const GeometryBuilder &View::paint() {
  geometry_.reset();
  if (ir_root_ != nullptr) paint_node(root_, 1.0);
  return geometry_;
}

/**
 * Paint is implicit: a node's style IS its geometry (2026-08-01 #4). Opacity
 * inherits multiplicatively down the subtree and lands as a per-vertex alpha
 * (2026-08-06), so a parent at 0.5 over a child at 0.5 paints at 0.25 without
 * anything rendering to a texture.
 */
void View::paint_node(const LayoutNode &node, double opacity) {
  if (!in_layout(node)) return;
  const double own = opacity * node.resolved.opacity;
  if (node.resolved.background.has_value()) {
    geometry_.rounded_rect(node.rect, node.resolved.radius, fade(*node.resolved.background, own));
  }
  // The ring only paints where there is a width to paint it with, which is also
  // what makes holding an undeclared color harmless.
  if (node.resolved.border_width > 0.0 && node.resolved.border_color.has_value()) {
    geometry_.rounded_rect_border(node.rect, node.resolved.radius, node.resolved.border_width,
                                  fade(*node.resolved.border_color, own));
  }
  // G4 (ZAB-137) paints the glyphs of a `Text` here, G5 (ZAB-138) an `Image`.
  for (const LayoutNode &child : node.children) paint_node(child, own);
}

// --- input ----------------------------------------------------------------

/**
 * The deepest, topmost node whose OWN rect contains the point.
 *
 * The walk descends unconditionally and returns a node on its own rect rather
 * than pruning on the parent's: before ZAB-7 an overflowing child painted but
 * could not be pressed, which is the same paint/input mismatch as clipping only
 * the paint, in the other direction. From G6 (ZAB-139) a `clip` is what cuts the
 * descent — and it is the only thing that does.
 */
LayoutNode *View::hit(LayoutNode &node, double x, double y) {
  if (!in_layout(node)) return nullptr;
  // Later siblings paint over earlier ones, so they are asked first.
  for (size_t i = node.children.size(); i > 0; i--) {
    LayoutNode *found = hit(node.children[i - 1], x, y);
    if (found != nullptr) return found;
  }
  return node.rect.contains(x, y) ? &node : nullptr;
}

LayoutNode *View::pressable_at(double x, double y) {
  LayoutNode *node = ir_root_ != nullptr ? hit(root_, x, y) : nullptr;
  // Up from what was hit to whatever governs the gesture: a label inside a button
  // is pressed by pressing the button.
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (takes_input(*candidate)) return candidate;
  }
  return nullptr;
}

bool View::pointer_move(double x, double y) {
  LayoutNode *target = pressable_at(x, y);
  if (target == hovered_) return false;
  if (hovered_ != nullptr) hovered_->hovered = false;
  hovered_ = target;
  if (hovered_ != nullptr) hovered_->hovered = true;
  return true;
}

bool View::pointer_down(double x, double y) {
  const bool moved = pointer_move(x, y);
  LayoutNode *target = pressable_at(x, y);
  if (target == nullptr) return moved;
  if (pressed_ != nullptr) pressed_->pressed = false;
  pressed_ = target;
  pressed_->pressed = true;
  return true;
}

bool View::pointer_up(double x, double y) {
  LayoutNode *released = pressed_;
  if (released == nullptr) return pointer_move(x, y);
  released->pressed = false;
  pressed_ = nullptr;
  // A press that leaves the control it started on fires nothing — the same rule
  // a cancelled gesture follows (ZAB-70): it ends, it does not conclude.
  if (pressable_at(x, y) == released && !released->ir->on_click.empty()) {
    fire(*released, released->ir->on_click);
  }
  pointer_move(x, y);
  return true;
}

bool View::pointer_exit() {
  bool changed = false;
  if (pressed_ != nullptr) {
    pressed_->pressed = false;
    pressed_ = nullptr;
    changed = true;
  }
  if (hovered_ != nullptr) {
    hovered_->hovered = false;
    hovered_ = nullptr;
    changed = true;
  }
  return changed;
}

void View::fire(const LayoutNode &node, const std::string &action) {
  (void)node;
  ActionEvent event;
  event.name = action;
  actions_.push_back(std::move(event));
}

std::vector<ActionEvent> View::drain_actions() {
  std::vector<ActionEvent> out;
  out.swap(actions_);
  return out;
}

// --- document -------------------------------------------------------------

bool Document::load(std::string_view json_text) {
  EnvelopeReport report = read_envelope(json_text);
  diagnostics_ = std::move(report.diagnostics);
  // A refused payload leaves what is already on screen alone: the update is lost,
  // never the session.
  if (!report.ok) return false;

  const std::string previous = view_ ? view_->id() : std::string();
  // The view goes FIRST: it reads the envelope, so it must never outlive one.
  view_.reset();
  envelope_ = std::make_unique<Envelope>(std::move(report.envelope));
  loaded_ = true;
  // The view that was on screen keeps its place across the swap when the new
  // envelope still has it; otherwise the first one takes over, which is what a
  // freshly imported file wants.
  if (!previous.empty() && show(previous)) return true;
  if (!envelope_->views.empty()) show(envelope_->views.front().id);
  return true;
}

bool Document::show(std::string_view view_id) {
  if (!loaded_ || envelope_ == nullptr || envelope_->view(view_id) == nullptr) return false;
  view_ = std::make_unique<View>(*envelope_, view_id);
  return true;
}

void Document::set_data(std::string_view path, const DataValue &value) {
  for (auto &entry : data_) {
    if (entry.first == path) {
      entry.second = value;
      return;
    }
  }
  data_.emplace_back(std::string(path), value);
}

const DataValue *Document::data(std::string_view path) const {
  for (const auto &entry : data_) {
    if (entry.first == path) return &entry.second;
  }
  return nullptr;
}

}  // namespace zabloo
