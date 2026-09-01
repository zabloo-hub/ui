// The transition engine, and the curves under it.
//
// A port of `renderer-web/src/transition.test.ts`, and the place where the curve
// arithmetic is actually proved: the `transitions` case of the corpus runs its
// clock to the end of the longest duration, so what it records is where the motion
// SETTLES — it pins the engine down at rest, and these pin it down in flight. If
// the two targets disagreed about the value at t=25ms, only this file would say so.

#include <cmath>
#include <limits>
#include <optional>

#include "easing.h"
#include "layout.h"
#include "testing.h"
#include "transition.h"

using namespace zabloo;

namespace {

const ResolvedTransition LINEAR{100.0, Easing::Linear};

ResolvedValues opacity_of(double value) {
  ResolvedValues out;
  out.opacity = value;
  return out;
}

ResolvedValues radius_of(double value) {
  ResolvedValues out;
  out.radius = value;
  return out;
}

/** One step, with the values written into a scratch the caller does not keep. */
ResolvedValues step(NodeAnim &anim, const ResolvedValues &targets,
                    const ResolvedTransition *transition, double now, bool &animating) {
  ResolvedValues out;
  animating = step_node(&anim, targets, transition, now, out);
  return out;
}

ResolvedValues step(NodeAnim &anim, const ResolvedValues &targets,
                    const ResolvedTransition *transition, double now) {
  bool ignored = false;
  return step(anim, targets, transition, now, ignored);
}

}  // namespace

// --- the curves -----------------------------------------------------------

TEST(easing, the_four_closed_forms_are_the_normative_table) {
  CHECK_NEAR(ease_progress(Easing::Linear, 0.25), 0.25, 1e-12);
  CHECK_NEAR(ease_progress(Easing::EaseIn, 0.25), 0.015625, 1e-12);
  CHECK_NEAR(ease_progress(Easing::EaseOut, 0.25), 0.578125, 1e-12);
  // ease-in-out is two halves: 4t³ below the middle, mirrored above it.
  CHECK_NEAR(ease_progress(Easing::EaseInOut, 0.25), 0.0625, 1e-12);
  CHECK_NEAR(ease_progress(Easing::EaseInOut, 0.75), 0.9375, 1e-12);
  CHECK_NEAR(ease_progress(Easing::EaseInOut, 0.5), 0.5, 1e-12);
}

TEST(easing, every_curve_runs_between_the_same_two_endpoints) {
  for (const Easing easing :
       {Easing::Linear, Easing::EaseIn, Easing::EaseOut, Easing::EaseInOut}) {
    CHECK_EQ(ease_progress(easing, 0.0), 0.0);
    CHECK_EQ(ease_progress(easing, 1.0), 1.0);
    // Outside 0..1 clamps rather than extrapolating, and NaN reads as the start.
    CHECK_EQ(ease_progress(easing, -5.0), 0.0);
    CHECK_EQ(ease_progress(easing, 5.0), 1.0);
    CHECK_EQ(ease_progress(easing, std::nan("")), 0.0);
  }
}

TEST(easing, the_spinners_wave_is_a_seamless_symmetric_ramp) {
  CHECK_EQ(spinner_pulse(0.0), 0.0);
  CHECK_EQ(spinner_pulse(0.5), 1.0);
  // A whole cycle is back at the start, and a negative phase wraps — which is how
  // a bead's own offset arrives.
  CHECK_EQ(spinner_pulse(1.0), 0.0);
  CHECK_NEAR(spinner_pulse(-0.5), 1.0, 1e-12);
  CHECK_NEAR(spinner_pulse(1.25), spinner_pulse(0.25), 1e-12);
  CHECK_EQ(spinner_pulse(std::nan("")), 0.0);
}

