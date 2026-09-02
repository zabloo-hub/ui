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
  prepare(root_, nullptr);
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
void View::prepare(LayoutNode &node, const ItemScope *scopes) {
  const Node &ir = *node.ir;
  // An `id` inside a template is worn by every instance of it: the map keeps the
  // last one realized, so the host channel still reaches ONE of them. Addressing
  // a particular row by id is not a thing v1 has — an action from inside a row
  // comes back with its item context instead.
  if (!ir.id.empty()) by_id_[ir.id] = &node;
  node.scopes = scopes;
  // Kept as the tree is built, never found by walking it (ZAB-73), and `discard`
  // is what drops the entries again when a `Repeat` lets a row go.
  if (ir.type == NodeType::Overlay) overlays_.push_back(&node);
  if (ir.type == NodeType::Repeat) {
    // Before the children, like every registry here: the sets are top-down, which
    // is what lets the expansion sweep reach a nested list on the same pass that
    // created the instance holding it.
    repeats_.push_back(&node);
    node.repeat = std::make_unique<RepeatState>();
    // What `build_layout_tree` left in `children` is the empty state, and only
    // that: the template's instances come from the data, not from the document.
    for (LayoutNode &slot : node.children) {
      slot.section_shown = false;
      node.repeat->empty.push_back(&slot);
    }
  }
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
  node.data_bound = ir.visible.is_bound() || ir.disabled.is_bound() || ir.checked.is_bound() ||
                    ((ir.type == NodeType::Slider || ir.type == NodeType::TextInput ||
                      ir.group == GroupBehavior::ExclusiveCheck) &&
                     ir.value.is_bound());
  if (node.data_bound) bound_.push_back(&node);
  // Settled: this is the node's initial value, so a field's caret belongs at the
  // end of it — where a player who had just typed it would have left it.
  apply_bindings(node, true);
  // Starting ON this data means there is nothing to animate from, so the slider
  // paints its value at once instead of gliding in from zero. That is a mount —
  // and `resettle` reuses it for an instance recycled onto another item.
  node.slider_display = node.slider_value;
  for (LayoutNode &child : node.children) prepare(child, scopes);
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
  // The expansion first, before anything reads the tree: a row that the data just
  // created has to exist before the layer is collected, before the resolve pass
  // walks it and before it is measured.
  sync_repeats();
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
  // Last, once every box is final — the tree's AND the layer's: a field inside a
  // modal has to keep its caret in view too, and its rect only exists after the
  // loop above.
  sync_text_scroll();
  // With the boxes final, what a virtualized list learnt from them: one line's
  // size, and whether these rects would now plan a different window than the one
  // this frame was laid out with.
  sync_extents();
  // A timeout counting down — or one that just fired, whose dismiss the next
  // frame has still to act on — is something that will change with no further
  // input, which is exactly what `animating` promises the adapter.
  if (overlay_layer_.wants_frame()) animating_ = true;
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

const DataValue *View::read_bind(const LayoutNode &node, const std::string &bind) {
  const ResolvedBind resolved = resolve_binding(bind, node.scopes);
  if (resolved.kind == ResolvedBind::Kind::Index) {
    index_value_ = DataValue::of_number(resolved.index);
    return &index_value_;
  }
  return data_ != nullptr ? data_->get(resolved.path) : nullptr;
}

bool View::write_path(const LayoutNode &node, const std::string &bind, std::string &out) const {
  const ResolvedBind resolved = resolve_binding(bind, node.scopes);
  // An index is a POSITION, not a slot: there is nowhere in the data to put it.
  if (resolved.kind != ResolvedBind::Kind::Path) return false;
  out = resolved.path;
  return true;
}

/**
 * Derives from data everything this node's state reads.
 *
 * The single place those states are computed, so building a node and a `SetData`
 * landing on it settle it the same way — which is what `resettle` leans on when
 * an item instance is recycled onto another element.
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
  if (ir.type == NodeType::Slider && ir.value.is_bound() && touches(ir.value.bind)) return true;
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

// --- Repeat: expansion, item scopes and the life of an instance (ZAB-31) ----

namespace {

/** The alias a template binds its element under when the node declares none. */
constexpr std::string_view ITEM_ALIAS = "item";

/** Whether a ScrollView scrolls on the axis a virtualized list stacks its lines on. */
bool scrolls_on(const LayoutNode &scroller, bool vertical) {
  const ScrollAxis axis = scroller.ir->scroll_axis;
  return axis == ScrollAxis::Both ||
         axis == (vertical ? ScrollAxis::Vertical : ScrollAxis::Horizontal);
}

/** Whether a measurement moved enough to matter — a subpixel wobble is not a relayout. */
bool measurement_moved(const std::optional<double> &previous, double next) {
  return !previous.has_value() || std::fabs(*previous - next) > 0.5;
}

}  // namespace

