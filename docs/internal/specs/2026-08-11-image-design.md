# `Image`: spec del componente + render en web — diseño (ZAB-13, F2 B3)

> Aprobado 2026-08-11. Alcance: **spec de props/estados de `<Image>`** en `@zabloo/react`
> e **implementación en `@zabloo/renderer-web`**, sobre la carga de assets de ZAB-12.
> Decisión registrada en `decisions-architecture.md` (2026-08-11, Image). La paridad en
> Unity (ZAB-11 + este componente) se valida en el batch final de cross-target.

## Punto de partida

ZAB-10 fijó el transporte (`assets` en el envelope, refs `asset:<id>`, `Image.src` como
prop-asset del export) y ZAB-12 la carga en web (decode a `ImageBitmap`, texturas
cacheadas por hash, batch por identidad de textura, `contain` centrado y sin tinte).
Lo que faltaba: **la autoría** (`Image` no existía en `@zabloo/react`) y las decisiones
de producto del componente — `fit`, tinte, radius y qué se ve mientras carga.

## `Image` es un primitivo de la IR, no un `Container` con paint de textura

Es la pregunta que la issue pedía argumentar. Se mantiene como **tipo de nodo** (6º del
vocabulario por orden de llegada; hoy la lista es Container, Text, Button, Collapse,
ScrollView, Image, Overlay, Toggle):

1. **Es una hoja con tamaño intrínseco, igual que `Text`.** El measure necesita saber
   que el nodo tiene contenido y cuánto mide (las dims del manifest, sin decodificar).
   `Container` es por definición un nodo cuyo tamaño sale de sus hijos y de sus props de
   layout; un `Container` que a veces se mide como hoja es un `Container` con dos modos.
   El precedente ya existe y es exactamente este: `Text` no es un `Container` con una
   prop `text`.
2. **La referencia de contenido no es estilo.** Meterla en `Style` (`background: asset:…`)
   la haría resoluble por token y sobreescribible por state — es decir, la textura
   cambiaría en `hover` con la misma maquinaria que un color. El contenido de un nodo no
   pertenece a la capa que el tema puede reescribir; el `src` es estructura (y de hecho
   el export lo recolecta como tal, mientras `Style` nunca se recorre buscando assets).
3. **La forward-tolerance ya lo degrada bien.** La regla normativa (2026-08-11, scroll)
   dice que un tipo desconocido se renderiza **como `Container` preservando
   `layout`/`style`/`visible`/`children`**: un SDK viejo que reciba un `Image` pinta su
   fondo redondeado en el hueco correcto. El fallback es literalmente la alternativa que
   se descarta, y sale gratis.
4. **No abre la puerta a un tipo por contenido.** El criterio de vocabulario sigue siendo
   "un tipo nuevo solo cuando fuerza una capacidad nueva": aquí la capacidad es
   **muestrear una textura**, que ni el paint implícito ni ningún primitivo existente
   podían expresar (y que obligó a generalizar el batch en ZAB-12).

## Props

```ts
export type ImageFit = "contain" | "cover" | "stretch";

export interface ImageNode extends NodeBase {
  type: "Image";
  src: AssetRef;      // "asset:logo.png" — el export reescribe el path de autoría
  fit?: ImageFit;     // default "contain"
}
```

```tsx
<Image
  src="logo.png"                       // path relativo a src/assets/
  fit="cover"
  layout={{ width: 88, height: 88 }}
  style={{ color: "{color.primary}", background: "{color.surface}", radius: "{radius.md}" }}
/>
```

**Dos props y nada más.** Todo lo demás del enunciado de la issue (tinte, radius,
placeholder) se resuelve con estilo que ya existe — el set de `Style` sigue cerrado
(2026-08-06) y los states siguen siendo el único mecanismo de variación por estado.

### `src` — estático, nunca binding

Es el path de autoría relativo a `src/assets/`; `zabloo export` lo hashea, lo inlinea y
reescribe la prop a `asset:<id>` (ZAB-10). Un binding es imposible por construcción: el
export recolecta los bytes en tiempo de autoría, así que un `src` dinámico no tendría
manifest que resolver. El export ya falla con mensaje claro si recibe un objeto.

### `fit` — todos los modos pintan DENTRO del rect

| `fit` | Caja pintada | UVs |
|---|---|---|
| `contain` (default) | rect ajustado al aspect ratio, centrado (letterbox) | textura completa |
| `cover` | el rect entero | **ventana recortada** y centrada en el eje que sobra |
| `stretch` | el rect entero | textura completa (distorsiona) |

`cover` **recorta por UVs, no desborda geometría**. Es lo que mantiene la invariante que
ya dictó el borde inset (2026-08-06): *nada pinta fuera del rect de layout*, así que el
hit-testing por rects sigue siendo honesto y no hace falta `clip` (que además todavía no
existe en el renderer web). Además evita el orden de pintado patológico de un desbordado
real, donde la imagen taparía a sus hermanos según el recorrido del árbol.

