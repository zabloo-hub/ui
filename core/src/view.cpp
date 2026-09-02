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
#include "overlay.h"
#include "scroll.h"
#include "spinner.h"
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
 * Sizing for the childless types. A `TextInput` is one line tall and has no
 * intrinsic width, which is G11's (ZAB-144).
 */
class View::Leaves : public LeafMeasurer {
 public:
  explicit Leaves(View &view) : view_(view) {}

  Size measure_leaf(LayoutNode &node, std::optional<double> available) override {
    if (node.ir->type == NodeType::Text) return view_.measure_text(node, available);
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
  if (!shown(node)) return;
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
  // Overlay children are skipped: an entry is laid out AFTER this pass, against
  // the view rect, and placed by its own call from `layout_frame`.
  for (LayoutNode &child : node.children) {
    if (in_flow(child)) place_text(child);
  }
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
  // Kept as the tree is built, never found by walking it (ZAB-73). G12 (ZAB-145)
  // is what will also have to drop entries here, when a `Repeat` releases a row.
  if (ir.type == NodeType::Overlay) overlays_.push_back(&node);
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
      ((ir.type == NodeType::Slider || ir.group == GroupBehavior::ExclusiveCheck) &&
       ir.value.is_bound())) {
    bound_.push_back(&node);
  }
  apply_bindings(node);
  // Starting ON this data means there is nothing to animate from, so the slider
  // paints its value at once instead of gliding in from zero. That is a mount —
  // and G12 (ZAB-145) reuses it for an instance recycled onto another item.
  node.slider_display = node.slider_value;
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
  // The layer settles first: the focus an opening modal moves has to reach THIS
  // frame's style merge, or `states.focused` would land a frame late. An anchored
  // entry is the one thing here that reads rects, and it reads the ones already
  // laid out (see `is_on_screen`).
  layer_ = collect_layer(overlays_, LayerPresence(overlay_layer_));
  // Before the resolve pass, deliberately, for the same reason. It reads the
  // PREVIOUS frame's `disabled` flags, and `prune_disabled` below is what
  // corrects a node the game has just switched off — one frame of stale flags,
  // and an invisible one, because `disabled` merges last and its override is
  // already painting over the focus ring that same frame.
  overlay_layer_.sync_modal_focus();
  overlay_layer_.sync_auto_close(now_);
  // A control that left the layout under the pointer (a tab panel switching, a
  // Collapse closing) must not keep wearing the hover state on its way back.
  prune_hover();
  // Before resolve: a closing overlay is still painted for one transition, and
  // that is what keeps the resolve pass from dropping its subtree mid-fade.
  overlay_layer_.sync_presence(now_);
  resolve(root_, now_);
  prune_disabled();
  Leaves leaves(*this);
  measure(root_, leaves, viewport_.width);
  arrange(root_, viewport_);
  place_text(root_);