void View::sync_repeats() {
  // By index and re-reading the size, because `expand` APPENDS: the instances an
  // outer list creates bring their own inner lists into this same sweep, which is
  // what makes a nested list come out right by construction. Discarded rows null
  // their entry rather than erase it, so those indices cannot shift underneath.
  for (size_t i = 0; i < repeats_.size(); i++) {
    if (repeats_[i] != nullptr) expand(*repeats_[i]);
  }
  repeats_.erase(std::remove(repeats_.begin(), repeats_.end(), nullptr), repeats_.end());
}

void View::expand(LayoutNode &node) {
  RepeatState &state = *node.repeat;
  const Node &ir = *node.ir;
  // `items` is a binding by construction (the IR carries no literal data):
  // anything else repeats nothing, and the empty state takes over.
  std::string array_path;
  const bool bound = !ir.items_bind.empty() && write_path(node, ir.items_bind, array_path);
  const DataValue *items =
      bound && data_ != nullptr ? items_of(data_->get(array_path)) : nullptr;
  const int count = items != nullptr ? static_cast<int>(items->items.size()) : 0;
  state.item_count = count;

  const Node *item_ir = item_template(ir);
  const WindowPlan plan = plan_window(node, count);
  node.virtual_span = plan.span;
  state.first = plan.first;
  state.count = plan.count;

  if (item_ir == nullptr || !bound) {
    state.slots.clear();
  } else {
    window_slots(items, ir.key_path, plan.first, plan.count, state.slots);
  }
  reconcile_window(state.instances, state.slots, state.entries, state.dropped);

  // Every current child, out of the list and held: reordering is then a move of
  // pointers, and the nodes themselves never change address — which is what lets
  // the focus, the id index and a gesture in flight all keep pointing at them.
  node.children.take_all(state.taken);
  // The empty state is always pushed last, so what precedes it is the old window.
  const size_t empty_first = state.taken.size() - state.empty.size();

  for (const RepeatInstance &gone : state.dropped) {
    // Before the discard, which is what would forget it: the focus of a row that
    // leaves the window survives as the ITEM it was on (ZAB-70).
    remember_focus(node, *gone.node);
    discard(*gone.node);
    state.taken[gone.slot].reset();
  }

  const std::string alias = ir.item_alias.empty() ? std::string(ITEM_ALIAS) : ir.item_alias;
  state.next.clear();
  for (const WindowEntry<RepeatInstance> &entry : state.entries) {
    std::string path = item_path(array_path, entry.slot.index);
    LayoutNode *child = nullptr;
    if (entry.instance != nullptr) {
      child = entry.instance->node;
      node.children.push_back(std::move(state.taken[entry.instance->slot]));
      rescope(*child, alias, path, entry.slot.index);
    } else {
      child = &build_instance(*item_ir, node, alias, std::move(path), entry.slot.index);
    }
    state.next.emplace(entry.slot.identity,
                       RepeatInstance{child, static_cast<uint32_t>(node.children.size() - 1)});
    // Back in the window: the item the focus is waiting on takes it again.
    restore_focus(node, entry.slot.identity, *child);
  }
  state.instances.swap(state.next);
  state.next.clear();

  // The empty state is in layout exactly while there is nothing to repeat — the
  // display:none semantics of every other slot (2026-08-11, ZAB-29).
  for (size_t i = empty_first; i < state.taken.size(); i++) {
    state.taken[i]->section_shown = count == 0;
    node.children.push_back(std::move(state.taken[i]));
  }
  state.taken.clear();
}

LayoutNode &View::build_instance(const Node &item_ir, LayoutNode &node, const std::string &alias,
                                 std::string path, int index) {
  LayoutNode &child = node.children.emplace_back();
  child.parent = &node;
  // The link is owned by the instance root and chained to whatever scope the
  // `Repeat` itself sits in, which is what lets a nested list reach the element
  // outside it — and what makes moving that outer row one mutation.
  child.scope_link = std::make_unique<ItemScope>();
  child.scope_link->alias = alias;
  child.scope_link->path = std::move(path);
  child.scope_link->index = index;
  child.scope_link->outer = node.scopes;
  build_layout_tree(item_ir, child);
  prepare(child, child.scope_link.get());
  return child;
}

