import { afterEach, describe, expect, it } from "vitest";
import {
  activePad,
  type Direction,
  type PadSnapshot,
  REPEAT_DELAY_MS,
  REPEAT_RATE_MS,
  type RepeatState,
  readPad,
  SCROLL_SPEED,
  scrollDelta,
  stepRepeat,
} from "./gamepad.js";
import { mountCase, readCorpus } from "./golden.js";
import type { GoldenView } from "./harness.js";
import { findNode } from "./snapshot.js";

const UP: Direction = [0, -1];
const DOWN: Direction = [0, 1];
const LEFT: Direction = [-1, 0];
const RIGHT: Direction = [1, 0];

/** A pad at rest, with the buttons and axes the standard mapping declares. */
function pad(overrides: { buttons?: number[]; axes?: number[] } = {}): PadSnapshot {
  const buttons = Array.from({ length: 16 }, (_, index) => ({
    pressed: (overrides.buttons ?? []).includes(index),
  }));
  const axes = [0, 0, 0, 0];
  for (const [index, value] of Object.entries(overrides.axes ?? [])) {
    axes[Number(index)] = value;
  }
  return { buttons, axes };
}

describe("readPad — buttons", () => {
  it("reads A as press and B as back", () => {
    expect(readPad(pad({ buttons: [0] }))).toMatchObject({ press: true, back: false });
    expect(readPad(pad({ buttons: [1] }))).toMatchObject({ press: false, back: true });
  });

  it("reads the four d-pad directions as unit axes", () => {
    expect(readPad(pad({ buttons: [12] })).direction).toEqual(UP);
    expect(readPad(pad({ buttons: [13] })).direction).toEqual(DOWN);
    expect(readPad(pad({ buttons: [14] })).direction).toEqual(LEFT);
    expect(readPad(pad({ buttons: [15] })).direction).toEqual(RIGHT);
  });

  it("resolves a d-pad diagonal to its horizontal component", () => {
    expect(readPad(pad({ buttons: [12, 15] })).direction).toEqual(RIGHT);
  });

  it("cancels opposite d-pad buttons instead of picking one", () => {
    expect(readPad(pad({ buttons: [14, 15] })).direction).toBeNull();
    expect(readPad(pad({ buttons: [12, 13] })).direction).toBeNull();
  });

  it("takes nothing from a pad at rest", () => {
    expect(readPad(pad())).toEqual({
      direction: null,
      press: false,
      back: false,
      scroll: { x: 0, y: 0 },
    });
  });

  it("survives a pad that reports fewer buttons and axes than the standard mapping", () => {
    expect(readPad({ buttons: [{ pressed: true }], axes: [] })).toEqual({
      direction: null,
      press: true,
      back: false,
      scroll: { x: 0, y: 0 },
    });
  });

  it("ignores a NaN axis rather than propagating it into the math", () => {
    expect(
      readPad({ buttons: [], axes: [Number.NaN, Number.NaN, Number.NaN, Number.NaN] }),
    ).toEqual({ direction: null, press: false, back: false, scroll: { x: 0, y: 0 } });
  });
});

describe("readPad — left stick", () => {
  it("ignores anything inside the dead zone", () => {
    expect(readPad(pad({ axes: [0.4, 0] })).direction).toBeNull();
    expect(readPad(pad({ axes: [0, -0.49] })).direction).toBeNull();
  });

  it("registers a direction once the stick clears the dead zone", () => {
    expect(readPad(pad({ axes: [0.8, 0] })).direction).toEqual(RIGHT);
    expect(readPad(pad({ axes: [0, -0.8] })).direction).toEqual(UP);
  });

  it("resolves a diagonal push to its dominant axis", () => {
    expect(readPad(pad({ axes: [0.9, 0.6] })).direction).toEqual(RIGHT);
    expect(readPad(pad({ axes: [0.6, 0.9] })).direction).toEqual(DOWN);
  });

  it("holds the current direction down to the release threshold (hysteresis)", () => {
    // Between the two thresholds: released while nothing is held, still held once it is.
    expect(readPad(pad({ axes: [0.4, 0] })).direction).toBeNull();
    expect(readPad(pad({ axes: [0.4, 0] }), RIGHT).direction).toEqual(RIGHT);
    expect(readPad(pad({ axes: [0.3, 0] }), RIGHT).direction).toBeNull();
  });

  it("does not lend the release threshold to a different direction", () => {
    expect(readPad(pad({ axes: [0, 0.4] }), RIGHT).direction).toBeNull();
  });

  it("lets the d-pad win over a stick resting off-center", () => {
    expect(readPad(pad({ buttons: [12], axes: [0.9, 0] })).direction).toEqual(UP);
  });
});