TEST(easing, a_broken_progress_binding_shows_an_empty_bar_and_never_a_full_one) {
  CHECK_EQ(clamp_progress(0.35), 0.35);
  CHECK_EQ(clamp_progress(1.5), 1.0);
  CHECK_EQ(clamp_progress(-1.0), 0.0);
  CHECK_EQ(clamp_progress(std::nan("")), 0.0);
  CHECK_EQ(clamp_progress(std::numeric_limits<double>::infinity()), 0.0);
}

// --- colors ---------------------------------------------------------------

TEST(transition, a_color_lerps_every_channel_in_straight_srgb_alpha_included) {
  const Color from{0.0f, 0.0f, 0.0f, 1.0f};
  const Color to{1.0f, 0.5f, 0.25f, 0.0f};
  const Color mid = lerp_color(from, to, 0.5);
  CHECK_NEAR(mid.r, 0.5, 1e-6);
  CHECK_NEAR(mid.g, 0.25, 1e-6);
  CHECK_NEAR(mid.b, 0.125, 1e-6);
  CHECK_NEAR(mid.a, 0.5, 1e-6);
  CHECK(lerp_color(from, to, 0.0) == from);
  CHECK(lerp_color(from, to, 1.0) == to);
}

// --- step_node ------------------------------------------------------------

TEST(transition, a_mount_snaps_because_it_has_no_previous_value_to_leave_from) {
  NodeAnim anim;
  bool animating = false;
  CHECK_EQ(step(anim, opacity_of(0.5), &LINEAR, 0.0, animating).opacity, 0.5);
  CHECK_EQ(animating, false);
}

TEST(transition, a_value_that_does_not_move_reports_nothing_moving) {
  NodeAnim anim;
  bool animating = false;
  step(anim, opacity_of(1.0), &LINEAR, 0.0);
  CHECK_EQ(step(anim, opacity_of(1.0), &LINEAR, 16.0, animating).opacity, 1.0);
  CHECK_EQ(animating, false);
}

TEST(transition, a_change_tweens_over_the_declared_duration_and_settles_on_the_target) {
  NodeAnim anim;
  bool animating = false;
  step(anim, radius_of(0.0), &LINEAR, 0.0);
  // The frame the target moves still paints the OLD value: the tween starts here.
  CHECK_EQ(step(anim, radius_of(10.0), &LINEAR, 0.0, animating).radius, 0.0);
  CHECK_EQ(animating, true);
  CHECK_EQ(step(anim, radius_of(10.0), &LINEAR, 50.0).radius, 5.0);
  CHECK_EQ(step(anim, radius_of(10.0), &LINEAR, 100.0, animating).radius, 10.0);
  CHECK_EQ(animating, false);
}

TEST(transition, a_late_frame_lands_on_the_target_instead_of_overshooting_it) {
  NodeAnim anim;
  step(anim, radius_of(0.0), &LINEAR, 0.0);
  step(anim, radius_of(10.0), &LINEAR, 0.0);
  CHECK_EQ(step(anim, radius_of(10.0), &LINEAR, 5000.0).radius, 10.0);
}

TEST(transition, the_nodes_own_curve_is_what_shapes_the_tween) {
  NodeAnim anim;
  const ResolvedTransition ease_in{100.0, Easing::EaseIn};
  step(anim, radius_of(0.0), &ease_in, 0.0);
  step(anim, radius_of(100.0), &ease_in, 0.0);
  // ease-in is t³ — the normative table's f(0.25), and not the linear 25.
  CHECK_NEAR(step(anim, radius_of(100.0), &ease_in, 25.0).radius, 1.5625, 1e-9);
}

TEST(transition, a_color_tweens_componentwise_like_any_other_value) {
  NodeAnim anim;
  ResolvedValues from;
  from.background = Color{0.0f, 0.0f, 0.0f, 1.0f};
  ResolvedValues to;
  to.background = Color{1.0f, 0.5f, 0.25f, 0.0f};
  step(anim, from, &LINEAR, 0.0);
  step(anim, to, &LINEAR, 0.0);
  const std::optional<Color> mid = step(anim, to, &LINEAR, 50.0).background;
  CHECK(mid.has_value());
  CHECK_NEAR(mid->r, 0.5, 1e-6);
  CHECK_NEAR(mid->a, 0.5, 1e-6);
}