void View::rescope(LayoutNode &instance, const std::string &alias, const std::string &path,
                   int index) {
  ItemScope *scope = instance.scope_link.get();
  if (scope == nullptr) return;
  if (scope->path == path && scope->index == index && scope->alias == alias) return;
  scope->alias = alias;
  scope->path = path;
  scope->index = index;
  // The subtree now reads another element: everything derived from data has to be
  // derived again (its text follows on its own — it is read at measure time).
  resettle(instance);
}

void View::resettle(LayoutNode &node) {
  if (node.data_bound) apply_bindings(node, true);
  forget_tweens(node);
  for (LayoutNode &child : node.children) resettle(child);
}

View::WindowPlan View::plan_window(LayoutNode &node, int item_count) {
  // Everything is realized when there is nothing to window against — a `Repeat`
  // outside a ScrollView, or one whose lines stack across the axis its scroller
  // scrolls — because then the whole list is on screen anyway and virtualizing it
  // would only cost a measurement.
  const WindowPlan whole{std::nullopt, 0, item_count};
  RepeatState &state = *node.repeat;
  // Nothing to repeat: the node is not a list this frame, it is its empty state —
  // and reserving the space of zero items would flatten it to nothing.
  if (item_count == 0) return whole;
  LayoutNode *scroller = scroller_of(node);
  if (scroller == nullptr) return whole;
  // The lines of a wrapping node stack across it, so a grid is scrolled on the
  // cross axis — vertically, since `wrap` only takes effect on a row.
  const bool wrapping = wraps_lines(node);
  const bool vertical = wrapping || node.ir->layout.direction != Direction::Row;
  if (!scrolls_on(*scroller, vertical)) return whole;

  const double view_length = vertical ? scroller->rect.height : scroller->rect.width;
  if (!state.extent.has_value() || !(*state.extent > 0.0) || !(view_length > 0.0)) {
    // Nothing measured yet — the first frame of a list, or of a reload. Realize a
    // batch, and let the next frame settle the window with real rects.
    if (item_count <= INITIAL_WINDOW) return whole;
    return WindowPlan{std::nullopt, 0, INITIAL_WINDOW};
  }

  ItemMetrics metrics;
  metrics.extent = *state.extent;
  metrics.gap = node.resolved.gap;
  const double padding = node.resolved.padding;
  metrics.per_line =
      wrapping ? items_per_line(std::max(0.0, node.rect.width - padding * 2.0),
                                state.item_main.value_or(0.0), metrics.gap)
               : 1;
  const double start = vertical ? node.rect.y : node.rect.x;
  const double view_start = (vertical ? scroller->rect.y : scroller->rect.x) - start - padding;
  const ItemSpan span = visible_span(item_count, metrics, view_start, view_length);
  return WindowPlan{span, span.first, span.count};
}

void View::sync_extents() {
  for (LayoutNode *node : repeats_) {
    if (node != nullptr) sync_extent(*node);
  }
}

/**
 * Learns one line's size from the instances that were just laid out. The
 * assumption virtualization rests on is that every instance of a template
 * measures the same, so ONE of them is the measurement. When it moves — the first
 * frame of a list, a resize that changes how many cells fit — the window this
 * frame used came from the old number, so the frame is repeated with the new one.
 */
void View::sync_extent(LayoutNode &node) {
  RepeatState &state = *node.repeat;
  if (!state.instances.empty() && !node.children.empty()) {
    LayoutNode &instance = node.children[0];
    // A width that moved is a relayout: whatever was learnt for the old one (rows
    // that wrapped differently, another number of cells per line) is not a
    // measurement of THIS list any more.
    if (measurement_moved(state.measured_width, node.rect.width)) {
      state.extent.reset();
      state.item_main.reset();
    }
    state.measured_width = node.rect.width;
    const bool row = node.ir->layout.direction == Direction::Row;
    const double main = row ? instance.measured.x : instance.measured.y;
    const double extent =
        wraps_lines(node) ? (row ? instance.measured.y : instance.measured.x) : main;
    // The BIGGEST instance seen wins. With the uniform items the assumption is
    // about, that is the item's own size on the first frame and it never moves
    // again; with rows of unequal size it converges upwards in a few frames
    // instead of oscillating between two windows forever, each of which would
    // schedule the next. The list is looser than it should be, never busy.
    state.extent = state.extent.has_value() ? std::max(*state.extent, extent) : extent;
    state.item_main = state.item_main.has_value() ? std::max(*state.item_main, main) : main;
  }
  // Whether THIS frame's rects would now produce a different window than the one
  // it was laid out with. They usually would not — but a scroll moved the rects
  // after the expansion pass read them, and the frame the game asked for is not
  // the one that shows the rows it scrolled to. So the view asks for one more, and
  // it converges there: what the plan reads (the scroller's rect, the node's own
  // reserved size) does not depend on which items are realized.
  if (window_drifted(node, state)) animating_ = true;
}

