/**
 * The web tessellator — same geometry as the Unity SDK's Tessellation.cs:
 * implicit paint (style → rounded-rect fan, clockwise, y down), glyph quads from
 * the self-owned atlas and textured quads for images. Emits into batches (solids
 * + one per atlas + one per image texture), grouped by clipping region.
 */

import type { ImageFit } from "@zabloo/format";
import type { ImageAsset } from "./assets.js";
import type { Clip } from "./clip.js";
import type { Batch, TextureSource } from "./gl.js";
import type { GlyphAtlas } from "./glyphs.js";
import type { Rect } from "./layout.js";

export type Color = [number, number, number, number];

const CORNER_SEGMENTS = 6;

/** Untinted: the shader multiplies texture × vertex color, so white = the pixels as-is. */
const UNTINTED: Color = [1, 1, 1, 1];

/**
 * The mutable store behind one batch: growable typed buffers plus write
 * cursors, kept and reused across frames (ZAB-55) — `batches()` hands out
 * views over the live region, so a steady-state frame reallocates nothing.
 */
interface BatchStore {
  texture: TextureSource | null;
  clip: Clip | null;
  vertices: Float32Array;
  /** Floats written so far (8 per vertex). */
  floats: number;
  /** 32-bit: a batch past 65.535 vertices would wrap 16-bit indices (ZAB-68). */
  indices: Uint32Array;
  /** Indices written so far. */
  count: number;
}

/**
 * Everything painted under one clipping region, in one contiguous run of the
 * paint pass. Batching is per group rather than per frame: a clip is GL state,
 * so geometry under different clips can't share a draw call.
 */
interface ClipGroup {
  clip: Clip | null;
  solid: BatchStore;
  images: Map<ImageAsset, BatchStore>;
  texts: Map<GlyphAtlas, BatchStore>;
}

/** How an Image node paints — the resolved style the view hands down. */
export interface ImagePaint {
  /** Default: "contain". */
  fit?: ImageFit;
  /** Tint × inherited opacity, already resolved. Default: opaque white (untinted). */
  color?: Color;
  /** Rounds the painted image, like the node's background. Default: 0. */
  radius?: number;
}

export class GeometryBuilder {
  private readonly groups: ClipGroup[] = [];
  private group: ClipGroup;
  /** Retired stores/groups waiting for the next frame — buffers kept (ZAB-55). */
  private readonly batchPool: BatchStore[] = [];
  private readonly groupPool: ClipGroup[] = [];
  /** `growthCount` when this frame started — see `growths` (ZAB-73). */
  private growthsAtReset = growthCount();

  /** `dpr` lets glyph quads snap to the physical pixel grid (crisp text). */
  constructor(private dpr: number = 1) {
    this.group = this.openGroup(null);
  }

  /**
   * Rewinds for a new frame, keeping every buffer: the view holds ONE builder
   * for its whole life, so a steady animation frame writes into last frame's
   * arrays instead of reallocating the scene's geometry (ZAB-55).
   */
  reset(dpr: number = this.dpr): this {
    this.dpr = dpr;
    this.growthsAtReset = growthCount();
    for (const group of this.groups) {
      this.recycle(group.solid);
      for (const batch of group.images.values()) this.recycle(batch);
      for (const batch of group.texts.values()) this.recycle(batch);
      group.images.clear();
      group.texts.clear();
      this.groupPool.push(group);
    }
    this.groups.length = 0;
    this.group = this.openGroup(null);
    return this;
  }

  /**
   * Vertex/index buffers that had to grow since this frame's `reset` (ZAB-73).
   *
   * The number a steady animation frame must hold at ZERO: the buffers are the
   * view's, kept across frames on purpose, so a frame that reallocates them is
   * either painting something new or has lost the reuse ZAB-55 bought. That is
   * exactly the regression CI could not see before — draw calls and vertices
   * stay identical while the allocator does all the work.
   */
  growths(): number {
    return growthCount() - this.growthsAtReset;
  }

  private recycle(batch: BatchStore): void {
    batch.texture = null;
    batch.clip = null;
    batch.floats = 0;
    batch.count = 0;
    this.batchPool.push(batch);
  }