describe("readPad — right stick", () => {
  it("ignores the scroll dead zone", () => {
    expect(readPad(pad({ axes: [0, 0, 0.1, -0.15] })).scroll).toEqual({ x: 0, y: 0 });
  });

  it("rescales what is left of the range, so it starts from zero", () => {
    const scroll = readPad(pad({ axes: [0, 0, 0.15 + 1e-9, 1] })).scroll;
    expect(scroll.x).toBeCloseTo(0, 6);
    expect(scroll.y).toBe(1);
  });

  it("keeps the sign of each axis", () => {
    const scroll = readPad(pad({ axes: [0, 0, -1, 0.575] })).scroll;
    expect(scroll.x).toBe(-1);
    expect(scroll.y).toBeCloseTo(0.5, 6);
  });

  it("clamps an over-range axis to full deflection", () => {
    expect(readPad(pad({ axes: [0, 0, 2, -2] })).scroll).toEqual({ x: 1, y: -1 });
  });
});

describe("scrollDelta", () => {
  it("moves at the full speed over one second at full deflection", () => {
    expect(scrollDelta({ x: 0, y: 1 }, 1000)).toEqual({ x: 0, y: SCROLL_SPEED });
  });

  it("scales with the frame's own duration", () => {
    expect(scrollDelta({ x: 1, y: 0 }, 16).x).toBeCloseTo((SCROLL_SPEED * 16) / 1000, 6);
  });

  it("responds quadratically, so half a stick is a quarter of the speed", () => {
    expect(scrollDelta({ x: 0.5, y: -0.5 }, 1000)).toEqual({
      x: SCROLL_SPEED * 0.25,
      y: -SCROLL_SPEED * 0.25,
    });
  });

  it("never moves backwards on a negative frame time", () => {
    expect(scrollDelta({ x: 1, y: 1 }, -16)).toEqual({ x: 0, y: 0 });
  });
});

describe("stepRepeat", () => {
  it("fires the instant a direction is pressed", () => {
    const step = stepRepeat(null, DOWN, 1000);
    expect(step.fire).toBe(true);
    expect(step.state).toEqual({ direction: DOWN, since: 1000, fired: 1 });
  });

  it("holds still through the repeat delay", () => {
    const held: RepeatState = { direction: DOWN, since: 1000, fired: 1 };
    expect(stepRepeat(held, DOWN, 1000 + REPEAT_DELAY_MS - 1).fire).toBe(false);
    expect(stepRepeat(held, DOWN, 1000 + REPEAT_DELAY_MS).fire).toBe(true);
  });

  it("repeats at the repeat rate once the delay is spent", () => {
    let state = stepRepeat(null, DOWN, 0).state;
    const fired: number[] = [0];
    for (let time = 1; time <= REPEAT_DELAY_MS + REPEAT_RATE_MS * 3; time++) {
      const step = stepRepeat(state, DOWN, time);
      state = step.state;
      if (step.fire) fired.push(time);
    }
    expect(fired).toEqual([
      0,
      REPEAT_DELAY_MS,
      REPEAT_DELAY_MS + REPEAT_RATE_MS,
      REPEAT_DELAY_MS + REPEAT_RATE_MS * 2,
      REPEAT_DELAY_MS + REPEAT_RATE_MS * 3,
    ]);
  });

  it("restarts the whole cycle when the direction changes", () => {
    const held: RepeatState = { direction: DOWN, since: 0, fired: 6 };
    const step = stepRepeat(held, LEFT, 900);
    expect(step.fire).toBe(true);
    expect(step.state).toEqual({ direction: LEFT, since: 900, fired: 1 });
  });

  it("forgets the hold when the direction is released", () => {
    expect(stepRepeat({ direction: DOWN, since: 0, fired: 3 }, null, 900)).toEqual({
      state: null,
      fire: false,
    });
  });

  it("fires once after a stall instead of catching up on the backlog", () => {
    const held: RepeatState = { direction: DOWN, since: 0, fired: 1 };
    const step = stepRepeat(held, DOWN, 10_000);
    expect(step).toMatchObject({ fire: true });
    expect(step.state).toEqual({ direction: DOWN, since: 0, fired: 2 });
  });
});