Default `contain` porque es el único modo que no miente sobre el contenido: ni recorta ni
distorsiona.

### Tinte = `style.color`

`color` pasa a significar, uniformemente, **"el color del contenido de este nodo"**: los
glifos en `Text`, los píxeles en `Image`. Sin `color`, blanco → la imagen tal cual (el
shader ya multiplica textura × color de vértice, así que el tinte no cuesta nada).

Ventaja decisiva sobre una prop `tint` propia: **los states tintan gratis**
(`states.disabled.style.color`), sin duplicar en el nodo un mecanismo que ya vive en
`Style`, y las transiciones de F7 lo animan sin tocar nada (`color` ya está en la lista
de animables). Un icono monocromo exportado en blanco se tematiza entero por tokens.

### `style.radius` recorta la imagen

El quad pasa a ser el **mismo abanico rounded-rect que el fondo**, con las UVs derivadas
de la posición del vértice dentro de la caja pintada. Sin esto, una imagen dentro de un
panel redondeado asoma por las esquinas — y no hay `clip` en web para taparlo. El radius
se clampa a la **caja pintada**, no al rect: con `contain` la caja es menor que el rect,
y redondear sobre el rect dejaría esquinas cuadradas visibles.

### Placeholder = el propio `style` del nodo

**No hay estado `loading`.** Mientras el decode está en vuelo, el nodo pinta solo lo
suyo (`background`, `borderWidth`) y el layout ya reservó el hueco con las dims del
manifest: el placeholder se **autora**, no es un estado del runtime.

Razones: (a) el vocabulario de states es cerrado y cada uno nuevo lo paga cada SDK;
(b) en Unity la textura puede estar lista de forma síncrona, así que un `loading` sería
un estado que en un target no se ve nunca — es decir, contenido que se ve distinto según
el motor, justo lo que la IR existe para evitar; (c) el resultado autorado es mejor: un
fondo `{color.surface}` con el mismo `radius` que la imagen es exactamente el skeleton
que se querría dibujar. Si algún día hace falta un cross-fade al aterrizar, lo cubre
`transition` sobre `opacity`, no un state nuevo.

### Tamaño

Hoja con tamaño intrínseco: sin `layout.width`/`height`, mide **los píxeles del
manifest** (sin decodificar — para eso B1 guardó `width`/`height`). Con dims explícitas,
mandan ellas y `fit` decide cómo se llena la caja. `padding` se comporta como en
cualquier hoja (rodea el contenido).

## Implementación (web)

- `fitImage(rect, w, h, fit) → { rect, uv } | null` en el tessellator: una función pura
  que resuelve caja + ventana de UV, testeada aparte de la geometría.
- `GeometryBuilder.image(rect, asset, { fit, color, radius })`: camino rápido de 4
  vértices cuando `radius ≈ 0`; si no, centroide + `perimeter()` (la misma
  parametrización que `roundedRect`, la misma que el SDK de Unity) con UVs interpoladas.
- `view.ts` resuelve `style.color` (default blanco) × opacidad heredada y `style.radius`
  como cualquier otro estilo — el paint del `Image` no tiene ninguna resolución propia.
- Sin cambios en `gl.ts`, en el `ImageLibrary` ni en el export: `ASSET_PROPS.Image.src`
  ya existía desde ZAB-10.

## Autoría

`<Image>` se suma a la lista de primitivos del host (`HostType`) y se exporta desde
`@zabloo/react`. Dos errores de autoría, en el mismo sitio que los de `Collapse`/`Toggle`:
`src` vacío o ausente, e hijos (es una hoja).

## Testing

- `renderer-web`: `fitImage` (los tres modos, el recorte centrado de `cover`, "nunca
  fuera del rect" para cualquier fit, null sin tamaño usable); `image()` (quad con UVs
  recortadas, tinte como color de vértice, abanico redondeado con UVs en 0..1 y vértices
  dentro del rect, radius clampado a la caja pintada, nada mientras no hay bitmap).
- `react`: emisión de `Image` (path de autoría intacto, `fit` omitido en el default),
  y los dos errores.
- End-to-end manual: proyecto starter → `zabloo export` (manifest con hash + dims, ref
  reescrita) → preview `zabloo dev` con los tres `fit`, radius, tinte y tamaño
  intrínseco lado a lado.

## Fuera de alcance

- **Unity**: el componente en C# y la paridad visual (batch final de cross-target).
- Atlas de imágenes (varias en un draw call), mipmaps y filtrado configurable — ZAB-12
  ya los dejó diferidos; siguen sin pedirlos la escala ni el contenido.
- `nine-slice` / bordes escalables: es paint nuevo (no un `fit`), y llegará con la capa
  de paint explícito si llega.
- Alineación del contenido dentro del rect en `contain` (hoy siempre centrado) y
  `objectPosition` para `cover`: extensiones compatibles el día que un caso real las
  pida.
- Animación de entrada al aterrizar el decode (la haría `transition` sobre `opacity`,
  ya en F7).
