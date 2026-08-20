/**
 * Thin WebGL2 submission layer — the browser's equivalent of what UI Toolkit's
 * MeshWriteData is for the Unity SDK: we hand it tessellated vertices/indices
 * and a texture, it issues the draw call. One shader, one interleaved buffer.
 * No scene graph — the IR tree is the scene graph.
 */

import { type Clip, scissorBox } from "./clip.js";

/**
 * Anything this layer can upload as a texture — a glyph atlas or a decoded image.
 * Structural on purpose: the GL layer knows about pixels and versions, not about
 * what produced them.
 */
interface TextureSource {
  /** Bumped whenever the pixels change; the upload is skipped while it holds. */
  readonly version: number;
  /** Null while an async decode is still in flight (falls back to white). */
  readonly bitmap: TexImageSource | null;
}

/**
 * A geometry batch: everything sharing one texture (one draw call). The typed
 * arrays are VIEWS over the tessellator's reused buffers, live for one frame
 * (ZAB-55) — the upload below copies them into GPU memory within it.
 */
interface Batch {
  /** Null = solid geometry (bound to a built-in 1×1 white texture). */
  texture: TextureSource | null;
  /** Interleaved: x,y, u,v, r,g,b,a (logical px; colors 0..1). */
  vertices: Float32Array;
  /**
   * 32-bit on purpose (ZAB-68): `UNSIGNED_SHORT` wraps mod 65536 past 65.535
   * vertices in ONE batch — ≈2.260 rounded rects or ≈16.384 glyphs under a
   * single clip — and the geometry scrambles with no warning. `UNSIGNED_INT`
   * is core in WebGL2, so the only cost is the wider index buffer.
   */
  indices: Uint32Array;
  /** Clipping region for this draw call; null = unclipped (decision 2026-08-11). */
  clip?: Clip | null;
}

const VERTEX_FLOATS = 8;

const VERT_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_pos;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_pos = a_pos;
  v_uv = a_uv;
  v_color = a_color;
}`;

/**
 * The rounded half of clipping: the scissor test already cut everything outside
 * the clip rect, so all that is left is discarding the four corners, as a signed
 * distance to the rounded box faded over one device pixel (`fwidth`) — the same
 * antialiased edge the rest of the geometry gets from MSAA. `u_clipRadius <= 0`
 * (every clip that isn't rounded) costs one uniform branch and nothing else.
 */
const FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_pos;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_tex;
uniform vec4 u_clipRect;
uniform float u_clipRadius;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv) * v_color;
  if (u_clipRadius > 0.0) {
    vec2 halfSize = u_clipRect.zw * 0.5;
    vec2 q = abs(v_pos - (u_clipRect.xy + halfSize)) - (halfSize - vec2(u_clipRadius));
    float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - u_clipRadius;
    float aa = max(fwidth(d), 0.0001);
    outColor.a *= 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
  }
}`;

class GLRenderer {
  private readonly gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vbo!: WebGLBuffer;
  private ibo!: WebGLBuffer;
  private uResolution!: WebGLUniformLocation;
  private uClipRect!: WebGLUniformLocation;
  private uClipRadius!: WebGLUniformLocation;
  private whiteTexture!: WebGLTexture;
  private readonly textures = new Map<TextureSource, { texture: WebGLTexture; version: number }>();
  /** False while the context is lost (or was already lost at construction). */
  private ready = false;
  private disposed = false;
  private readonly handleLost: (event: Event) => void;
  private readonly handleRestored: () => void;

  /**
   * `onRestore` fires after a lost context comes back and its resources are
   * rebuilt: the view has to repaint, or the canvas stays blank until something
   * else happens to ask for a frame.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onRestore?: () => void,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error("zabloo renderer: WebGL2 is not available");
    this.gl = gl;

    // A tab backgrounded on mobile, a GPU reset or a driver hiccup drops the
    // context: every GL object dies and every call turns into a no-op, so
    // without this the canvas stays blank forever (ZAB-68).
    this.handleLost = (event: Event) => {
      // Without preventDefault the browser never fires `webglcontextrestored`.
      event.preventDefault();
      this.ready = false;
      // Those textures are gone with the context; forgetting them is what makes
      // the next draw re-create AND re-upload them (the atlases included).
      this.textures.clear();
    };
    this.handleRestored = () => {
      if (this.disposed) return;
      this.initResources();
      this.onRestore?.();
    };
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);

    this.initResources();
  }

  /**
   * Builds every GPU object and the state that outlives a frame. Runs in the
   * constructor and again on every restore: the context comes back EMPTY — the
   * program, the buffers, the attribute wiring and the textures all have to be
   * made from scratch. Skipped while the context is lost (a canvas can be
   * mounted on one already gone), and the restore then picks it up.
   */
  private initResources(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;

    this.program = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.vbo = gl.createBuffer() as WebGLBuffer;
    this.ibo = gl.createBuffer() as WebGLBuffer;
    this.uResolution = gl.getUniformLocation(this.program, "u_resolution") as WebGLUniformLocation;
    this.uClipRect = gl.getUniformLocation(this.program, "u_clipRect") as WebGLUniformLocation;
    this.uClipRadius = gl.getUniformLocation(this.program, "u_clipRadius") as WebGLUniformLocation;

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const stride = VERTEX_FLOATS * 4;
    bindAttrib(gl, this.program, "a_pos", 2, stride, 0);
    bindAttrib(gl, this.program, "a_uv", 2, stride, 8);
    bindAttrib(gl, this.program, "a_color", 4, stride, 16);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.whiteTexture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    setTexParams(gl);
    this.ready = true;
  }

