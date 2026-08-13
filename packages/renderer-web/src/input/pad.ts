/**
 * Gamepad wiring (ZAB-47, extracted from `view.ts` in ZAB-54): the loop that
 * runs the rules of `gamepad.ts` and hands out what they produce. The pad is
 * ONE MORE SOURCE of input, not a second input model — everything it reads
 * resolves to an intention the keyboard already produces (a unit direction, a
 * press, a dismiss, a scroll), and every member of `PadHost` is one of those
 * intentions, served by the very same handlers the keys go through. That is
 * what keeps "navigate with the d-pad" and "navigate with the arrows" from
 * drifting apart.
 */

import {
  activePad,
  type Direction,
  type PadIntent,
  type RepeatState as PadRepeat,
  type PadSnapshot,
  readPad,
  scrollDelta,
  stepRepeat,
} from "../gamepad.js";

/**
 * What the pad asks of the view. Every member is an intention the keyboard
 * already produces, so the view implements each one with the handler that
 * already serves the equivalent key.
 */
export interface PadHost {
  /** Disposed views must not run work that was already in flight. */
  readonly disposed: boolean;
  /** Move the focus one step — the arrow keys' own move. */
  moveFocus(dx: number, dy: number): void;
  /** Press/release the focused node — A is Enter. */
  pressFocused(down: boolean): void;
  /**
   * Walk a focused field's caret with a synthetic arrow `keydown`. Returns
   * whether the field took the key (it gives it back at the end of the text,
   * so the player leaves with the d-pad instead of being trapped — decision
   * 2026-08-11, ZAB-26).
   */
  editArrowKey(key: string): boolean;
  /**
   * Nudge the focused Slider along its own axis, if the direction matches one.
   * Returns whether it did — a miss falls through to `moveFocus`.
   */
  nudgeFocusedSlider(dx: number, dy: number): boolean;
  /**
   * Commit the keyboard/pad Slider gesture in flight, if any — `onCommit` is
   * "the value the player settled on", and that value is on screen.
   */
  settleSliderKeys(): void;
  /**
   * Cancel the focused node's pressed state, the way a pointer that leaves the
   * control does: pulling a cable is not how a player buys something.
   */
  cancelFocusedPress(): void;
  /**
   * Ask the modal that owns input to dismiss — B is Escape, and nothing at all
   * when no overlay is up.
   */
  dismissTopModal(): void;
  /** Scroll the ScrollView the focus lives in by a pixel delta. */
  scrollFocusedBy(delta: { x: number; y: number }): void;
}

/** The poll loop's clock — the same monotonic source the view renders against. */
function now(): number {
  return performance.now();
}

/** The arrow key a gamepad direction stands in for. */
function arrowKey([dx, dy]: Direction): string {
  if (dx !== 0) return dx > 0 ? "ArrowRight" : "ArrowLeft";
  return dy > 0 ? "ArrowDown" : "ArrowUp";
}

/**
 * The poll loop and the state that turns a held button into an edge.
 * `gamepad.ts` owns the rules; this owns the loop that runs them and where
 * their intentions land.
 */
export class PadController {
  /**
   * The gamepad's own frame loop (ZAB-47). The Gamepad API is polled, never
   * pushed, and the view otherwise paints on change only — so a pad needs a loop
   * of its own, alive exactly while one is connected.
   */
  private poll: number | null = null;
  /** The pad's state on the previous poll: what turns a held button into an edge. */
  private held: Direction | null = null;
  private repeat: PadRepeat | null = null;
  private press = false;
  private back = false;
  /** When the previous poll ran — the scroll stick moves px per SECOND, not per frame. */
  private time = 0;

  constructor(private readonly host: PadHost) {}

  /** The pads the browser reports, with the stale entries of an unplugged one dropped. */
  private pads(): readonly (PadSnapshot | null)[] {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return [];
    return navigator.getGamepads().map((pad) => (pad?.connected ? pad : null));
  }

  /** Starts or stops the poll loop to match what is plugged in. */
  sync(): void {
    if (activePad(this.pads())) this.start();
    else this.stop();
  }

  /**
   * The Gamepad API is polled, never pushed: a held button is a state, not an
   * event, so the only way to read one is a frame. Hence a loop of its own —
   * separate from the view's `scheduleFrame`, which exists to finish a transition
   * and stops as soon as one ends. It runs exactly while a pad is connected: a
   * preview with no pad schedules nothing and costs what it always did.
   */
  private start(): void {
    if (this.poll !== null || typeof globalThis.requestAnimationFrame !== "function") return;
    this.time = now();
    const poll = () => {
      this.poll = globalThis.requestAnimationFrame(poll);
      this.pollPad();
    };
    this.poll = globalThis.requestAnimationFrame(poll);
  }

  stop(): void {
    if (this.poll === null) return;
    globalThis.cancelAnimationFrame(this.poll);
    this.poll = null;
    // A pad unplugged mid-press CANCELS it, the way a pointer that leaves the
    // control does.
    if (this.press) this.host.cancelFocusedPress();
    // A slider being nudged when the pad went away still settles.
    if (this.repeat) this.host.settleSliderKeys();
    this.held = null;
    this.repeat = null;
    this.press = false;
    this.back = false;
  }

  /** One poll: read the pad, then hand each intention to the handler that owns it. */
  private pollPad(): void {
    if (this.host.disposed) return;
    const time = now();
    const elapsed = time - this.time;
    this.time = time;
    const pad = activePad(this.pads());
    if (!pad) return;
    const intent = readPad(pad, this.held);
    this.held = intent.direction;
    this.direction(intent, time);
    this.buttons(intent);
    this.scroll(intent, elapsed);
  }

  /**
   * A held direction on the repeat clock. The browser gives the arrow keys their
   * repeat for free; a pad has to be told, which is the whole of `stepRepeat`.
   */
  private direction(intent: PadIntent, time: number): void {
    const step = stepRepeat(this.repeat, intent.direction, time);
    const released = this.repeat !== null && step.state === null;
    this.repeat = step.state;
    // Letting go of the direction ends a Slider gesture, the same commit the
    // `keyup` of an arrow fires — both ways of moving a slider settle alike.
    if (released) this.host.settleSliderKeys();
    if (!step.fire || !step.state) return;
    const [dx, dy] = step.state.direction;
    // The keyboard's own cascade, in the same order: the focused field's caret
    // first, then a Slider's own axis, and only then the focus itself.
    if (this.host.editArrowKey(arrowKey(step.state.direction))) return;
    if (this.host.nudgeFocusedSlider(dx, dy)) return;
    this.host.moveFocus(dx, dy);
  }

  /** A (press the focused node) and B (back), on their edges — a hold is not a stream. */
  private buttons(intent: PadIntent): void {
    if (intent.press !== this.press) {
      this.press = intent.press;
      this.host.pressFocused(intent.press);
    }
    if (intent.back !== this.back) {
      this.back = intent.back;
      // B is Escape: a dismiss request for the modal that owns input.
      if (intent.back) this.host.dismissTopModal();
    }
  }

  /** The right stick scrolls the ScrollView the focus lives in — px per second, not per frame. */
  private scroll(intent: PadIntent, elapsed: number): void {
    if (intent.scroll.x === 0 && intent.scroll.y === 0) return;
    this.host.scrollFocusedBy(scrollDelta(intent.scroll, elapsed));
  }
}
