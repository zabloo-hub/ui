// Pure gamepad semantics (2026-08-12, ZAB-47), a port of
// `renderer-web/src/gamepad.ts`: the standard mapping, the dead zone and the
// hold-to-repeat clock.
//
// The gamepad is ONE MORE SOURCE of input, not a second input model: everything
// here resolves to the intentions the keyboard already produces (a unit
// direction, a press, a dismiss, a scroll), and `pad.h` feeds them into the very
// same handlers. That is what keeps "navigate with the d-pad" and "navigate with
// the arrows" from drifting apart.
//
// No device and no engine: it reads a plain snapshot of buttons and axes, which
// is what lets the golden corpus replay a `pad` script against the core on a bare
// CPU (G3) — and what makes the numbers below the normative ones every target
// shares (`docs/format/input.md`).

#pragma once

#include <cstddef>
#include <optional>
#include <vector>

namespace zabloo {

/**
 * Indices of the standard mapping (https://w3c.github.io/gamepad/#remapping),
 * which is the vocabulary a corpus `pad` script is written in.
 *
 * They are NOT an engine's numbering: Godot's `JoyButton` puts the d-pad at
 * 11–14, so the adapter translates on its way in. Doing it there is the point —
 * one vocabulary reaches the core, whatever device produced it.
 */
inline constexpr size_t PAD_BUTTON_A = 0;
inline constexpr size_t PAD_BUTTON_B = 1;
inline constexpr size_t PAD_DPAD_UP = 12;
inline constexpr size_t PAD_DPAD_DOWN = 13;
inline constexpr size_t PAD_DPAD_LEFT = 14;
inline constexpr size_t PAD_DPAD_RIGHT = 15;
inline constexpr size_t PAD_AXIS_LEFT_X = 0;
inline constexpr size_t PAD_AXIS_LEFT_Y = 1;
inline constexpr size_t PAD_AXIS_RIGHT_X = 2;
inline constexpr size_t PAD_AXIS_RIGHT_Y = 3;

/**
 * How far the left stick travels before it counts as a direction, and how far
 * back it must come before that direction is released. The gap is hysteresis: a
 * stick resting near the threshold would otherwise fire, release and fire again
 * with no movement at all, which reads as a stuck list.
 */
inline constexpr double PAD_NAV_DEADZONE = 0.5;
inline constexpr double PAD_NAV_RELEASE = 0.35;

/** The right stick's own dead zone — lower, because a scroll has no discrete step to miss. */
inline constexpr double PAD_SCROLL_DEADZONE = 0.15;

/** Hold-to-repeat: the pause before a held direction starts repeating, then its period. */
inline constexpr double PAD_REPEAT_DELAY_MS = 400.0;
inline constexpr double PAD_REPEAT_RATE_MS = 90.0;

/** Scroll speed at full deflection, in px per second. */
inline constexpr double PAD_SCROLL_SPEED = 1100.0;

/**
 * The slice of a pad this reads.
 *
 * Short vectors are tolerated on purpose, as the reference's optional indexing
 * is: a device that reports fewer buttons or axes than the standard mapping has
 * simply not pressed the ones it lacks. The adapter keeps ONE of these alive
 * across frames, so polling allocates nothing in steady state.
 */
struct PadSnapshot {
  std::vector<bool> buttons;
  std::vector<double> axes;

  /** A button the pad may not have at all — a missing index is not pressed. */
  bool pressed(size_t index) const { return index < buttons.size() && buttons[index]; }
  /** An axis the pad may not have — and never a NaN reaching the math. */
  double axis(size_t index) const;
};

/** A unit direction on one axis — exactly what `move_focus` takes. */
struct PadDirection {
  double dx = 0.0;
  double dy = 0.0;
};

bool operator==(const PadDirection &a, const PadDirection &b);

/** The right stick, dead zone removed and rescaled to -1..1 per axis. */
struct PadScroll {
  double x = 0.0;
  double y = 0.0;
};

/** What the pad is asking for this frame, in the view's own vocabulary. */
struct PadIntent {
  /** The direction the d-pad or the left stick is pointing at, if any. */
  std::optional<PadDirection> direction;
  /** A — press/activate the focused node. */
  bool press = false;
  /** B — back: dismiss the overlay that owns input. */
  bool back = false;
  PadScroll scroll;
};

/**
 * Reads one frame of a pad. `held` is the direction the previous frame resolved,
 * which is what the release threshold applies to — pass nothing and the stick
 * has to travel the full dead zone to register.
 *
 * The d-pad wins over the stick: a pressed button is an unambiguous direction,
 * and a stick left resting off-center should not fight it. A diagonal collapses
 * to its horizontal component — spatial navigation moves on ONE axis, and a
 * stable tie-break beats alternating between two on the same input.
 */
PadIntent read_pad(const PadSnapshot &pad,
                   const std::optional<PadDirection> &held = std::nullopt);

/** How far a scroll stick moves the content over `dt_ms` — px on each axis. */
PadScroll scroll_delta(const PadScroll &scroll, double dt_ms);

/** A direction being held, and the clock its repeats are measured against. */
struct PadRepeat {
  PadDirection direction;
  /** The instant it was first pressed — every repeat is due relative to this. */
  double since = 0.0;
  /** How many times it has fired, the initial one included. */
  int fired = 0;
};

struct PadRepeatStep {
  /** The hold to carry into the next frame, or nothing once the direction is released. */
  std::optional<PadRepeat> state;
  /** Whether this frame owes the view one move. */
  bool fire = false;
};

/**
 * The hold-to-repeat clock: fires the instant a direction is pressed, pauses for
 * `PAD_REPEAT_DELAY_MS`, then repeats every `PAD_REPEAT_RATE_MS` — the
 * keyboard's own behavior, which an OS gives the arrows for free and a pad has
 * to be told.
 *
 * Changing direction restarts the whole cycle: it is a new intention, not the
 * continuation of the previous one.
 *
 * At most one move per frame, even after a stall (a window in the background, a
 * long relayout): the pad is a source of intentions, not of a backlog to catch
 * up on.
 */
PadRepeatStep step_repeat(const std::optional<PadRepeat> &previous,
                          const std::optional<PadDirection> &direction, double now);

}  // namespace zabloo