describe("activePad", () => {
  it("takes the first connected pad", () => {
    const second = pad({ buttons: [0] });
    expect(activePad([null, second, pad()])).toBe(second);
  });

  it("is null while nothing is connected", () => {
    expect(activePad([null, null])).toBeNull();
    expect(activePad([])).toBeNull();
  });
});

// --- integration: the poll loop of view.ts, against the corpus (ZAB-53) ---
// Everything below runs the REAL wiring — `syncPad` on the connect events, the
// rAF loop, and the handlers each intention lands in — with only the pad itself
// stubbed. The pure rules are proven above; what these prove is that the loop
// reads them and that each intention reaches the same handler the keyboard uses.

/** Standard-mapping indices, as the harness pad numbers them. */
const BTN_A = 0;
const BTN_B = 1;
const BTN_DOWN = 13;
const BTN_RIGHT = 15;
const AXIS_RIGHT_Y = 3;

/** One poll's worth of time — any frame-sized step reads the pad once. */
const FRAME_MS = 16;

const CORPUS = readCorpus();

let view: GoldenView | null = null;

afterEach(() => {
  view?.dispose();
  view = null;
});

function states(mounted: GoldenView, ref: string): string[] {
  return findNode(mounted.snapshot(), ref)?.states ?? [];
}

/** Press-and-release a d-pad button, polled on both edges — one discrete step. */
function tap(mounted: GoldenView, padControl: ReturnType<GoldenView["connectGamepad"]>): void {
  padControl.press(BTN_DOWN);
  mounted.advance(FRAME_MS);
  padControl.release(BTN_DOWN);
  mounted.advance(FRAME_MS);
}

describe("integration — d-pad navigation", () => {
  it("moves the focus with the d-pad, through the same spatial step as the arrows", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    expect(view.snapshot().focus).toBe("primary");
    const pad = view.connectGamepad();

    pad.press(BTN_DOWN);
    view.advance(FRAME_MS);

    expect(view.snapshot().focus).toBe("secondary");
    expect(states(view, "secondary")).toContain("focused");
  });

  it("repeats a held direction on the keyboard's own clock", async () => {
    view = await mountCase(CORPUS.settings);
    const pad = view.connectGamepad();

    // The first fire is the press itself, landing the focus somewhere at all.
    pad.press(BTN_DOWN);
    view.advance(FRAME_MS);
    expect(view.snapshot().focus).toBe("tab-general");

    // Held through the delay: not one step early…
    view.advance(REPEAT_DELAY_MS - 1);
    expect(view.snapshot().focus).toBe("tab-general");

    // …then one step exactly on the delay, and one per period after it.
    view.advance(1);
    expect(view.snapshot().focus).toBe("quality");
    view.advance(REPEAT_RATE_MS);
    expect(view.snapshot().focus).toBe("fullscreen");
  });

  it("stops repeating the instant the pad is unplugged", async () => {
    view = await mountCase(CORPUS.settings);
    const pad = view.connectGamepad();
    pad.press(BTN_DOWN);
    view.advance(FRAME_MS);
    expect(view.snapshot().focus).toBe("tab-general");

    pad.disconnect();
    view.advance(REPEAT_DELAY_MS + REPEAT_RATE_MS);

    expect(view.snapshot().focus).toBe("tab-general");
  });
});

