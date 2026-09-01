// The Spinner's wave — a port of `renderer-web/src/spinner.test.ts`.
//
// It does not spin: v1 has no transform, so what the beads do is pulse. These pin
// down the shape of that pulse, which the `controls` case of the corpus records at
// phase 0 and nowhere else — the crest travelling is only visible from here.

#include <cmath>

#include "spinner.h"
#include "testing.h"
#include "transition.h"

using namespace zabloo;

TEST(spinner, the_crest_travels_so_each_bead_peaks_at_its_own_phase) {
  // Bead i peaks when the cycle phase is i/n + 0.5.
  for (size_t i = 0; i < 3; i++) {
    CHECK_NEAR(bead_opacity(i, 3, static_cast<double>(i) / 3.0 + 0.5), 1.0, 1e-12);
  }
}

TEST(spinner, a_bead_sits_at_the_floor_when_its_own_phase_is_at_the_trough) {
  CHECK_EQ(bead_opacity(0, 3, 0.0), SPINNER_DEFAULT_MIN);
  CHECK_NEAR(bead_opacity(1, 3, 1.0 / 3.0), SPINNER_DEFAULT_MIN, 1e-12);
}

TEST(spinner, the_wave_never_leaves_the_floor_to_one_band) {
  for (size_t step = 0; step <= 40; step++) {
    const double value = bead_opacity(1, 3, static_cast<double>(step) / 40.0);
    CHECK(value >= SPINNER_DEFAULT_MIN - 1e-12);
    CHECK(value <= 1.0);
  }
}

TEST(spinner, the_floor_comes_from_min_clamped) {
  CHECK_EQ(bead_opacity(0, 3, 0.0, 0.0), 0.0);
  CHECK_NEAR(bead_opacity(0, 3, 0.0, 0.8), 0.8, 1e-12);
  // A bead is never brighter than its own opacity: a min above 1 flattens the wave
  // to a steady 1 rather than overdriving it.
  CHECK_EQ(bead_opacity(0, 3, 0.0, 5.0), 1.0);
  CHECK_EQ(bead_opacity(0, 3, 0.0, std::nan("")), 0.0);
}

TEST(spinner, the_ramp_takes_its_shape_from_easing) {
  // Halfway up the ramp, linear sits at 0.5 of the band and ease-in well below it.
  const double linear = bead_opacity(0, 1, 0.25, 0.0, Easing::Linear);
  const double ease_in = bead_opacity(0, 1, 0.25, 0.0, Easing::EaseIn);
  CHECK_NEAR(linear, 0.5, 1e-12);
  CHECK(ease_in < linear);
}

TEST(spinner, a_lone_bead_with_no_cycle_holds_steady_at_full_brightness) {
  CHECK_EQ(bead_opacity(0, 0, 0.5), 1.0);
}

TEST(spinner, the_wave_is_seamless_across_the_cycle_boundary) {
  const double before = bead_opacity(1, 3, 0.999);
  const double after = bead_opacity(1, 3, 1.001);
  CHECK_NEAR(after, before, 0.01);
}

TEST(spinner, a_real_phase_comes_straight_off_the_loop) {
  // A 900 ms cycle, 450 ms in: bead 0 is at its crest.
  CHECK_NEAR(bead_opacity(0, 3, loop_phase(0.0, 450.0, 900.0)), 1.0, 1e-12);
  // A frozen period — a "reduce motion" theme — leaves the wave at its first frame.
  CHECK_EQ(loop_phase(0.0, 450.0, 0.0), 0.0);
}