  // Then the layer, in `(z, document order)`, each entry measured and arranged
  // against the view rect. What paints is the live layer plus whatever is still
  // fading out, in that same order — a closing modal keeps its place under the
  // toast that was above it.
  paint_layer_ = overlay_layer_.any_exiting()
                     ? collect_layer(overlays_, PaintPresence(overlay_layer_))
                     : layer_;
  for (LayoutNode *overlay : paint_layer_) {
    measure(*overlay, leaves, viewport_.width);
    overlay_layer_.arrange_overlay(*overlay, viewport_);
  }
  // After arrange, where the boxes are final: a popover that just opened scrolls
  // its list to the option it focused. It only ever writes scroll offsets, and
  // arrange is the only pass that reads one back, so re-running it settles this.
  if (reveal_opened_popover()) {
    arrange(root_, viewport_);
    for (LayoutNode *overlay : paint_layer_) overlay_layer_.arrange_overlay(*overlay, viewport_);
  }
  // Text is placed in a pass of its own here, not lazily as the reference does,
  // so a layer entry has to be placed AFTER its own arrange — the tree pass above
  // stopped at it.
  for (LayoutNode *overlay : paint_layer_) place_text(*overlay);
  // A timeout counting down — or one that just fired, whose dismiss the next
  // frame has still to act on — is something that will change with no further
  // input, which is exactly what `animating` promises the adapter.
  if (overlay_layer_.wants_frame()) animating_ = true;
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
  if (!shown(node)) {
    // Out of layout: nothing to paint, and no honest previous value for the day it
    // comes back — dropping the state makes that return snap, like a mount. An
    // overlay mid-exit is the exception: it is still on screen this frame.
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
  else if (node.ir->type == NodeType::Slider) resolve_slider(node, anim, tween, now);
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

/**
 * The Slider's painted value. A change that comes from the game (a binding,
 * `set_value`) GLIDES; the one in the player's hand does not — a thumb lagging
 * the finger reads as a broken control, not as juice — so a gesture in flight
 * steps with no transition, which is the engine's instant path.
 */
void View::resolve_slider(LayoutNode &node, NodeAnim *anim, const ResolvedTransition *transition,
                          double now) {
  const bool gesturing = slider_drag_.node == &node || slider_keys_.node == &node;
  const SteppedValue stepped = step_value(anim, TrackKey::Value, node.slider_value,
                                          gesturing ? nullptr : transition, now);
  node.slider_display = stepped.value;
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
  if (ir.type == NodeType::Slider) {
    const SliderRange range = range_of(node);
    // Unbound, `value` is the initial number; bound, the store decides — and an
    // empty store leaves the control at its minimum. `to_number` is what accepts
    // the numeric strings the channel blurs, so a value that crossed a text field
    // or a JSON payload still moves the control.
    const double initial = ir.value.is_bound()
                               ? to_number(read_bind(node, ir.value.bind), range.min)
                               : (ir.value.value.kind == Scalar::Kind::Number
                                      ? ir.value.value.number
                                      : range.min);
    node.slider_value = quantize(initial, range);
  }
  // A TextInput's bound value lands here too, in G11 (ZAB-144): the prop exists,
  // the runtime that holds it does not yet.
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
  if (ir.type == NodeType::Slider && ir.value.is_bound() && touches(ir.value.bind)) return true;
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
    // Choosing is the gesture that ends the menu (2026-08-12, ZAB-25), and it
    // ends it even when the choice is the option already selected — a dropdown
    // that stayed open on "I meant this one" would be a dead end.
    overlay_layer_.close_enclosing_popover(node);
    // Re-picking the option already selected moves nothing, so nothing is
    // reported — the menu still closed, which is the popover's rule and not this
    // one's.
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

// --- Slider (2026-08-11, ZAB-24) -------------------------------------------

SliderRange View::range_of(const LayoutNode &node) const {
  return resolve_range(node.ir->min, node.ir->max, node.ir->step);
}

bool View::slider_vertical(const LayoutNode &node) const {
  return grows_upward(node.ir->slider_axis);
}

void View::set_slider_value(LayoutNode &node, double value) {
  const double next = quantize(value, range_of(node));
  if (next == node.slider_value) return;
  node.slider_value = next;
  const Node &ir = *node.ir;
  std::string path;
  if (ir.value.is_bound() && write_path(node, ir.value.bind, path)) {
    write_data(path, DataValue::of_number(next));
  }
  if (!ir.on_change.empty()) fire(node, ir.on_change);
}

void View::commit_slider(const SliderGesture &gesture) {
  if (gesture.node == nullptr) return;
  const std::string &action = gesture.node->ir->on_commit;
  if (!action.empty() && gesture.node->slider_value != gesture.from) fire(*gesture.node, action);
}

double View::value_at_point(const LayoutNode &node, double x, double y) const {
  const bool vertical = slider_vertical(node);
  const double padding = node.resolved.padding;
  const double length =
      std::max(0.0, (vertical ? node.rect.height : node.rect.width) - padding * 2);
  const double start = (vertical ? node.rect.y : node.rect.x) + padding;
  // The thumb's own size, straight from the measure — the same number
  // `arrange_slider` insets the travel by, so the two cannot drift apart.
  const LayoutNode *thumb = node.children.size() > 1 ? &node.children[1] : nullptr;
  const double thumb_size =
      thumb != nullptr ? std::min(vertical ? thumb->measured.y : thumb->measured.x, length) : 0.0;
  return value_at(vertical ? y : x, start, length, thumb_size, range_of(node), vertical);
}

/**
 * One arrow press on the focused Slider. Only the keys ALONG its axis reach here
 * (the cross-axis ones keep navigating), and on a vertical slider up means more —
 * the value grows upward, like the track does.
 */
void View::nudge_slider(LayoutNode &node, double dx, double dy) {
  const bool vertical = slider_vertical(node);
  const double direction = vertical ? -dy : dx;
  if (slider_keys_.node == nullptr) slider_keys_ = SliderGesture{&node, node.slider_value};
  set_slider_value(node, step_by(node.slider_value, direction, range_of(node)));
}

bool View::slider_axis_key(const LayoutNode *node, double dx) const {
  if (node == nullptr || node->ir->type != NodeType::Slider || !in_layout(*node)) return false;
  if (node->disabled) return false;
  return slider_vertical(*node) ? dx == 0.0 : dx != 0.0;
}

bool View::settle_slider_keys() {
  const SliderGesture gesture = slider_keys_;
  if (gesture.node == nullptr) return false;
  slider_keys_ = SliderGesture{};
  commit_slider(gesture);
  return true;
}

bool View::end_slider_drag(bool settle) {
  const SliderGesture gesture = slider_drag_;
  if (gesture.node == nullptr) return false;
  slider_drag_ = SliderGesture{};
  gesture.node->pressed = false;
  if (settle) commit_slider(gesture);
  return true;
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
  // Opening a popover is behavior on TOP of the action, never instead of it: a
  // `<Select>` trigger is an ordinary Button that happens to be an anchor.
  overlay_layer_.toggle_popovers(node);
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

LayoutNode &View::scope() { return focus_scope(root_, layer_); }

/**
 * The scope's initial focus.
 *
 * A popover opens ON its selection — the option the group already holds, so a
 * list of twenty languages lands where the player left it (2026-08-12, ZAB-25) —
 * and everything else opens on its declared `autofocus`.
 */
LayoutNode *View::autofocus(LayoutNode &scope) {
  if (!is_press_triggered(scope)) return autofocus_in(scope);

  LayoutNode *option = selected_option_in(scope);
  if (option == nullptr || !is_focusable(*option)) {
    option = autofocus_in(scope);
    if (option == nullptr) {
      // Nothing chosen yet: the FIRST option, never nothing. A menu the player
      // opened is a menu they are in, and one that starts with no focus cannot be
      // walked with the arrows at all — the keyboard would have nowhere to step
      // from. (Only a popover does this: everywhere else "no autofocus" honestly
      // means the author asked for none.)
      std::vector<LayoutNode *> options;
      candidates_in(scope, options);
      option = options.empty() ? nullptr : options.front();
    }
  }
  // Whatever it lands on has to be SEEN: the list opens scrolled to it.
  pending_reveal_ = option;
  return option;
}

void View::candidates_in(LayoutNode &scope, std::vector<LayoutNode *> &out) {
  if (!in_layout(scope)) return;  // pruned subtrees have stale rects
  // A closed popover is pruned the same way, but by the LAYER's predicate:
  // `popover_open` is overlay state and not a layout flag, so `in_layout` alone
  // would offer its options — stale rects included — as candidates.
  if (scope.ir->type == NodeType::Overlay &&
      std::find(layer_.begin(), layer_.end(), &scope) == layer_.end()) {
    return;
  }
  if (is_focusable(scope)) out.push_back(&scope);
  for (LayoutNode &child : scope.children) candidates_in(child, out);
}

/**
 * Reveals the focus a POPOVER opened on, once this frame's boxes are final.
 *
 * `reveal_focused` is otherwise navigation-only, and deliberately so: a pointer
 * press focuses what the player is already looking at, and a focus restored
 * during a relayout would scroll a frame late. A popover is the case that rule
 * does not cover — it opens ON its selection (2026-08-12, ZAB-25), so the list
 * has to be scrolled to an option that the frame it appears on has only just
 * been laid out. Doing it here, after arrange, is what makes it the SAME frame:
 * only scroll offsets change, and arrange is the only pass that reads one back.
 */
bool View::reveal_opened_popover() {
  LayoutNode *node = pending_reveal_;
  pending_reveal_ = nullptr;
  if (node == nullptr || !in_layout(*node)) return false;
  return reveal_focused(*node);
}

bool View::dismiss_top_modal() {
  LayoutNode *modal = top_modal(layer_);
  if (modal == nullptr) return false;
  overlay_layer_.request_dismiss(*modal);
  return true;
}

bool View::shown(const LayoutNode &node) { return in_layout(node) || node.presence_exiting; }

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
  // CANCELLED, not settled: the control died under the finger, so its value never
  // became the player's (ZAB-63). Both gestures alike — a held arrow must not
  // commit a control the game just killed either. A scroll drag survives on
  // purpose: a disabled section is still readable, so scrolling it was never an
  // interaction that section owned.
  if (slider_drag_.node != nullptr && slider_drag_.node->disabled) end_slider_drag(false);
  if (slider_keys_.node != nullptr && slider_keys_.node->disabled) slider_keys_ = SliderGesture{};
}

bool View::move_focus(double dx, double dy) {
  if (ir_root_ == nullptr) return false;
  // On a focused Slider the arrows ALONG its axis adjust the value and the cross
  // ones keep navigating (2026-08-11, ZAB-24). Deliberately unlike the TextInput
  // of G11 (ZAB-144), which hands its axis back at the end of the text: a slider's
  // travel is short, so stepping through it is cheap, and a control that swallowed
  // all four directions is exactly what breaks a screen for a pad.
  //
  // Before the scope, and it needs no check against it: the focus is already
  // inside whatever owns it, so a slider that holds the focus is by definition one
  // the player can reach.
  if (slider_axis_key(focus_, dx)) {
    nudge_slider(*focus_, dx, dy);
    return true;
  }
  // Only inside the current scope: while a modal is up, the trap that derives
  // from it is exactly this — nothing under it is a candidate (2026-08-11).
  LayoutNode &walk = scope();
  std::vector<LayoutNode *> candidates;
  candidates_in(walk, candidates);
  if (candidates.empty()) return false;

  LayoutNode *current = focus_;
  const bool walkable =
      current != nullptr && std::find(candidates.begin(), candidates.end(), current) != candidates.end();
  if (!walkable) {
    // The player asked to move and there is no rect to move FROM, so the walk
    // starts again from the scope's `autofocus` — the rule already documented for
    // having no focus at all.
    LayoutNode *start = autofocus(walk);
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
  // Collapse branch below. The field's own handling arrives with G11 (ZAB-144).
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

bool View::set_value(std::string_view id, double value) {
  LayoutNode *node = find_by_id(id, NodeType::Slider);
  if (node == nullptr) return false;
  // A whole gesture and not just a write: the value moves and then SETTLES, so a
  // game that pushes a number gets its `onCommit` exactly as a player's release
  // would have. `set_checked`'s "a tap given by the game", one control over.
  const SliderGesture gesture{node, node->slider_value};
  set_slider_value(*node, value);
  commit_slider(gesture);
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
  if (ir_root_ == nullptr) return geometry_;
  paint_node(root_, 1.0, nullptr);
  // Then the layer, in `(z, document order)`. Each entry is a PAINT ROOT: it
  // opens a group of its own, because sharing the tree's would put the tree's
  // glyphs over this panel (a group draws all its solids before all its text),
  // and it starts from its own `presence` rather than from the opacity of
  // wherever it was declared — so a backdrop and its panel fade in together.
  for (LayoutNode *overlay : paint_layer_) {
    geometry_.start_root();
    paint_node(*overlay, overlay->presence, nullptr);
  }
  return geometry_;
}

/**
 * Paint is implicit: a node's style IS its geometry (2026-08-01 #4). Opacity
 * inherits multiplicatively down the subtree and lands as a per-vertex alpha
 * (2026-08-06), so a parent at 0.5 over a child at 0.5 paints at 0.25 without
 * anything rendering to a texture.
 */
void View::paint_node(LayoutNode &node, double opacity, const Clip *clip) {
  if (!shown(node)) return;
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
  const Clip *inner = child_clip(node, clip, paint_clips_);
  // Clipped away entirely: the subtree — and the scrollbar — paint nothing.
  if (is_empty_clip(inner)) return;
  // Overlay children are skipped here: they paint in the layer pass, above.
  for (LayoutNode &child : node.children) {
    if (in_flow(child)) paint_node(child, own, inner);
  }
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

// --- input ----------------------------------------------------------------

/**
 * The node under the point, under the regions this frame cut. The walk itself is
 * `hit.h`'s; this is only where the tree and the arena come from.
 *
 * The input arena is its own on purpose: the batches of the last paint still name
 * regions in `paint_clips_`, and a hit test between two frames must not hand
 * those addresses back to be overwritten.
 */
LayerHit View::hit_layer(double x, double y) {
  if (ir_root_ == nullptr) return LayerHit{};
  hit_clips_.reset();
  return resolve_hit(root_, layer_, x, y, hit_clips_);
}

LayoutNode *View::hit(double x, double y) {
  const LayerHit resolved = hit_layer(x, y);
  return resolved.kind == LayerHit::Kind::Node ? resolved.node : nullptr;
}

namespace {

/**
 * Nearest self-or-ancestor a gesture belongs to, stopping at an `Overlay`: a
 * layer entry is the top of its own input scope, so a gesture inside a modal
 * never reaches the ScrollView or Collapse it happens to be declared inside.
 */
template <typename Predicate>
LayoutNode *find_up(LayoutNode *node, Predicate predicate) {
  for (LayoutNode *current = node; current != nullptr; current = current->parent) {
    if (current->ir->type == NodeType::Overlay) return nullptr;
    if (predicate(*current)) return current;
  }
  return nullptr;
}
}  // namespace

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
 * What a mouse lights up: exactly the focusable set (2026-08-11, ZAB-36), so one
 * rule answers both questions rather than two lists drifting apart — and a mouse
 * and a pad see the same dead control.
 */
LayoutNode *View::hoverable_at(double x, double y) {
  // A modal's backdrop captures the input, so it lights up nothing below it.
  return find_up(hit(x, y), [](const LayoutNode &node) { return is_focusable(node); });
}

/** The Collapse header at this point, if the press did not land on a control. */
LayoutNode *View::collapse_header_at(double x, double y) {
  return find_up(hit(x, y), [](const LayoutNode &node) {
    return is_collapse_header(node) && !node.disabled;
  });
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
  if (slider_drag_.node != nullptr) {
    // No drag threshold: a slider follows the finger from the first pixel. There
    // is no tap-vs-drag ambiguity to resolve — the press already set a value.
    const double before = slider_drag_.node->slider_value;
    set_slider_value(*slider_drag_.node, value_at_point(*slider_drag_.node, x, y));
    return slider_drag_.node->slider_value != before || changed;
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
  // cannot advance the previous gesture's drag by the jump between the two. A
  // Slider gesture ends the way a cancel ends it — settling, since its value is
  // already on screen and already written.
  drag_ = ScrollDrag{};
  backdrop_press_ = nullptr;
  end_slider_drag(true);
  const bool moved = pointer_move(x, y, mouse);
  // One walk for the whole press: everything below reads what the layer resolved,
  // rather than testing the same point again.
  const LayerHit resolved = hit_layer(x, y);
  if (resolved.kind == LayerHit::Kind::Backdrop) {
    // A tap on a modal's backdrop: dismissed on release, like a button click, and
    // never falling through to what the modal covers. FIRST, because a modal
    // captures everything below it — a Slider under one must not take the press.
    backdrop_press_ = resolved.node;
    return true;
  }
  LayoutNode *node = resolved.kind == LayerHit::Kind::Node ? resolved.node : nullptr;
  // A Slider takes the pointer before any button: the gesture starts on the press
  // (the thumb jumps to the finger), and the control lives inside scrollable
  // screens where the drag has to move the value and not the list. G11 (ZAB-144)
  // puts the text field here too, for the same reason.
  LayoutNode *slider =
      find_up(node, [](const LayoutNode &candidate) {
        return !candidate.disabled && candidate.ir->type == NodeType::Slider;
      });
  if (slider != nullptr) {
    slider_drag_ = SliderGesture{slider, slider->slider_value};
    slider->pressed = true;
    // The pointer and directional navigation share ONE focus (2026-08-04).
    set_focus(slider);
    set_slider_value(*slider, value_at_point(*slider, x, y));
    return true;
  }
  // What a press takes hold of next: a Button or a Toggle, and nothing else —
  // deliberately NARROWER than the focusable set. A Collapse header toggles on the
  // release without ever wearing `pressed` (see `pointer_up`).
  LayoutNode *target = find_up(node, [](const LayoutNode &candidate) {
    return !candidate.disabled &&
           (candidate.ir->type == NodeType::Button || candidate.ir->type == NodeType::Toggle);
  });
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
  // The Slider's release settles the gesture: `onCommit` is the "apply the
  // expensive thing" event, and it only fires if the number actually moved.
  if (end_slider_drag(true)) {
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

  LayoutNode *backdrop = backdrop_press_;
  backdrop_press_ = nullptr;
  if (backdrop != nullptr) {
    // Dismissed only if the release lands on the same backdrop — a press that
    // slid onto the panel is a press that changed its mind.
    const LayerHit resolved = hit_layer(x, y);
    if (resolved.kind == LayerHit::Kind::Backdrop && resolved.node == backdrop) {
      overlay_layer_.request_dismiss(*backdrop);
    }
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
  // A modal captures the wheel too: nothing below it scrolls.
  const LayerHit resolved = hit_layer(x, y);
  if (resolved.kind != LayerHit::Kind::Node) return false;
  LayoutNode *node = resolved.node;
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
  // The one exception to "ends without concluding": a Slider SETTLES on a cancel.
  // Its value is already on screen and was written into its bound path on every
  // move, so refusing `onCommit` would leave the game without the "apply the
  // expensive thing" event for a value the player really did leave there. Same
  // reading as a pad unplugged mid-nudge (2026-08-12, ZAB-47).
  changed = end_slider_drag(true) || changed;
  changed = drag_.node != nullptr || changed;
  drag_ = ScrollDrag{};
  // A backdrop press that never concluded: nothing is dismissed, exactly as a
  // press released off its control fires nothing.
  changed = backdrop_press_ != nullptr || changed;
  backdrop_press_ = nullptr;
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