describe("integration — A and B", () => {
  it("presses the focused control with A and activates it on the release edge", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const pad = view.connectGamepad();

    pad.press(BTN_A);
    view.advance(FRAME_MS);
    expect(states(view, "primary")).toContain("pressed");
    expect(view.actions).toEqual([]); // a hold is not a stream, and not a tap yet

    pad.release(BTN_A);
    view.advance(FRAME_MS);
    expect(states(view, "primary")).not.toContain("pressed");
    expect(view.actions).toEqual([{ action: "buy" }]);
  });

  it("cancels a press when the pad is unplugged mid-hold, like a pointer leaving", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const pad = view.connectGamepad();
    pad.press(BTN_A);
    view.advance(FRAME_MS);
    expect(states(view, "primary")).toContain("pressed");

    pad.disconnect();

    expect(states(view, "primary")).not.toContain("pressed");
    expect(view.actions).toEqual([]);
  });

  it("treats B as a dismiss request for the modal that owns the input", async () => {
    view = await mountCase(CORPUS.overlays);
    const pad = view.connectGamepad();

    pad.press(BTN_B);
    view.advance(FRAME_MS);

    expect(view.actions).toEqual([{ action: "close-modal" }]);
  });

  it("makes B do nothing at all while no overlay is up", async () => {
    view = await mountCase(CORPUS["states-tokens"]);
    const pad = view.connectGamepad();

    pad.press(BTN_B);
    view.advance(FRAME_MS);
    pad.release(BTN_B);
    view.advance(FRAME_MS);

    expect(view.actions).toEqual([]);
  });
});

describe("integration — right-stick scrolling", () => {
  it("scrolls the ScrollView the focus lives in, in px per second", async () => {
    view = await mountCase(CORPUS.repeat);
    const pad = view.connectGamepad();
    // Land the focus on an item of the virtualized list first.
    tap(view, pad);
    const before = findNode(view.snapshot(), "list-scroller")?.scroll;
    if (!before) throw new Error("the list scroller is not in layout");

    pad.axis(AXIS_RIGHT_Y, 1);
    view.advance(500);

    const after = findNode(view.snapshot(), "list-scroller")?.scroll;
    // Full deflection for half a second: SCROLL_SPEED / 2 px, or the end of the
    // content if that comes first — the same clamp the wheel goes through.
    const expected = Math.min(before.y + SCROLL_SPEED / 2, before.maxY);
    expect(after?.y).toBeCloseTo(expected, 3);
  });

  it("leaves the scroller alone while the stick rests in its dead zone", async () => {
    view = await mountCase(CORPUS.repeat);
    const pad = view.connectGamepad();
    tap(view, pad);

    pad.axis(AXIS_RIGHT_Y, 0.1);
    view.advance(500);

    expect(findNode(view.snapshot(), "list-scroller")?.scroll?.y).toBe(0);
  });
});

describe("integration — sliders", () => {
  /** Walks the settings focus down to the brightness Slider, one tap per step. */
  async function focusBrightness(): Promise<
    [GoldenView, ReturnType<GoldenView["connectGamepad"]>]
  > {
    const mounted = await mountCase(CORPUS.settings);
    const pad = mounted.connectGamepad();
    for (const stop of ["tab-general", "quality", "fullscreen", "brightness"]) {
      tap(mounted, pad);
      expect(mounted.snapshot().focus).toBe(stop);
    }
    return [mounted, pad];
  }

  it("nudges the focused Slider along its axis and commits when the direction lifts", async () => {
    const [mounted, pad] = await focusBrightness();
    view = mounted;

    pad.press(BTN_RIGHT);
    view.advance(FRAME_MS);
    // One step of 10 over the bound 60, written back on the data channel.
    expect(view.writes).toContainEqual({ path: "settings.brightness", value: 70 });
    expect(view.actions).toEqual([]); // still mid-gesture

    pad.release(BTN_RIGHT);
    view.advance(FRAME_MS);
    expect(view.actions).toEqual([{ action: "brightness-apply" }]);
  });

  it("still settles the gesture when the pad is unplugged mid-nudge", async () => {
    const [mounted, pad] = await focusBrightness();
    view = mounted;
    pad.press(BTN_RIGHT);
    view.advance(FRAME_MS);

    pad.disconnect();

    // `onCommit` is "the value the player left it at", and 70 is on screen.
    expect(view.actions).toEqual([{ action: "brightness-apply" }]);
  });
});
