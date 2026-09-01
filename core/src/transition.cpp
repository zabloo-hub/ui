#include <cmath>
#include <cstddef>
#include <optional>

#include "easing.h"
#include "layout.h"
#include "transition.h"

namespace zabloo {

namespace {

size_t index_of(TrackKey key) { return static_cast<size_t>(key); }

Track *live_track(NodeAnim *anim, TrackKey key) {
  const size_t i = index_of(key);
  return anim != nullptr && anim->in_flight[i] ? &anim->tracks[i] : nullptr;
}

const AnimValue *current_of(const NodeAnim *anim, TrackKey key) {
  const size_t i = index_of(key);
  return anim != nullptr && anim->has_current[i] ? &anim->current[i] : nullptr;
}

void forget_track(NodeAnim *anim, TrackKey key) {
  if (anim != nullptr) anim->in_flight[index_of(key)] = false;
}

void set_current(NodeAnim *anim, TrackKey key, const AnimValue &value) {
  if (anim == nullptr) return;
  const size_t i = index_of(key);
  anim->current[i] = value;
  anim->has_current[i] = true;
}

AnimValue lerp(const AnimValue &from, const AnimValue &to, double t) {
  // A key carries the same kind for the life of a document, so the mismatch below
  // is unreachable — but "interpolating" a number towards a color has exactly one
  // honest answer, and it is the target.
  if (from.kind != to.kind) return to;
  if (from.kind == AnimValue::Kind::Number) {
    return AnimValue::of_number(from.number + (to.number - from.number) * t);
  }
  return AnimValue::of_color(lerp_color(from.color, to.color, t));
}

/**
 * Points a key at a new target from where it currently is. Without a usable
 * transition the change is instant — the exact pre-F7 behavior, and the path a
 * node with no `transition` at all takes for every one of its values.
 */
AnimValue retarget(NodeAnim *anim, TrackKey key, const AnimValue &current, const AnimValue &target,
                   const ResolvedTransition *transition, double now) {
  if (anim == nullptr || transition == nullptr || !transition->usable()) {
    forget_track(anim, key);
    return target;
  }
  const size_t i = index_of(key);
  anim->tracks[i] = Track{current, target, now, transition->duration, transition->easing};
  anim->in_flight[i] = true;
  return current;
}

/**
 * Advances one key by one frame. A null `target` means the value is not declared
 * this frame (an `auto` size, an undeclared color): the key snaps and is forgotten,
 * so the day it comes back is a mount rather than a resume.
 *
 * Returns whether there is a value to render; `out` carries it.
 */
bool step_track(NodeAnim *anim, TrackKey key, const AnimValue *target,
                const ResolvedTransition *transition, double now, AnimValue &out) {
  if (anim == nullptr) {
    if (target == nullptr) return false;
    out = *target;
    return true;
  }

  // Sample the tween in flight FIRST, so `current` is the value on screen right
  // now — that is the point a retarget below has to leave from.
  if (const Track *track = live_track(anim, key); track != nullptr) {
    const double progress = (now - track->started_at) / track->duration;
    const AnimValue at = lerp(track->from, track->to, ease_progress(track->easing, progress));
    set_current(anim, key, at);
    if (progress >= 1.0) forget_track(anim, key);
  }

  if (target == nullptr) {
    forget_track(anim, key);
    anim->has_current[index_of(key)] = false;
    return false;
  }

  const Track *flight = live_track(anim, key);
  const AnimValue *current = current_of(anim, key);
  AnimValue value;
  if (current == nullptr) {
    value = *target;  // mount, or a node coming back into layout
  } else if (flight != nullptr) {
    // Already heading there, or retargeted from the value on screen.
    value =
        flight->to == *target ? *current : retarget(anim, key, *current, *target, transition, now);
  } else {
    value = *current == *target ? *current  // settled
                                : retarget(anim, key, *current, *target, transition, now);
  }

  set_current(anim, key, value);
  out = value;
  return true;
}

/** Whether the key is STILL in flight after its step — the "animating" signal. */
bool in_flight(NodeAnim *anim, TrackKey key) { return live_track(anim, key) != nullptr; }

/** One always-declared scalar: the paint values and the two layout spacings. */
double step_scalar(NodeAnim *anim, TrackKey key, double target,
                   const ResolvedTransition *transition, double now, bool &animating) {
  const AnimValue in = AnimValue::of_number(target);
  AnimValue out;
  step_track(anim, key, &in, transition, now, out);
  if (in_flight(anim, key)) animating = true;
  return out.number;
}

/** An `auto` size: absent is a value the layout pass acts on, not a missing one. */
std::optional<double> step_dim(NodeAnim *anim, TrackKey key, const std::optional<double> &target,
                               const ResolvedTransition *transition, double now, bool &animating) {
  const AnimValue in = AnimValue::of_number(target.value_or(0.0));
  AnimValue out;
  const bool has = step_track(anim, key, target.has_value() ? &in : nullptr, transition, now, out);
  if (in_flight(anim, key)) animating = true;
  return has ? std::optional<double>(out.number) : std::nullopt;
}

/** An undeclared color: nothing is painted, which is not the same as painting black. */
std::optional<Color> step_color(NodeAnim *anim, TrackKey key, const std::optional<Color> &target,
                                const ResolvedTransition *transition, double now, bool &animating) {
  const AnimValue in = AnimValue::of_color(target.value_or(Color{}));
  AnimValue out;
  const bool has = step_track(anim, key, target.has_value() ? &in : nullptr, transition, now, out);
  if (in_flight(anim, key)) animating = true;
  return has ? std::optional<Color>(out.color) : std::nullopt;
}

}  // namespace

bool ResolvedTransition::usable() const { return duration > 0.0 && std::isfinite(duration); }

void clear_node_anim(NodeAnim &anim) {
  anim.in_flight.fill(false);
  anim.has_current.fill(false);
}

bool step_node(NodeAnim *anim, const ResolvedValues &targets, const ResolvedTransition *transition,
               double now, ResolvedValues &out) {
  bool animating = false;
  // Stepped into locals and assigned at the end, because `out` may BE the node's
  // own `resolved` — the reuse that keeps a steady-state frame allocation-free —
  // while `targets` is the scratch the caller filled from it moments ago.
  const std::optional<Color> background =
      step_color(anim, TrackKey::Background, targets.background, transition, now, animating);
  const std::optional<Color> border_color =
      step_color(anim, TrackKey::BorderColor, targets.border_color, transition, now, animating);
  const std::optional<Color> color =
      step_color(anim, TrackKey::Color, targets.color, transition, now, animating);
  const double opacity =
      step_scalar(anim, TrackKey::Opacity, targets.opacity, transition, now, animating);
  const double radius =
      step_scalar(anim, TrackKey::Radius, targets.radius, transition, now, animating);
  const double border_width =
      step_scalar(anim, TrackKey::BorderWidth, targets.border_width, transition, now, animating);
  const std::optional<double> width =
      step_dim(anim, TrackKey::Width, targets.width, transition, now, animating);
  const std::optional<double> height =
      step_dim(anim, TrackKey::Height, targets.height, transition, now, animating);
  const double gap = step_scalar(anim, TrackKey::Gap, targets.gap, transition, now, animating);
  const double padding =
      step_scalar(anim, TrackKey::Padding, targets.padding, transition, now, animating);

  out.background = background;
  out.border_color = border_color;
  out.color = color;
  out.opacity = opacity;
  out.radius = radius;
  out.border_width = border_width;
  out.width = width;
  out.height = height;
  out.gap = gap;
  out.padding = padding;
  return animating;
}

SteppedValue step_value(NodeAnim *anim, TrackKey key, double target,
                        const ResolvedTransition *transition, double now) {
  SteppedValue out;
  out.value = step_scalar(anim, key, target, transition, now, out.animating);
  return out;
}

double loop_phase(double started_at, double now, double period) {
  if (!(period > 0.0) || !std::isfinite(period)) return 0.0;
  const double elapsed = now - started_at;
  if (!(elapsed > 0.0)) return 0.0;  // also catches NaN
  return std::fmod(elapsed, period) / period;
}

Color lerp_color(const Color &from, const Color &to, double t) {
  // Widened to double for the arithmetic and narrowed back on store: the reference
  // has one numeric type, so mixing in `float` would round differently and drift a
  // channel away from the number the corpus recorded.
  const auto mix = [t](float a, float b) {
    const double lo = static_cast<double>(a);
    return static_cast<float>(lo + (static_cast<double>(b) - lo) * t);
  };
  return Color{mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b), mix(from.a, to.a)};
}

}  // namespace zabloo
