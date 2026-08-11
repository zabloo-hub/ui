/**
 * The web tessellator — same geometry as the Unity SDK's Tessellation.cs:
 * implicit paint (style → rounded-rect fan, clockwise, y down), glyph quads from
 * the self-owned atlas and textured quads for images. Emits into batches (solids
 * + one per atlas + one per image texture).
 */

import type { ImageFit } from "@zabloo/format";
import type { ImageAsset } from "./assets.js";
import type { Batch } from "./gl.js";
import type { GlyphAtlas } from "./glyphs.js";
import type { Rect } from "./layout.js";

export type Color = [number, number, number, number];

const CORNER_SEGMENTS = 6;

/** Untinted: the shader multiplies texture × vertex color, so white = the pixels as-is. */
const UNTINTED: Color = [1, 1, 1, 1];

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
  private readonly solid: Batch = { texture: null, vertices: [], indices: [] };
  private readonly imageBatches = new Map<ImageAsset, Batch>();
  private readonly textBatches = new Map<GlyphAtlas, Batch>();

  /** `dpr` lets glyph quads snap to the physical pixel grid (crisp text). */
  constructor(private readonly dpr: number = 1) {}

  /**
   * Solids, then images, then text — backgrounds render under images, and glyphs
   * on top of both. Each distinct image is its own texture, hence its own draw
   * call: the single-batch invariant only ever held for solids + glyph atlas.
   */
  batches(): Batch[] {
    return [this.solid, ...this.imageBatches.values(), ...this.textBatches.values()];
  }

  roundedRect(rect: Rect, radius: number, color: Color): void {
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const r = Math.min(radius, rect.width * 0.5, rect.height * 0.5);
    const batch = this.solid;
    const base = batch.vertices.length / 8;

    if (r <= 0.01) {
      pushVertex(batch, rect.x, rect.y, 0, 0, color);
      pushVertex(batch, rect.x + rect.width, rect.y, 0, 0, color);
      pushVertex(batch, rect.x + rect.width, rect.y + rect.height, 0, 0, color);
      pushVertex(batch, rect.x, rect.y + rect.height, 0, 0, color);
      batch.indices.push(base, base + 1, base + 2, base + 2, base + 3, base);
      return;
    }

    // Perimeter: 4 corner arcs traversed clockwise on screen (y down), fan
    // around the centroid — identical to the SDK.
    pushVertex(batch, rect.x + rect.width / 2, rect.y + rect.height / 2, 0, 0, color);
    const points = perimeter(rect, r);
    for (const [x, y] of points) pushVertex(batch, x, y, 0, 0, color);
    for (let i = 0; i < points.length; i++) {
      batch.indices.push(base, base + 1 + i, base + 1 + ((i + 1) % points.length));
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
    const batch = this.solid;
    const base = batch.vertices.length / 8;

    // Outer then inner perimeter, same parametrization → stitch quads.
    // (radius 0 degenerates corner arcs to repeated points — harmless.)
    const outer = perimeter(rect, r);
    const innerPts = perimeter(inner, Math.max(0, r - width));
    for (const [x, y] of outer) pushVertex(batch, x, y, 0, 0, color);
    for (const [x, y] of innerPts) pushVertex(batch, x, y, 0, 0, color);

    const count = outer.length;
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      batch.indices.push(
        base + i,
        base + next,
        base + count + next,
        base + count + next,
        base + count + i,
        base + i,
      );
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
    const base = batch.vertices.length / 8;
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
      batch.indices.push(base, base + 1, base + 2, base + 2, base + 3, base);
      return;
    }

    // Rounded: same fan as a rounded-rect background, sampling the texture at
    // each vertex's relative position inside the painted box.
    const uvAt = (x: number, y: number): [number, number] => [
      uv.x + ((x - box.x) / box.width) * uv.width,
      uv.y + ((y - box.y) / box.height) * uv.height,
    ];
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const [cu, cv] = uvAt(cx, cy);
    pushVertex(batch, cx, cy, cu, cv, color);
    const points = perimeter(box, r);
    for (const [x, y] of points) {
      const [u, v] = uvAt(x, y);
      pushVertex(batch, x, y, u, v, color);
    }
    for (let i = 0; i < points.length; i++) {
      batch.indices.push(base, base + 1 + i, base + 1 + ((i + 1) % points.length));
    }
  }

  private imageBatchFor(asset: ImageAsset): Batch {
    let batch = this.imageBatches.get(asset);
    if (!batch) {
      batch = { texture: asset, vertices: [], indices: [] };
      this.imageBatches.set(asset, batch);
    }
    return batch;
  }

  /** Single-line text run starting at (originX, originY) — top-left of the run. */
  text(originX: number, originY: number, content: string, atlas: GlyphAtlas, color: Color): void {
    const batch = this.batchFor(atlas);
    let pen = originX;
    const baseline = originY + atlas.ascent;

    for (const char of content) {
      const glyph = atlas.get(char);
      if (!glyph) continue;
      if (glyph.hasQuad) {
        // Snap the glyph origin to the physical pixel grid: fractional layout
        // positions + LINEAR filtering would blur the glyph by half a pixel.
        // The extents are integer device px already (atlas raster scale = dpr).
        const x0 = Math.round((pen + glyph.minX) * this.dpr) / this.dpr;
        const y0 = Math.round((baseline - glyph.maxY) * this.dpr) / this.dpr;
        const x1 = x0 + (glyph.maxX - glyph.minX);
        const y1 = y0 + (glyph.maxY - glyph.minY);
        const base = batch.vertices.length / 8;
        // Atlas v grows downward (texImage2D row order) → v0 = glyph top.
        pushVertex(batch, x0, y0, glyph.u0, glyph.v0, color);
        pushVertex(batch, x1, y0, glyph.u1, glyph.v0, color);
        pushVertex(batch, x1, y1, glyph.u1, glyph.v1, color);
        pushVertex(batch, x0, y1, glyph.u0, glyph.v1, color);
        batch.indices.push(base, base + 1, base + 2, base + 2, base + 3, base);
      }
      pen += glyph.advance;
    }
  }

  private batchFor(atlas: GlyphAtlas): Batch {
    let batch = this.textBatches.get(atlas);
    if (!batch) {
      batch = { texture: atlas, vertices: [], indices: [] };
      this.textBatches.set(atlas, batch);
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

function pushVertex(batch: Batch, x: number, y: number, u: number, v: number, color: Color): void {
  batch.vertices.push(x, y, u, v, color[0], color[1], color[2], color[3]);
}

/**
 * Rounded-rect perimeter: 4 corner arcs traversed clockwise on screen (y down),
 * 4 × (CORNER_SEGMENTS + 1) points — same parametrization as the Unity SDK.
 */
function perimeter(rect: Rect, r: number): Array<[number, number]> {
  const centers = [
    [rect.x + r, rect.y + r], // TL: 180 → 270
    [rect.x + rect.width - r, rect.y + r], // TR: 270 → 360
    [rect.x + rect.width - r, rect.y + rect.height - r], // BR: 0 → 90
    [rect.x + r, rect.y + rect.height - r], // BL: 90 → 180
  ];
  const points: Array<[number, number]> = [];
  for (let corner = 0; corner < 4; corner++) {
    const start = (180 + corner * 90) * (Math.PI / 180);
    for (let s = 0; s <= CORNER_SEGMENTS; s++) {
      const angle = start + (Math.PI / 2) * (s / CORNER_SEGMENTS);
      const [cx, cy] = centers[corner];
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  }
  return points;
}