TEST(transition, the_layout_dims_tween_like_any_other_scalar_they_are_declared_inputs) {
  NodeAnim anim;
  ResolvedValues from;
  from.height = 40.0;
  from.padding = 8.0;
  ResolvedValues to;
  to.height = 140.0;
  to.padding = 8.0;
  step(anim, from, &LINEAR, 0.0);
  step(anim, to, &LINEAR, 0.0);
  const ResolvedValues mid = step(anim, to, &LINEAR, 50.0);
  CHECK(mid.height.has_value());
  CHECK_EQ(*mid.height, 90.0);
  CHECK_EQ(mid.padding, 8.0);  // an untouched prop stays put
}

TEST(transition, several_props_move_at_once_and_it_stays_busy_until_the_last_one_lands) {
  NodeAnim anim;
  const ResolvedTransition slow{200.0, Easing::Linear};
  ResolvedValues from;
  from.opacity = 0.0;
  from.background = Color{0.0f, 0.0f, 0.0f, 1.0f};
  ResolvedValues to;
  to.opacity = 1.0;
  to.background = Color{1.0f, 1.0f, 1.0f, 1.0f};
  step(anim, from, &slow, 0.0);
  step(anim, to, &slow, 0.0);
  bool animating = false;
  const ResolvedValues mid = step(anim, to, &slow, 100.0, animating);
  CHECK_EQ(mid.opacity, 0.5);
  CHECK_NEAR(mid.background->g, 0.5, 1e-6);
  CHECK_EQ(animating, true);
}

// --- snapping: the pre-F7 behavior ----------------------------------------

TEST(transition, a_node_that_cannot_animate_snaps_every_value_it_has) {
  // No state at all is how the view steps a node with no usable `transition`, and
  // it has to be the pre-F7 behavior exactly.
  ResolvedValues out;
  CHECK_EQ(step_node(nullptr, opacity_of(0.25), &LINEAR, 0.0, out), false);
  CHECK_EQ(out.opacity, 0.25);
  CHECK_EQ(step_node(nullptr, opacity_of(1.0), &LINEAR, 50.0, out), false);
  CHECK_EQ(out.opacity, 1.0);
}

TEST(transition, no_transition_declared_snaps) {
  NodeAnim anim;
  bool animating = false;
  step(anim, opacity_of(0.0), nullptr, 0.0);
  CHECK_EQ(step(anim, opacity_of(1.0), nullptr, 0.0, animating).opacity, 1.0);
  CHECK_EQ(animating, false);
}

TEST(transition, a_duration_that_is_not_a_positive_finite_number_snaps) {
  for (const double duration : {0.0, -1.0, std::numeric_limits<double>::infinity(),
                                std::nan("")}) {
    NodeAnim anim;
    const ResolvedTransition transition{duration, Easing::Linear};
    step(anim, opacity_of(0.0), &transition, 0.0);
    CHECK_EQ(step(anim, opacity_of(1.0), &transition, 0.0).opacity, 1.0);
  }
}

TEST(transition, an_absent_endpoint_snaps_because_auto_is_no_number_to_tween_to) {
  NodeAnim anim;
  ResolvedValues sized;
  sized.width = 100.0;
  step(anim, sized, &LINEAR, 0.0);
  bool animating = false;
  // Incoming: the declared width goes away and there is nothing to head towards.
  CHECK_EQ(step(anim, ResolvedValues{}, &LINEAR, 0.0, animating).width.has_value(), false);
  CHECK_EQ(animating, false);
  // Outgoing: coming back is a mount, not a resume.
  CHECK_EQ(*step(anim, sized, &LINEAR, 0.0).width, 100.0);
}