bool View::window_drifted(LayoutNode &node, RepeatState &state) {
  const WindowPlan next = plan_window(node, state.item_count);
  return next.first != state.first || next.count != state.count;
}

LayoutNode *View::repeat_of(const LayoutNode &node) const {
  // A node of the EMPTY state is not inside an item, so it walks past its
  // `Repeat` and finds whatever list encloses the whole thing.
  for (const LayoutNode *current = &node; current != nullptr; current = current->parent) {
    LayoutNode *parent = current->parent;
    if (parent == nullptr || parent->repeat == nullptr) continue;
    const std::vector<LayoutNode *> &empty = parent->repeat->empty;
    if (std::find(empty.begin(), empty.end(), current) == empty.end()) return parent;
  }
  return nullptr;
}

void View::discard(LayoutNode &node) {
  // The list itself is going: there is nothing left for a pending focus to come
  // back to.
  if (pending_focus_.has_value() && pending_focus_->repeat == &node) pending_focus_.reset();
  const auto drop = [&node](std::vector<LayoutNode *> &list) {
    list.erase(std::remove(list.begin(), list.end(), &node), list.end());
  };
  drop(bound_);
  drop(overlays_);
  drop(fields_);
  // Last frame's layer too. It is rebuilt further down this very frame, so
  // nothing would read a stale entry — but a list of pointers to freed nodes is
  // the exact class of bug the tree's stable addresses exist to keep out.
  drop(layer_);
  drop(paint_layer_);
  // NULLED and not erased: `sync_repeats` may be walking this very list by index.
  std::replace(repeats_.begin(), repeats_.end(), &node, static_cast<LayoutNode *>(nullptr));
  overlay_layer_.forget(node);
  if (!node.ir->id.empty()) {
    const auto found = by_id_.find(node.ir->id);
    if (found != by_id_.end() && found->second == &node) by_id_.erase(found);
  }
  if (focus_ == &node) focus_ = nullptr;
  if (hovered_ == &node) hovered_ = nullptr;
  if (pressed_ == &node) pressed_ = nullptr;
  if (backdrop_press_ == &node) backdrop_press_ = nullptr;
  if (pending_reveal_ == &node) pending_reveal_ = nullptr;
  if (text_drag_ == &node) text_drag_ = nullptr;
  if (drag_.node == &node) drag_ = ScrollDrag{};
  if (slider_drag_.node == &node) slider_drag_ = SliderGesture{};
  if (slider_keys_.node == &node) slider_keys_ = SliderGesture{};
  for (LayoutNode &child : node.children) discard(child);
}

/**
 * Keeps the focus of a row that is about to be un-realized, as the ITEM it sat on
 * (ZAB-70). Scrolling a focused row out of the window is not the player giving up
 * the focus — it is the renderer recycling a node — so what would otherwise happen
 * is the worst of both: the discard drops the focus, and the next frame's
 * `sync_modal_focus`, seeing none, hands it to the view's `autofocus`, which can be
 * at the other end of the screen. Nobody asked for that, and a wheel, a drag or the
 * right stick all trigger it.
 *
 * So the focus becomes LOGICAL: nothing wears it, `sync_modal_focus` refuses to give
 * it away, and the row takes it back when it is realized again (`restore_focus`).
 */
