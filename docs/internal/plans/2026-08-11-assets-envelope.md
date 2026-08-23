# Assets en el envelope + empaquetado en export — plan de implementación (ZAB-10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** el envelope gana un manifest de assets embebidos en base64 (`assets`), los nodos los referencian con `asset:<id>`, y `zabloo export` los recolecta, hashea y empaqueta desde `src/assets/`.

**Architecture:** el envelope sigue siendo un único JSON (el camino único de carga no cambia). `@zabloo/format` añade los tipos (`AssetRef`, `AssetEntry`, `ImageNode`), la validación forward-tolerant y el helper `decodeAssetData`. `@zabloo/cli` añade una pasada de recolección post-emisión (`collectAssets`) con parsers propios de cabeceras PNG/JPEG (sin deps nativas), dedup por id lógico (= path relativo a `src/assets/`), y límites de tamaño 2/15/50 MB. Spec: `docs/internal/specs/2026-08-11-assets-envelope-design.md`.

**Tech Stack:** TypeScript ESM, pnpm workspaces, vitest (tests colocados `src/*.test.ts`), biome, Node ≥ 22. Sin dependencias nuevas.

## Global Constraints

- Repo de trabajo: worktree `ui` en la rama `zab-10-b1-formato-referencias-de-assets-en-el-enve` (los paths de abajo son relativos a su raíz).
- **Sin dependencias nuevas** (ni runtime ni dev). Nada nativo (sharp, etc.).
- `@zabloo/format` debe seguir siendo **browser-safe**: ningún import de `node:*` (lo consume `@zabloo/renderer-web`).
- Validación **forward-tolerant**: campos desconocidos pasan sin queja; solo se valida forma de lo conocido. `data` NUNCA se decodifica al validar.
- Límites exactos: warning por asset > `2 * 1024 * 1024` bytes; warning por total > `15 * 1024 * 1024`; error duro por total > `50 * 1024 * 1024` (decodificado).
- Sin bump de versión: todo es aditivo dentro de `IR_VERSION = 1`.
- Comandos por paquete: `pnpm --filter @zabloo/format test` / `typecheck`; ídem `@zabloo/cli`. Lint global: `pnpm lint` (biome).
- Mensajes de commit: frase descriptiva simple (estilo del repo, sin prefijos conventional-commits).

---

### Task 1: Formato — tipos de asset + validación en `parseEnvelope`

**Files:**
- Modify: `packages/format/src/index.ts`
- Test: `packages/format/src/index.test.ts`

**Interfaces:**
- Consumes: lo ya existente en `@zabloo/format` (`Envelope`, `ZNode`, `NodeBase`, `parseEnvelope`).
- Produces: `type AssetRef = \`asset:${string}\``; `interface AssetEntry { hash: string; mime: string; size: number; width?: number; height?: number; data?: string }`; `Envelope.assets?: Record<string, AssetEntry>`; `interface ImageNode extends NodeBase { type: "Image"; src: AssetRef }` (entra en la unión `ZNode`); `parseEnvelope` valida la sección `assets` si existe.

- [ ] **Step 1: Write the failing tests**

Añadir al final de `packages/format/src/index.test.ts`:

