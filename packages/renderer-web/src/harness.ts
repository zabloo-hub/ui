/**
 * Headless rig for the golden tests (ZAB-48): mounts a real view on a stand-in
 * browser so CI can measure what the renderer computes without a GPU, a window
 * or a font service.
 *
 * **It fakes the browser, never the renderer.** Everything under test runs for
 * real — `mount`, the expansion/resolve passes, measure/arrange, the tessellator,
 * the hit-testing and the event handling of `view.ts`. What is stubbed is only
 * what Node does not have and the renderer only writes to:
 *
 * | Stub | Why it is honest |
 * |---|---|
 * | WebGL2 context | Draw calls are the OUTPUT; the metrics are computed before it |
 * | Canvas2D context | Only the atlas bitmap goes through it — the metrics do not |
 * | `document` + `<textarea>` | The hidden field the browser types into (ZAB-26) |
 * | clock + `requestAnimationFrame` | Time has to step by hand, or a tween is a race |
 * | `createImageBitmap` | An image's LAYOUT comes from the manifest, not from pixels |
 * | `navigator.getGamepads` | A pad is a STATE the view polls; the stub is the state, the poll loop stays real |
 *
 * Text is the part that could have been faked and deliberately is not: the rig
 * waits for the view's own stb-truetype rasterizer (`handle.ready`) before it
 * measures anything, so every width, break point and baseline in a golden file
 * comes from the shipped TTF through the shipped WASM — the same pair Unity
 * runs, which is what makes the corpus reusable in ZAB-38 instead of a
 * web-only curiosity.
 *
 * This module is imported by tests only: nothing in `index.ts` references it, so
 * it never reaches `dist`.
 */

import type { ActionContext, Diagnostic, Envelope } from "@zabloo/format";
import type { ViewSnapshot } from "./snapshot.js";
import { mount, type ZablooHandle } from "./view.js";

/** Viewport every golden envelope is measured at, unless it asks for another. */
export const GOLDEN_SIZE = { width: 480, height: 320 };

/**
 * Device pixel ratio the corpus is rendered at. 1 on purpose: a golden file is a
 * document of LOGICAL geometry, and rasterizing the atlas at 2× would move the
 * glyph boxes (they are rounded in device px) without moving anything the
 * metrics describe.
 */
export const GOLDEN_DPR = 1;

