import { describe, expect, it } from "vitest";
import { fakeJpeg, fakePng, jpegSegment } from "./image-fixtures.js";
import { imageMeta, jpegMeta, pngMeta } from "./image-meta.js";

describe("pngMeta", () => {
  it("reads width/height from IHDR", () => {
    expect(pngMeta(fakePng(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("returns null for non-PNG bytes and truncated files", () => {
    expect(pngMeta(Buffer.from("not a png at all, really"))).toBeNull();
    expect(pngMeta(fakePng(640, 480).subarray(0, 10))).toBeNull();
  });
});

describe("jpegMeta", () => {
  it("walks segments to the SOF frame header", () => {
    expect(jpegMeta(fakeJpeg(32, 16))).toEqual({ width: 32, height: 16 });
  });

  it("returns null for non-JPEG bytes and files without SOF", () => {
    expect(jpegMeta(Buffer.from("nope"))).toBeNull();
    const noSof = Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSegment(0xe0, Buffer.alloc(5))]);
    expect(jpegMeta(noSof)).toBeNull();
  });
});

describe("imageMeta", () => {
  it("dispatches by mime and returns null for unknown mimes", () => {
    expect(imageMeta("image/png", fakePng(2, 3))).toEqual({ width: 2, height: 3 });
    expect(imageMeta("image/jpeg", fakeJpeg(2, 3))).toEqual({ width: 2, height: 3 });
    expect(imageMeta("font/ttf", Buffer.alloc(64))).toBeNull();
  });
});