```ts
describe("parseEnvelope: assets", () => {
  const asset = {
    hash: "a".repeat(64),
    mime: "image/png",
    size: 3,
    width: 1,
    height: 1,
    data: "AAAA",
  };

  it("accepts an envelope without assets (unchanged)", () => {
    expect(parseEnvelope(validEnvelope).assets).toBeUndefined();
  });

  it("accepts a valid asset entry", () => {
    const env = parseEnvelope({ ...validEnvelope, assets: { "hero.png": asset } });
    expect(env.assets?.["hero.png"]?.hash).toBe("a".repeat(64));
  });

  it("accepts an entry without data/width/height (deferred-resolution shape)", () => {
    const bare = { hash: asset.hash, mime: asset.mime, size: asset.size };
    const env = parseEnvelope({ ...validEnvelope, assets: { "hero.png": bare } });
    expect(env.assets?.["hero.png"]?.data).toBeUndefined();
  });

  it("is forward-tolerant: unknown entry fields pass through", () => {
    const env = parseEnvelope({
      ...validEnvelope,
      assets: { "hero.png": { ...asset, futureField: true } },
    });
    expect(env.assets?.["hero.png"]?.mime).toBe("image/png");
  });

  it("rejects a non-object assets section", () => {
    expect(() => parseEnvelope({ ...validEnvelope, assets: [] })).toThrow(
      "`assets` must be an object",
    );
  });

  it("rejects entries missing hash, mime or size", () => {
    expect(() =>
      parseEnvelope({ ...validEnvelope, assets: { x: { mime: "image/png", size: 3 } } }),
    ).toThrow("`hash`");
    expect(() => parseEnvelope({ ...validEnvelope, assets: { x: { hash: "h", size: 3 } } })).toThrow(
      "`mime`",
    );
    expect(() => parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, size: "3" } } })).toThrow(
      "`size`",
    );
  });

  it("rejects data that is not base64-shaped (without decoding it)", () => {
    expect(() => parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, data: "!!" } } })).toThrow(
      "base64",
    );
    expect(() => parseEnvelope({ ...validEnvelope, assets: { x: { ...asset, data: "AAA" } } })).toThrow(
      "base64",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zabloo/format test`
Expected: FAIL — los tests nuevos fallan (la sección `assets` no se valida aún; los de rechazo no lanzan).

- [ ] **Step 3: Implement types + validation**

En `packages/format/src/index.ts`:

(a) Tras el tipo `ColorValue`, añadir:

```ts
/** A reference to an asset in the envelope's manifest, e.g. `"asset:icons/coin.png"`. */
export type AssetRef = `asset:${string}`;

/**
 * One asset in the envelope's manifest (decision 2026-08-11, ZAB-10). `hash` is the
 * content identity (SHA-256 hex): dedup today, content-addressed caching/CDN once the
 * platform exists. `data` is optional in the SCHEMA only — v1 exports always inline
 * it; a future platform may omit it and let SDKs resolve bytes by hash (deferred
 * resolution) without a format change.
 */
export interface AssetEntry {
  hash: string;
  /** MIME type, e.g. "image/png". The format is generic; accepted MIMEs are an export concern. */
  mime: string;
  /** Byte size of the decoded content. */
  size: number;
  /** Pixel dimensions (images): lets layout reserve space before decoding. */
  width?: number;
  height?: number;
  /** Content bytes, base64-encoded. */
  data?: string;
}
```

(b) En `Envelope`, tras `tokens`:

```ts
  /** Asset manifest keyed by logical id. Optional: envelopes without assets stay valid as-is. */
  assets?: Record<string, AssetEntry>;
```

(c) Ampliar la unión y añadir el nodo (contrato fijado aquí; el componente React + render es ZAB-13):

```ts
export type ZNode = ContainerNode | TextNode | ButtonNode | CollapseNode | ImageNode;
```

```ts
/**
 * Textured rectangle. `src` references the envelope's asset manifest; at authoring
 * time the prop carries a path relative to `src/assets/` and `zabloo export` rewrites
 * it to the final `asset:<id>` ref (ZAB-13 implements the component + rendering).
 */
export interface ImageNode extends NodeBase {
  type: "Image";
  src: AssetRef;
}
```

(d) En `parseEnvelope`, después del check de `views`, añadir:

```ts
  if (env.assets !== undefined) {
    if (typeof env.assets !== "object" || env.assets === null || Array.isArray(env.assets)) {
      throw new Error("IR envelope: `assets` must be an object");
    }
    for (const [id, entry] of Object.entries(env.assets)) {
      validateAssetEntry(id, entry);
    }
  }
```

(e) Al final del archivo:

```ts
const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Cheap shape checks only — `data` is never decoded here (that would pay the cost twice). */
function validateAssetEntry(id: string, value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`IR envelope: asset "${id}" must be an object`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.hash !== "string" || entry.hash.length === 0) {
    throw new Error(`IR envelope: asset "${id}": missing non-empty \`hash\``);
  }
  if (typeof entry.mime !== "string" || entry.mime.length === 0) {
    throw new Error(`IR envelope: asset "${id}": missing non-empty \`mime\``);
  }
  if (typeof entry.size !== "number" || entry.size < 0) {
    throw new Error(`IR envelope: asset "${id}": missing numeric \`size\``);
  }
  if (entry.width !== undefined && typeof entry.width !== "number") {
    throw new Error(`IR envelope: asset "${id}": \`width\` must be a number`);
  }
  if (entry.height !== undefined && typeof entry.height !== "number") {
    throw new Error(`IR envelope: asset "${id}": \`height\` must be a number`);
  }
  if (
    entry.data !== undefined &&
    (typeof entry.data !== "string" ||
      entry.data.length % 4 !== 0 ||
      !BASE64_SHAPE.test(entry.data))
  ) {
    throw new Error(`IR envelope: asset "${id}": \`data\` is not base64`);
  }
}
```

(f) Actualizar el docstring de cabecera del archivo: donde dice "closed set of 3 primitives" ya quedó desfasado — reformular la línea de vocabulario a "closed set grown by capability: Container, Text, Button, Collapse, Image" y añadir una línea "Assets travel embedded (base64) in an `assets` manifest; nodes reference them as `asset:<id>` (decision 2026-08-11)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @zabloo/format test && pnpm --filter @zabloo/format typecheck`
Expected: PASS (todos, incluidos los preexistentes).

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/index.ts packages/format/src/index.test.ts
git commit -m "Formato: manifest de assets en el envelope + AssetRef + nodo Image (ZAB-10)"
```

---

### Task 2: Formato — `decodeAssetData`

**Files:**
- Modify: `packages/format/src/index.ts`
- Test: `packages/format/src/index.test.ts`

**Interfaces:**
- Consumes: `AssetEntry` (Task 1).
- Produces: `decodeAssetData(entry: AssetEntry): Uint8Array` — lo reutilizan renderer-web (ZAB-12) y el preview del CLI.

- [ ] **Step 1: Write the failing tests**

Añadir a `packages/format/src/index.test.ts` (import de `decodeAssetData` en la cabecera):

```ts
describe("decodeAssetData", () => {
  it("round-trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const data = btoa(String.fromCharCode(...bytes));
    const entry = { hash: "h", mime: "application/octet-stream", size: bytes.length, data };
    expect(decodeAssetData(entry)).toEqual(bytes);
  });

  it("throws a clear error when data is absent (deferred resolution not supported yet)", () => {
    expect(() => decodeAssetData({ hash: "h", mime: "image/png", size: 1 })).toThrow(
      "no inline `data`",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zabloo/format test`
Expected: FAIL — `decodeAssetData` no existe.

- [ ] **Step 3: Implement**

En `packages/format/src/index.ts`, tras `parseEnvelope`:

```ts
/**
 * Decode an asset's inlined bytes. Browser-safe on purpose (atob, no `node:` imports)
 * — shared by the web renderer and the CLI preview; the Unity SDK decodes on its side
 * (Convert.FromBase64String).
 */
export function decodeAssetData(entry: AssetEntry): Uint8Array {
  if (entry.data === undefined) {
    throw new Error("asset has no inline `data` (deferred resolution is not supported yet)");
  }
  const binary = atob(entry.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @zabloo/format test && pnpm --filter @zabloo/format typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/index.ts packages/format/src/index.test.ts
git commit -m "Formato: decodeAssetData (base64 → bytes, browser-safe)"
```

---

### Task 3: CLI — parsers de cabecera PNG/JPEG (`image-meta.ts`)

**Files:**
- Create: `packages/cli/src/image-meta.ts`
- Create: `packages/cli/src/image-fixtures.ts` (helpers de test compartidos con Task 4 — NO es un archivo `.test.ts`: importar un test desde otro re-registraría sus tests)
- Test: `packages/cli/src/image-meta.test.ts`

**Interfaces:**
- Consumes: nada del resto del repo (módulo hoja, solo `Buffer`).
- Produces: `interface ImageMeta { width: number; height: number }`; `imageMeta(mime: string, bytes: Buffer): ImageMeta | null` (dispatch por MIME); `pngMeta(bytes: Buffer): ImageMeta | null`; `jpegMeta(bytes: Buffer): ImageMeta | null` — `null` = cabecera irreconocible o MIME sin parser. Para tests: `fakePng(width, height): Buffer`, `fakeJpeg(width, height): Buffer`, `jpegSegment(marker, payload): Buffer` en `image-fixtures.ts`.

- [ ] **Step 1: Write the fixtures and the failing tests**

Crear `packages/cli/src/image-fixtures.ts`. Los bytes se fabrican a mano — los parsers leen cabeceras, no necesitan imágenes decodificables:

```ts
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
```

Crear `packages/cli/src/image-meta.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zabloo/cli test`
Expected: FAIL — `./image-meta.js` no existe.

- [ ] **Step 3: Implement**

Crear `packages/cli/src/image-meta.ts`:

```ts
/**
 * Minimal image header readers for `zabloo export` — width/height without decoding
 * and without native deps (decision 2026-08-11, ZAB-10: no sharp). Readers parse
 * headers only; they do NOT validate the whole file.
 */

export interface ImageMeta {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: signature + IHDR (always the first chunk) → width/height at bytes 16..23. */
export function pngMeta(bytes: Buffer): ImageMeta | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** JPEG: walk marker segments to the first SOFn frame header. */
export function jpegMeta(bytes: Buffer): ImageMeta | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // padding byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2; // standalone marker (TEM/RSTn/SOI/EOI): no length field
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

/** Dispatch by MIME; null when no parser applies (caller decides how strict to be). */
export function imageMeta(mime: string, bytes: Buffer): ImageMeta | null {
  if (mime === "image/png") return pngMeta(bytes);
  if (mime === "image/jpeg") return jpegMeta(bytes);
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @zabloo/cli test && pnpm --filter @zabloo/cli typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/image-meta.ts packages/cli/src/image-meta.test.ts packages/cli/src/image-fixtures.ts
git commit -m "CLI: parsers de cabecera PNG/JPEG para dimensiones sin decodificar"
```

---

### Task 4: CLI — pasada de recolección (`assets.ts`)

**Files:**
- Create: `packages/cli/src/assets.ts`
- Test: `packages/cli/src/assets.test.ts`

**Interfaces:**
- Consumes: `AssetEntry`, `AssetRef`, `ZNode` de `@zabloo/format` (Task 1); `imageMeta` de `./image-meta.js` (Task 3); `node:crypto`, `node:fs/promises`, `node:path`.
- Produces: `collectAssets(views: Record<string, ZNode>, assetsDir: string): Promise<CollectedAssets>` con `interface CollectedAssets { assets: Record<string, AssetEntry>; warnings: string[]; totalBytes: number }`. **Muta las views in place** (reescribe props de path a `asset:<id>`). Constantes exportadas: `ASSET_WARN_BYTES`, `TOTAL_WARN_BYTES`, `TOTAL_MAX_BYTES`.

- [ ] **Step 1: Write the failing tests**

Crear `packages/cli/src/assets.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZNode } from "@zabloo/format";
import { beforeEach, describe, expect, it } from "vitest";
import { ASSET_WARN_BYTES, collectAssets, TOTAL_MAX_BYTES } from "./assets.js";
import { fakePng } from "./image-fixtures.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zabloo-assets-"));
});

function imageView(src: string): ZNode {
  return {
    type: "Container",
    children: [{ type: "Image", id: "logo", src } as unknown as ZNode],
  } as ZNode;
}

describe("collectAssets", () => {
  it("leaves asset-less views untouched and returns an empty manifest", async () => {
    const views = { main: { type: "Text", text: "hi" } as ZNode };
    const result = await collectAssets(views, dir);
    expect(result.assets).toEqual({});
    expect(result.totalBytes).toBe(0);
  });

  it("packages an image: hash, mime, dims, base64 data, ref rewritten", async () => {
    const png = fakePng(640, 480);
    await mkdir(join(dir, "icons"), { recursive: true });
    await writeFile(join(dir, "icons", "coin.png"), png);
    const views = { main: imageView("icons/coin.png") };

    const { assets, totalBytes } = await collectAssets(views, dir);

    const entry = assets["icons/coin.png"];
    expect(entry).toBeDefined();
    expect(entry?.hash).toBe(createHash("sha256").update(png).digest("hex"));
    expect(entry?.mime).toBe("image/png");
    expect(entry?.size).toBe(png.length);
    expect(entry?.width).toBe(640);
    expect(entry?.height).toBe(480);
    expect(entry?.data).toBe(png.toString("base64"));
    expect(totalBytes).toBe(png.length);
    const node = (views.main as { children?: unknown[] }).children?.[0] as { src: string };
    expect(node.src).toBe("asset:icons/coin.png");
  });

  it("dedups by id: same path from two views → one entry, both refs rewritten", async () => {
    await writeFile(join(dir, "hero.png"), fakePng(2, 2));
    const views = { a: imageView("hero.png"), b: imageView("hero.png") };

    const { assets, totalBytes } = await collectAssets(views, dir);

    expect(Object.keys(assets)).toEqual(["hero.png"]);
    expect(totalBytes).toBe(fakePng(2, 2).length);
    for (const view of Object.values(views)) {
      const node = (view as { children?: unknown[] }).children?.[0] as { src: string };
      expect(node.src).toBe("asset:hero.png");
    }
  });

  it("leaves already-rewritten asset: refs alone", async () => {
    const views = { main: imageView("asset:hero.png") };
    const { assets } = await collectAssets(views, dir);
    expect(assets).toEqual({});
  });

  it("errors with view/node context when the file does not exist", async () => {
    await expect(collectAssets({ shop: imageView("nope.png") }, dir)).rejects.toThrow(
      /view "shop".*"logo".*nope\.png/s,
    );
  });

  it("errors on extensions without a known MIME", async () => {
    await writeFile(join(dir, "logo.svg"), "<svg/>");
    await expect(collectAssets({ main: imageView("logo.svg") }, dir)).rejects.toThrow(
      /unsupported.*\.png/s,
    );
  });

  it("rejects paths escaping src/assets", async () => {
    await expect(collectAssets({ main: imageView("../secret.png") }, dir)).rejects.toThrow(
      /escapes/,
    );
  });

  it("warns on a single asset above 2 MB", async () => {
    const big = Buffer.concat([fakePng(1, 1), Buffer.alloc(ASSET_WARN_BYTES)]);
    await writeFile(join(dir, "big.png"), big);
    const { warnings } = await collectAssets({ main: imageView("big.png") }, dir);
    expect(warnings.some((w) => w.includes("big.png"))).toBe(true);
  });

  it("hard-errors when the total exceeds 50 MB", async () => {
    const huge = Buffer.concat([fakePng(1, 1), Buffer.alloc(TOTAL_MAX_BYTES)]);
    await writeFile(join(dir, "huge.png"), huge);
    await expect(collectAssets({ main: imageView("huge.png") }, dir)).rejects.toThrow(/50 MB/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zabloo/cli test`
Expected: FAIL — `./assets.js` no existe.

- [ ] **Step 3: Implement**

Crear `packages/cli/src/assets.ts`:

```ts
/**
 * Asset collection pass of `zabloo export` (decision 2026-08-11, ZAB-10): walks the
 * emitted views, resolves authoring paths against `src/assets/`, hashes and inlines
 * the bytes (base64 — v1 always ships everything with the envelope) and rewrites the
 * props to `asset:<id>` refs. The logical id IS the path relative to `src/assets/`
 * (stable across exports); `hash` is the content version.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { AssetEntry, AssetRef, ZNode } from "@zabloo/format";
import { imageMeta } from "./image-meta.js";

/** Which props carry assets, per node type (grows with the format — F3 adds fonts). */
const ASSET_PROPS: Record<string, string[]> = {
  Image: ["src"],
};

/** MIMEs the export accepts in F2. `".ttf": "font/ttf"` joins in F3 (ZAB-16). */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export const ASSET_WARN_BYTES = 2 * 1024 * 1024;
export const TOTAL_WARN_BYTES = 15 * 1024 * 1024;
export const TOTAL_MAX_BYTES = 50 * 1024 * 1024;

export interface CollectedAssets {
  /** Manifest for the envelope; empty when the project uses no assets. */
  assets: Record<string, AssetEntry>;
  /** Size warnings (per-asset > 2 MB, total > 15 MB) for the export summary. */
  warnings: string[];
  /** Decoded bytes across the manifest. */
  totalBytes: number;
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export async function collectAssets(
  views: Record<string, ZNode>,
  assetsDir: string,
): Promise<CollectedAssets> {
  const assets: Record<string, AssetEntry> = {};
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const [viewId, rootNode] of Object.entries(views)) {
    const stack: ZNode[] = [rootNode];
    while (stack.length > 0) {
      const node = stack.pop() as ZNode & { children?: ZNode[] };
      for (const prop of ASSET_PROPS[node.type] ?? []) {
        const record = node as unknown as Record<string, unknown>;
        const value = record[prop];
        if (typeof value !== "string" || value.startsWith("asset:")) continue;

        const where = `view "${viewId}", node "${node.id ?? "?"}" (${node.type})`;
        const id = normalize(value).replaceAll("\\", "/");
        if (id.startsWith("..")) {
          throw new Error(`${where}: asset path "${value}" escapes src/assets/`);
        }
        if (!(id in assets)) {
          const entry = await readAsset(id, join(assetsDir, id), where);
          assets[id] = entry;
          totalBytes += entry.size;
          if (entry.size > ASSET_WARN_BYTES) {
            warnings.push(
              `asset "${id}" weighs ${mb(entry.size)} MB — consider compressing/rescaling`,
            );
          }
        }
        record[prop] = `asset:${id}` satisfies AssetRef;
      }
      if (node.children) stack.push(...node.children);
    }
  }

  if (totalBytes > TOTAL_MAX_BYTES) {
    throw new Error(
      `assets exceed the 50 MB hot-update limit (total: ${mb(totalBytes)} MB) — reduce or split the project`,
    );
  }
  if (totalBytes > TOTAL_WARN_BYTES) {
    warnings.push(`assets total ${mb(totalBytes)} MB (> 15 MB) — hot-updates will be heavy`);
  }
  return { assets, warnings, totalBytes };
}

async function readAsset(id: string, absPath: string, where: string): Promise<AssetEntry> {
  const ext = extname(id).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext];
  if (!mime) {
    const accepted = Object.keys(MIME_BY_EXTENSION).join(", ");
    throw new Error(`${where}: asset "${id}" has an unsupported type (accepted: ${accepted})`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new Error(`${where}: asset "${id}" not found at ${absPath}`);
  }
  const meta = imageMeta(mime, bytes);
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    mime,
    size: bytes.length,
    ...(meta ?? {}),
    data: bytes.toString("base64"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @zabloo/cli test && pnpm --filter @zabloo/cli typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/assets.ts packages/cli/src/assets.test.ts
git commit -m "CLI: pasada de recolección de assets (hash, dedup, límites, reescritura a asset:)"
```

---

### Task 5: CLI — wiring en `exportProject` + resumen en `zabloo export`

**Files:**
- Modify: `packages/cli/src/export.ts`
- Modify: `packages/cli/src/cli.ts:17-31`

**Interfaces:**
- Consumes: `collectAssets` (Task 4).
- Produces: `ExportResult` ampliado — `{ outFile: string; viewIds: string[]; assets: Array<{ id: string; bytes: number }>; assetBytes: number; warnings: string[] }`. `dev.ts` consume `exportProject` y no necesita cambios (campos añadidos, ninguno quitado; el push con assets se afina en ZAB-14).

- [ ] **Step 1: Wire the collection pass into `exportProject`**

En `packages/cli/src/export.ts`:

(a) Añadir el import: `import { collectAssets } from "./assets.js";`

(b) Ampliar `ExportResult`:

```ts
export interface ExportResult {
  outFile: string;
  viewIds: string[];
  /** Per-asset breakdown for the CLI summary (decision: el resumen imprime el desglose). */
  assets: Array<{ id: string; bytes: number }>;
  /** Decoded bytes across the asset manifest. */
  assetBytes: number;
  /** Size warnings from the asset pass, for the CLI summary. */
  warnings: string[];
}
```

(c) Tras el bucle de views y antes de construir el envelope, sustituir el bloque final (desde `const envelope: Envelope = ...` hasta el `return`) por:

```ts
  const collected = await collectAssets(views, join(root, "src", "assets"));
  const envelope: Envelope = { v: IR_VERSION, tokens, views };
  if (Object.keys(collected.assets).length > 0) {
    envelope.assets = collected.assets;
  }
  const outDir = resolve(root, config.outDir ?? "dist");
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "zabloo.ir.json");
  await writeFile(outFile, `${JSON.stringify(envelope, null, 2)}\n`);
  return {
    outFile,
    viewIds: Object.keys(views),
    assets: Object.entries(collected.assets).map(([id, entry]) => ({ id, bytes: entry.size })),
    assetBytes: collected.totalBytes,
    warnings: collected.warnings,
  };
```

- [ ] **Step 2: Print the summary in the CLI**

En `packages/cli/src/cli.ts`, dentro del `action` de `export`, sustituir el cuerpo del `try` por:

```ts
      const { outFile, viewIds, assets, assetBytes, warnings } = await exportProject(options.cwd);
      if (options.porcelain) {
        console.log(outFile);
      } else {
        console.log(`zabloo export: wrote ${viewIds.length} view(s) [${viewIds.join(", ")}]`);
        if (assets.length > 0) {
          const total = (assetBytes / (1024 * 1024)).toFixed(1);
          console.log(`  assets: ${assets.length} (${total} MB total)`);
          for (const asset of assets) {
            console.log(`    ${asset.id} (${(asset.bytes / 1024).toFixed(0)} KB)`);
          }
        }
        console.log(`  → ${outFile}`);
      }
      for (const warning of warnings) {
        console.warn(`zabloo export: ⚠ ${warning}`);
      }
```

(los warnings se imprimen también en modo `--porcelain` — van a stderr, no ensucian el path).

- [ ] **Step 3: Verify the whole workspace**

Run: `pnpm -r test && pnpm -r typecheck && pnpm lint`
Expected: PASS en todos los paquetes; biome sin quejas.

- [ ] **Step 4: Regression check — a no-assets project exports byte-identical**

```bash
pnpm -r build
node packages/cli/dist/cli.js export --cwd examples/hello-button
node -e "const e = require('./examples/hello-button/dist/zabloo.ir.json'); if ('assets' in e) throw new Error('unexpected assets key'); console.log('OK: no assets key, envelope unchanged');"
```

Expected: el export corre sin errores y el envelope de un proyecto sin assets NO lleva clave `assets` (idéntico a antes de esta rama).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/export.ts packages/cli/src/cli.ts
git commit -m "CLI: zabloo export empaqueta assets en el envelope y resume pesos/warnings (ZAB-10)"
```

---

## Fuera de alcance (recordatorio)

Carga en SDKs (ZAB-11 Unity, ZAB-12 web), componente `Image` en `@zabloo/react` + render (ZAB-13), dev loop con assets (ZAB-14), `font/ttf` (F3/ZAB-16 — una línea en `MIME_BY_EXTENSION` + entrada en `ASSET_PROPS` cuando exista el nodo). La spec de esta issue: `docs/internal/specs/2026-08-11-assets-envelope-design.md`.