void View::remember_focus(LayoutNode &repeat, LayoutNode &instance) {
  if (focus_ == nullptr) return;
  std::vector<uint32_t> path;
  for (const LayoutNode *current = focus_; current != &instance; current = current->parent) {
    LayoutNode *parent = current->parent;
    if (parent == nullptr) return;  // the focus is not inside this instance
    path.push_back(static_cast<uint32_t>(parent->children.index_of(*current)));
  }
  std::reverse(path.begin(), path.end());
  for (const auto &[identity, live] : repeat.repeat->instances) {
    if (live.node != &instance) continue;
    pending_focus_ = PendingFocus{&repeat, identity, std::move(path)};
    return;
  }
}

/**
 * Gives the focus back to an item that was realized again. The path is walked
 * against the NEW instance — a subtree whose shape changed (a nested list with
 * another window inside it) simply does not resolve, and the focus is then honestly
 * nowhere rather than on some other node of the row.
 */
void View::restore_focus(LayoutNode &repeat, const std::string &identity, LayoutNode &instance) {
  if (!pending_focus_.has_value()) return;
  if (pending_focus_->repeat != &repeat || pending_focus_->identity != identity) return;
  const std::vector<uint32_t> path = pending_focus_->path;
  // Realized again, whatever comes of the walk: it stops being pending here.
  pending_focus_.reset();
  LayoutNode *target = &instance;
  for (const uint32_t index : path) {
    if (index >= target->children.size()) return;
    target = &target->children[index];
  }
  if (is_focusable(*target)) set_focus(target);
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
  // Fired with the item it belongs to, if any: an action from inside a `Repeat`
  // carries the context that says WHICH one (2026-08-11, ZAB-29).
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
  // A field switched off mid-selection lets the pointer go too. Nothing concludes
  // there either, and for a simpler reason than the Slider's: the buffer never
  // moved, so there was never a value to settle or to throw away.
  if (text_drag_ != nullptr && text_drag_->disabled) text_drag_ = nullptr;
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

bool View::cancel_focused_press() {
  LayoutNode *node = focus_;
  if (node == nullptr || !node->pressed) return false;
  // Dropped, never released: `release` is what activates, and this is the path
  // for a press that ends without concluding (ZAB-70).
  node->pressed = false;
  return true;
}

bool View::scroll_focused_by(double dx, double dy) {
  // A focus waiting on a row the `Repeat` has not realized still names the list
  // it lives in, so the stick keeps scrolling THAT one (ZAB-70). Without it the
  // stick would go dead exactly while the player is scrolling the focused row out
  // of the window — which is the moment they are most obviously using it.
  LayoutNode *node = focus_;
  LayoutNode *scroller = nullptr;
  if (node != nullptr) {
    scroller = in_layout(*node) ? scroller_of(*node) : nullptr;
  } else if (pending_focus_.has_value() && pending_focus_->repeat != nullptr) {
    scroller = scroller_of(*pending_focus_->repeat);
  }
  if (scroller == nullptr) return false;
  return set_scroll_offset(*scroller, scroller->scroll_offset.x + dx,
                           scroller->scroll_offset.y + dy);
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
  // A Slider and a TextInput take the pointer before any button, and for the same
  // reason: the gesture starts on the press — the thumb jumps to the finger, the
  // caret lands where it was clicked — and both live inside scrollable screens
  // where the drag has to move the control and not the list.
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
  LayoutNode *field = find_up(node, [](const LayoutNode &candidate) {
    return !candidate.disabled && candidate.ir->type == NodeType::TextInput &&
           candidate.field != nullptr;
  });
  if (field != nullptr) {
    text_drag_ = field;
    set_focus(field);
    set_field_selection(*field, caret_at(text_index_at(*field, x)));
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
  // A selection drag is NOT that exception: the buffer never moved, so there is
  // nothing it could have concluded either way.
  changed = text_drag_ != nullptr || changed;
  text_drag_ = nullptr;
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
  ActionEvent event;
  event.name = action;
  // The item it fired from, when it fired inside a `Repeat` (ZAB-29) — the
  // innermost one, which is enough for nested lists because its path already
  // embeds every enclosing index.
  const LayoutNode *repeat = repeat_of(node);
  const ItemScope *scope = node.scopes;
  if (repeat != nullptr && scope != nullptr) {
    event.item_path = scope->path;
    event.item_index = scope->index;
    const ItemKey key =
        item_key(data_ != nullptr ? data_->get(scope->path) : nullptr, repeat->ir->key_path);
    // Absent when identity is positional: the game gets a key only if there is one.
    event.has_key = key.present;
    event.key_is_number = key.is_number;
    event.key_number = key.number;
    event.key_text = key.text;
  }
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
