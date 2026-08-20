import { afterEach, describe, expect, it, vi } from "vitest";
import { REPEAT_DELAY_MS, REPEAT_RATE_MS, SCROLL_SPEED } from "../gamepad.js";
import { PadController, type PadHost } from "./pad.js";

/**
 * `PadController` against its own seam (ZAB-74). `gamepad.ts` owns the RULES —
 * dead zones, the repeat clock, the scroll curve — and has 29 tests of its own;
 * this owns the LOOP that runs them: when it exists at all, what turns a held
 * button into an edge, and what a pad that goes away mid-gesture owes the view.
 *
 * The Gamepad API is polled, never pushed, so the fake here is the pad's STATE
 * plus a hand-cranked `requestAnimationFrame` — nothing happens until a test
 * runs a frame, which is the only way a poll loop is testable at all.
 */

/** Standard-mapping indices, the same numbers `gamepad.ts` documents. */
const A = 0;
const B = 1;
const DPAD_DOWN = 13;
const DPAD_RIGHT = 15;

/** A pad the browser reports, with every button up and both sticks centered. */
class FakePad {
  connected = true;
  readonly buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  readonly axes = [0, 0, 0, 0];

  press(index: number): this {
    this.buttons[index].pressed = true;
    return this;
  }
  release(index: number): this {
    this.buttons[index].pressed = false;
    return this;
  }
  axis(index: number, value: number): this {
    this.axes[index] = value;
    return this;
  }
}

interface Rig {
  pad: PadController;
  host: { [K in keyof PadHost]: PadHost[K] };
  /** Plugs a pad in (it is not polled until `sync`). */
  plug(): FakePad;
  unplug(): void;
  /** Runs the frames the loop scheduled, moving the clock `ms` in total. */
  frames(count: number, ms?: number): void;
  /** Frames scheduled but not yet run — zero means the loop is stopped. */
  scheduled(): number;
  disposed(value: boolean): void;
}

function rig(options: { raf?: boolean; navigator?: boolean } = {}): Rig {
  // Slots: the stubbed globals below read them, and the rig's own methods write
  // them, so none of these can be a value the caller holds.
  const fake: {
    pads: (FakePad | null)[];
    disposed: boolean;
    clock: number;
    nextHandle: number;
  } = { pads: [], disposed: false, clock: 1000, nextHandle: 1 };
  const pending = new Map<number, () => void>();

  vi.stubGlobal("performance", { now: () => fake.clock });
  if (options.navigator !== false) {
    vi.stubGlobal("navigator", { getGamepads: () => fake.pads });
  } else {
    vi.stubGlobal("navigator", {});
  }
  if (options.raf !== false) {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      const handle = fake.nextHandle++;
      pending.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      pending.delete(handle);
    });
  } else {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  }

  const host = {
    get disposed() {
      return fake.disposed;
    },
    moveFocus: vi.fn(),
    pressFocused: vi.fn(),
    editArrowKey: vi.fn(() => false),
    nudgeFocusedSlider: vi.fn(() => false),
    settleSliderKeys: vi.fn(),
    cancelFocusedPress: vi.fn(),
    dismissTopModal: vi.fn(),
    scrollFocusedBy: vi.fn(),
  };

  return {
    pad: new PadController(host as unknown as PadHost),
    host: host as unknown as Rig["host"],
    plug: () => {
      const pad = new FakePad();
      fake.pads = [pad];
      return pad;
    },
    unplug: () => {
      fake.pads = [];
    },
    frames: (count, ms = 0) => {
      for (const _ of Array(count).keys()) {
        fake.clock += ms;
        const [handle, callback] = [...pending.entries()][0] ?? [];
        if (handle === undefined || !callback) return;
        pending.delete(handle);
        callback();
      }
    },
    scheduled: () => pending.size,
    disposed: (value) => {
      fake.disposed = value;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the poll loop", () => {
  /**
   * It runs exactly while a pad is connected: a preview with no pad schedules
   * nothing and costs what it always did.
   */
  it("does not exist until a pad is plugged in", () => {
    const state = rig();

    state.pad.sync();

    expect(state.scheduled()).toBe(0);
  });

  it("starts when one shows up and keeps itself alive", () => {
    const state = rig();
    state.plug();

    state.pad.sync();
    expect(state.scheduled()).toBe(1);

    state.frames(1);
    expect(state.scheduled()).toBe(1);
  });

  it("stops when the cable is pulled", () => {
    const state = rig();
    state.plug();
    state.pad.sync();

    state.unplug();
    state.pad.sync();

    expect(state.scheduled()).toBe(0);
  });

  it("ignores a pad the browser still lists but reports disconnected", () => {
    const state = rig();
    const pad = state.plug();
    pad.connected = false;

    state.pad.sync();

    expect(state.scheduled()).toBe(0);
  });

  it("does not start twice when sync runs again", () => {
    const state = rig();
    state.plug();

    state.pad.sync();
    state.pad.sync();

    // Two loops would double every intention the pad produces.
    expect(state.scheduled()).toBe(1);
  });

  it("runs no work for a view that is already disposed", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(A);

    state.disposed(true);
    state.frames(1);

    expect(state.host.pressFocused).not.toHaveBeenCalled();
  });

  it("costs nothing where there are no frames to schedule", () => {
    const state = rig({ raf: false });
    state.plug();

    expect(() => state.pad.sync()).not.toThrow();
  });

  it("reads nothing on a host with no Gamepad API at all", () => {
    const state = rig({ navigator: false });

    state.pad.sync();

    expect(state.scheduled()).toBe(0);
  });
});