export interface GoldenOptions {
  /** View to render (default: the envelope's first). */
  view?: string;
  width?: number;
  height?: number;
  /** Data pushed through `setData` before the first measured frame. */
  data?: Record<string, unknown>;
  /**
   * Mount on the stand-in browser of a view that is already up, instead of
   * installing another one — two canvases on ONE page, which is the only way to
   * exercise what the keyboard and the pad do when several views are mounted
   * (ZAB-70). Its `dispose` then tears down this handle alone; the page belongs
   * to the view that installed it.
   */
  share?: GoldenView;
  /**
   * Structured diagnostics of the load (ZAB-72). Left out — as every corpus case
   * does — they go to the console, which is where `warnings` picks them up.
   */
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

/** An action the view fired, with the item context when it came from a `Repeat`. */
export interface FiredAction {
  action: string;
  context?: ActionContext;
}

/** A value the view wrote back into a bound path (the ZAB-23 return leg). */
export interface DataWrite {
  path: string;
  value: unknown;
}

export interface GoldenView {
  handle: ZablooHandle;
  /** Metrics of the frame on screen. */
  snapshot(): ViewSnapshot;
  /** Named actions fired so far, in order. */
  actions: FiredAction[];
  /** Writes the view pushed back into the data store, in order. */
  writes: DataWrite[];
  /** Anything the renderer warned about — a corpus envelope must produce none. */
  warnings: string[];
  pointer: Pointer;
  /** A `keydown` on the window, as the view listens for it. */
  keyDown(key: string, init?: KeyInit): void;
  keyUp(key: string, init?: KeyInit): void;
  /** Press and release — what a player does to activate the focused control. */
  press(key?: string): void;
  /** Types into the focused TextInput through the hidden field, as a browser does. */
  type(text: string): void;
  /**
   * An IME composition against the hidden field, in its three moments. While one
   * is in flight the field SHOWS what is being composed but the game is not told
   * (half a syllable is not a value); `end` is what commits it. Separate calls so
   * a test can put something else — a reload — in between.
   */
  compose: {
    start(): void;
    update(text: string): void;
    end(): void;
  };
  /** Whether the hidden field is the one holding the keyboard right now. */
  focusedEditor(): boolean;
  /**
   * The GPU dropping the context under the view — what `WEBGL_lose_context` does
   * in a browser, and what a backgrounded mobile tab or a driver reset does on
   * their own (ZAB-68). Every GL call is a no-op until `restoreContext`.
   */
  loseContext(): void;
  /** The context coming back — empty, as the browser hands it back. */
  restoreContext(): void;
  /** Draw calls submitted to the fake GL since mount — a repaint bumps it. */
  drawCalls(): number;
  /**
   * Moves the canvas on the page without resizing it, and tells the page it
   * scrolled — the two halves of what happens when a container scrolls under a
   * mounted view. The renderer caches where the canvas is (ZAB-73), so a test
   * that moves it without the event is testing the STALE rect on purpose.
   */
  moveCanvas(left: number, top: number): void;
  scrollPage(): void;
  /**
   * Steps the clock `ms` forward and runs the frames the view scheduled for that
   * span — the only way time passes here, so a transition is measured at the
   * instant the test names instead of whenever the machine got around to it.
   */
  advance(ms: number): void;
  /**
   * Renders one more frame without moving the clock.
   *
   * Some geometry is only correct on the SECOND frame by design: a `Repeat`
   * measures its instances on the frame the data arrives and windows them on the
   * next one ("what the instances measured is the input the next window is
   * computed from"). Measuring the first frame would record a transient.
   */
  settle(): void;
  resize(width: number, height: number): void;
  /**
   * Plugs a pad into the fake `navigator` and announces it, as the browser
   * does — `gamepadconnected` fires and the view starts its poll loop.
   */
  connectGamepad(): GoldenPad;
  dispose(): void;
}

export interface KeyInit {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

/**
 * A pad the harness plugged in. The methods mutate the state the view's poll
 * loop reads on its next frame — nothing happens until `advance()` runs one.
 * Indices are the standard mapping (0=A, 1=B, 12–15=d-pad, axes 0/1 left stick,
 * 2/3 right stick), the same numbers `gamepad.ts` documents.
 */
export interface GoldenPad {
  press(index: number): void;
  release(index: number): void;
  axis(index: number, value: number): void;
  /** Pulls the cable: `connected` drops and `gamepaddisconnected` fires. */
  disconnect(): void;
}

/** Pointer gestures against the canvas, in logical view coordinates. */
export interface Pointer {
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  /**
   * The pointer ENDING without a release — a touch the system interrupted, a
   * browser gesture taking over. Whatever was in flight has to stop, and none of
   * it concludes (ZAB-70).
   */
  cancel(): void;
  /** Down and up on the same spot — a tap. */
  click(x: number, y: number): void;
  wheel(x: number, y: number, deltaX: number, deltaY: number): void;
  /** The pointer leaving the canvas, which drops the hover. */
  leave(): void;
}

/**
 * Mounts an envelope and returns it ready to measure: the rasterizer swapped in,
 * the seed data applied and one frame rendered with both.
 */
export async function mountGolden(
  envelope: Envelope | object,
  options: GoldenOptions = {},
): Promise<GoldenView> {
  const width = options.width ?? GOLDEN_SIZE.width;
  const height = options.height ?? GOLDEN_SIZE.height;
  const shared = options.share ? domOf(options.share) : null;
  const dom = shared ?? installDom();
  const canvas = new FakeCanvas(width, height, GOLDEN_DPR);

  const actions: FiredAction[] = [];
  const writes: DataWrite[] = [];
  const handle = mount(canvas as unknown as HTMLCanvasElement, envelope, {
    view: options.view,
    onAction: (action, context) => actions.push(context ? { action, context } : { action }),
    onDataChanged: (path, value) => writes.push({ path, value }),
    ...(options.onDiagnostic && { onDiagnostic: options.onDiagnostic }),
  });

  // The first frames measured text with the browser's rasterizer; from here on
  // they are measured with ours, which is the one the corpus is a record of.
  await handle.ready;
  for (const [path, value] of Object.entries(options.data ?? {})) handle.setData(path, value);

  const view: GoldenView = {
    handle,
    snapshot: () => handle.snapshot(),
    actions,
    writes,
    warnings: dom.warnings,
    pointer: {
      down: (x, y) => canvas.dispatch("pointerdown", pointerEvent(x, y)),
      move: (x, y) => canvas.dispatch("pointermove", pointerEvent(x, y)),
      up: (x, y) => canvas.dispatch("pointerup", pointerEvent(x, y)),
      cancel: () => canvas.dispatch("pointercancel", pointerEvent(0, 0)),
      click: (x, y) => {
        canvas.dispatch("pointerdown", pointerEvent(x, y));
        canvas.dispatch("pointerup", pointerEvent(x, y));
      },
      wheel: (x, y, deltaX, deltaY) =>
        canvas.dispatch("wheel", { ...pointerEvent(x, y), deltaX, deltaY }),
      leave: () => canvas.dispatch("pointerleave", {}),
    },
    keyDown: (key, init) => dom.dispatch("keydown", keyEvent(key, init)),
    keyUp: (key, init) => dom.dispatch("keyup", keyEvent(key, init)),
    press: (key = "Enter") => {
      dom.dispatch("keydown", keyEvent(key));
      dom.dispatch("keyup", keyEvent(key));
    },
    type: (text) => dom.typeIntoEditor(text),
    compose: {
      start: () => dom.dispatchOnEditor("compositionstart"),
      update: (text) => dom.typeIntoEditor(text, "compositionupdate"),
      end: () => dom.dispatchOnEditor("compositionend"),
    },
    focusedEditor: () => dom.editor !== null && dom.activeElement === dom.editor,
    loseContext: () => canvas.loseContext(),
    restoreContext: () => canvas.restoreContext(),
    drawCalls: () => canvas.drawCalls,
    moveCanvas: (left, top) => canvas.moveTo(left, top),
    scrollPage: () => dom.dispatch("scroll", {}),
    advance: (ms) => dom.advance(ms),
    // A resize to the same size: the view re-renders, which is all this asks for.
    settle: () => dom.dispatch("resize", {}),
    resize: (nextWidth, nextHeight) => {
      canvas.resize(nextWidth, nextHeight);
      dom.dispatch("resize", {});
    },
    connectGamepad: () => dom.connectPad(),
    dispose: () => {
      handle.dispose();
      // A shared page outlives this handle: it belongs to the view that installed it.
      if (shared === null) dom.uninstall();
    },
  };
  doms.set(view, dom);
  return view;
}

/** Which stand-in browser a mounted view is running on — see `GoldenOptions.share`. */
const doms = new WeakMap<GoldenView, FakeDom>();

function domOf(view: GoldenView): FakeDom {
  const dom = doms.get(view);
  if (!dom) throw new Error("golden harness: that view was not mounted by this harness");
  return dom;
}

function pointerEvent(x: number, y: number): Record<string, unknown> {
  return { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", preventDefault: () => {} };
}

function keyEvent(key: string, init: KeyInit = {}): Record<string, unknown> {
  return {
    key,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    repeat: init.repeat ?? false,
    preventDefault: () => {},
  };
}

// --- the stand-in browser ---

type Listener = (event: unknown) => void;

/** Listener bookkeeping shared by every fake element (and by the window). */
class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    // A copy: a handler that removes itself (the disposers do) must not mutate
    // the set being iterated.
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

/**
 * The canvas the view mounts on. `width`/`height` are the backing store in device
 * px and `clientWidth`/`clientHeight` the CSS box — the renderer derives the
 * logical size from both, exactly as it does in a browser.
 */
class FakeCanvas extends FakeTarget {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  readonly parentElement = null;
  /** Where the canvas sits on the page — moved by `moveTo` (ZAB-73). */
  private left = 0;
  private top = 0;
  private readonly gl = new FakeGl();
  private readonly ctx2d = new FakeContext2D();

  constructor(
    width: number,
    height: number,
    private readonly dpr: number,
  ) {
    super();
    this.clientWidth = width;
    this.clientHeight = height;
    this.width = Math.round(width * dpr);
    this.height = Math.round(height * dpr);
  }

  getContext(kind: string): unknown {
    return kind === "2d" ? this.ctx2d : this.gl.context;
  }

  /** Draw calls the view has submitted since it mounted. */
  get drawCalls(): number {
    return this.gl.draws;
  }

  /**
   * The context going away and coming back, in the browser's own two moments:
   * the flag flips FIRST (from that instant every GL call is a no-op) and the
   * event follows, which is exactly the order a real loss reaches the page.
   */
  loseContext(): void {
    this.gl.lost = true;
    this.dispatch("webglcontextlost", { preventDefault: () => {} });
  }

  restoreContext(): void {
    this.gl.lost = false;
    this.dispatch("webglcontextrestored", {});
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: this.left, top: this.top, width: this.clientWidth, height: this.clientHeight };
  }

  /** Puts the canvas somewhere else on the page — a scroll, or a layout change. */
  moveTo(left: number, top: number): void {
    this.left = left;
    this.top = top;
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}

  resize(width: number, height: number): void {
    this.clientWidth = width;
    this.clientHeight = height;
    this.width = Math.round(width * this.dpr);
    this.height = Math.round(height * this.dpr);
  }
}

/**
 * The 2D context the glyph atlas draws into. Nothing measured here reaches a
 * golden file: those frames are the ones BEFORE the WASM rasterizer lands, and
 * `FontLibrary.adopt` throws their atlases away. It still has to behave, though
 * — numbers wide enough to fill the 1024² atlas would make the fallback frames
 * warn about glyphs they could not pack, which is noise the corpus would then
 * have to explain. So: plausible metrics, and the tests prove the real
 * rasterizer is in by comparing against the shipped font itself.
 */
class FakeContext2D {
  fillStyle = "";
  font = "";
  textBaseline = "";