  private acquire(texture: TextureSource | null, clip: Clip | null): BatchStore {
    const pooled = this.batchPool.pop();
    if (pooled) {
      pooled.texture = texture;
      pooled.clip = clip;
      return pooled;
    }
    return {
      texture,
      clip,
      vertices: new Float32Array(1024),
      floats: 0,
      indices: new Uint32Array(512),
      count: 0,
    };
  }

  /**
   * Enters a clipping region (null = unclipped). Consecutive calls with the same
   * region keep filling the current group; anything else opens a new one, which
   * is what keeps painter's order across regions: a group is drawn as a whole,
   * so re-entering an EARLIER group would sneak geometry under what was already
   * painted over it.
   */
  setClip(clip: Clip | null): void {
    if (clip === this.group.clip) return;
    this.group = this.openGroup(clip);
  }

  /**
   * Starts a new group unconditionally: what a PAINT ROOT needs, and the only
   * thing `setClip` cannot express — two roots may share a clipping region (both
   * unclipped, typically) and still have to be ordered one after the other.
   *
   * Without it an overlay entry would keep filling the tree's group, and since a
   * group draws solids before text, the tree's glyphs would come out ON TOP of an
   * opaque panel floating above them (found in the preview, ZAB-25).
   */
  startRoot(clip: Clip | null = null): void {
    this.group = this.openGroup(clip);
  }

  private openGroup(clip: Clip | null): ClipGroup {
    const group = this.groupPool.pop() ?? {
      clip,
      solid: undefined as unknown as BatchStore,
      images: new Map<ImageAsset, BatchStore>(),
      texts: new Map<GlyphAtlas, BatchStore>(),
    };
    group.clip = clip;
    group.solid = this.acquire(null, clip);
    this.groups.push(group);
    return group;
  }

  /**
   * Groups in paint order and, inside each, solids → images → text: backgrounds
   * render under images, and glyphs on top of both. Each distinct image is its
   * own texture, hence its own draw call: the single-batch invariant only ever
   * held for solids + glyph atlas.
   *
   * Each `Batch` is a VIEW over this frame's live region of a reused buffer:
   * valid until the next `reset`, which is one whole frame — exactly the life
   * the GL submission and the stats need.
   */
  batches(): Batch[] {
    const out: Batch[] = [];
    for (const group of this.groups) {
      out.push(liveView(group.solid));
      for (const batch of group.images.values()) out.push(liveView(batch));
      for (const batch of group.texts.values()) out.push(liveView(batch));
    }
    return out;
  }

  roundedRect(rect: Rect, radius: number, color: Color): void {
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const r = Math.min(radius, rect.width * 0.5, rect.height * 0.5);
    const batch = this.group.solid;
    const base = batch.floats / 8;

    if (r <= 0.01) {
      pushVertex(batch, rect.x, rect.y, 0, 0, color);
      pushVertex(batch, rect.x + rect.width, rect.y, 0, 0, color);
      pushVertex(batch, rect.x + rect.width, rect.y + rect.height, 0, 0, color);
      pushVertex(batch, rect.x, rect.y + rect.height, 0, 0, color);
      pushQuadIndices(batch, base);
      return;
    }

    // Perimeter: 4 corner arcs traversed clockwise on screen (y down), fan
    // around the centroid — identical to the SDK.
    pushVertex(batch, rect.x + rect.width / 2, rect.y + rect.height / 2, 0, 0, color);
    fillPerimeter(rect, r);
    for (let i = 0; i < PERIMETER_POINTS; i++) {
      pushVertex(batch, perimeterX[i], perimeterY[i], 0, 0, color);
    }
    for (let i = 0; i < PERIMETER_POINTS; i++) {
      pushIndex(batch, base);
      pushIndex(batch, base + 1 + i);
      pushIndex(batch, base + 1 + ((i + 1) % PERIMETER_POINTS));
    }
  }

