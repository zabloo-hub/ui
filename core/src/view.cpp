#include "view.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "collapse.h"
#include "easing.h"
#include "focus.h"
#include "hit.h"
#include "scroll.h"
#include "spinner.h"
#include "text.h"
#include "utf8.h"

namespace zabloo {
namespace {

/** A `Text` with no `fontSize` of its own. */
constexpr double DEFAULT_FONT_SIZE = 16.0;
/** Above this a glyph atlas stops being an atlas; the same cap the web uses. */
constexpr double MAX_FONT_SIZE = 512.0;

}  // namespace

// --- leaves ---------------------------------------------------------------

/** Sizing for the childless types. */
class View::Leaves : public LeafMeasurer {
 public:
  explicit Leaves(View &view) : view_(view) {}

  Size measure_leaf(LayoutNode &node, std::optional<double> available) override {
    if (node.ir->type == NodeType::Text) return view_.measure_text(node, available);
    if (node.ir->type == NodeType::TextInput) {
      // ONE line tall, and no intrinsic width: a field must not grow and shrink
      // with what is being typed into it, so its width comes from its own
      // `layout` (`@zabloo/react`'s `<TextInput>` fills one in) and the content
      // scrolls inside that box.
      const Style &style = view_.style_of(node);
      GlyphAtlas &atlas = view_.fonts_.get(view_.font_size(style));
      return Size{0.0, std::max(0.0, view_.dim(style.line_height, atlas.font_line_height()))};
    }
    if (node.ir->type == NodeType::Image) {
      // Intrinsic size straight from the manifest — nothing is decoded, so the
      // image occupies its space from the very first frame. A ref that does not
      // resolve measures nothing, and the node is left painting its own
      // background: the placeholder is authored, not a state (ZAB-13).
      const ImageAsset *asset = view_.images_.get(node.ir->src);
      return asset == nullptr ? Size{} : Size{asset->width, asset->height};
    }
    return Size{};
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
    : envelope_(&envelope), data_(&data), fonts_(1.0, default_font()), images_(envelope) {
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
  if (ir.type == NodeType::TextInput) {
    node.field = std::make_unique<FieldState>();
    // Kept in a registry rather than looked up by walking: the caret pass runs
    // after every arrange and a tree of a thousand rows has no business being
    // searched for the two fields in it (ZAB-73).
    fields_.push_back(&node);
  }
  if (ir.visible.is_bound() || ir.disabled.is_bound() || ir.checked.is_bound() ||
      (ir.type == NodeType::TextInput && ir.value.is_bound()) ||
      (ir.group == GroupBehavior::ExclusiveCheck && ir.value.is_bound())) {
    bound_.push_back(&node);
  }
  // Settled: this is the node's initial value, so its caret belongs at the end of
  // it — where a player who had just typed it would have left it.
  apply_bindings(node, true);
  for (LayoutNode &child : node.children) prepare(child);
}

void View::set_size(double width, double height) {
  viewport_ = Rect{0.0, 0.0, std::max(0.0, width), std::max(0.0, height)};
}

void View::layout_frame() {
  if (ir_root_ == nullptr) return;
  frame_++;
  // Recomputed from scratch every frame: a tween that landed last frame must not
  // keep the adapter asking for more (`animating`).
  animating_ = false;
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
  resolve(root_, now_);
  prune_disabled();
  Leaves leaves(*this);
  measure(root_, leaves, viewport_.width);
  arrange(root_, viewport_);
  place_text(root_);
  sync_text_scroll();
}

/**
 * The content box of a node: its rect, minus its own padding.
 *
 * A field's text, caret and highlight all live in it, and so does the pointer
 * coordinate that picks a caret position — one helper, so the four cannot drift.
 */
Rect View::content_box(const LayoutNode &node) const {
  const double padding = node.resolved.padding;
  return Rect{node.rect.x + padding, node.rect.y + padding,
              std::max(0.0, node.rect.width - padding * 2.0),
              std::max(0.0, node.rect.height - padding * 2.0)};
}

/**
 * Keeps every field's caret inside its box — the field's own horizontal scroll,
 * the counterpart of the `ScrollView`'s offset and, like it, never authored.
 *
 * It runs after the arrange, where the rect is final, and it is idempotent: a
 * frame that moved nothing recomputes the same offset.
 */
void View::sync_text_scroll() {
  for (LayoutNode *node : fields_) {
    if (!in_layout(*node)) continue;
    FieldState &field = *node->field;
    const Style &style = style_of(*node);
    GlyphAtlas &atlas = fonts_.get(font_size(style));
    field.scroll = scroll_for(field.scroll, caret_x(field.chars, field.selection.focus, atlas),
                              content_box(*node).width,
                              caret_x(field.chars, field.chars.size(), atlas), CARET.width);
  }
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
  // The placeholder is a STATE, not a colour of its own (ZAB-26): a field
  // holding nothing wears `empty`, and that is what dresses what it shows.
  states.empty = node.field != nullptr && node.field->text.empty();
  states.disabled = node.disabled;
  node.style_cache = effective_style(*node.ir, states);
  node.style_frame = frame_;
  return node.style_cache;
}

/**
 * A node's `transition`, its `Dim` duration resolved to milliseconds.
 *
 * Read from the base node only: no cascade, and no per-state transition — both are
 * compatible future extensions, not v1 surface.
 */
std::optional<ResolvedTransition> View::transition_of(const LayoutNode &node) const {
  const Transition &declared = node.ir->transition;
  if (!declared.present) return std::nullopt;
  ResolvedTransition out;
  out.duration = dim(declared.duration, 0.0);
  out.easing = declared.easing;
  return out;
}

/**
 * The tween state of a node that is about to need one, allocated on first use.
 *
 * Most of a UI never animates, so most nodes never pay for this: a node with no
 * usable `transition` is stepped with a null `NodeAnim` and every value of it
 * snaps, which is the pre-F7 behavior to the letter.
 */
NodeAnim *View::anim_of(LayoutNode &node, const ResolvedTransition *transition) {
  if (node.anim == nullptr && (transition == nullptr || !transition->usable())) return nullptr;
  if (node.anim == nullptr) node.anim = std::make_unique<NodeAnim>();
  return node.anim.get();
}

void View::resolve(LayoutNode &node, double now) {
  if (!in_layout(node)) {
    // Out of layout: nothing to paint, and no honest previous value for the day it
    // comes back — dropping the state makes that return snap, like a mount.
    forget_anim(node);
    return;
  }
  node.forced_clip = false;
  // Effective `disabled` BEFORE the style resolves, since it is a state the merge
  // has to see this very frame (ZAB-63). It inherits from the parent — one prop
  // on a section answers for every control in it — and an `Overlay` restarts the
  // chain: a layer entry is the top of its own input scope, so a modal declared
  // inside a disabled panel stays operable and dismissable.
  node.disabled = node.disabled_flag || (node.ir->type != NodeType::Overlay &&
                                         node.parent != nullptr && node.parent->disabled);
  const Style &style = style_of(node);
  const Layout &layout = node.ir->layout;
  // One scratch for the whole tree, refilled per node: `step_node` consumes it
  // synchronously and never keeps it, so an animating frame allocates no targets
  // object per node (ZAB-55). Every field is assigned, absent ones included — a
  // leftover from the previous node would otherwise read as a declared value.
  ResolvedValues &targets = targets_;

  targets.background = optional_color(style.background, MISSING_COLOR);
  // An undeclared border color HOLDS the last one instead of dropping it: the
  // border it paints is on its way out through `borderWidth`, and a focus ring
  // that lost its color halfway would flash the missing-color magenta (ZAB-36).
  const std::optional<Color> border = optional_color(style.border_color, MISSING_COLOR);
  targets.border_color = border.has_value() ? border : node.resolved.border_color;
  targets.color = optional_color(style.color, DEFAULT_TEXT_COLOR);
  targets.opacity = std::min(1.0, std::max(0.0, style.opacity.value_or(1.0)));
  targets.radius = dim(style.radius, 0.0);
  targets.border_width = dim(style.border_width, 0.0);
  targets.gap = dim(layout.gap, 0.0);
  targets.padding = dim(layout.padding, 0.0);
  targets.width = optional_dim(layout.width);
  targets.height = optional_dim(layout.height);

  const std::optional<ResolvedTransition> transition = transition_of(node);
  const ResolvedTransition *tween = transition.has_value() ? &*transition : nullptr;
  NodeAnim *anim = anim_of(node, tween);
  // The node's own `resolved` is the out-param: the step rewrites it in place,
  // after the previous frame's values above were already read out of it.
  if (step_node(anim, targets, tween, now, node.resolved)) animating_ = true;

  // Behaviors that tween a value of their own, with endpoints they compute
  // (decision 2026-08-11 §5) — before the children, since a Collapse decides here
  // whether its content is in layout at all this frame.
  if (node.ir->type == NodeType::ProgressBar) resolve_progress(node, anim, tween, now);
  else if (node.ir->type == NodeType::Collapse) resolve_collapse(node, anim, tween, now);

  for (LayoutNode &child : node.children) resolve(child, now);
  // After the children: these modulate values they have already resolved.
  if (node.ir->type == NodeType::Spinner) spin(node, now);
  else if (node.ir->type == NodeType::Toggle) crossfade_slots(node, anim, tween, now);
}

/**
 * The Toggle's two indicator slots share one box (the layout pass lays
 * `children[1]` on top of `children[0]`), so which one you see is opacity — a
 * cross-fade rather than one subtree replacing another (2026-08-11, ZAB-36).
 *
 * With no transition the progress is 0 or 1 and the swap is instant, exactly as it
 * was before F7. It MULTIPLIES each slot's own resolved opacity, the way inherited
 * opacity does (2026-08-06).
 */
void View::crossfade_slots(LayoutNode &node, NodeAnim *anim, const ResolvedTransition *transition,
                           double now) {
  const SteppedValue stepped =
      step_value(anim, TrackKey::Checked, node.checked ? 1.0 : 0.0, transition, now);
  node.checked_progress = stepped.value;
  if (stepped.animating) animating_ = true;
  for (size_t i = 0; i < node.children.size() && i < 2; i++) {
    LayoutNode &slot = node.children[i];
    if (!in_layout(slot)) continue;
    slot.resolved.opacity *= slot_opacity(i, node.checked_progress);
  }
}

/**
 * The ProgressBar's fraction: read (or bound), clamped, and tweened on the VALUE
 * with the node's own `transition` — a behavior driving the interpolation engine
 * with endpoints it computes (decision 2026-08-11 §5). The arrange then derives the
 * fill's rect from this number, so there is still one layout pass per frame and the
 * rect never feeds back into its own input.
 */
void View::resolve_progress(LayoutNode &node, NodeAnim *anim,
                            const ResolvedTransition *transition, double now) {
  const SteppedValue stepped =
      step_value(anim, TrackKey::Progress, progress_target(node), transition, now);
  node.progress = stepped.value;
  if (stepped.animating) animating_ = true;
}

/** What the bar is heading to: its bound or literal `value`, read normatively. */
double View::progress_target(LayoutNode &node) {
  // Anything that is not a finite number — no data, a string, an absent value — is
  // an EMPTY bar, never a full one, which is what `clamp_progress` says about a
  // binding pointing at nothing.
  const Bindable<Scalar> &value = node.ir->value;
  if (value.kind == Bindable<Scalar>::Kind::Bind) {
    const DataValue *data = read_bind(node, value.bind);
    if (data == nullptr || data->kind != DataValue::Kind::Number) return 0.0;
    return clamp_progress(data->number);
  }
  if (value.value.kind != Scalar::Kind::Number) return 0.0;
  return clamp_progress(value.value.number);
}

/**
 * The Collapse's open/close: the behavior tweens the node's OWN height between the
 * header's box and the height measured with the content in (`collapse.h`), clipping
 * while it runs. The content stays in layout for exactly that long, so a closed
 * Collapse still costs nothing once the tween ends.
 */
void View::resolve_collapse(LayoutNode &node, NodeAnim *anim,
                            const ResolvedTransition *transition, double now) {
  if (!node.collapse_animating) return;
  const double closed =
      closed_height(node.children.empty() ? 0.0 : node.children[0].natural.y, node.resolved.padding);
  // While pending, THIS frame's measure is what learns the open height: aim at the
  // closed box so the content that just entered layout does not flash.
  const double target =
      node.collapse_pending ? closed : collapse_target(node.open, node.natural.y, closed);
  const SteppedValue stepped = step_value(anim, TrackKey::Collapse, target, transition, now);

  if (node.collapse_pending || stepped.animating) {
    node.collapse_pending = false;
    node.resolved.height = stepped.value;
    node.forced_clip = true;
    animating_ = true;
    return;
  }
  // Settled: the override goes away and the box is whatever the content asks for —
  // a closed one drops its content out of layout, as it always did.
  node.collapse_animating = false;
  apply_open(node);
}

/**
 * The Spinner's loop: one phase per frame, spread over the beads, multiplied onto
 * the opacity they just resolved (multiplicative like every other opacity in the
 * system — 2026-08-06). It is core-owned behavior keyed by node identity, exactly
 * like the scroll offset: nothing about it is in the IR beyond the node's own knobs.
 */
void View::spin(LayoutNode &node, double now) {
  size_t beads = 0;
  for (const LayoutNode &child : node.children) {
    if (in_flow(child)) beads++;
  }
  if (beads == 0) return;
  const double period = dim(node.ir->period, SPINNER_DEFAULT_PERIOD);
  // A period of 0 is how a "reduce motion" theme stops the loop: the wave freezes
  // at its first frame instead of the spinner disappearing.
  const bool running = period > 0.0 && std::isfinite(period);
  if (!node.loop_started_at.has_value()) node.loop_started_at = now;
  const double phase = running ? loop_phase(*node.loop_started_at, now, period) : 0.0;
  const double min = node.ir->min.value_or(SPINNER_DEFAULT_MIN);
  size_t i = 0;
  for (LayoutNode &bead : node.children) {
    if (!in_flow(bead)) continue;
    bead.resolved.opacity *= bead_opacity(i, beads, phase, min, node.ir->spinner_easing);
    i++;
  }
  if (running) animating_ = true;
}

/** A whole subtree's motion, forgotten — what leaving the layout costs. */
void View::forget_anim(LayoutNode &node) {
  forget_tweens(node);
  for (LayoutNode &child : node.children) forget_anim(child);
}

/**
 * One node's motion, forgotten: the next step snaps, like a mount. Shared by the
 * two things that ask for exactly that — a subtree leaving layout, and (from G12
 * on) an item instance reused for another element (`resettle`, ZAB-66).
 */
void View::forget_tweens(LayoutNode &node) {
  if (node.anim != nullptr) clear_node_anim(*node.anim);
  // A spinner that comes back starts its wave over, like a mount.
  node.loop_started_at.reset();
  if (node.collapse_animating) {
    // A Collapse taken out of layout mid-tween lands on its logical state: it comes
    // back open or closed, never halfway through a motion nobody saw.
    node.collapse_animating = false;
    node.collapse_pending = false;
    node.forced_clip = false;
    apply_open(node);
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
 *
 * `settle` separates the two callers for the one state that has a position in it:
 * a field being BUILT puts its caret at the end of the value it was given, while
 * a field the game has just written into keeps the caret the player left there
 * and only clamps it into the new text. Nothing else here has anywhere to be.
 */
void View::apply_bindings(LayoutNode &node, bool settle) {
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
  if (ir.type == NodeType::TextInput && node.field != nullptr) {
    // Unbound, `value` is the initial text; bound, the store decides — and an
    // empty store leaves the field empty, showing its placeholder. The game's own
    // string is shown AS IT IS: `maxLength` bounds what the player can type, never
    // what the data is allowed to hold (decision 2026-08-11, ZAB-26).
    const Scalar literal = ir.value.literal(Scalar{});
    const std::string text =
        ir.value.is_bound() ? format_value(read_bind(node, ir.value.bind))
        : literal.kind == Scalar::Kind::Text ? literal.text
        : literal.kind == Scalar::Kind::Number ? number_to_text(literal.number)
                                               : std::string();
    set_field_text(node, text);
    node.field->selection = settle ? caret_at(node.field->chars.size())
                                   : clamp_selection(node.field->selection,
                                                     node.field->chars.size());
  }
  // A Slider's bound value lands here too, in G10 (ZAB-143): the props exist, the
  // runtime that holds them does not yet.
}

/**
 * The one place a field's buffer is written, whoever wrote it — the initial
 * value, a `SetData`, a keystroke, a paste, `set_text`.
 *
 * It keeps the decoded split in step with the buffer, which is the invariant the
 * whole caret rests on: every index in the frame counts entries of `chars`.
 */
void View::set_field_text(LayoutNode &node, const std::string &text) {
  FieldState &field = *node.field;
  field.text = text;
  field.chars = utf8_decode(text);
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
  if (ir.type == NodeType::TextInput && ir.value.is_bound() && touches(ir.value.bind)) return true;
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
    // Not settled: the player's caret stays where they left it and is only
    // clamped into the new text — a write from the game is not a gesture.
    if (watches(*node, path)) apply_bindings(*node, false);
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
/**
 * The content is in layout while the Collapse is open — and for as long as the
 * height tween runs, which is what a closing Collapse animates over.
 */
void View::apply_open(LayoutNode &node) {
  const bool shown = node.open || node.collapse_animating;
  for (size_t i = 1; i < node.children.size(); i++) node.children[i].section_shown = shown;
}

/**
 * The single state-mutation path for a Collapse: a tap on the header, `set_open`,
 * and the group enforcing exclusivity all come through here.
 */
bool View::set_collapse_open(LayoutNode &node, bool open) {
  if (node.open == open) return false;
  node.open = open;
  start_collapse(node);
  if (open) enforce_group(node);
  return true;
}

/**
 * Puts a Collapse's new `open` state into effect: the height tween if the node
 * declares a usable transition and does not declare its own height (a declared box
 * belongs to the author — the behavior does not fight it), the plain show/hide
 * otherwise, which is the pre-F7 behavior exactly.
 */
void View::start_collapse(LayoutNode &node) {
  const std::optional<ResolvedTransition> transition = transition_of(node);
  if (transition.has_value() && transition->usable() && !node.ir->layout.height.present()) {
    // The content enters layout now so the next measure can size it; while it was
    // out there is no honest open height, hence the one pending frame.
    node.collapse_pending = !node.collapse_animating && node.open;
    node.collapse_animating = true;
  }
  apply_open(node);
}

/** `"exclusive-open"`: opening one section closes its siblings. */
void View::enforce_group(LayoutNode &opened) {
  if (opened.parent == nullptr) return;
  if (opened.parent->ir->group != GroupBehavior::ExclusiveOpen) return;
  for (LayoutNode &sibling : opened.parent->children) {
    if (&sibling == &opened || sibling.ir->type != NodeType::Collapse || !sibling.open) continue;
    sibling.open = false;
    // Through the same path as a tap: in an accordion the one that closes animates
    // shut while the one that opens animates open.
    start_collapse(sibling);
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
  if (focus_ != nullptr) {
    focus_->focused = false;
    // Whatever the IME was building belongs to the field that had the keyboard.
    end_composition_state(*focus_);
  }
  focus_ = node;
  if (focus_ == nullptr) return;
  focus_->focused = true;
  // A field that gets the focus starts with a SOLID caret, not mid-blink.
  if (focus_->field != nullptr) focus_->field->caret_since = now_;
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
  // A field switched off mid-selection lets the pointer go. Nothing concludes:
  // the buffer never moved (ZAB-63).
  if (text_drag_ != nullptr && text_drag_->disabled) text_drag_ = nullptr;
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
  // The focus drags the scroll with it (2026-08-12, ZAB-47), which is the
  // deferred half of the ScrollView's spec. Only NAVIGATION does: a pointer press
  // focuses what the player is already looking at.
  reveal_focused(*best);
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

bool View::set_scroll(std::string_view id, double x, double y) {
  LayoutNode *node = find_by_id(id, NodeType::ScrollView);
  if (node == nullptr) return false;
  set_scroll_offset(*node, x, y);
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
  // The regions of the previous frame die here, together with the batches that
  // named them: nothing may hold a `Clip *` across a paint.
  paint_clips_.reset();
  geometry_.reset();
  if (ir_root_ != nullptr) paint_node(root_, 1.0, nullptr);
  return geometry_;
}

/**
 * Paint is implicit: a node's style IS its geometry (2026-08-01 #4). Opacity
 * inherits multiplicatively down the subtree and lands as a per-vertex alpha
 * (2026-08-06), so a parent at 0.5 over a child at 0.5 paints at 0.25 without
 * anything rendering to a texture.
 */
void View::paint_node(LayoutNode &node, double opacity, const Clip *clip) {
  if (!in_layout(node)) return;
  const double own = opacity * node.resolved.opacity;
  // Everything below is cut to the region this node's own rect is subject to.
  geometry_.set_clip(clip);
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
  // that tints an `Image` below — with the inherited opacity already folded in,
  // exactly as the fill above.
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
  if (node.ir->type == NodeType::Image) {
    const ImageAsset *asset = images_.get(node.ir->src);
    // Over the background the node just painted, which is what shows through
    // while the adapter has no texture for it yet.
    if (asset != nullptr) {
      geometry_.image(node.rect, *asset, node.ir->fit,
                      fade(node.resolved.color.value_or(UNTINTED), own), node.resolved.radius);
    }
  }
  if (node.ir->type == NodeType::TextInput && node.field != nullptr) {
    // A field is a LEAF with content: no children to paint and no scrollbar to
    // draw. Its clip group is left current on purpose — whatever paints next
    // opens its own, and re-setting this one here would leave an empty group
    // behind whenever the field is the last thing in its parent.
    paint_field(node, own, clip);
    return;
  }
  const Clip *inner = child_clip(node, clip, paint_clips_);
  // Clipped away entirely: the subtree — and the scrollbar — paint nothing.
  if (is_empty_clip(inner)) return;
  for (LayoutNode &child : node.children) paint_node(child, own, inner);
  if (node.ir->type == NodeType::ScrollView) paint_scrollbar(node, own, inner);
}

/**
 * The overlay position indicator, drawn inside the viewport and over the content
 * it indicates — which is why it comes after the children and re-enters the
 * region they were cut to.
 *
 * It is painted by the SDK and not authored: `scrollbar` is a boolean, and
 * styling it is the deferred, compatible extension the spec names (boolean →
 * object, 2026-08-11, ZAB-9).
 */
void View::paint_scrollbar(LayoutNode &node, double opacity, const Clip *clip) {
  if (!node.ir->scrollbar) return;
  const Rect &rect = node.rect;
  const ScrollbarThumb vertical = scrollbar_thumb(rect.height - SCROLLBAR_MARGIN * 2, rect.height,
                                                  node.scroll_max.y, node.scroll_offset.y,
                                                  SCROLLBAR_MIN_LENGTH);
  const ScrollbarThumb horizontal = scrollbar_thumb(rect.width - SCROLLBAR_MARGIN * 2, rect.width,
                                                    node.scroll_max.x, node.scroll_offset.x,
                                                    SCROLLBAR_MIN_LENGTH);
  if (!vertical.visible && !horizontal.visible) return;

  geometry_.set_clip(clip);
  const Color color = fade(SCROLLBAR_COLOR, opacity);
  if (vertical.visible) {
    geometry_.rounded_rect(Rect{rect.x + rect.width - SCROLLBAR_MARGIN - SCROLLBAR_THICKNESS,
                                rect.y + SCROLLBAR_MARGIN + vertical.start, SCROLLBAR_THICKNESS,
                                vertical.length},
                           SCROLLBAR_THICKNESS * 0.5, color);
  }
  if (horizontal.visible) {
    geometry_.rounded_rect(Rect{rect.x + SCROLLBAR_MARGIN + horizontal.start,
                                rect.y + rect.height - SCROLLBAR_MARGIN - SCROLLBAR_THICKNESS,
                                horizontal.length, SCROLLBAR_THICKNESS},
                           SCROLLBAR_THICKNESS * 0.5, color);
  }
}

/**
 * The field's own content: the selection highlight, the text or its placeholder,
 * and the caret — all shifted by the field's horizontal scroll, so a long value
 * runs UNDER the edge instead of over it.
 *
 * The three colours are the field's `style.color`, the same "colour of this
 * node's content" that already paints its glyphs, so a state override reaches
 * them for free and `Style` gains nothing (ZAB-26). The placeholder is not a
 * colour either: it is what `states.empty` dresses.
 */
void View::paint_field(LayoutNode &node, double opacity, const Clip *clip) {
  const FieldState &field = *node.field;
  const Style &style = style_of(node);
  GlyphAtlas &atlas = fonts_.get(font_size(style));
  const Rect box = content_box(node);
  // Everything below is cut to the content box: it is the field's OWN paint, so
  // it clips whether or not the author asked the node to clip its children.
  const Clip inner = intersect_clip(clip, box, 0.0);
  if (is_empty_clip(&inner)) return;
  geometry_.set_clip(paint_clips_.intern(inner));

  const Color content = node.resolved.color.value_or(DEFAULT_TEXT_COLOR);
  const bool showing_value = !field.text.empty();
  const std::string &showing = showing_value ? field.text : node.ir->placeholder;
  // One line, centred in the box — the same half-leading a `Text` places with.
  const double line_height = std::max(0.0, dim(style.line_height, atlas.font_line_height()));
  const double top = box.y + std::max(0.0, (box.height - line_height) / 2.0);
  const double origin_x = box.x - field.scroll;

  if (node.focused && has_selection(field.selection)) {
    const Span ordered = span_of(field.selection, field.chars.size());
    const double from = caret_x(field.chars, ordered.start, atlas);
    const double to = caret_x(field.chars, ordered.end, atlas);
    geometry_.rounded_rect(Rect{origin_x + from, top, to - from, line_height}, 0.0,
                           fade(content, opacity * CARET.selection_alpha));
  }
  if (!showing.empty()) {
    geometry_.text(origin_x, top + (line_height - atlas.font_line_height()) / 2.0, showing, atlas,
                   fade(content, opacity));
  }
  // The caret hides while a range is selected (the highlight already says where
  // the edit will land) and blinks from the last edit, so it is solid as you type.
  if (node.focused && !has_selection(field.selection) &&
      caret_visible(now_ - field.caret_since)) {
    geometry_.rounded_rect(
        Rect{origin_x + caret_x(field.chars, field.selection.focus, atlas), top, CARET.width,
             line_height},
        0.0, fade(content, opacity));
  }
}

// --- TextInput (ZAB-26) ---------------------------------------------------
// `textinput.h` owns the editing model — the caret math, `maxLength`, the
// single-line rule. This owns the state that runs it: the buffer, where the
// caret is, and the return leg of the data channel when an edit settles.

/**
 * The single state-mutation path for a field's text: typing, a paste, a
 * deletion, an IME commit and `set_text` all come through here.
 *
 * `silent` is a composition in flight — the field shows it and the game is not
 * told, because half a syllable is not a value — and `commit` is the end of one,
 * where the settled text has to go out even though the silent frames already put
 * it in the buffer.
 */
void View::apply_edit(LayoutNode &node, const Edit &edit, bool silent, bool commit) {
  FieldState &field = *node.field;
  const bool changed = edit.text != field.text;
  set_field_text(node, edit.text);
  field.selection = clamp_selection(edit.selection, field.chars.size());
  // Every edit restarts the blink from ON: a caret that goes dark exactly as you
  // type reads as a dropped keystroke.
  field.caret_since = now_;
  if ((changed || commit) && !silent) text_edited(node);
}

/**
 * An edit settled: the new value goes into the bound path — the return leg of
 * the data channel (2026-08-11, ZAB-23) — and the live `onChange` fires.
 */
void View::text_edited(LayoutNode &node) {
  const Node &ir = *node.ir;
  std::string path;
  if (ir.value.is_bound() && write_path(node, ir.value.bind, path)) {
    // The resolved path, never the declared one: a field inside an item writes
    // into THAT item (ZAB-52 is exactly the bug of writing the unresolved one).
    write_data(path, DataValue::of_text(node.field->text));
  }
  if (!ir.on_change.empty()) fire(node, ir.on_change);
}

/** Moves the caret (or the selection) without touching the text. */
void View::set_field_selection(LayoutNode &node, const Selection &selection) {
  FieldState &field = *node.field;
  field.selection = clamp_selection(selection, field.chars.size());
  field.caret_since = now_;
}

/** The caret index a point in view space selects, in the field's own content. */
size_t View::text_index_at(LayoutNode &node, double x) {
  const Rect box = content_box(node);
  GlyphAtlas &atlas = fonts_.get(font_size(style_of(node)));
  return index_at_x(node.field->chars, x - box.x + node.field->scroll, atlas);
}

/** The focused field, or null — the subject of every entry point below. */
LayoutNode *View::focused_field() {
  if (focus_ == nullptr || focus_->ir->type != NodeType::TextInput) return nullptr;
  if (focus_->field == nullptr || !in_layout(*focus_) || focus_->disabled) return nullptr;
  return focus_;
}

bool View::insert_text(std::string_view text) {
  LayoutNode *node = focused_field();
  if (node == nullptr || text.empty()) return false;
  end_composition_state(*node);
  apply_edit(*node, insert(node->field->chars, node->field->selection, text,
                           node->ir->max_length.value_or(0.0)));
  return true;
}

/**
 * A composition update: the field SHOWS it and the game is not told.
 *
 * The web renderer gets this from a hidden `<textarea>` that holds the whole
 * value; here the platform reports only the composing string, so every update
 * replaces the previous one — which is what the saved base is for. `end` is the
 * `compositionend` of the reference: the settled text goes out exactly once.
 */
bool View::set_composition(std::string_view text) {
  LayoutNode *node = focused_field();
  if (node == nullptr) return false;
  FieldState &field = *node->field;
  if (!field.composing) {
    field.composing = true;
    field.composing_base = field.text;
    field.composing_selection = field.selection;
  }
  // Always from the base, so an update is a replacement and not an append.
  const std::vector<char32_t> base = utf8_decode(field.composing_base);
  apply_edit(*node, insert(base, field.composing_selection, text,
                           node->ir->max_length.value_or(0.0)),
             true);
  return true;
}

bool View::end_composition() {
  LayoutNode *node = focused_field();
  if (node == nullptr || !node->field->composing) return false;
  node->field->composing = false;
  // Committed as it stands: the silent frames already put it in the buffer, so
  // what is left is telling the game — once, with the settled text.
  apply_edit(*node, Edit{node->field->text, node->field->selection}, false, true);
  return true;
}

/**
 * A composition abandoned by something that is not the IME — a keystroke, a
 * pointer, a write from the game. The text stays as the field shows it; only the
 * bookkeeping that would have made the next update a replacement is dropped.
 */
void View::end_composition_state(LayoutNode &node) {
  if (node.field != nullptr) node.field->composing = false;
}

std::string View::field_selection_text() {
  LayoutNode *node = focused_field();
  if (node == nullptr) return std::string();
  return selected_text(node->field->chars, node->field->selection);
}

bool View::edit_key(const KeyIntent &intent) {
  LayoutNode *node = focused_field();
  if (node == nullptr) return false;
  FieldState &field = *node->field;
  const size_t max = field.chars.size();
  end_composition_state(*node);

  if (intent.shortcut) {
    switch (intent.key) {
      case EditKey::SelectAll: set_field_selection(*node, select_all(max)); return true;
      // Ctrl/Cmd+arrow is Home/End on every desktop that has the combination.
      case EditKey::Left:
      case EditKey::Right:
        set_field_selection(
            *node, move_to_edge(max, field.selection, intent.key == EditKey::Right, intent.shift)
                       .selection);
        return true;
      // Copy, cut and paste are the platform's: the adapter reads the clipboard
      // and comes back through `field_selection_text` and `insert_text`.
      default: return false;
    }
  }

  switch (intent.key) {
    case EditKey::Left:
    case EditKey::Right: {
      const Move step =
          move_caret(max, field.selection, intent.key == EditKey::Left ? -1 : 1, intent.shift);
      // Nothing left to walk: let it fall through to spatial navigation instead
      // of trapping the player in the field (decision 2026-08-11, ZAB-26).
      if (step.at_boundary) return false;
      set_field_selection(*node, step.selection);
      return true;
    }
    case EditKey::Home:
    case EditKey::End:
      set_field_selection(
          *node,
          move_to_edge(max, field.selection, intent.key == EditKey::End, intent.shift).selection);
      return true;
    case EditKey::Backspace:
    case EditKey::Delete:
      apply_edit(*node,
                 remove(field.chars, field.selection, intent.key == EditKey::Delete));
      return true;
    case EditKey::Submit:
      // A held Enter is not a second submission.
      if (!intent.repeat && !node->ir->on_submit.empty()) fire(*node, node->ir->on_submit);
      return true;
    case EditKey::Tab:
      // Navigation here is spatial, so a Tab would only hand the keyboard to
      // whatever the scene has next and leave the field looking focused.
      return true;
    case EditKey::Space:
      // A space is TEXT: consumed so it presses nothing, and inserted by the
      // character path like any other key.
      return true;
    default:
      // Up and down always navigate: a single-line field has nowhere to send
      // them, which is the deliberate difference from the Slider's own axis.
      return false;
  }
}

bool View::set_text(std::string_view id, std::string_view text) {
  LayoutNode *node = find_by_id(id, NodeType::TextInput);
  if (node == nullptr || node->field == nullptr) return false;
  end_composition_state(*node);
  // The whole field is replaced, so the caret goes to the end — where a player
  // who had just typed it would have left it. `maxLength` is deliberately not
  // applied: it bounds what the PLAYER types, never what the game may put there.
  const std::string next(text);
  apply_edit(*node, Edit{next, caret_at(utf8_decode(next).size())});
  return true;
}

// --- input ----------------------------------------------------------------

/**
 * The node under the point, under the regions this frame cut. The walk itself is
 * `hit.h`'s; this is only where the tree and the arena come from.
 *
 * The input arena is its own on purpose: the batches of the last paint still name
 * regions in `paint_clips_`, and a hit test between two frames must not hand
 * those addresses back to be overwritten.
 */
LayoutNode *View::hit(double x, double y) {
  if (ir_root_ == nullptr) return nullptr;
  hit_clips_.reset();
  return hit_test(root_, x, y, hit_clips_);
}

/**
 * Is this node's own rect reachable at that point? Asked on release, where the
 * tree walk would answer a different question — which node is under the pointer
 * NOW, possibly a child of the pressed one. Scrolling a button out from under a
 * finger cancels its tap, and this is what notices.
 */
bool View::reachable_at(LayoutNode &node, double x, double y) {
  if (!node.rect.contains(x, y)) return false;
  hit_clips_.reset();
  return clip_contains(effective_clip(node, hit_clips_), x, y);
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
  LayoutNode *node = hit(x, y);
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (candidate->disabled) continue;
    if (candidate->ir->type == NodeType::Button || candidate->ir->type == NodeType::Toggle) {
      return candidate;
    }
  }
  return nullptr;
}

/** The field a press lands in, which then owns the pointer for the gesture. */
LayoutNode *View::field_at(double x, double y) {
  LayoutNode *node = hit(x, y);
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (candidate->ir->type == NodeType::TextInput && candidate->field != nullptr &&
        !candidate->disabled) {
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
  LayoutNode *node = hit(x, y);
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (is_focusable(*candidate)) return candidate;
  }
  return nullptr;
}

/** The Collapse header at this point, if the press did not land on a control. */
LayoutNode *View::collapse_header_at(double x, double y) {
  LayoutNode *node = hit(x, y);
  for (LayoutNode *candidate = node; candidate != nullptr; candidate = candidate->parent) {
    if (is_collapse_header(*candidate) && !candidate->disabled) return candidate;
  }
  return nullptr;
}

/**
 * Below this much pointer travel a gesture is still a tap: past it, it is a
 * scroll, and the release no longer activates anything.
 */
constexpr double DRAG_THRESHOLD = 4.0;

bool View::pointer_move(double x, double y, bool mouse) {
  bool changed = false;
  // Hover is a MOUSE state: a finger that taps and leaves would otherwise keep a
  // control lit up with nothing over it.
  if (mouse) {
    LayoutNode *target = hoverable_at(x, y);
    if (target != hovered_) {
      if (hovered_ != nullptr) hovered_->hovered = false;
      hovered_ = target;
      if (hovered_ != nullptr) hovered_->hovered = true;
      changed = true;
    }
  }
  if (text_drag_ != nullptr) {
    // The anchor stays where the press landed and only the focus follows the
    // pointer, so dragging backwards selects backwards.
    set_field_selection(*text_drag_,
                        Selection{text_drag_->field->selection.anchor,
                                  text_index_at(*text_drag_, x)});
    return true;
  }
  if (drag_.node == nullptr) return changed;

  // Held back until the threshold clears it, so a plain tap still reaches the
  // Collapse-toggle handling in `pointer_up`.
  if (!drag_.moved) {
    const double dx = x - drag_.start_x;
    const double dy = y - drag_.start_y;
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return changed;
    drag_.moved = true;
  }
  const double dx = x - drag_.last_x;
  const double dy = y - drag_.last_y;
  drag_.last_x = x;
  drag_.last_y = y;
  return set_scroll_offset(*drag_.node, drag_.node->scroll_offset.x - dx,
                           drag_.node->scroll_offset.y - dy) ||
         changed;
}

bool View::pointer_down(double x, double y, bool mouse) {
  // A new press ends whatever was still in flight, so the hover refresh below
  // cannot advance the previous gesture's drag by the jump between the two.
  drag_ = ScrollDrag{};
  const bool moved = pointer_move(x, y, mouse);
  // A field takes the pointer BEFORE anything else can: it drags a selection out,
  // and screens full of fields are scrollable, so the gesture must not become a
  // scroll of the list the field sits in. (G10, ZAB-143, joins it here for the
  // Slider, whose drag has the same problem.)
  LayoutNode *field = field_at(x, y);
  if (field != nullptr) {
    text_drag_ = field;
    set_focus(field);
    set_field_selection(*field, caret_at(text_index_at(*field, x)));
    return true;
  }
  LayoutNode *target = pressable_at(x, y);
  if (target != nullptr) {
    if (pressed_ != nullptr) pressed_->pressed = false;
    pressed_ = target;
    pressed_->pressed = true;
    // The pointer and directional navigation share ONE focus (2026-08-04).
    set_focus(target);
    return true;
  }
  // Nothing took the press, so it may be the beginning of a scroll. A disabled
  // control refuses the press above, and refusing means it falls THROUGH: a dead
  // button inside a scroller does not swallow the drag that moves the list.
  LayoutNode *node = hit(x, y);
  LayoutNode *scroller = node != nullptr ? scroller_of(*node) : nullptr;
  // `scroller_of` starts at the parent, so a press on the scroller itself — its
  // padding, its background — has to be caught here too.
  if (scroller == nullptr && node != nullptr && node->ir->type == NodeType::ScrollView) {
    scroller = node;
  }
  if (scroller != nullptr) {
    drag_ = ScrollDrag{scroller, x, y, x, y, false};
  }
  return moved;
}

bool View::pointer_up(double x, double y, bool mouse) {
  if (text_drag_ != nullptr) {
    // A selection concludes by simply existing: there is nothing to fire and no
    // value to settle — the buffer never changed.
    text_drag_ = nullptr;
    pointer_move(x, y, mouse);
    return true;
  }
  LayoutNode *released = pressed_;
  if (released != nullptr) {
    released->pressed = false;
    pressed_ = nullptr;
    drag_ = ScrollDrag{};
    // A press that leaves the control it started on fires nothing — the same rule
    // a cancelled gesture follows (ZAB-70): it ends, it does not conclude. And
    // "leaves" counts a control scrolled out from under the finger, which is why
    // the region is checked and not just the rect.
    if (reachable_at(*released, x, y)) release(*released);
    pointer_move(x, y, mouse);
    return true;
  }

  const bool dragged = drag_.moved;
  drag_ = ScrollDrag{};
  if (dragged) {
    // A scroll gesture, not a tap: the content moved, and nothing concludes.
    pointer_move(x, y, mouse);
    return true;
  }

  // Nothing was pressed and nothing was dragged, so this may be a tap on a
  // Collapse header: it toggles on the release and never wears `pressed`, which
  // is why it is not a pressable in the first place (the `<details>`/`<summary>`
  // model).
  LayoutNode *header = collapse_header_at(x, y);
  const bool toggled = header != nullptr && header->parent != nullptr &&
                       set_collapse_open(*header->parent, !header->parent->open);
  return pointer_move(x, y, mouse) || toggled;
}

bool View::pointer_wheel(double x, double y, double dx, double dy) {
  LayoutNode *node = hit(x, y);
  if (node == nullptr) return false;
  LayoutNode *scroller = node->ir->type == NodeType::ScrollView ? node : scroller_of(*node);
  if (scroller == nullptr) return false;
  // Axis for axis, as the reference maps a browser's deltas: a scroller that does
  // not enable an axis has a zero bound there, so the clamp drops it.
  return set_scroll_offset(*scroller, scroller->scroll_offset.x + dx,
                           scroller->scroll_offset.y + dy);
}

bool View::pointer_exit() {
  bool changed = pointer_cancel();
  if (hovered_ != nullptr) {
    hovered_->hovered = false;
    hovered_ = nullptr;
    changed = true;
  }
  return changed;
}

bool View::pointer_cancel() {
  bool changed = false;
  if (pressed_ != nullptr) {
    pressed_->pressed = false;
    pressed_ = nullptr;
    changed = true;
  }
  // A selection drag simply stops: the buffer never moved, so there is nothing
  // it could have concluded. G10 (ZAB-143) adds the one real exception here: a
  // Slider SETTLES on a cancel. Its value is already on screen and was written
  // into its bound path on every move, so refusing `onCommit` would leave the
  // game without the "apply the expensive thing" event for a value the player
  // really did leave there.
  changed = text_drag_ != nullptr || changed;
  text_drag_ = nullptr;
  changed = drag_.node != nullptr || changed;
  drag_ = ScrollDrag{};
  return changed;
}

// --- scrolling ------------------------------------------------------------

LayoutNode *View::scroller_of(LayoutNode &node) const {
  for (LayoutNode *current = node.parent; current != nullptr; current = current->parent) {
    // A layer entry is the top of its own input scope: a modal declared inside a
    // scroller must not scroll the screen behind it.
    if (current->ir->type == NodeType::Overlay) return nullptr;
    if (current->ir->type == NodeType::ScrollView) return current;
  }
  return nullptr;
}

bool View::set_scroll_offset(LayoutNode &node, double x, double y) {
  const Size next{clamp_scroll(x, 0.0, node.scroll_max.x),
                  clamp_scroll(y, 0.0, node.scroll_max.y)};
  if (next.x == node.scroll_offset.x && next.y == node.scroll_offset.y) return false;
  node.scroll_offset = next;
  return true;
}

bool View::reveal_focused(LayoutNode &node) {
  bool moved = false;
  // Outward through the nested scrollers, each one revealing the one inside it —
  // the way a browser's `scrollIntoView` bubbles. That converges in one pass
  // instead of measuring an inner rect the inner scroll has just moved.
  LayoutNode *target = &node;
  for (LayoutNode *scroller = scroller_of(node); scroller != nullptr;
       scroller = scroller_of(*scroller)) {
    const double padding = scroller->resolved.padding;
    const Rect box{scroller->rect.x + padding, scroller->rect.y + padding,
                   std::max(0.0, scroller->rect.width - padding * 2),
                   std::max(0.0, scroller->rect.height - padding * 2)};
    moved = set_scroll_offset(
                *scroller,
                scroller->scroll_offset.x +
                    reveal_delta(target->rect.x, target->rect.width, box.x, box.width),
                scroller->scroll_offset.y +
                    reveal_delta(target->rect.y, target->rect.height, box.y, box.height)) ||
            moved;
    target = scroller;
  }
  return moved;
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