  fillRect(): void {}
  fillText(): void {}
  putImageData(): void {}

  createImageData(
    width: number,
    height: number,
  ): { width: number; height: number; data: Uint8ClampedArray } {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  measureText(text: string): Record<string, number> {
    const width = text.length * 8;
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 12,
      fontBoundingBoxDescent: 3,
    };
  }
}

/**
 * A WebGL2 context that accepts everything and returns a truthy handle for
 * everything. It can afford to: `gl.ts` only ever WRITES to it (buffers,
 * uniforms, draw calls), and the two things it reads back — the shader compile
 * and program link status — are exactly the two a real driver reports as `true`
 * on success. Nothing the golden tests assert on passes through here.
 *
 * Two members are real, because the renderer's behavior turns on them:
 * `isContextLost` (the state a test steers, ZAB-68) and the draw-call count
 * (how a test sees that a frame actually reached the GPU).
 */
class FakeGl {
  lost = false;
  draws = 0;
  readonly context: unknown;

  constructor() {
    const members = new Map<string, unknown>();
    this.context = new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === "isContextLost") return () => this.lost;
          if (prop === "drawElements") {
            return () => {
              this.draws++;
            };
          }
          let member = members.get(prop);
          if (member === undefined) {
            // One object per name, stable across calls: `createBuffer()` handing
            // out a new identity every time would defeat the texture cache.
            const handle = { gl: prop };
            member = () => handle;
            members.set(prop, member);
          }
          return member;
        },
      },
    );
  }
}