  /**
   * INSET border: a ring between the rect edge and the edge inset by `width`
   * (CSS border-box model — nothing paints outside the layout rect, so
   * hit-testing on layout rects stays honest and clipping never cuts a border).
   */
  roundedRectBorder(rect: Rect, radius: number, width: number, color: Color): void {
    if (!(rect.width > 0) || !(rect.height > 0) || !(width > 0)) return;
    const r = Math.min(radius, rect.width * 0.5, rect.height * 0.5);

    // Border thick enough to cover the whole rect: just fill it.
    if (width * 2 >= Math.min(rect.width, rect.height)) {
      this.roundedRect(rect, r, color);
      return;
    }

    const inner: Rect = {
      x: rect.x + width,
      y: rect.y + width,
      width: rect.width - width * 2,
      height: rect.height - width * 2,
    };
    const batch = this.group.solid;
    const base = batch.floats / 8;

    // Outer then inner perimeter, same parametrization → stitch quads. The
    // scratch is refilled between the two loops, so each is consumed before
    // the other lands. (radius 0 degenerates corner arcs to repeated points —
    // harmless.)
    fillPerimeter(rect, r);
    for (let i = 0; i < PERIMETER_POINTS; i++) {
      pushVertex(batch, perimeterX[i], perimeterY[i], 0, 0, color);
    }
    fillPerimeter(inner, Math.max(0, r - width));
    for (let i = 0; i < PERIMETER_POINTS; i++) {
      pushVertex(batch, perimeterX[i], perimeterY[i], 0, 0, color);
    }

    const count = PERIMETER_POINTS;
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      pushIndex(batch, base + i);
      pushIndex(batch, base + next);
      pushIndex(batch, base + count + next);
      pushIndex(batch, base + count + next);
      pushIndex(batch, base + count + i);
      pushIndex(batch, base + i);
    }
  }

  /**
   * Textured geometry for an Image node. Every `fit` mode paints INSIDE the layout
   * rect — `cover` crops through the UVs instead of overflowing — which preserves
   * the invariant that nothing paints outside the rect (the same reason borders are
   * inset): hit-testing on layout rects stays honest, and no clipping is needed.
   *
   * A radius rounds the painted image the same way it rounds a background, so an
   * image inside a rounded panel does not poke out at the corners. The geometry is
   * then the rounded-rect fan, with UVs derived from each vertex's position — one
   * source of truth for the shape, shared with `roundedRect`.
   *
   * Paints nothing while the decode is in flight; layout already reserved the
   * space from the manifest's dimensions, and the node's own background shows
   * through in the meantime (the loading placeholder is authored, not a state).
   */
  image(rect: Rect, asset: ImageAsset, paint: ImagePaint = {}): void {
    if (asset.bitmap === null) return;
    const quad = fitImage(rect, asset.width, asset.height, paint.fit);
    if (quad === null) return;

    const batch = this.imageBatchFor(asset);
    const base = batch.floats / 8;
    const color = paint.color ?? UNTINTED;
    const { rect: box, uv } = quad;
    const r = Math.min(paint.radius ?? 0, box.width * 0.5, box.height * 0.5);

    if (r <= 0.01) {
      const x1 = box.x + box.width;
      const y1 = box.y + box.height;
      const u1 = uv.x + uv.width;
      const v1 = uv.y + uv.height;
      // v grows downward, like the atlas: texImage2D uploads rows top-first.
      pushVertex(batch, box.x, box.y, uv.x, uv.y, color);
      pushVertex(batch, x1, box.y, u1, uv.y, color);
      pushVertex(batch, x1, y1, u1, v1, color);
      pushVertex(batch, box.x, y1, uv.x, v1, color);
      pushQuadIndices(batch, base);
      return;
    }

    // Rounded: same fan as a rounded-rect background, sampling the texture at
    // each vertex's relative position inside the painted box.
    const uAt = (x: number): number => uv.x + ((x - box.x) / box.width) * uv.width;
    const vAt = (y: number): number => uv.y + ((y - box.y) / box.height) * uv.height;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    pushVertex(batch, cx, cy, uAt(cx), vAt(cy), color);
    fillPerimeter(box, r);
    for (let i = 0; i < PERIMETER_POINTS; i++) {
      const x = perimeterX[i];
      const y = perimeterY[i];
      pushVertex(batch, x, y, uAt(x), vAt(y), color);
    }
    for (let i = 0; i < PERIMETER_POINTS; i++) {
      pushIndex(batch, base);
      pushIndex(batch, base + 1 + i);
      pushIndex(batch, base + 1 + ((i + 1) % PERIMETER_POINTS));
    }
  }

  private imageBatchFor(asset: ImageAsset): BatchStore {
    let batch = this.group.images.get(asset);
    if (!batch) {
      batch = this.acquire(asset, this.group.clip);
      this.group.images.set(asset, batch);
    }
    return batch;
  }

  /** Single-line text run starting at (originX, originY) — top-left of the run. */
  text(originX: number, originY: number, content: string, atlas: GlyphAtlas, color: Color): void {
    const batch = this.batchFor(atlas);
    let pen = originX;
    const baseline = originY + atlas.ascent;
    let previous = "";

    for (const char of content) {
      const glyph = atlas.get(char);
      if (!glyph) continue;
      // Same kerning `measure` applied — otherwise the painted run would not
      // fit the box the layout pass reserved for it.
      if (previous !== "") pen += atlas.kern(previous, char);
      previous = char;
      if (glyph.hasQuad) {
        // Snap the glyph origin to the physical pixel grid: fractional layout
        // positions + LINEAR filtering would blur the glyph by half a pixel.
        // The extents are integer device px already (atlas raster scale = dpr).
        const x0 = Math.round((pen + glyph.minX) * this.dpr) / this.dpr;
        const y0 = Math.round((baseline - glyph.maxY) * this.dpr) / this.dpr;
        const x1 = x0 + (glyph.maxX - glyph.minX);
        const y1 = y0 + (glyph.maxY - glyph.minY);
        const base = batch.floats / 8;
        // Atlas v grows downward (texImage2D row order) → v0 = glyph top.
        pushVertex(batch, x0, y0, glyph.u0, glyph.v0, color);
        pushVertex(batch, x1, y0, glyph.u1, glyph.v0, color);
        pushVertex(batch, x1, y1, glyph.u1, glyph.v1, color);
        pushVertex(batch, x0, y1, glyph.u0, glyph.v1, color);
        pushQuadIndices(batch, base);
      }
      pen += glyph.advance;
    }
  }

  private batchFor(atlas: GlyphAtlas): BatchStore {
    let batch = this.group.texts.get(atlas);
    if (!batch) {
      batch = this.acquire(atlas, this.group.clip);
      this.group.texts.set(atlas, batch);
    }
    return batch;
  }
}

