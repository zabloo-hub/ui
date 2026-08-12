/**
 * Pure gamepad semantics (ZAB-47) — the standard mapping, the dead zone and the
 * hold-to-repeat clock. No DOM and no `Gamepad` type: it reads a plain snapshot
 * of buttons and axes, so it is unit testable without a browser, and so the Unity
 * SDK (ZAB-27) has an unambiguous reference for the same rules — the role
 * `slider.ts` and `toggle.ts` already play for their controls.
 *
 * The gamepad is ONE MORE SOURCE of input, not a second input model: everything
 * here resolves to the intentions the keyboard already produces (a unit direction,
 * a press, a dismiss, a scroll), and `view.ts` feeds them into the same handlers.
 * That is what keeps "navigate with the d-pad" and "navigate with the arrows" from
 * drifting apart.
 */

/**
 * The slice of a `Gamepad` this reads. Structural on purpose: a test builds one
 * as an object literal, and a real `Gamepad` satisfies it as it comes.
 */
export interface PadSnapshot {
  buttons: readonly { readonly pressed: boolean }[];
  axes: readonly number[];
}

/** A unit direction on one axis — exactly what `moveFocus` takes. */
export type Direction = readonly [number, number];

/** Standard-mapping indices (https://w3c.github.io/gamepad/#remapping). */
const BUTTON_A = 0;
const BUTTON_B = 1;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const LEFT_STICK: Direction = [0, 1];
const RIGHT_STICK: Direction = [2, 3];

/**
 * How far the left stick travels before it counts as a direction, and how far
 * back it must come before that direction is released. The gap is hysteresis: a
 * stick resting near the threshold would otherwise fire, release and fire again
 * with no movement at all, which reads as a stuck list.
 */
const NAV_DEADZONE = 0.5;
const NAV_RELEASE = 0.35;

/** The right stick's own dead zone — lower, because a scroll has no discrete step to miss. */
const SCROLL_DEADZONE = 0.15;

/** Hold-to-repeat: the pause before a held direction starts repeating, then its period. */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_RATE_MS = 90;

/** Scroll speed at full deflection, in px per second. */
export const SCROLL_SPEED = 1100;

/** What the pad is asking for this frame, in the view's own vocabulary. */
export interface PadIntent {
  /** The direction the d-pad or the left stick is pointing at, if any. */
  direction: Direction | null;
  /** A — press/activate the focused node. */
  press: boolean;
  /** B — back: dismiss the overlay that owns input. */
  back: boolean;
  /** Right stick, dead zone removed and rescaled to -1..1 per axis. */
  scroll: { x: number; y: number };
}

/**
 * The first connected pad. Several pads on one preview is not a scenario worth
 * modelling — the page has one player — so the first one that reports in drives
 * the view, and unplugging it hands the view to whichever is left.
 */
export function activePad<T extends PadSnapshot>(pads: readonly (T | null)[]): T | null {
  for (const pad of pads) {
    if (pad) return pad;
  }
  return null;
}

/**
 * Reads one frame of a pad. `held` is the direction the previous frame resolved,
 * which is what the release threshold applies to — pass `null` and the stick has
 * to travel the full dead zone to register.
 *
 * The d-pad wins over the stick: a pressed button is an unambiguous direction,
 * and a stick left resting off-center should not fight it. A diagonal collapses
 * to its horizontal component — spatial navigation moves on ONE axis, and a
 * stable tie-break beats alternating between two on the same input.
 */
export function readPad(pad: PadSnapshot, held: Direction | null = null): PadIntent {
  return {
    direction: dpadDirection(pad) ?? stickDirection(pad, held),
    press: pressed(pad, BUTTON_A),
    back: pressed(pad, BUTTON_B),
    scroll: {
      x: taper(axis(pad, RIGHT_STICK[0])),
      y: taper(axis(pad, RIGHT_STICK[1])),
    },
  };
}