/** The hidden `<textarea>` the view routes real typing, IME and paste through. */
class FakeTextArea extends FakeTarget {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection: "forward" | "backward" | "none" = "none";
  spellcheck = true;
  tabIndex = 0;
  readonly style: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();
  private dom: FakeDom | null = null;

  attach(dom: FakeDom): void {
    this.dom = dom;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  setSelectionRange(start: number, end: number, direction: "forward" | "backward"): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }

  focus(): void {
    if (this.dom) this.dom.activeElement = this;
  }

  blur(): void {
    if (this.dom?.activeElement === this) this.dom.activeElement = null;
  }

  remove(): void {
    this.blur();
    if (this.dom) this.dom.editor = null;
  }
}

/**
 * The globals the renderer reaches for, and the clock it runs on. Installed
 * around one mounted view and removed with it, so a suite never leaks a fake
 * `document` into the next test.
 */
class FakeDom {
  editor: FakeTextArea | null = null;
  activeElement: unknown = null;
  readonly warnings: string[] = [];
  private readonly pads: FakePad[] = [];

  private readonly window = new FakeTarget();
  private clock = 0;
  private frames: Array<{ id: number; callback: (time: number) => void }> = [];
  private timers: Array<{ id: number; at: number; callback: () => void }> = [];
  private nextId = 1;
  private readonly saved = new Map<string, PropertyDescriptor | undefined>();
  private readonly warn = console.warn;
  private readonly error = console.error;

