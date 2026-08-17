/**
 * The GPU robustness of the submission layer (ZAB-68) — the failures a browser
 * actually produces and that no other suite can reach: a lost context, the
 * resources it takes with it, and the objects the layer must not leak.
 *
 * The fake context here is instrumented where the golden harness's is not: it
 * hands out DISTINCT objects per creation (so a test can tell a rebuilt program
 * from the old one), records the calls, and can be told to lose itself.
 */

import { describe, expect, it } from "vitest";
import { type Batch, GLRenderer, type TextureSource } from "./gl.js";

/** One call as the fake recorded it: the name, and the arguments that matter. */
interface Call {
  name: string;
  args: unknown[];
}

/** A GL object the fake handed out — unique per creation, tagged with its kind. */
interface GLObject {
  kind: string;
  id: number;
}

class FakeGL {
  lost = false;
  readonly calls: Call[] = [];
  private nextId = 1;

  readonly context = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => {
      switch (prop) {
        case "isContextLost":
          return () => this.lost;
        // The two reads a real driver answers `true` to on success.
        case "getShaderParameter":
        case "getProgramParameter":
          return () => true;
        case "getShaderInfoLog":
        case "getProgramInfoLog":
          return () => "";
        case "getUniformLocation":
          return (_program: unknown, name: string) => this.create(`uniform:${name}`);
        case "getAttribLocation":
          return () => 0;
        case "createShader":
        case "createProgram":
        case "createBuffer":
        case "createTexture":
          return (...args: unknown[]) => {
            this.calls.push({ name: prop, args });
            return this.create(prop);
          };
        default:
          // Everything else is a write: recorded and swallowed. Enum constants
          // (gl.TRIANGLES, gl.UNSIGNED_INT…) are read as properties, so they
          // answer with their own name — which is what the assertions read.
          if (prop.toUpperCase() === prop) return prop;
          return (...args: unknown[]) => {
            this.calls.push({ name: prop, args });
          };
      }
    },
  });

  private create(kind: string): GLObject {
    return { kind, id: this.nextId++ };
  }

  named(name: string): Call[] {
    return this.calls.filter((call) => call.name === name);
  }

  count(name: string): number {
    return this.named(name).length;
  }

  /** Forgets everything recorded so far — "from here on" for the next assertion. */
  clear(): void {
    this.calls.length = 0;
  }
}