describe("A and B, on their edges", () => {
  it("presses once for a button that is HELD, not once per frame", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();

    pad.press(A);
    state.frames(3, 16);

    expect(state.host.pressFocused).toHaveBeenCalledTimes(1);
    expect(state.host.pressFocused).toHaveBeenCalledWith(true);
  });

  it("releases on the edge back down", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(A);
    state.frames(1, 16);

    pad.release(A);
    state.frames(1, 16);

    expect(state.host.pressFocused).toHaveBeenNthCalledWith(2, false);
  });

  it("asks the top modal to dismiss on B, and only on its press", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();

    pad.press(B);
    state.frames(3, 16);
    pad.release(B);
    state.frames(1, 16);

    // B is Escape: the release is not a second dismiss.
    expect(state.host.dismissTopModal).toHaveBeenCalledTimes(1);
  });
});

describe("a direction", () => {
  it("moves the focus the instant it is pressed", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();

    pad.press(DPAD_RIGHT);
    state.frames(1, 16);

    expect(state.host.moveFocus).toHaveBeenCalledWith(1, 0);
  });

  it("waits out the repeat delay before the second move", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(DPAD_DOWN);
    state.frames(1, 16);

    state.frames(1, REPEAT_DELAY_MS - 100);
    expect(state.host.moveFocus).toHaveBeenCalledTimes(1);

    state.frames(1, 200);
    expect(state.host.moveFocus).toHaveBeenCalledTimes(2);
  });

  it("then repeats on its own period", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(DPAD_DOWN);
    state.frames(1, 16);
    state.frames(1, REPEAT_DELAY_MS);
    const after = (state.host.moveFocus as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    state.frames(1, REPEAT_RATE_MS);

    expect((state.host.moveFocus as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      after + 1,
    );
  });

  /**
   * The keyboard's own cascade, in the same order — that is what keeps
   * "navigate with the d-pad" and "navigate with the arrows" from drifting.
   */
  it("goes to a focused field's caret first", () => {
    const state = rig();
    const pad = state.plug();
    (state.host.editArrowKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    state.pad.sync();

    pad.press(DPAD_RIGHT);
    state.frames(1, 16);

    expect(state.host.editArrowKey).toHaveBeenCalledWith("ArrowRight");
    expect(state.host.nudgeFocusedSlider).not.toHaveBeenCalled();
    expect(state.host.moveFocus).not.toHaveBeenCalled();
  });

  it("then to a Slider's own axis", () => {
    const state = rig();
    const pad = state.plug();
    (state.host.nudgeFocusedSlider as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    state.pad.sync();

    pad.press(DPAD_RIGHT);
    state.frames(1, 16);

    expect(state.host.nudgeFocusedSlider).toHaveBeenCalledWith(1, 0);
    expect(state.host.moveFocus).not.toHaveBeenCalled();
  });

  it("falls through to the focus when the field gives the key back", () => {
    const state = rig();
    const pad = state.plug();
    // A field at the end of its text hands the arrow back, so the player leaves
    // with the d-pad instead of being trapped in it (ZAB-26).
    (state.host.editArrowKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    state.pad.sync();

    pad.press(DPAD_DOWN);
    state.frames(1, 16);

    expect(state.host.moveFocus).toHaveBeenCalledWith(0, 1);
  });

  it("settles a Slider gesture when the direction is let go", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(DPAD_RIGHT);
    state.frames(1, 16);

    pad.release(DPAD_RIGHT);
    state.frames(1, 16);

    // The same commit the `keyup` of an arrow fires: both ways of moving a
    // slider settle alike.
    expect(state.host.settleSliderKeys).toHaveBeenCalledTimes(1);
  });

  it("does not settle anything when no direction was held", () => {
    const state = rig();
    state.plug();
    state.pad.sync();

    state.frames(3, 16);

    expect(state.host.settleSliderKeys).not.toHaveBeenCalled();
  });
});

describe("the scroll stick", () => {
  it("moves the focused scroller by px per SECOND, not per frame", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();

    pad.axis(3, 1);
    state.frames(1, 100);

    // Full deflection for 100ms: a tenth of the top speed, squared response and all.
    expect(state.host.scrollFocusedBy).toHaveBeenCalledWith({ x: 0, y: SCROLL_SPEED * 0.1 });
  });

  it("says nothing while the stick rests in its dead zone", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();

    pad.axis(3, 0.1);
    state.frames(2, 16);

    expect(state.host.scrollFocusedBy).not.toHaveBeenCalled();
  });
});

