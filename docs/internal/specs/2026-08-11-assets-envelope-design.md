# Assets en el envelope + empaquetado en `zabloo export` — diseño (ZAB-10, F2 B1)

> Aprobado 2026-08-11 (sesión de brainstorming). Alcance: **formato + validación en
> `@zabloo/format`** y **empaquetado en `zabloo export`**. Consumidores del contrato:
> ZAB-11 (texturas Unity), ZAB-12 (renderer-web), ZAB-13 (`Image`), ZAB-14 (dev loop),
> ZAB-16 (TTF compartida, F3). Decisión registrada en `decisions-architecture.md`
> (2026-08-11, assets).

## Objetivo y restricciones

Definir cómo viajan los assets binarios (imágenes ahora; la TTF de F3 y futuros después)
del proyecto de authoring al SDK, cumpliendo:

- **Un solo camino de carga** (invariante 2026-08-01): import manual, dev push y
  hot-update de plataforma entregan el mismo payload.
- **Todo junto en v1**: los bytes viajan siempre con el envelope. Sin fetch remoto ni
  resolución diferida hoy — pero con la evolución a CDN ya dibujada en el schema.
- **Escala objetivo v1**: UI típica — decenas de assets, mayoría iconos (KB), alguna
  imagen hero de 1–2 MB, total < 10 MB decodificado.
- **Manifest genérico** por tipo/MIME: F2 solo implementa imágenes, pero fuentes, audio,
  etc. entran sin tocar el formato.

## Decisión de empaquetado: embebido base64 en el envelope