/** The canvas the renderer mounts on: a listener registry and a backing size. */
class FakeCanvas {
  width = 200;
  height = 100;
  readonly gl = new FakeGL();
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  getContext(): unknown {
    return this.gl.context;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  /** The GPU dropping the context: the flag first, the event after (as a browser does). */
  lose(): { defaultPrevented: boolean } {
    this.gl.lost = true;
    const event = {
      defaultPrevented: false,
      preventDefault(): void {
        this.defaultPrevented = true;
      },
    };
    this.dispatch("webglcontextlost", event);
    return event;
  }

  restore(): void {
    this.gl.lost = false;
    this.dispatch("webglcontextrestored", {});
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function setup(): { canvas: FakeCanvas; gl: FakeGL; renderer: GLRenderer; restores: number } {
  const canvas = new FakeCanvas();
  const state = { canvas, gl: canvas.gl, restores: 0 } as {
    canvas: FakeCanvas;
    gl: FakeGL;
    renderer: GLRenderer;
    restores: number;
  };
  state.renderer = new GLRenderer(canvas as unknown as HTMLCanvasElement, () => {
    state.restores++;
  });
  return state;
}

/** A texture source, as an atlas or a decoded image looks to this layer. */
function source(version = 1): TextureSource {
  return { version, bitmap: {} as TexImageSource };
}

function batch(texture: TextureSource | null = null): Batch {
  return {
    texture,
    vertices: new Float32Array(8 * 4),
    indices: new Uint32Array([0, 1, 2, 2, 3, 0]),
    clip: null,
  };
}

const CLEAR: [number, number, number, number] = [0, 0, 0, 1];

describe("index space (ZAB-68)", () => {
  it("draws 32-bit indices, so a batch past 65.535 vertices cannot wrap", () => {
    const { gl, renderer } = setup();
    gl.clear();

    renderer.draw([batch()], 200, 100, CLEAR);

    const draw = gl.named("drawElements")[0];
    expect(draw.args[2]).toBe("UNSIGNED_INT");
    // The index buffer is uploaded as the 32-bit array the tessellator fills.
    const upload = gl.named("bufferData").at(-1);
    expect(upload?.args[1]).toBeInstanceOf(Uint32Array);
  });
});

describe("shader lifetime (ZAB-68)", () => {
  it("deletes both shaders once the program is linked", () => {
    const { gl } = setup();

    expect(gl.count("createShader")).toBe(2);
    expect(gl.count("deleteShader")).toBe(2);
    // Detached first: a shader still attached is kept alive by the program.
    expect(gl.count("detachShader")).toBe(2);
  });
});

describe("context loss (ZAB-68)", () => {
  it("prevents the default on the loss event, or the context never comes back", () => {
    const { canvas } = setup();

    expect(canvas.lose().defaultPrevented).toBe(true);
  });

  it("submits nothing while the context is lost", () => {
    const { canvas, gl, renderer } = setup();
    canvas.lose();
    gl.clear();

    renderer.draw([batch()], 200, 100, CLEAR);

    expect(gl.count("drawElements")).toBe(0);
    expect(gl.count("bufferData")).toBe(0);
  });

  it("rebuilds the program, the buffers and the white texture on restore", () => {
    const { canvas, gl, renderer } = setup();
    canvas.lose();
    gl.clear();

    canvas.restore();

    expect(gl.count("createProgram")).toBe(1);
    expect(gl.count("createBuffer")).toBe(2);
    // The 1×1 white texture solid geometry binds to.
    expect(gl.count("createTexture")).toBe(1);
    // And the frame that follows reaches the GPU again.
    renderer.draw([batch()], 200, 100, CLEAR);
    expect(gl.count("drawElements")).toBe(1);
  });

  it("re-uploads the atlases and images the lost context took with it", () => {
    const { canvas, gl, renderer } = setup();
    const atlas = source();
    renderer.draw([batch(atlas)], 200, 100, CLEAR);
    // Steady state: the same source at the same version uploads once, not per frame.
    renderer.draw([batch(atlas)], 200, 100, CLEAR);
    expect(gl.count("texImage2D")).toBe(2); // white texture + the atlas

    canvas.lose();
    canvas.restore();
    gl.clear();
    renderer.draw([batch(atlas)], 200, 100, CLEAR);

    // The pixels are back on the GPU even though the source never changed: the
    // version cache cannot be trusted across a loss, the textures are gone.
    expect(gl.count("texImage2D")).toBe(1);
  });

  it("asks the view to repaint once the resources are back", () => {
    const state = setup();
    state.canvas.lose();
    expect(state.restores).toBe(0);

    state.canvas.restore();

    expect(state.restores).toBe(1);
  });

  it("initializes on the restore when the context was already lost at mount", () => {
    const canvas = new FakeCanvas();
    canvas.gl.lost = true;

    const renderer = new GLRenderer(canvas as unknown as HTMLCanvasElement);
    expect(canvas.gl.count("createProgram")).toBe(0);
    renderer.draw([batch()], 200, 100, CLEAR);
    expect(canvas.gl.count("drawElements")).toBe(0);

    canvas.restore();
    renderer.draw([batch()], 200, 100, CLEAR);

    expect(canvas.gl.count("createProgram")).toBe(1);
    expect(canvas.gl.count("drawElements")).toBe(1);
  });
});

describe("dispose (ZAB-68)", () => {
  it("releases every GPU object it owns and stops listening", () => {
    const { canvas, gl, renderer } = setup();
    renderer.draw([batch(source())], 200, 100, CLEAR);
    gl.clear();

    renderer.dispose();

    expect(gl.count("deleteProgram")).toBe(1);
    expect(gl.count("deleteBuffer")).toBe(2);
    // The white texture and the atlas's.
    expect(gl.count("deleteTexture")).toBe(2);
    expect(canvas.listenerCount("webglcontextlost")).toBe(0);
    expect(canvas.listenerCount("webglcontextrestored")).toBe(0);
  });

  it("deletes nothing on a lost context — the driver already took it all", () => {
    const { canvas, gl, renderer } = setup();
    renderer.draw([batch(source())], 200, 100, CLEAR);
    canvas.lose();
    gl.clear();

    expect(() => renderer.dispose()).not.toThrow();
    expect(gl.count("deleteProgram")).toBe(0);
    expect(gl.count("deleteTexture")).toBe(0);
  });

  it("is idempotent: a second dispose releases nothing twice", () => {
    const { gl, renderer } = setup();
    renderer.dispose();
    gl.clear();

    renderer.dispose();

    expect(gl.calls).toEqual([]);
  });

  it("never rebuilds after a restore that arrives late", () => {
    const { canvas, gl, renderer } = setup();
    renderer.dispose();
    gl.clear();

    // Disposing removed the listeners, so this reaches nobody — but a canvas the
    // host kept around could still fire it at whatever listens next.
    canvas.restore();
    renderer.draw([batch()], 200, 100, CLEAR);

    expect(gl.calls).toEqual([]);
  });
});