  /** Renders the batches at the given logical size (canvas backing = device px). */
  draw(
    batches: Batch[],
    logicalWidth: number,
    logicalHeight: number,
    clearColor: [number, number, number, number],
  ): void {
    const gl = this.gl;
    // Nothing to draw with while the context is down — the frame is dropped and
    // the restore repaints it. `isContextLost` is checked too: the loss event is
    // asynchronous, so the flag can still say ready inside the same frame.
    if (!this.ready || gl.isContextLost()) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...clearColor);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, logicalWidth, logicalHeight);

    // Batches arrive grouped by clip (same region → same object), so the state
    // only changes at group boundaries.
    let currentClip: Clip | null | undefined;
    const dpr = logicalWidth > 0 ? this.canvas.width / logicalWidth : 1;

    for (const batch of batches) {
      if (batch.indices.length === 0) continue;
      const clip = batch.clip ?? null;
      if (clip !== currentClip) {
        this.applyClip(clip, dpr);
        currentClip = clip;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.textureFor(batch.texture));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, batch.vertices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, batch.indices.length, gl.UNSIGNED_INT, 0);
    }
    if (currentClip) this.applyClip(null, dpr);
  }

  /**
   * Clipping in two halves: the scissor box cuts the rect (free, exact — the
   * inset border guarantees nothing paints outside a layout rect, so it can
   * never cut a border), and the shader discards the rounded corners.
   */
  private applyClip(clip: Clip | null, dpr: number): void {
    const gl = this.gl;
    if (!clip) {
      gl.disable(gl.SCISSOR_TEST);
      gl.uniform1f(this.uClipRadius, 0);
      return;
    }
    const box = scissorBox(clip, this.canvas.width, this.canvas.height, dpr);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(box.x, box.y, box.width, box.height);
    gl.uniform4f(this.uClipRect, clip.x, clip.y, clip.width, clip.height);
    gl.uniform1f(this.uClipRadius, clip.radius);
  }

  /** Drops a source's texture (an asset evicted from the cache on hot-update). */
  evict(source: TextureSource): void {
    const entry = this.textures.get(source);
    if (!entry) return;
    if (this.ready) this.gl.deleteTexture(entry.texture);
    this.textures.delete(source);
  }

  /**
   * Releases every GPU resource this renderer owns (the view's `dispose`), and
   * stops listening: a context that comes back after this must NOT rebuild
   * anything. Idempotent, and safe on a lost context — there the driver already
   * dropped every object, so deleting them would be aiming at dead handles.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    const gl = this.gl;
    if (this.ready && !gl.isContextLost()) {
      for (const entry of this.textures.values()) gl.deleteTexture(entry.texture);
      gl.deleteTexture(this.whiteTexture);
      gl.deleteBuffer(this.vbo);
      gl.deleteBuffer(this.ibo);
      gl.deleteProgram(this.program);
    }
    this.textures.clear();
    this.ready = false;
  }

  /** Uploads (or re-uploads, if the pixels changed) a source's bitmap as a texture. */
  private textureFor(source: TextureSource | null): WebGLTexture {
    const bitmap = source?.bitmap;
    if (!source || !bitmap) return this.whiteTexture;
    const gl = this.gl;
    const entry = this.textures.get(source) ?? {
      texture: gl.createTexture() as WebGLTexture,
      version: -1,
    };
    this.textures.set(source, entry);
    if (entry.version !== source.version) {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      setTexParams(gl);
      entry.version = source.version;
    }
    return entry.texture;
  }
}

function bindAttrib(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  size: number,
  stride: number,
  offset: number,
): void {
  const location = gl.getAttribLocation(program, name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

function setTexParams(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * The linked program is the only thing kept: the shader objects are dead weight
 * once the link copied what it needed, and nothing here ever compiles again — so
 * the `finally` releases them on every path, success or throw (ZAB-68).
 */
function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`zabloo renderer: shader error — ${log}`);
    }
    return shader;
  };
  const shaders: WebGLShader[] = [];
  try {
    shaders.push(compile(gl.VERTEX_SHADER, vertSrc));
    shaders.push(compile(gl.FRAGMENT_SHADER, fragSrc));
    const program = gl.createProgram() as WebGLProgram;
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    for (const shader of shaders) gl.detachShader(program, shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`zabloo renderer: link error — ${log}`);
    }
    return program;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

export type { Batch, TextureSource };
export { GLRenderer };
