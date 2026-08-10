/** Hand-crafted image headers for tests (the parsers never decode full files). */

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** Minimal PNG for the parser: signature + IHDR length/type + width/height. */
export function fakePng(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13),
    Buffer.from("IHDR"),
    u32(width),
    u32(height),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
}

/** One JPEG marker segment: FF <marker> <length incl. itself> <payload>. */
export function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Minimal JPEG for the parser: SOI + one padding APP0 + SOF0 with dimensions. */
export function fakeJpeg(width: number, height: number): Buffer {
  const sof = Buffer.alloc(6);
  sof[0] = 8; // precision
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3; // components
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.alloc(5)),
    jpegSegment(0xc0, sof),
  ]);
}