El envelope sigue siendo **un único JSON**. Los assets van embebidos en base64 dentro de
una sección `assets` nueva. Alternativas descartadas (detalle en el decision log): bundle
zip `.zabloo` (lector zip en cada consumidor, segunda superficie de formato, resuelve un
problema de escala que no tenemos) y archivos sueltos + resolver (rompe "el payload es
una cosa" y construye hoy la resolución diferida que decidimos no construir).

Coste aceptado: ~33 % de inflación base64 (peor caso realista ~13 MB de JSON) y bytes en
memoria durante el parse. Asumible a la escala objetivo; los límites de tamaño (abajo)
mantienen los envelopes dentro de ella.

**Vía de evolución (sin cambio de formato ni de versión):** `data` es opcional en el
schema. En v1 el export siempre lo rellena; el día que exista la plataforma, podrá emitir
el manifest **sin** `data` y el SDK resolverá los bytes por `hash` contra el CDN, con
caching content-addressed. Misma estructura, mismo loader.

## Formato (`@zabloo/format`)

```ts
/** Referencia a un asset del manifest, p. ej. "asset:icons/coin.png". */
export type AssetRef = `asset:${string}`;

export interface AssetEntry {
  /** SHA-256 (hex) del contenido. Identidad de contenido: dedup hoy, caching/CDN mañana. */
  hash: string;
  /** MIME, p. ej. "image/png". El formato es genérico; qué MIMEs acepta cada fase lo decide el export. */
  mime: string;
  /** Bytes del contenido decodificado. */
  size: number;
  /** Dimensiones en px (imágenes): el layout puede reservar sitio sin decodificar. */
  width?: number;
  height?: number;
  /** Base64. Opcional en el schema: v1 siempre lo rellena; la plataforma podrá omitirlo (resolución por hash). */
  data?: string;
}

export interface Envelope {
  v: number;
  tokens: Record<string, TokenValue>;
  /** Manifest keyed por id lógico. Opcional: envelopes sin assets siguen válidos tal cual. */
  assets?: Record<string, AssetEntry>;
  views: Record<string, ZNode>;
}
```

- **Id lógico ≠ hash.** Los nodos referencian por id (`asset:hero.png`), estable entre
  exports; el hash es la versión del contenido. Una actualización futura sabe qué
  re-descargar sin que cambien las referencias del árbol.
- **Sintaxis `asset:<id>` como string** — mismo espíritu que `{token}` y `{ bind }`:
  distinguible a simple vista, serializa plano. La usarán `Image.src` (ZAB-13), la TTF
  de F3 y cualquier estilo futuro (background image).
- **Forward-compat gratis**: `assets` es una clave nueva que los SDKs viejos ignoran (ya
  son forward-tolerant); un nodo `Image` desconocido cae en el fallback de tipo
  desconocido ya decidido. **Sin bump de versión** — aditivo dentro de v1.

## Empaquetado en `zabloo export`

**Convención de authoring (Flutter-style):** los assets viven en `src/assets/`; el
authoring los referencia por **path relativo a esa carpeta** (`"hero.png"`,
`"icons/coin.png"`). Ese path relativo es, tal cual, el **id lógico** del manifest.

**Contrato reconciler → export:** los componentes de `@zabloo/react` que aceptan un
asset (el `Image` de ZAB-13) emiten el nodo con el path de authoring en la prop.
`zabloo export` hace una **pasada de recolección** sobre las views ya emitidas:

1. Recorre el árbol buscando props-asset (empezando por `src` de `Image`; la lista de
   props-asset vive en el export, no hardcodeada en el reconciler).
2. Por cada path: resuelve contra `src/assets/`, lee el archivo, calcula SHA-256,
   extrae `width`/`height` leyendo la cabecera del binario (IHDR de PNG, SOF de JPEG —
   parsers propios de ~20 líneas, **sin dependencias nativas** tipo sharp) y codifica
   base64.
3. Reescribe la prop al `AssetRef` final y añade la entrada al manifest. El mismo path
   desde N views → **una sola entrada** (dedup por id).
4. Errores legibles: path inexistente → error con view y nodo; extensión sin MIME
   conocido → error. MIMEs aceptados en F2: `image/png`, `image/jpeg` (`font/ttf` se
   añade a la lista en F3/ZAB-16).

**Límites de tamaño** (constantes del export en v1, no configurables; el resumen del
export imprime el peso total y el desglose por asset):

| Umbral | Acción |
|---|---|
| Asset > 2 MB | warning ("considera comprimir/reescalar") |
| Total > 15 MB decodificado | warning |
| Total > 50 MB decodificado | **error duro** (protege el hot-update) |

`zabloo dev` no cambia en esta issue: al ser el envelope un único JSON, el push
existente ya transporta los assets embebidos (afinar live-reload con imágenes es
ZAB-14).

## Validación (`parseEnvelope`) y helper

Misma filosofía minimal y forward-tolerant que hoy:

- Si `assets` existe: objeto; cada entrada exige `hash` (string no vacío), `mime`
  (string) y `size` (número ≥ 0). `width`/`height`/`data` se comprueban solo si están.
  Campos desconocidos pasan.
- `data` se valida **en forma** (string base64 plausible), sin decodificarlo —
  decodificar MBs para validar sería pagar el coste dos veces.
- No se valida que cada `asset:` referenciado exista en el manifest — la validación
  exhaustiva es F8 (ZAB-37); el export garantiza coherencia en origen, y un ref
  colgante recibe el mismo trato tolerante que un token desconocido.

**Helper compartido:** `@zabloo/format` exporta `decodeAssetData(entry): Uint8Array`
(base64 → bytes). Lo reutilizan renderer-web (ZAB-12) y el preview del CLI; Unity
decodifica en C# (`Convert.FromBase64String`), como hace con el resto del formato.

## Testing

- `format`: envelope con/sin `assets` parsea; entradas inválidas (sin hash, `size` no
  numérico) fallan con mensaje claro; campos extra pasan (forward-compat);
  `decodeAssetData` round-trip.
- `cli` (export): proyecto fixture con imagen → manifest con hash estable, dims
  correctas, ref reescrita a `asset:`; mismo asset en dos views → una entrada; path
  inexistente → error legible con contexto; asset grande → warning visible.
- Parsers de cabecera: unit tests con PNGs/JPEGs mínimos conocidos.

## Fuera de alcance (de esta issue)

- Carga/decodificación en los SDKs y texturas (ZAB-11 Unity, ZAB-12 web).
- El componente `Image` y su spec (ZAB-13) — aquí solo se fija su contrato de
  referencia (`src: AssetRef`, path en authoring).
- Dev loop con assets (ZAB-14).
- Resolución diferida / CDN / caching en disco — la plataforma, cuando exista; el
  formato ya la permite (`data` opcional + `hash`).
- Compresión/optimización de imágenes en el export (reescalado, conversión de formato).