/**
 * Largest rect with the source's aspect ratio that fits inside `rect`, centered
 * (CSS `object-fit: contain`). Null when either side has no usable size — a
 * manifest without dimensions and a decode still in flight, or a collapsed rect.
 */
export function aspectFit(rect: Rect, width: number, height: number): Rect | null {
  if (!(rect.width > 0) || !(rect.height > 0) || !(width > 0) || !(height > 0)) return null;
  const scale = Math.min(rect.width / width, rect.height / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  return {
    x: rect.x + (rect.width - fittedWidth) / 2,
    y: rect.y + (rect.height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

/** The painted box and the slice of the texture it samples (both in 0..1 for the UVs). */
export interface ImageQuad {
  rect: Rect;
  uv: Rect;
}

/** The whole texture — what every mode but `cover` samples. */
const FULL_UV: Rect = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Resolves a `fit` into the box to paint and the UV window to sample. `contain`
 * shrinks the box (letterbox) and `cover` shrinks the UV window (crop): both keep
 * the aspect ratio, and neither ever paints outside `rect`. `stretch` takes the
 * whole box and the whole texture, distorting on purpose.
 *
 * Null when either side has no usable size — a manifest without dimensions and a
 * decode still in flight, or a collapsed rect.
 */
export function fitImage(
  rect: Rect,
  width: number,
  height: number,
  fit: ImageFit = "contain",
): ImageQuad | null {
  if (!(rect.width > 0) || !(rect.height > 0) || !(width > 0) || !(height > 0)) return null;
  if (fit === "stretch") return { rect, uv: FULL_UV };
  if (fit === "cover") {
    const scale = Math.max(rect.width / width, rect.height / height);
    // Visible slice of the source, in source px → UV fractions, centered.
    const u = Math.min(1, rect.width / scale / width);
    const v = Math.min(1, rect.height / scale / height);
    return { rect, uv: { x: (1 - u) / 2, y: (1 - v) / 2, width: u, height: v } };
  }
  const fitted = aspectFit(rect, width, height);
  return fitted === null ? null : { rect: fitted, uv: FULL_UV };
}

/** Applies an inherited opacity to a color (per-vertex alpha, decision 2026-08-06). */
export function fade(color: Color, opacity: number): Color {
  return opacity >= 1 ? color : [color[0], color[1], color[2], color[3] * opacity];
}

/** The live region of a store, in the `Batch` shape the GL layer consumes. */
function liveView(store: BatchStore): Batch {
  return {
    texture: store.texture,
    vertices: store.vertices.subarray(0, store.floats),
    indices: store.indices.subarray(0, store.count),
    clip: store.clip,
  };
}

/**
 * Buffer reallocations since the module loaded. A plain counter, shared by every
 * builder on the page: a builder records it at `reset` and reports the delta, so
 * no per-batch bookkeeping rides along the write path (`pushVertex` is the
 * hottest function in the renderer).
 */
let growths = 0;

function growthCount(): number {
  return growths;
}

function growFloats(array: Float32Array, needed: number): Float32Array {
  let capacity = array.length * 2;
  while (capacity < needed) capacity *= 2;
  const next = new Float32Array(capacity);
  next.set(array);
  growths++;
  return next;
}

function growIndices(array: Uint32Array, needed: number): Uint32Array {
  let capacity = array.length * 2;
  while (capacity < needed) capacity *= 2;
  const next = new Uint32Array(capacity);
  next.set(array);
  growths++;
  return next;
}

function pushVertex(
  batch: BatchStore,
  x: number,
  y: number,
  u: number,
  v: number,
  color: Color,
): void {
  if (batch.floats + 8 > batch.vertices.length) {
    batch.vertices = growFloats(batch.vertices, batch.floats + 8);
  }
  const out = batch.vertices;
  let at = batch.floats;
  out[at++] = x;
  out[at++] = y;
  out[at++] = u;
  out[at++] = v;
  out[at++] = color[0];
  out[at++] = color[1];
  out[at++] = color[2];
  out[at++] = color[3];
  batch.floats = at;
}

function pushIndex(batch: BatchStore, value: number): void {
  if (batch.count >= batch.indices.length) {
    batch.indices = growIndices(batch.indices, batch.count + 1);
  }
  batch.indices[batch.count++] = value;
}

/** The two triangles of the quad whose four vertices start at `base`. */
function pushQuadIndices(batch: BatchStore, base: number): void {
  pushIndex(batch, base);
  pushIndex(batch, base + 1);
  pushIndex(batch, base + 2);
  pushIndex(batch, base + 2);
  pushIndex(batch, base + 3);
  pushIndex(batch, base);
}

/**
 * Rounded-rect perimeter: 4 corner arcs traversed clockwise on screen (y down),
 * 4 × (CORNER_SEGMENTS + 1) points — same parametrization as the Unity SDK.
 * Written into a module scratch (single-threaded, consumed before the next
 * fill) so a frame full of rounded rects allocates no point arrays (ZAB-55).
 */
const PERIMETER_POINTS = 4 * (CORNER_SEGMENTS + 1);
const perimeterX = new Float64Array(PERIMETER_POINTS);
const perimeterY = new Float64Array(PERIMETER_POINTS);

function fillPerimeter(rect: Rect, r: number): void {
  let at = 0;
  for (let corner = 0; corner < 4; corner++) {
    // TL: 180 → 270, TR: 270 → 360, BR: 0 → 90, BL: 90 → 180.
    const cx = corner === 0 || corner === 3 ? rect.x + r : rect.x + rect.width - r;
    const cy = corner < 2 ? rect.y + r : rect.y + rect.height - r;
    const start = (180 + corner * 90) * (Math.PI / 180);
    for (let s = 0; s <= CORNER_SEGMENTS; s++) {
      const angle = start + (Math.PI / 2) * (s / CORNER_SEGMENTS);
      perimeterX[at] = cx + r * Math.cos(angle);
      perimeterY[at] = cy + r * Math.sin(angle);
      at++;
    }
  }
}