/** How far a scroll stick moves the content over `dtMs` — px on each axis. */
export function scrollDelta(
  scroll: { x: number; y: number },
  dtMs: number,
): { x: number; y: number } {
  const seconds = Math.max(0, dtMs) / 1000;
  return {
    // Squared response: the same stick gives fine control near the center and
    // full speed at the rim, which is how a game scrolls a long list.
    x: scroll.x * Math.abs(scroll.x) * SCROLL_SPEED * seconds,
    y: scroll.y * Math.abs(scroll.y) * SCROLL_SPEED * seconds,
  };
}

/** A direction being held, and the clock its repeats are measured against. */
export interface RepeatState {
  direction: Direction;
  /** The instant it was first pressed — every repeat is due relative to this. */
  since: number;
  /** How many times it has fired, the initial one included. */
  fired: number;
}

export interface RepeatStep {
  /** The hold to carry into the next frame, or null once the direction is released. */
  state: RepeatState | null;
  /** Whether this frame owes the view one move. */
  fire: boolean;
}

/**
 * The hold-to-repeat clock: fires the instant a direction is pressed, pauses for
 * `REPEAT_DELAY_MS`, then repeats every `REPEAT_RATE_MS` — the keyboard's own
 * behavior, which the browser gives the arrows for free and a pad has to be told.
 *
 * Changing direction restarts the whole cycle: it is a new intention, not the
 * continuation of the previous one.
 *
 * At most one move per frame, even after a stall (a tab in the background, a long
 * relayout): the pad is a source of intentions, not of a backlog to catch up on.
 */
export function stepRepeat(
  previous: RepeatState | null,
  direction: Direction | null,
  now: number,
): RepeatStep {
  if (!direction) return { state: null, fire: false };
  if (!previous || !sameDirection(previous.direction, direction)) {
    return { state: { direction, since: now, fired: 1 }, fire: true };
  }
  const due = previous.since + REPEAT_DELAY_MS + (previous.fired - 1) * REPEAT_RATE_MS;
  if (now < due) return { state: previous, fire: false };
  return { state: { ...previous, fired: previous.fired + 1 }, fire: true };
}

function sameDirection(a: Direction, b: Direction): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function dpadDirection(pad: PadSnapshot): Direction | null {
  const x = (pressed(pad, DPAD_RIGHT) ? 1 : 0) - (pressed(pad, DPAD_LEFT) ? 1 : 0);
  if (x !== 0) return [x, 0];
  const y = (pressed(pad, DPAD_DOWN) ? 1 : 0) - (pressed(pad, DPAD_UP) ? 1 : 0);
  return y !== 0 ? [0, y] : null;
}

function stickDirection(pad: PadSnapshot, held: Direction | null): Direction | null {
  const x = axis(pad, LEFT_STICK[0]);
  const y = axis(pad, LEFT_STICK[1]);
  const dominant: Direction = Math.abs(x) >= Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)];
  if (dominant[0] === 0 && dominant[1] === 0) return null;
  // The release threshold only applies to the direction already being held: any
  // OTHER direction is a new intention and has to clear the full dead zone.
  const reach = Math.abs(dominant[0] === 0 ? y : x);
  const threshold = held && sameDirection(held, dominant) ? NAV_RELEASE : NAV_DEADZONE;
  return reach >= threshold ? dominant : null;
}

/** A button that the pad may not have at all — a missing index is not pressed. */
function pressed(pad: PadSnapshot, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

/** An axis that the pad may not have — and never a NaN reaching the math below. */
function axis(pad: PadSnapshot, index: number): number {
  const value = pad.axes[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Removes the dead zone and rescales what is left over the full 0..1 range, so
 * the stick starts moving the content from zero instead of jumping to the value
 * the threshold cut off.
 */
function taper(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= SCROLL_DEADZONE) return 0;
  const scaled = (magnitude - SCROLL_DEADZONE) / (1 - SCROLL_DEADZONE);
  return Math.sign(value) * Math.min(1, scaled);
}