TEST(transition, a_tween_in_flight_is_dropped_when_its_target_disappears) {
  NodeAnim anim;
  ResolvedValues zero;
  zero.width = 0.0;
  ResolvedValues hundred;
  hundred.width = 100.0;
  step(anim, zero, &LINEAR, 0.0);
  step(anim, hundred, &LINEAR, 0.0);
  bool animating = false;
  step(anim, ResolvedValues{}, &LINEAR, 50.0, animating);
  CHECK_EQ(animating, false);
  CHECK_EQ(*step(anim, hundred, &LINEAR, 50.0).width, 100.0);
}

TEST(transition, clearing_the_state_snaps_the_next_step_like_a_mount) {
  NodeAnim anim;
  bool animating = false;
  step(anim, opacity_of(0.0), &LINEAR, 0.0);
  clear_node_anim(anim);
  CHECK_EQ(step(anim, opacity_of(1.0), &LINEAR, 0.0, animating).opacity, 1.0);
  CHECK_EQ(animating, false);
}

// --- interruption ---------------------------------------------------------

TEST(transition, an_interruption_leaves_from_the_value_on_screen_over_a_full_duration) {
  NodeAnim anim;
  step(anim, radius_of(0.0), &LINEAR, 0.0);
  step(anim, radius_of(10.0), &LINEAR, 0.0);
  CHECK_EQ(step(anim, radius_of(10.0), &LINEAR, 50.0).radius, 5.0);

  // Halfway there the state flips back: it leaves from 5, not from 10 or 0…
  CHECK_EQ(step(anim, radius_of(0.0), &LINEAR, 50.0).radius, 5.0);
  // …and takes the WHOLE duration to get home, not the 50ms that were left. The
  // CSS model: the other reading gives unnaturally fast exits in the common case.
  CHECK_EQ(step(anim, radius_of(0.0), &LINEAR, 100.0).radius, 2.5);
  bool animating = false;
  CHECK_EQ(step(anim, radius_of(0.0), &LINEAR, 150.0, animating).radius, 0.0);
  CHECK_EQ(animating, false);
}

TEST(transition, a_third_target_mid_flight_never_makes_the_value_jump) {
  NodeAnim anim;
  step(anim, opacity_of(0.0), &LINEAR, 0.0);
  step(anim, opacity_of(1.0), &LINEAR, 0.0);
  CHECK_NEAR(step(anim, opacity_of(1.0), &LINEAR, 20.0).opacity, 0.2, 1e-12);
  CHECK_NEAR(step(anim, opacity_of(0.5), &LINEAR, 20.0).opacity, 0.2, 1e-12);
  CHECK_NEAR(step(anim, opacity_of(0.5), &LINEAR, 70.0).opacity, 0.35, 1e-12);
}

TEST(transition, removing_the_transition_mid_flight_snaps) {
  NodeAnim anim;
  step(anim, radius_of(0.0), &LINEAR, 0.0);
  step(anim, radius_of(10.0), &LINEAR, 0.0);
  bool animating = false;
  CHECK_EQ(step(anim, radius_of(20.0), nullptr, 50.0, animating).radius, 20.0);
  CHECK_EQ(animating, false);
}

// --- loops ----------------------------------------------------------------

TEST(transition, a_loop_phase_starts_at_zero_and_wraps_on_its_own_period) {
  CHECK_EQ(loop_phase(0.0, 0.0, 1000.0), 0.0);
  CHECK_EQ(loop_phase(0.0, 500.0, 1000.0), 0.5);
  CHECK_EQ(loop_phase(0.0, 1000.0, 1000.0), 0.0);
  CHECK_EQ(loop_phase(0.0, 2500.0, 1000.0), 0.5);
  // Counted from its OWN start, not from the clock's origin.
  CHECK_NEAR(loop_phase(400.0, 700.0, 1000.0), 0.3, 1e-12);
  CHECK_EQ(loop_phase(100.0, 50.0, 1000.0), 0.0);  // before it starts
}

