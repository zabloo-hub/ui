import { describe, expect, it } from "vitest";
import type { ImageAsset } from "./assets.js";
import type { GlyphAtlas } from "./glyphs.js";
import type { Rect } from "./layout.js";
import { aspectFit, fitImage, GeometryBuilder } from "./tessellator.js";

const RECT: Rect = { x: 10, y: 20, width: 100, height: 100 };

function asset(width: number, height: number, decoded = true): ImageAsset {
  return {
    hash: `${width}x${height}`,
    width,
    height,
    bitmap: decoded ? ({} as TexImageSource) : null,
    version: decoded ? 1 : 0,
  };
}

/** Vertices are interleaved x,y,u,v,r,g,b,a — read one back as an object. */
function vertex(vertices: number[], index: number) {
  const at = index * 8;
  return {
    x: vertices[at],
    y: vertices[at + 1],
    u: vertices[at + 2],
    v: vertices[at + 3],
    alpha: vertices[at + 7],
  };
}

describe("aspectFit", () => {
  it("letterboxes a wide source, centered on the cross axis", () => {
    expect(aspectFit(RECT, 200, 100)).toEqual({ x: 10, y: 45, width: 100, height: 50 });
  });

  it("pillarboxes a tall source, centered on the cross axis", () => {
    expect(aspectFit(RECT, 100, 200)).toEqual({ x: 35, y: 20, width: 50, height: 100 });
  });

  it("fills the rect exactly when the ratios match", () => {
    expect(aspectFit(RECT, 50, 50)).toEqual(RECT);
  });

  it("scales up a source smaller than the rect", () => {
    expect(aspectFit(RECT, 10, 10)).toEqual(RECT);
  });

  it("returns null when either side has no usable size", () => {
    expect(aspectFit(RECT, 0, 100)).toBeNull();
    expect(aspectFit(RECT, 100, 0)).toBeNull();
    expect(aspectFit({ x: 0, y: 0, width: 0, height: 10 }, 100, 100)).toBeNull();
  });
});