  install(): void {
    const body = {
      appendChild: (child: FakeTextArea) => {
        this.editor = child;
        child.attach(this);
      },
    };
    const document = {
      createElement: (tag: string) => {
        if (tag === "textarea") return new FakeTextArea();
        // The glyph atlas asks for a canvas when there is no `OffscreenCanvas`.
        return new FakeCanvas(1024, 1024, 1);
      },
      body,
    };
    // A getter, not a value: `activeElement` tracks the focus the view moves.
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => this.activeElement,
    });
    this.define("document", document);

    this.define("devicePixelRatio", GOLDEN_DPR);
    this.define("addEventListener", (type: string, listener: Listener) =>
      this.window.addEventListener(type, listener),
    );
    this.define("removeEventListener", (type: string, listener: Listener) =>
      this.window.removeEventListener(type, listener),
    );
    this.define("requestAnimationFrame", (callback: (time: number) => void) => {
      const id = this.nextId++;
      this.frames.push({ id, callback });
      return id;
    });
    this.define("cancelAnimationFrame", (id: number) => {
      this.frames = this.frames.filter((frame) => frame.id !== id);
    });
    this.define("setTimeout", (callback: () => void, ms = 0) => {
      const id = this.nextId++;
      this.timers.push({ id, at: this.clock + ms, callback });
      return id;
    });
    this.define("clearTimeout", (id: number) => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    });
    // The frame clock. Fake so a transition is measured where the test says.
    this.define("performance", { now: () => this.clock });
    // No decoder in Node — and none is needed: an image's layout comes from the
    // manifest's `width`/`height`, so the metrics are complete without pixels.
    this.define("createImageBitmap", () => new Promise(() => {}));
    // Present from the start, empty until `connectPad`: the view's mount-time
    // sync must find a working API that reports nothing, not a missing one.
    this.define("navigator", { getGamepads: () => [...this.pads] });

    console.warn = (...args: unknown[]) => {
      this.warnings.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      this.warnings.push(args.map(String).join(" "));
    };
  }

  private define(name: string, value: unknown): void {
    this.saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  uninstall(): void {
    for (const [name, descriptor] of this.saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    this.saved.clear();
    console.warn = this.warn;
    console.error = this.error;
  }

  dispatch(type: string, event: unknown): void {
    this.window.dispatch(type, event);
  }

  /**
   * Moves the clock and runs what was due: the timers first (an `autoCloseMs`
   * that expires mid-span closes its overlay before the frame that paints the
   * result), then the frames the view scheduled. Frames scheduled BY those
   * frames run on the next call, exactly as a browser would.
   */
  advance(ms: number): void {
    this.clock += ms;
    const due = this.timers.filter((timer) => timer.at <= this.clock);
    this.timers = this.timers.filter((timer) => timer.at > this.clock);
    for (const timer of due) timer.callback();
    const frames = this.frames;
    this.frames = [];
    for (const frame of frames) frame.callback(this.clock);
  }

  /**
   * Plugs in a pad shaped like a real `Gamepad` reports itself: connected, the
   * standard mapping's 17 buttons and 4 axes, all at rest. The control returned
   * mutates that state in place — a pad is a state the view POLLS, so a "press"
   * here is only ever seen by the frame `advance()` runs after it.
   */
  connectPad(): GoldenPad {
    const pad: FakePad = {
      connected: true,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      axes: [0, 0, 0, 0],
    };
    this.pads.push(pad);
    this.dispatch("gamepadconnected", {});
    return {
      press: (index) => {
        pad.buttons[index].pressed = true;
      },
      release: (index) => {
        pad.buttons[index].pressed = false;
      },
      axis: (index, value) => {
        pad.axes[index] = value;
      },
      disconnect: () => {
        pad.connected = false;
        this.dispatch("gamepaddisconnected", {});
      },
    };
  }

  /**
   * Types into the hidden field the way a browser does — the value changes and
   * an `input` event follows — which is the only path that exercises the
   * renderer's real editing model (`maxLength`, the single-line rule, the caret).
   */
  typeIntoEditor(text: string, event: "input" | "compositionupdate" = "input"): void {
    const editor = this.requireEditor();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    const caret = start + text.length;
    editor.selectionStart = caret;
    editor.selectionEnd = caret;
    editor.selectionDirection = "forward";
    editor.dispatch(event, {});
  }

  /** The composition events, which carry no value of their own — the field holds it. */
  dispatchOnEditor(event: string): void {
    this.requireEditor().dispatch(event, {});
  }

  private requireEditor(): FakeTextArea {
    const editor = this.editor;
    if (!editor) throw new Error("golden harness: nothing is focused on a TextInput");
    return editor;
  }
}

/** What `view.ts` reads off a `Gamepad`: the connected flag, buttons and axes. */
interface FakePad {
  connected: boolean;
  buttons: { pressed: boolean }[];
  axes: number[];
}

function installDom(): FakeDom {
  const dom = new FakeDom();
  dom.install();
  return dom;
}
