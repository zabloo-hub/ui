import { describe, expect, it } from "vitest";
import type { ImageAsset } from "./assets.js";
import type { GlyphAtlas } from "./glyphs.js";
import type { Rect } from "./layout.js";
import { aspectFit, GeometryBuilder } from "./tessellator.js";

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

describe("GeometryBuilder.image", () => {
  it("emits a full-UV quad fitted inside the layout rect", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(200, 100), 1);

    const batch = geometry.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    expect(batch.vertices).toHaveLength(4 * 8);
    expect(batch.indices).toEqual([0, 1, 2, 2, 3, 0]);

    // Fitted rect: 100×50 at (10, 45). UVs span the whole texture, v down.
    expect(vertex(batch.vertices, 0)).toMatchObject({ x: 10, y: 45, u: 0, v: 0 });
    expect(vertex(batch.vertices, 2)).toMatchObject({ x: 110, y: 95, u: 1, v: 1 });
  });

  it("paints untinted, with the inherited opacity as vertex alpha", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(100, 100), 0.5);

    const batch = geometry.batches().find((b) => b.indices.length > 0);
    if (!batch) throw new Error("expected an image batch");
    expect(vertex(batch.vertices, 0).alpha).toBe(0.5);
    // r,g,b stay white so the shader's texture × color is the texture itself.
    expect(batch.vertices.slice(4, 7)).toEqual([1, 1, 1]);
  });

  it("paints nothing while the decode is still in flight", () => {
    const geometry = new GeometryBuilder();
    geometry.image(RECT, asset(100, 100, false), 1);
    expect(geometry.batches().every((b) => b.indices.length === 0)).toBe(true);
  });

  it("batches per texture: one draw call per distinct image, shared across nodes", () => {
    const geometry = new GeometryBuilder();
    const coin = asset(100, 100);
    const hero = asset(200, 100);
    geometry.image(RECT, coin, 1);
    geometry.image(RECT, hero, 1);
    geometry.image(RECT, coin, 1);

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
    geometry.image(RECT, image, 1);
    geometry.roundedRect(RECT, 0, [1, 0, 0, 1]);

    expect(geometry.batches().map((b) => b.texture)).toEqual([null, image, atlas]);
  });
});