describe("fitImage", () => {
  it("contain: letterboxes the box, samples the whole texture", () => {
    expect(fitImage(RECT, 200, 100)).toEqual({
      rect: { x: 10, y: 45, width: 100, height: 50 },
      uv: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it("cover: fills the rect and crops the overflowing axis evenly through the UVs", () => {
    // A 200×100 source in a 100×100 rect: scale by height, so half the width shows.
    expect(fitImage(RECT, 200, 100, "cover")).toEqual({
      rect: RECT,
      uv: { x: 0.25, y: 0, width: 0.5, height: 1 },
    });
    expect(fitImage(RECT, 100, 200, "cover")).toEqual({
      rect: RECT,
      uv: { x: 0, y: 0.25, width: 1, height: 0.5 },
    });
  });

  it("stretch: the whole rect and the whole texture, aspect ratio be damned", () => {
    expect(fitImage(RECT, 200, 100, "stretch")).toEqual({
      rect: RECT,
      uv: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it("never paints outside the layout rect, whatever the fit", () => {
    for (const fit of ["contain", "cover", "stretch"] as const) {
      const quad = fitImage(RECT, 320, 40, fit);
      if (!quad) throw new Error("expected a quad");
      expect(quad.rect.x).toBeGreaterThanOrEqual(RECT.x);
      expect(quad.rect.y).toBeGreaterThanOrEqual(RECT.y);
      expect(quad.rect.x + quad.rect.width).toBeLessThanOrEqual(RECT.x + RECT.width);
      expect(quad.rect.y + quad.rect.height).toBeLessThanOrEqual(RECT.y + RECT.height);
    }
  });

  it("returns null when either side has no usable size", () => {
    expect(fitImage(RECT, 0, 100, "cover")).toBeNull();
    expect(fitImage({ x: 0, y: 0, width: 0, height: 10 }, 100, 100, "stretch")).toBeNull();
  });
});

describe("GeometryBuilder.image", () => {
  it("emits a full-UV quad fitted inside the layout rect", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(200, 100));

    const batch = geometry.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    expect(batch.vertices).toHaveLength(4 * 8);
    expect(batch.indices).toEqual([0, 1, 2, 2, 3, 0]);

    // Fitted rect: 100×50 at (10, 45). UVs span the whole texture, v down.
    expect(vertex(batch.vertices, 0)).toMatchObject({ x: 10, y: 45, u: 0, v: 0 });
    expect(vertex(batch.vertices, 2)).toMatchObject({ x: 110, y: 95, u: 1, v: 1 });
  });

  it("cover: the quad is the layout rect, with the cropped UV window", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(200, 100), { fit: "cover" });

    const batch = geometry.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    expect(vertex(batch.vertices, 0)).toMatchObject({ x: 10, y: 20, u: 0.25, v: 0 });
    expect(vertex(batch.vertices, 2)).toMatchObject({ x: 110, y: 120, u: 0.75, v: 1 });
  });

  it("paints untinted by default, with the given color as vertex color", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(100, 100));
    const untinted = geometry.batches().find((b) => b.indices.length > 0);
    if (!untinted) throw new Error("expected an image batch");
    // r,g,b stay white so the shader's texture × color is the texture itself.
    expect(untinted.vertices.slice(4, 8)).toEqual([1, 1, 1, 1]);

    const tinted = new GeometryBuilder();
    tinted.image(RECT, asset(100, 100), { color: [1, 0.8, 0, 0.5] });
    const batch = tinted.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    expect(batch.vertices.slice(4, 8)).toEqual([1, 0.8, 0, 0.5]);
    expect(vertex(batch.vertices, 0).alpha).toBe(0.5);
  });

  it("rounds the painted image with the same fan a background uses", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(100, 100), { fit: "stretch", radius: 12 });

    const batch = geometry.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    const count = batch.vertices.length / 8;
    expect(count).toBe(1 + 4 * (6 + 1)); // centroid + 4 corner arcs
    // The centroid samples the middle of the texture.
    expect(vertex(batch.vertices, 0)).toMatchObject({ x: 60, y: 70, u: 0.5, v: 0.5 });
    for (let i = 0; i < count; i++) {
      const { x, y, u, v } = vertex(batch.vertices, i);
      expect(x).toBeGreaterThanOrEqual(RECT.x);
      expect(x).toBeLessThanOrEqual(RECT.x + RECT.width);
      expect(y).toBeGreaterThanOrEqual(RECT.y);
      expect(y).toBeLessThanOrEqual(RECT.y + RECT.height);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("clamps the radius to the painted box, not to the layout rect", () => {
    // contain shrinks the box to 100×50, so a radius of 40 clamps to 25 — a pill.
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(200, 100), { radius: 40 });

    const batch = geometry.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    for (let i = 0; i < batch.vertices.length / 8; i++) {
      const { y } = vertex(batch.vertices, i);
      expect(y).toBeGreaterThanOrEqual(45);
      expect(y).toBeLessThanOrEqual(95);
    }
  });

  it("paints nothing while the decode is still in flight", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(100, 100, false));
    expect(geometry.batches().every((b) => b.indices.length === 0)).toBe(true);
  });

  it("batches per texture: one draw call per distinct image, shared across nodes", () => {
    const geometry = new GeometryBuilder();
    const coin = asset(100, 100);
    const hero = asset(200, 100);
    geometry.image(RECT, coin);
    geometry.image(RECT, hero);
    geometry.image(RECT, coin);

    const drawn = geometry.batches().filter((b) => b.indices.length > 0);
    expect(drawn).toHaveLength(2);
    expect(drawn.map((b) => b.texture)).toEqual([coin, hero]);
    // The two coin quads share a batch, with indices offset past the first quad.
    expect(drawn[0].indices).toEqual([0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4]);
  });

  it("orders batches solids → images → text", () => {
    const geometry = new GeometryBuilder();
    const atlas = { version: 1, bitmap: {} } as unknown as GlyphAtlas;
    const image = asset(100, 100);
    geometry.text(0, 0, "", atlas, [1, 1, 1, 1]);
    geometry.image(RECT, image);
    geometry.roundedRect(RECT, 0, [1, 0, 0, 1]);

    expect(geometry.batches().map((b) => b.texture)).toEqual([null, image, atlas]);
  });
});
