/**
 * Thin WebGL2 submission layer — the browser's equivalent of what UI Toolkit's
 * MeshWriteData is for the Unity SDK: we hand it tessellated vertices/indices
 * and a texture, it issues the draw call. One shader, one interleaved buffer.
 * No scene graph — the IR tree is the scene graph.
 */

import type { GlyphAtlas } from "./glyphs.js";

/** A geometry batch: everything sharing one texture (one draw call). */
export interface Batch {
  /** Null = solid geometry (bound to a built-in 1×1 white texture). */
  atlas: GlyphAtlas | null;
  /** Interleaved: x,y, u,v, r,g,b,a (logical px; colors 0..1). */
  vertices: number[];
  indices: number[];
}

const VERTEX_FLOATS = 8;

const VERT_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv) * v_color;
}`;

export class GLRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private readonly uResolution: WebGLUniformLocation;
  private readonly whiteTexture: WebGLTexture;
  private readonly atlasTextures = new Map<
    GlyphAtlas,
    { texture: WebGLTexture; version: number }
  >();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error("zabloo renderer: WebGL2 is not available");
    this.gl = gl;

    this.program = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.vbo = gl.createBuffer() as WebGLBuffer;
    this.ibo = gl.createBuffer() as WebGLBuffer;
    this.uResolution = gl.getUniformLocation(this.program, "u_resolution") as WebGLUniformLocation;

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
  }

  /** Renders the batches at the given logical size (canvas backing = device px). */
  draw(
    batches: Batch[],
    logicalWidth: number,
    logicalHeight: number,
    clearColor: [number, number, number, number],
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...clearColor);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, logicalWidth, logicalHeight);

    for (const batch of batches) {
      if (batch.indices.length === 0) continue;
      gl.bindTexture(gl.TEXTURE_2D, this.textureFor(batch.atlas));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(batch.vertices), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(batch.indices), gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, batch.indices.length, gl.UNSIGNED_SHORT, 0);
    }
  }

  /** Uploads (or re-uploads, if the atlas grew) the atlas bitmap as a texture. */
  private textureFor(atlas: GlyphAtlas | null): WebGLTexture {
    if (atlas === null) return this.whiteTexture;
    const gl = this.gl;
    let entry = this.atlasTextures.get(atlas);
    if (!entry) {
      entry = { texture: gl.createTexture() as WebGLTexture, version: -1 };
      this.atlasTextures.set(atlas, entry);
    }
    if (entry.version !== atlas.version) {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      setTexParams(gl);
      entry.version = atlas.version;
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

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`zabloo renderer: shader error — ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`zabloo renderer: link error — ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
