// The transition engine — the core's half of F7's interpolation pass.
//
// A port of `renderer-web/src/transition.ts`, pure and clock-injected: the view
// hands it a node's freshly resolved target values plus `now`, and gets back the
// values to render this frame.
//
// It interpolates DECLARED INPUTS, never computed rects: the view writes the
// result onto the node and then runs its normal measure/arrange pass with those
// numbers, so there is one layout pass per frame and the layout never feeds back
// into its own input (decision 2026-08-11, ZAB-33 §4). The curves come from
// `easing.h`, the normative closed forms — that shared arithmetic is what keeps
// every target on the same number every frame.
//
// One departure from the reference's SHAPE, none from its behavior: where the
// browser keeps two `Map`s per node, this keeps two fixed arrays indexed by
// `TrackKey`. The key set is closed and tiny, so an array is both smaller and
// free of per-frame hashing — which is what keeps ZAB-55's "a steady-state frame
// allocates nothing" true here too. The whole block is allocated lazily, and only
// for a node that can actually tween: see `NodeAnim`.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "color.h"
#include "envelope.h"

namespace zabloo {

/**
 * Everything a node can tween, in one closed set.
 *
 * The first ten are the ANIMATABLE PROPS — the normative list, and nothing else
 * animates. `fontSize` is out because it is the glyph atlas's key (animating it
 * would rasterize a new size per frame), `grow` because it is a share of a
 * remainder rather than a magnitude, and every enum and structural prop because
 * there is nothing between their two values.
 *
 * The rest are BEHAVIOR KEYS: scalars a component's behavior tweens with
 * endpoints it computes itself (decision 2026-08-11 §5). They ride the same
 * tracks as the declared props — one interruption rule, one clock, one set of
 * curves — under keys the animatable set cannot collide with.
 */
enum class TrackKey : uint8_t {
  // Colors, lerped componentwise in straight sRGB with straight alpha.
  Background,
  BorderColor,
  Color,
  // Paint scalars and the layout dims, all lerped after token resolution.
  Opacity,
  Radius,
  BorderWidth,
  Width,
  Height,
  Gap,
  Padding,

  /** The ProgressBar's fraction — which is why the bar tweens its VALUE, never its fill rect. */
  Progress,
  /** How far an `Overlay` has entered the layer, which fades a modal in and out (G9). */
  Presence,
  /** The Slider's value, for changes that are NOT the gesture in the player's hand (G10). */
  Value,
  /** The Collapse's own height, between its header's box and the height measured with content. */
  Collapse,
  /** The Toggle's 0..1 crossfade between its two indicator slots. */
  Checked,

  Count,
};

inline constexpr size_t TRACK_COUNT = static_cast<size_t>(TrackKey::Count);
/** Where the behavior keys begin: everything before it is an animatable prop. */
inline constexpr size_t ANIMATABLE_COUNT = static_cast<size_t>(TrackKey::Progress);

/** A tweened value: a number, or a color. Which one a key carries never changes. */
struct AnimValue {
  enum class Kind : uint8_t { Number, Color };

  Kind kind = Kind::Number;
  double number = 0.0;
  zabloo::Color color;

  static AnimValue of_number(double value) {
    AnimValue out;
    out.kind = Kind::Number;
    out.number = value;
    return out;
  }
  static AnimValue of_color(zabloo::Color value) {
    AnimValue out;
    out.kind = Kind::Color;
    out.color = value;
    return out;
  }

  bool operator==(const AnimValue &other) const {
    if (kind != other.kind) return false;
    return kind == Kind::Number ? number == other.number : color == other.color;
  }
};

/** A tween in flight for one key. */
struct Track {
  AnimValue from;
  AnimValue to;
  double started_at = 0.0;
  double duration = 0.0;
  Easing easing = Easing::EaseOut;
};

/**
 * A node's `transition` with its `Dim` duration already resolved to milliseconds.
 * Read from the base node only: no cascade, and no per-state transition (both are
 * compatible future extensions, not v1 surface).
 */
struct ResolvedTransition {
  double duration = 0.0;
  Easing easing = Easing::EaseOut;

  /** A duration that is not a positive finite number is no transition: it snaps. */
  bool usable() const;
};

/**
 * Per-node animation state.
 *
 * Held by the LAYOUT node, so rebuilding the tree — an envelope reload — drops it
 * and everything snaps, which is exactly the rule: transitions live INSIDE the
 * life of one loaded document.
 *
 * Every entry point takes it as a NULLABLE pointer, and null means "this node
 * cannot tween": every key snaps, which is the pre-F7 behavior to the letter. The
 * view only allocates one for a node that declares a usable `transition` or that
 * a behavior is already tweening, so the common node — most of a UI — carries a
 * pointer and nothing else.
 */
struct NodeAnim {
  std::array<Track, TRACK_COUNT> tracks{};
  std::array<bool, TRACK_COUNT> in_flight{};
  std::array<AnimValue, TRACK_COUNT> current{};
  std::array<bool, TRACK_COUNT> has_current{};
};

/** This frame's animatable values, as `step_node` reads and writes them. */
struct ResolvedValues;

/** Forgets everything: the next step snaps, like a mount. */
void clear_node_anim(NodeAnim &anim);

/**
 * Advances one node's animatable props by one frame, writing the values to render
 * into `out` and answering whether anything is still moving.
 *
 * A tween starts whenever a resolved value CHANGES, whatever caused the change —
 * there is no trigger list. It snaps when either endpoint is absent (an `auto`
 * size, an undeclared color: no honest endpoint), on the first step (a mount has
 * no previous value), and when the node declares no usable `transition`. An
 * interruption retargets from the value ON SCREEN over a FULL duration (the CSS
 * model), so releasing a button mid-press leaves from the color actually visible
 * instead of snapping back or exiting unnaturally fast.
 *
 * `out` may be the node's own `resolved`: every animatable prop is written each
 * step, absent ones included, so no stale value survives the reuse.
 */
bool step_node(NodeAnim *anim, const ResolvedValues &targets,
               const ResolvedTransition *transition, double now, ResolvedValues &out);

/** What one behavior-driven scalar shows this frame, and whether it is still moving. */
struct SteppedValue {
  double value = 0.0;
  bool animating = false;
};

/**
 * The same step for a scalar a component's behavior owns (the ProgressBar's
 * fraction, the Collapse's height). It takes the endpoint already computed, so the
 * behavior decides WHAT moves while this file keeps deciding HOW — one
 * interruption rule and one curve set for declared props and behavior-driven ones
 * alike, rather than a second engine running beside this one.
 */
SteppedValue step_value(NodeAnim *anim, TrackKey key, double target,
                        const ResolvedTransition *transition, double now);

/**
 * Repeating 0..1 phase for behavior-driven loops (the Spinner's wave). The other
 * half of the machinery is the view's frame loop, which keeps asking for frames
 * while anything is animating; a behavior samples this to drive its own endpoints.
 *
 * A period that is not a positive finite number holds at 0 — which is how a
 * "reduce motion" theme freezes the wave at its first frame instead of making the
 * spinner disappear.
 */
double loop_phase(double started_at, double now, double period);

/** Componentwise lerp in STRAIGHT sRGB with STRAIGHT alpha — no premultiply, no gamma. */
Color lerp_color(const Color &from, const Color &to, double t);

}  // namespace zabloo
