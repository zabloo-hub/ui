#include "view.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "focus.h"
#include "text.h"

namespace zabloo {
namespace {

/** A `Text` with no `fontSize` of its own. */
constexpr double DEFAULT_FONT_SIZE = 16.0;
/** Above this a glyph atlas stops being an atlas; the same cap the web uses. */
constexpr double MAX_FONT_SIZE = 512.0;

}  // namespace

// --- leaves ---------------------------------------------------------------

/**
 * Sizing for the childless types. `Image` waits for the manifest in G5
 * (ZAB-138); a `TextInput` is one line tall and has no intrinsic width, which is
 * G11's (ZAB-144).
 */
class View::Leaves : public LeafMeasurer {
 public:
  explicit Leaves(View &view) : view_(view) {}

  Size measure_leaf(LayoutNode &node, std::optional<double> available) override {
    if (node.ir->type != NodeType::Text) return Size{};
    return view_.measure_text(node, available);
  }

 private:
  View &view_;
};

/**
 * Wrapping happens HERE, once per frame: the block is kept on the node so paint
 * and the snapshot reuse these very lines instead of breaking the text a second
 * time. The node also keeps WHAT it wrapped, so the frames that changed none of
 * it — most of them, for the static labels a UI is mostly made of — reuse the
 * block instead of measuring every glyph again (ZAB-69).
 */
Size View::measure_text(LayoutNode &node, std::optional<double> available) {
  const Style &style = style_of(node);
  GlyphAtlas &atlas = fonts_.get(font_size(style));
  const TextLayoutOptions options = text_options(style, atlas.font_line_height(), available);
  const std::string content = text_of(node);

  node.text_ascent = atlas.ascent();
  node.text_font_line_height = atlas.font_line_height();
  if (node.has_text_block && node.text_metrics == &atlas && node.text_content == content &&
      node.text_options == options) {
    return Size{node.text_block.width, node.text_block.height};
  }

  node.text_block = layout_text(content, atlas, options);
  node.has_text_block = true;
  node.text_content = content;
  node.text_metrics = &atlas;
  node.text_options = options;
  return Size{node.text_block.width, node.text_block.height};
}

/**
 * A bound `Text` is read HERE, at measure time, and is not registered as a bound
 * node: nothing about it has to be re-derived when the data moves, because the
 * next frame simply measures the new string. No value is the empty string, which
 * measures one line tall and zero wide (ZAB-65) — so a label whose data went
 * away holds its slot and its gaps rather than collapsing them.
 */
std::string View::text_of(const LayoutNode &node) {
  if (!node.ir->text.is_bound()) return node.ir->text.literal(std::string());
  return format_value(read_bind(node, node.ir->text.bind));
}

double View::font_size(const Style &style) const {
  const double size = std::round(dim(style.font_size, DEFAULT_FONT_SIZE));
  return std::min(MAX_FONT_SIZE, std::max(1.0, size));
}

/**
 * The text-layout knobs, resolved against the font (decision 2026-08-11,
 * ZAB-17): text wraps by default, to the width the flexbox offered the node.
 */
TextLayoutOptions View::text_options(const Style &style, double font_line_height,
                                     std::optional<double> max_width) const {
  TextLayoutOptions options;
  options.wrap = style.wrap.value_or(true);
  options.max_width = max_width;
  options.line_height = std::max(0.0, dim(style.line_height, font_line_height));
  // A cap below one line is not a cap: it would leave nothing to paint.
  options.max_lines =
      style.max_lines.has_value() && *style.max_lines >= 1.0
          ? std::optional<int>(static_cast<int>(std::floor(*style.max_lines)))
          : std::nullopt;
  options.overflow = style.overflow.value_or(TextOverflow::Clip);
  return options;
}

/**
 * Where this frame's lines sit, walked once after the arrange.
 *
 * Paint and the metrics snapshot both read what this leaves on the node, on
 * purpose: a baseline recorded in a golden file has to be the baseline the
 * tessellator actually used, not a second computation of it that could drift.
 */
void View::place_text(LayoutNode &node) {
  if (!in_layout(node)) return;
  if (node.ir->type == NodeType::Text && node.has_text_block) {
    // Lines are placed inside the padding box: a Text's own padding already grew
    // its measured size, so it has to keep the glyphs off the edge too.
    const double padding = node.resolved.padding;
    const Rect box{node.rect.x + padding, node.rect.y + padding,
                   std::max(0.0, node.rect.width - padding * 2.0),
                   std::max(0.0, node.rect.height - padding * 2.0)};
    const Style &style = style_of(node);
    place_lines(node.text_block, box, node.text_font_line_height,
                style.text_align.value_or(TextAlign::Start),
                style.text_align_y.value_or(TextAlign::Start), node.text_lines);
  }
  for (LayoutNode &child : node.children) place_text(child);
}

// --- view -----------------------------------------------------------------

View::View(const Envelope &envelope, std::string_view view_id, DataStore &data)
    : envelope_(&envelope), data_(&data), fonts_(1.0, default_font()) {
  const ViewDef *found = envelope.view(view_id);
  id_ = std::string(view_id);
  ir_root_ = found != nullptr ? &found->root : nullptr;
  if (ir_root_ == nullptr) return;
  build_layout_tree(*ir_root_, root_);
  prepare(root_);
  // The focus is NOT settled here. `autofocus` is initial state like a Collapse's
  // `open`, but whether the node it names can take the focus at all depends on
  // the inherited `disabled` flag — and nothing has resolved that yet. It settles
  // on the first frame, which is also where it settles again whenever the node
  // wearing it leaves the layout.
}

/**
 * Initial state and bindings over the freshly built tree, top-down.
 *
 * Top-down is what an `"exclusive-check"` group needs: it derives its options'
 * `checked` from its own value, so it has to speak before they do — otherwise an
 * option would settle on its own `checked` and be overwritten a moment later.
 */
void View::prepare(LayoutNode &node) {
  const Node &ir = *node.ir;
  if (!ir.id.empty()) by_id_[ir.id] = &node;
  if (ir.type == NodeType::Collapse) {
    node.open = ir.open.value_or(true);
    apply_open(node);
  }
  if (ir.group == GroupBehavior::ExclusiveSelect) {
    const TabsGroup tabs = tabs_of(node);
    if (!tabs.warning.empty()) {
      // Once per build, not once per tap: it is a property of the document, not
      // of the gesture that reads it.
      Diagnostic warning;
      warning.level = DiagnosticLevel::Warn;
      warning.code = DiagnosticCode::InvalidNode;
      warning.path = ir.id;
      warning.message = "exclusive-select group: " + tabs.warning;
      warnings_.push_back(std::move(warning));
    }
    node.selected_index = clamp_selected(ir.selected, tabs.buttons.size());
    apply_selection(node);
  }
  if (ir.visible.is_bound() || ir.disabled.is_bound() || ir.checked.is_bound() ||
      (ir.group == GroupBehavior::ExclusiveCheck && ir.value.is_bound())) {
    bound_.push_back(&node);
  }
  apply_bindings(node);
  for (LayoutNode &child : node.children) prepare(child);
}

void View::set_size(double width, double height) {
  viewport_ = Rect{0.0, 0.0, std::max(0.0, width), std::max(0.0, height)};
}

void View::layout_frame() {
  if (ir_root_ == nullptr) return;
  frame_++;
  // Before the resolve pass, deliberately: a focus assigned here reaches THIS
  // frame's style merge, so `states.focused` never lands a frame late. It reads
  // the PREVIOUS frame's `disabled` flags, and `prune_disabled` below is what
  // corrects a node the game has just switched off — one frame of stale flags,
  // and an invisible one, because `disabled` merges last and its override is
  // already painting over the focus ring that same frame.
  sync_focus();
  // A control that left the layout under the pointer (a tab panel switching, a
  // Collapse closing) must not keep wearing the hover state on its way back.
  prune_hover();
  resolve(root_);
  prune_disabled();
  Leaves leaves(*this);
  measure(root_, leaves, viewport_.width);
  arrange(root_, viewport_);
  place_text(root_);
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
  states.selected = node.selected;
  states.checked = node.checked;
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
  // After the children: this modulates a value they have already resolved.
  if (node.ir->type == NodeType::Toggle) crossfade_slots(node);
}

/**
 * The Toggle's two indicator slots share one box (the layout pass lays
 * `children[1]` on top of `children[0]`), so which one you see is opacity — a
 * cross-fade rather than one subtree replacing another (2026-08-11, ZAB-36).
 *
 * The progress is the checked flag itself until G8 (ZAB-141) tweens it, which is
 * the pre-F7 look exactly: one indicator, fully opaque. It MULTIPLIES the slot's
 * own resolved opacity, the way inherited opacity does (2026-08-06).
 */
void View::crossfade_slots(LayoutNode &node) {
  node.checked_progress = node.checked ? 1.0 : 0.0;
  for (size_t i = 0; i < node.children.size() && i < 2; i++) {
    LayoutNode &slot = node.children[i];
    if (!in_layout(slot)) continue;
    slot.resolved.opacity *= slot_opacity(i, node.checked_progress);
  }
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

// --- bindings -------------------------------------------------------------

namespace {

/** The scopes of a node outside every template — shared, and never written to. */
const std::vector<ItemScope> NO_SCOPES;

}  // namespace

const DataValue *View::read_bind(const LayoutNode &node, const std::string &bind) {
  const ResolvedBind resolved =
      resolve_binding(bind, node.scopes != nullptr ? *node.scopes : NO_SCOPES);
  if (resolved.kind == ResolvedBind::Kind::Index) {
    index_value_ = DataValue::of_number(resolved.index);
    return &index_value_;
  }
  return data_ != nullptr ? data_->get(resolved.path) : nullptr;
}

bool View::write_path(const LayoutNode &node, const std::string &bind, std::string &out) const {
  const ResolvedBind resolved =
      resolve_binding(bind, node.scopes != nullptr ? *node.scopes : NO_SCOPES);
  // An index is a POSITION, not a slot: there is nowhere in the data to put it.
  if (resolved.kind != ResolvedBind::Kind::Path) return false;
  out = resolved.path;
  return true;
}

/**
 * Derives from data everything this node's state reads.
 *
 * The single place those states are computed, so building a node and a `SetData`
 * landing on it settle it the same way — which is what G12 (ZAB-145) will lean on
 * when an item instance is recycled onto another element.
 */
void View::apply_bindings(LayoutNode &node) {
  const Node &ir = *node.ir;
  // A bound `visible` with no data starts HIDDEN: data-driven visibility means
  // "visible when the data says so" (2026-08-03).
  node.visible_flag =
      ir.visible.is_bound() ? is_truthy(read_bind(node, ir.visible.bind)) : ir.visible.literal(true);
  // Only this node's OWN value: what an ancestor says is folded in by the
  // resolve pass, which is the one that walks top-down (ZAB-63).
  node.disabled_flag = ir.disabled.is_bound() ? is_truthy(read_bind(node, ir.disabled.bind))
                                              : ir.disabled.literal(false);
  if (ir.type == NodeType::Container && ir.group == GroupBehavior::ExclusiveCheck) {
    const DataValue *bound = ir.value.is_bound() ? read_bind(node, ir.value.bind) : nullptr;
    node.group_value = ir.value.is_bound()
                           ? (bound != nullptr ? *bound : DataValue())
                           : scalar_value(ir.value.literal(Scalar{}));
    apply_group_value(node);
  }
  // Inside an exclusive-check group a Toggle's state is DERIVED from the group's
  // value, never stored per option — the selection is one value, not N booleans.
  if (ir.type == NodeType::Toggle && exclusive_group_of(node) == nullptr) {
    node.checked =
        ir.checked.is_bound() ? is_truthy(read_bind(node, ir.checked.bind)) : ir.checked.literal(false);
  }
  // A Slider's and a TextInput's bound value land here too, in G10 (ZAB-143) and
  // G11 (ZAB-144): the props exist, the runtime that holds them does not yet.
}

bool View::watches(const LayoutNode &node, std::string_view written) const {
  const Node &ir = *node.ir;
  const auto touches = [&](const std::string &bind) {
    std::string path;
    return write_path(node, bind, path) && affects(written, path);
  };
  if (ir.visible.is_bound() && touches(ir.visible.bind)) return true;
  if (ir.disabled.is_bound() && touches(ir.disabled.bind)) return true;
  if (ir.type == NodeType::Toggle && ir.checked.is_bound() && touches(ir.checked.bind)) return true;
  if (ir.group == GroupBehavior::ExclusiveCheck && ir.value.is_bound() && touches(ir.value.bind)) {
    return true;
  }
  return false;
}

/**
 * The one place a data path lands on the tree, whoever wrote it.
 *
 * Writing an array moves the bindings INSIDE it (`shop.items` →
 * `shop.items.3.name`) and writing into one item moves a binding watching the
 * whole array, which is what `affects` decides. A bound `Text` is not on this
 * list: it is read at measure time, so the next frame simply measures the new
 * string.
 */
void View::data_written(std::string_view path) {
  for (LayoutNode *node : bound_) {
    if (watches(*node, path)) apply_bindings(*node);
  }
}

/** A control writing its own value: the same store update, plus the game's leg. */
void View::write_data(const std::string &path, DataValue value) {
  if (data_ != nullptr) data_->set(path, value);
  data_written(path);
  data_changes_.push_back(DataChange{path, std::move(value)});
}

// --- Collapse and groups --------------------------------------------------

/** `children[0]` is the header and the rest is the content (`<details>` model). */
void View::apply_open(LayoutNode &node) {
  for (size_t i = 1; i < node.children.size(); i++) node.children[i].section_shown = node.open;
}

/**
 * The single state-mutation path for a Collapse: a tap on the header, `set_open`,
 * and the group enforcing exclusivity all come through here.
 */
bool View::set_collapse_open(LayoutNode &node, bool open) {
  if (node.open == open) return false;
  node.open = open;
  apply_open(node);
  if (open) enforce_group(node);
  return true;
}

/** `"exclusive-open"`: opening one section closes its siblings. */
void View::enforce_group(LayoutNode &opened) {
  if (opened.parent == nullptr) return;
  if (opened.parent->ir->group != GroupBehavior::ExclusiveOpen) return;
  for (LayoutNode &sibling : opened.parent->children) {
    if (&sibling == &opened || sibling.ir->type != NodeType::Collapse || !sibling.open) continue;
    sibling.open = false;
    apply_open(sibling);
  }
}

TabsGroup View::tabs_of(const LayoutNode &group) const {
  std::vector<NodeType> bar;
  if (!group.children.empty()) {
    for (const LayoutNode &child : group.children[0].children) bar.push_back(child.ir->type);
  }
  return resolve_tabs_group(bar, group.children.size());
}

/** Only the selected panel stays in layout; its button carries `states.selected`. */
void View::apply_selection(LayoutNode &group) {
  const TabsGroup tabs = tabs_of(group);
  for (size_t i = 0; i < tabs.panels.size(); i++) {
    const bool chosen = static_cast<int>(i) == group.selected_index;
    group.children[tabs.panels[i]].section_shown = chosen;
    group.children[0].children[tabs.buttons[i]].selected = chosen;
  }
}

/** Single state-mutation path for tabs: a tap, Enter, the pad, `set_selected_tab`. */
bool View::set_selected(LayoutNode &group, int index) {
  const TabsGroup tabs = tabs_of(group);
  const int next = clamp_selected(std::optional<double>(static_cast<double>(index)), tabs.buttons.size());
  if (next == group.selected_index) return false;
  group.selected_index = next;
  apply_selection(group);
  return true;
}

LayoutNode *View::tab_group_of(LayoutNode &button, int &index) {
  LayoutNode *bar = button.parent;
  if (bar == nullptr || bar->parent == nullptr) return nullptr;
  LayoutNode *group = bar->parent;
  if (group->ir->group != GroupBehavior::ExclusiveSelect) return nullptr;
  // In the panels, not in the bar: a Button inside a panel is an ordinary button.
  if (group->children.empty() || &group->children[0] != bar) return nullptr;
  const TabsGroup tabs = tabs_of(*group);
  for (size_t i = 0; i < tabs.buttons.size(); i++) {
    if (&bar->children[tabs.buttons[i]] != &button) continue;
    index = static_cast<int>(i);
    return group;
  }
  return nullptr;
}

LayoutNode *View::exclusive_group_of(LayoutNode &node) const {
  for (LayoutNode *current = node.parent; current != nullptr; current = current->parent) {
    if (current->ir->type == NodeType::Container &&
        current->ir->group == GroupBehavior::ExclusiveCheck) {
      return current;
    }
  }
  return nullptr;
}

void View::group_options(LayoutNode &group, LayoutNode &node, std::vector<LayoutNode *> &out) const {
  for (LayoutNode &child : node.children) {
    // A nested group owns its own options.
    if (child.ir->type == NodeType::Container &&
        child.ir->group == GroupBehavior::ExclusiveCheck) {
      continue;
    }
    if (child.ir->type == NodeType::Toggle) out.push_back(&child);
    group_options(group, child, out);
  }
}

/** Re-derives every option's state from the group's selected value. */
void View::apply_group_value(LayoutNode &group) {
  std::vector<LayoutNode *> options;
  group_options(group, group, options);
  for (LayoutNode *option : options) {
    const DataValue value = scalar_value(option->ir->value.literal(Scalar{}));
    option->checked = is_selected(&group.group_value, &value);
  }
}

/**
 * Single state-mutation path for Toggles (a tap, Enter, the pad, `set_checked`):
 * updates the state, writes the new value into its bound path — the return leg of
 * the data channel — and fires the named actions: the option's own, and the
 * group's when the selection of one MOVED (ZAB-64).
 */
void View::set_toggle_checked(LayoutNode &node, bool checked) {
  const Node &ir = *node.ir;
  LayoutNode *group = exclusive_group_of(node);
  std::string group_action;

  if (group != nullptr) {
    // A radio only ever turns ON; the group's value is the state that moves.
    if (!checked) return;
    // Re-picking the option already selected moves nothing, so nothing is
    // reported — closing the popover it was chosen in is G9's (ZAB-142).
    if (node.checked) return;
    const DataValue chosen = scalar_value(ir.value.literal(Scalar{}));
    group->group_value = chosen;
    apply_group_value(*group);
    std::string path;
    if (group->ir->value.is_bound() && write_path(*group, group->ir->value.bind, path)) {
      write_data(path, chosen);
    }
    // The selection MOVED — the early return above is what keeps re-picking the
    // current option silent — so the group speaks too. Its hook is the one a
    // `<Select>` declares: the option only ever says "me".
    group_action = group->ir->on_change;
  } else {
    if (node.checked == checked) return;
    node.checked = checked;
    std::string path;
    if (ir.checked.is_bound() && write_path(node, ir.checked.bind, path)) {
      write_data(path, DataValue::of_bool(checked));
    }
  }

  // Inner first, then the group: the same order a press reads.
  if (!ir.on_change.empty()) fire(node, ir.on_change);
  if (!group_action.empty()) fire(node, group_action);
}

/**
 * Activating a control — the one path shared by pointer taps, Enter and the pad.
 * A Button fires its named action (and moves the selection when it is a tab); a
 * Toggle flips, which inside an `"exclusive-check"` group means selecting it.
 */
void View::activate(LayoutNode &node) {
  // The last gate before anything fires. The input paths already refuse a
  // disabled control, so this catches whatever reaches activation another way —
  // a held key, a gesture that started before the game disabled the section. The
  // host channel is deliberately NOT gated: the game writing a value is
  // out-of-band, like a `SetData` on a bound path (ZAB-63).
  if (node.disabled) return;
  if (node.ir->type == NodeType::Toggle) {
    set_toggle_checked(node, next_checked(node.checked, exclusive_group_of(node) != nullptr));
    return;
  }
  // Fired with the item it belongs to, if any — G12 (ZAB-145) is what gives an
  // action fired inside a `Repeat` the context that says WHICH one.
  if (!node.ir->on_click.empty()) fire(node, node.ir->on_click);
  int index = 0;
  LayoutNode *group = tab_group_of(node, index);
  if (group != nullptr) set_selected(*group, index);
}

/**
 * What a release does, whether the press came from a finger or from a key.
 *
 * A control comes first, and that ordering is the contract rather than an
 * accident: a header authored AS a `Button` fires its action and does not
 * toggle. The `<details>` toggle is what a header that takes no press of its own
 * does — which is why the pointer reaches it only when nothing was pressed.
 */
void View::release(LayoutNode &node) {
  if (node.disabled) return;
  if (node.ir->type == NodeType::Button || node.ir->type == NodeType::Toggle) {
    activate(node);
  } else if (is_collapse_header(node) && node.parent != nullptr) {
    set_collapse_open(*node.parent, !node.parent->open);
  }
}

// --- focus and directional navigation (2026-08-04) ------------------------

void View::set_focus(LayoutNode *node) {
  if (focus_ == node) return;
  if (focus_ != nullptr) focus_->focused = false;
  focus_ = node;
  if (focus_ != nullptr) focus_->focused = true;
}

/**
 * A focus that is still on screen keeps it — a node that has just gone disabled
 * included, which `prune_disabled` takes away right after the resolve pass that
 * settles the flag. Otherwise the scope's `autofocus` takes over, and nothing at
 * all when it names nothing: an empty focus is honest, a focus on a node that
 * left the layout is not.
 */
void View::sync_focus() {
  if (focus_ != nullptr && in_layout(*focus_)) return;
  set_focus(autofocus_in(root_));
}

void View::prune_hover() {
  if (hovered_ != nullptr && !in_layout(*hovered_)) {
    hovered_->hovered = false;
    hovered_ = nullptr;
  }
  if (pressed_ != nullptr && !in_layout(*pressed_)) {
    pressed_->pressed = false;
    pressed_ = nullptr;
  }
}

/**
 * Releases what a node that has just become disabled was holding.
 *
 * The focus goes to NOTHING rather than to a neighbour: the player did not ask to
 * move, and the next arrow starts the walk again from the scope's `autofocus`. A
 * gesture in flight is CANCELLED, not concluded — the control died, so its value
 * never settled (ZAB-63).
 */
void View::prune_disabled() {
  if (focus_ != nullptr && focus_->disabled) {
    // A key held down over a control the game just switched off: the press dies
    // with the focus, since the release will not find it again.
    focus_->pressed = false;
    set_focus(nullptr);
  }
  if (hovered_ != nullptr && hovered_->disabled) {
    hovered_->hovered = false;
    hovered_ = nullptr;
  }
  if (pressed_ != nullptr && pressed_->disabled) {
    pressed_->pressed = false;
    pressed_ = nullptr;
  }
}

bool View::move_focus(double dx, double dy) {
  if (ir_root_ == nullptr) return false;
  std::vector<LayoutNode *> candidates;
  collect_focusables(root_, candidates);
  if (candidates.empty()) return false;

  LayoutNode *current = focus_;
  const bool walkable =
      current != nullptr && std::find(candidates.begin(), candidates.end(), current) != candidates.end();
  if (!walkable) {
    // The player asked to move and there is no rect to move FROM, so the walk
    // starts again from the scope's `autofocus` — the rule already documented for
    // having no focus at all.
    LayoutNode *start = autofocus_in(root_);
    set_focus(start != nullptr ? start : candidates.front());
    return true;
  }

  LayoutNode *best = nullptr;
  double best_score = 0.0;
  for (LayoutNode *candidate : candidates) {
    if (candidate == current) continue;
    const double score = navigation_score(current->rect, candidate->rect, dx, dy);
    if (score < 0.0) continue;  // not in the direction of travel
    // The first of a tie keeps it, as the reference's strict `<` does.
    if (best == nullptr || score < best_score) {
      best = candidate;
      best_score = score;
    }
  }
  if (best == nullptr) return false;
  set_focus(best);
  // Dragging the scroll along with the focus (`reveal_delta`, focus.h) waits for
  // G6 (ZAB-139): there are no scroll offsets to move yet.
  return true;
}

bool View::press_focused(bool down) {
  LayoutNode *node = focus_;
  if (node == nullptr || !in_layout(*node) || node->disabled) return false;
  // A Slider is adjusted with the axis arrows and a TextInput submits with Enter:
  // neither has anything to activate, and a press must not fall through to the
  // Collapse branch below. Both arrive with G10 (ZAB-143) and G11 (ZAB-144).
  if (node->ir->type == NodeType::Slider || node->ir->type == NodeType::TextInput) return false;
  if (down) {
    if (node->pressed) return false;
    node->pressed = true;
    return true;
  }
  if (!node->pressed) return false;
  node->pressed = false;
  release(*node);
  return true;
}

// --- the host channel -----------------------------------------------------

LayoutNode *View::find_by_id(std::string_view id, NodeType type) {
  const auto found = by_id_.find(std::string(id));
  if (found == by_id_.end() || found->second->ir->type != type) return nullptr;
  return found->second;
}

bool View::set_open(std::string_view id, bool open) {
  LayoutNode *node = find_by_id(id, NodeType::Collapse);
  if (node == nullptr) return false;
  set_collapse_open(*node, open);
  return true;
}

bool View::set_selected_tab(std::string_view id, int index) {
  const auto found = by_id_.find(std::string(id));
  if (found == by_id_.end() || found->second->ir->group != GroupBehavior::ExclusiveSelect) {
    return false;
  }
  set_selected(*found->second, index);
  return true;
}

bool View::set_checked(std::string_view id, bool checked) {
  LayoutNode *node = find_by_id(id, NodeType::Toggle);
  if (node == nullptr) return false;
  // The player's gesture, hooks included — a game and a player produce identical
  // results (`docs/format/host-channel.md`).
  set_toggle_checked(*node, checked);
  return true;
}

std::vector<DataChange> View::drain_data_changes() {
  std::vector<DataChange> out;
  out.swap(data_changes_);
  return out;
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
void View::paint_node(LayoutNode &node, double opacity) {
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
  // Glyphs paint in the node's own `color` — the same "color of the content"
  // that will tint an `Image` in G5 (ZAB-138) — with the inherited opacity
  // already folded in, exactly as the fill above.
  if (node.ir->type == NodeType::Text && node.has_text_block) {
    GlyphAtlas &atlas = fonts_.get(font_size(style_of(node)));
    // An undeclared `color` paints in the default text color rather than not at
    // all: a label with no style is still a label, which is not the case for a
    // background (absent means nothing is painted, never black).
    const Color color = fade(node.resolved.color.value_or(DEFAULT_TEXT_COLOR), own);
    for (size_t i = 0; i < node.text_block.lines.size() && i < node.text_lines.size(); i++) {
      geometry_.text(node.text_lines[i].x, node.text_lines[i].y, node.text_block.lines[i].text,
                     atlas, color);
    }
  }
  for (LayoutNode &child : node.children) paint_node(child, own);
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

/**
 * What a press takes hold of: a Button or a Toggle, and nothing else.
 *
 * Deliberately NARROWER than the focusable set. A Collapse header toggles on the
 * release without ever wearing `pressed` (see `pointer_up`), and a Slider and a
 * TextInput run gestures of their own — G10 (ZAB-143) and G11 (ZAB-144). Up from
 * what was hit to whatever governs the gesture: a label inside a button is
 * pressed by pressing the button.
 */
LayoutNode *View::pressable_at(double x, double y) {
  LayoutNode *node = ir_root_ != nullptr ? hit(root_, x, y) : nullptr;
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (candidate->disabled) continue;
    if (candidate->ir->type == NodeType::Button || candidate->ir->type == NodeType::Toggle) {
      return candidate;
    }
  }
  return nullptr;
}

/**
 * What a mouse lights up: exactly the focusable set (2026-08-11, ZAB-36), so one
 * rule answers both questions rather than two lists drifting apart — and a mouse
 * and a pad see the same dead control.
 */
LayoutNode *View::hoverable_at(double x, double y) {
  LayoutNode *node = ir_root_ != nullptr ? hit(root_, x, y) : nullptr;
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (is_focusable(*candidate)) return candidate;
  }
  return nullptr;
}

/** The Collapse header at this point, if the press did not land on a control. */
LayoutNode *View::collapse_header_at(double x, double y) {
  LayoutNode *node = ir_root_ != nullptr ? hit(root_, x, y) : nullptr;
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (is_collapse_header(*candidate) && !candidate->disabled) return candidate;
  }
  return nullptr;
}

bool View::pointer_move(double x, double y) {
  LayoutNode *target = hoverable_at(x, y);
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
  // The pointer and directional navigation share ONE focus (2026-08-04).
  set_focus(target);
  return true;
}

bool View::pointer_up(double x, double y) {
  LayoutNode *released = pressed_;
  if (released == nullptr) {
    // Nothing was pressed, so this may be a tap on a Collapse header: it toggles
    // on the release and never wears `pressed`, which is why it is not a
    // pressable in the first place (the `<details>`/`<summary>` model).
    LayoutNode *header = collapse_header_at(x, y);
    const bool toggled = header != nullptr && header->parent != nullptr &&
                         set_collapse_open(*header->parent, !header->parent->open);
    return pointer_move(x, y) || toggled;
  }
  released->pressed = false;
  pressed_ = nullptr;
  // A press that leaves the control it started on fires nothing — the same rule
  // a cancelled gesture follows (ZAB-70): it ends, it does not conclude.
  if (pressable_at(x, y) == released) release(*released);
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
  view_ = std::make_unique<View>(*envelope_, view_id, *data_);
  return true;
}

void Document::set_data(std::string_view path, DataValue value) {
  const std::string key(path);
  data_->set(key, std::move(value));
  // Data pushed BEFORE a view exists is not a special case: the store is the
  // document's, so the next view simply reads it while it builds.
  if (view_ != nullptr) view_->data_written(key);
}

const DataValue *Document::data(std::string_view path) const { return data_->get(path); }

}  // namespace zabloo
