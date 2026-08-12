import { describe, expect, it } from "vitest";
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