TEST(transition, a_period_that_is_not_a_positive_finite_number_freezes_the_loop) {
  // Which is how a "reduce motion" theme stops a Spinner: the wave holds at its
  // first frame instead of the spinner disappearing.
  for (const double period : {0.0, -1.0, std::numeric_limits<double>::infinity(),
                              std::nan("")}) {
    CHECK_EQ(loop_phase(0.0, 500.0, period), 0.0);
  }
}

// --- step_value: the behavior-driven scalars ------------------------------

TEST(transition, a_behavior_scalar_snaps_on_its_first_step_like_any_other_mount) {
  NodeAnim anim;
  const SteppedValue first = step_value(&anim, TrackKey::Progress, 0.4, &LINEAR, 0.0);
  CHECK_EQ(first.value, 0.4);
  CHECK_EQ(first.animating, false);
}

TEST(transition, a_behavior_scalar_tweens_with_the_nodes_own_transition) {
  NodeAnim anim;
  step_value(&anim, TrackKey::Progress, 0.0, &LINEAR, 0.0);
  const SteppedValue started = step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 0.0);
  CHECK_EQ(started.value, 0.0);
  CHECK_EQ(started.animating, true);
  CHECK_NEAR(step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 50.0).value, 0.5, 1e-12);
  const SteppedValue landed = step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 100.0);
  CHECK_EQ(landed.value, 1.0);
  CHECK_EQ(landed.animating, false);
}

TEST(transition, a_behavior_scalar_is_instant_without_a_usable_transition) {
  NodeAnim anim;
  step_value(&anim, TrackKey::Progress, 0.0, nullptr, 0.0);
  const SteppedValue stepped = step_value(&anim, TrackKey::Progress, 1.0, nullptr, 0.0);
  CHECK_EQ(stepped.value, 1.0);
  CHECK_EQ(stepped.animating, false);
}

TEST(transition, a_behavior_scalar_retargets_from_the_value_on_screen_too) {
  NodeAnim anim;
  step_value(&anim, TrackKey::Progress, 0.0, &LINEAR, 0.0);
  step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 0.0);
  // Damage lands halfway through the heal: the bar leaves from the 0.5 on screen
  // and takes a full duration to reach 0.25, instead of snapping or rushing.
  CHECK_NEAR(step_value(&anim, TrackKey::Progress, 0.25, &LINEAR, 50.0).value, 0.5, 1e-12);
  CHECK_NEAR(step_value(&anim, TrackKey::Progress, 0.25, &LINEAR, 100.0).value, 0.375, 1e-12);
  CHECK_NEAR(step_value(&anim, TrackKey::Progress, 0.25, &LINEAR, 150.0).value, 0.25, 1e-12);
}

TEST(transition, a_behavior_key_shares_the_nodes_tracks_without_colliding_with_a_prop) {
  NodeAnim anim;
  step(anim, opacity_of(1.0), &LINEAR, 0.0);
  step_value(&anim, TrackKey::Progress, 0.0, &LINEAR, 0.0);
  step(anim, opacity_of(0.0), &LINEAR, 0.0);
  step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 0.0);
  CHECK_NEAR(step(anim, opacity_of(0.0), &LINEAR, 50.0).opacity, 0.5, 1e-12);
  CHECK_NEAR(step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 50.0).value, 0.5, 1e-12);
}

TEST(transition, a_behavior_key_is_forgotten_with_the_rest_of_the_nodes_state) {
  NodeAnim anim;
  step_value(&anim, TrackKey::Progress, 0.0, &LINEAR, 0.0);
  clear_node_anim(anim);
  const SteppedValue stepped = step_value(&anim, TrackKey::Progress, 1.0, &LINEAR, 0.0);
  CHECK_EQ(stepped.value, 1.0);
  CHECK_EQ(stepped.animating, false);
}