describe("a pad that goes away mid-gesture", () => {
  /**
   * Pulling a cable is not how a player buys something: a press in flight is
   * CANCELLED, exactly as a pointer that leaves the control is. A slider being
   * nudged still settles — that value was on screen.
   */
  it("cancels the press it was holding", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(A);
    state.frames(1, 16);

    state.unplug();
    state.pad.sync();

    expect(state.host.cancelFocusedPress).toHaveBeenCalledTimes(1);
    expect(state.host.pressFocused).toHaveBeenCalledTimes(1);
  });

  it("settles the Slider it was nudging", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(DPAD_RIGHT);
    state.frames(1, 16);

    state.unplug();
    state.pad.sync();

    expect(state.host.settleSliderKeys).toHaveBeenCalledTimes(1);
  });

  it("cancels nothing when nothing was in flight", () => {
    const state = rig();
    state.plug();
    state.pad.sync();
    state.frames(1, 16);

    state.unplug();
    state.pad.sync();

    expect(state.host.cancelFocusedPress).not.toHaveBeenCalled();
    expect(state.host.settleSliderKeys).not.toHaveBeenCalled();
  });

  it("starts clean when a pad is plugged back in", () => {
    const state = rig();
    const first = state.plug();
    state.pad.sync();
    first.press(A);
    state.frames(1, 16);
    state.unplug();
    state.pad.sync();

    const second = state.plug();
    second.press(A);
    state.pad.sync();
    state.frames(1, 16);

    // The edge state went with the pad: A held on the NEW pad is a new press.
    expect(state.host.pressFocused).toHaveBeenNthCalledWith(2, true);
  });

  it("is idempotent — a second stop releases nothing twice", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(A);
    state.frames(1, 16);

    state.pad.stop();
    state.pad.stop();

    expect(state.host.cancelFocusedPress).toHaveBeenCalledTimes(1);
  });
});

describe("what a reload does NOT reset (checked in ZAB-57)", () => {
  /**
   * There is deliberately no `reset()` here: everything the controller keeps is
   * DEVICE state, and none of it names a node. Clearing it would be the actual
   * bug — zeroing `press` mid-hold makes the very next poll read A as newly
   * pressed and press whatever the new tree focused, a control the player never
   * aimed at.
   */
  it("keeps a held A held across a rebuild, so no phantom press fires", () => {
    const state = rig();
    const pad = state.plug();
    state.pad.sync();
    pad.press(A);
    state.frames(1, 16);

    // A rebuild: `sync` is what the view calls, and it must not re-edge anything.
    state.pad.sync();
    state.frames(2, 16);

    expect(state.host.pressFocused).toHaveBeenCalledTimes(1);
  });
});
