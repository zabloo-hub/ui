/**
 * The web tessellator — same geometry as the Unity SDK's Tessellation.cs:
 * implicit paint (style → rounded-rect fan, clockwise, y down) and glyph quads
 * from the self-owned atlas. Emits into batches (solids + one per atlas).
 */

import type { Batch } from "./gl.js";
import type { GlyphAtlas } from "./glyphs.js";
import type { Rect } from "./layout.js";

export type Color = [number, number, number, number];

const CORNER_SEGMENTS = 6;

export class GeometryBuilder {
  private readonly solid: Batch = { atlas: null, vertices: [], indices: [] };
  private readonly textBatches = new Map<GlyphAtlas, Batch>();

  /** `dpr` lets glyph quads snap to the physical pixel grid (crisp text). */
  constructor(private readonly dpr: number = 1) {}

  /** Solids first, then text — backgrounds render under glyphs. */
  batches(): Batch[] {
    return [this.solid, ...this.textBatches.values()];
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
      batch = { atlas, vertices: [], indices: [] };
      this.textBatches.set(atlas, batch);
    }
    return batch;
  }
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
