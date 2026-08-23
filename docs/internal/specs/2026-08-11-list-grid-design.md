# Spec: `<List>` / `<Grid>` — la capa de autoría del `Repeat` (2026-08-11, ZAB-32)

> Tarea Linear: [ZAB-32] — milestone **F6 — Listas de datos**, track A6.
> Alcance entregado: `<List>`/`<Grid>` en `@zabloo/react` + `wrap` en el subset de
> layout de `@zabloo/format` + esta spec y la decisión. El contrato de la IR ya
> estaba cerrado en ZAB-29; **32 emite, 31 consume**: el pintado (y la
> virtualización) es ZAB-31 y Unity es ZAB-30. Verificación **por tests de emisión
> de IR**, porque hasta que ZAB-31 mergee no hay nada que dibuje un `Repeat`.

## Contexto y problema

ZAB-29 dejó el `Repeat` cerrado y con sus reglas escritas: `items` bindea el array,
`as` declara el alias del ámbito, `key` es un path relativo a la identidad, y los
slots son posicionales — `children[0]` es el template y `children[1..]` el estado
vacío. Nada de eso es escribible hoy desde JSX: `@zabloo/react` no conoce el tipo.

La pregunta de esta tarea es una sola, y es de **autoría**: cómo se escribe un
template que se emite **una vez** y se instancia N veces en el SDK. Y arrastra una
segunda que ZAB-29 dejó explícitamente aquí: un `<Grid>` de N columnas necesita
`wrap`, que el subset Yoga v1 no tiene.

## Decisión 1: azúcar sobre `Repeat`, y el primitivo no se exporta

`<List>` y `<Grid>` son **azúcar de autoría**, no tipos de la IR: los dos emiten un
`Repeat` y se diferencian solo en el `layout` que le ponen. Es exactamente lo que
ZAB-29 previó al decidir que **el `Repeat` ES el contenedor flex de las instancias**.

El primitivo `Repeat` **no se exporta**, mismo trato que `Toggle` (ZAB-23) y `Slider`
(ZAB-24) y por la misma razón: sus slots son posicionales, así que la convención se
escribe **en un solo sitio** en vez de en cada llamada. Quien construya un `Repeat` a
mano por el host (`h("Repeat", …)`) sigue teniendo las validaciones, pero no es la
puerta soportada.

| Componente | Layout que pone | Para qué |
|---|---|---|
| `<List axis="vertical">` (default) | `direction: "column"` | la lista de siempre |
| `<List axis="horizontal">` | `direction: "row"` | un carrusel, una fila de cartas |
| `<Grid columns={n}>` | `direction: "row"`, `wrap: true`, `width` resuelto | rejilla de inventario |

## Decisión 2: el template se escribe de las dos formas, y el alias vive en un sitio

El template admite **children planos** o una **render-prop**:

```tsx
// children planos: el alias se escribe a mano, como en el JSON
<List items="shop.items" as="it">
  <Text bind="it.name" />
</List>

// render-prop: el alias lo pone el componente
<List items="shop.cats" as="cat">
  {(cat) => (
    <Column>
      <Text bind={cat("name")} />
      <List items={cat("items")} as="it">
        {(it) => (
          <Row>
            <Text bind={it("name")} />
            <Text bind={cat("id")} />   {/* la categoría, desde dentro del producto */}
          </Row>
        )}
      </List>
    </Column>
  )}
</List>
```

Las dos emiten exactamente la misma IR — la función se ejecuta **una vez**, en
authoring, como cualquier componente de usuario. Lo que aporta la render-prop no es
brevedad sino que **el alias deja de estar duplicado**: renombrar `as` mueve todos los
bindings del template con él. Eso es lo que hace legible el caso anidado, que es
justo el que ZAB-29 se molestó en hacer alcanzable con `as` declarado.

El objeto que recibe es un `ItemRef`, deliberadamente pequeño:

| Llamada | Resultado con `as="cat"` |
|---|---|
| `cat("name")` | `"cat.name"` |
| `cat("price.amount")` | `"cat.price.amount"` |
| `cat()` | `"cat"` — el elemento entero |
| `cat.$index` | `"cat.$index"` — la posición |

Es un **constructor de strings**, no un proxy: `bind` sigue siendo un string y la
resolución sigue siendo del SDK (`resolveBinding`). Authoring no interpreta ningún
path, ni sabe qué hay en los datos.

**Descartado un proxy** (`item.price.amount` sin llamar): más bonito en la línea
feliz, pero mete un objeto mágico donde el resto del catálogo tiene props planas, y
no se distingue de un typo (`item.pricee` devolvería un binding roto tan válido como
el bueno). El paréntesis se lee peor y falla igual, pero no finge ser otra cosa.

**Descartado el render-prop obligatorio**: rompería la simetría con todo el catálogo,
que toma children, y obligaría a una función para pintar una fila estática.

## Decisión 3: `keyPath`, `items` string, `empty` como prop

- **`items` es un string** (`items="shop.items"`), no `{ bind }`: en el `Repeat`
  **siempre** es un binding, así que el objeto sería ceremonia pura. Es el mismo
  criterio que `<Text bind="player.gold">`.
- **`key` se llama `keyPath`** en el componente: `key` es de React y no llega a las
  props. El nombre además dice lo que es — un *path relativo al item*, no la key ya
  leída (que es lo que devuelve `itemKey()` en `@zabloo/format`).
- **El estado vacío es la prop `empty`**, no unos children posicionales. En el JSON el
  slot es posicional porque el JSON no tiene nombres; en JSX sí los hay, y hacer que
  "el segundo hijo signifique otra cosa" es justo el tipo de trampa que la prop
  elimina. `empty` acepta uno o varios nodos y aterriza en `children[1..]`.

De ahí sale la única restricción de forma: **el template de `<List>` es un solo
nodo**, porque `children[0]` *es* el template. Dos nodos sueltos, o un fragmento, es
un error de autoría con un mensaje que manda envolverlos en `<Row>`/`<Column>` — la
misma familia de error que "una vista emite exactamente una raíz".

## Decisión 4: `wrap` entra en el subset de layout

El hueco que ZAB-29 dejó apuntado se cierra por el lado del **layout**, no
inventándole una forma nueva al `Repeat`:

```ts
export interface Layout {
  // … direction, justify, align, gap, padding, width/height, grow
  /** Rompe el eje principal en varias líneas cuando los hijos no caben. Default: false. */
  wrap?: boolean;
}
```

Una rejilla **es** una fila que envuelve, y con `wrap` lo es para cualquier nodo, no
solo para un `Repeat`: la capacidad es del layout y ahí se queda. `justify`/`align`
siguen significando lo suyo **dentro de una línea**, y la distribución de las líneas
entre sí (`align-content` de Yoga) **NO entra** — las líneas se apilan desde el
principio, que es lo único que una rejilla de filas iguales puede distinguir.

**Descartados `Repeat` anidados por fila** (la otra salida que apuntaba ZAB-29):
obligaría al juego a mandar los datos ya troceados en filas — un array de arrays cuya
forma depende del ancho de la pantalla. Los datos son del juego; la disposición es de
la UI.

**Forward-tolerance:** aditivo y sin bump. Un SDK que no conoce `wrap` lo ignora como
cualquier prop desconocida y coloca los hijos en una sola línea: la fila se desborda
(y se recorta, si el nodo recorta), pero no se pierde contenido ni se rompe el resto
de la pantalla. Implementarlo en el pase de flexbox es del renderer (ZAB-31 y su
contraparte Unity): **esta tarea emite `wrap`, no lo pinta.**

## Decisión 5: la geometría del `<Grid>` se resuelve en authoring

`<Grid columns={4} itemWidth={72} layout={{ gap: 8 }}>` emite:

```jsonc
{ "type": "Repeat", "items": { "bind": "inventory.slots" },
  "layout": { "direction": "row", "wrap": true, "gap": 8, "width": 312 },
  "children": [
    { "type": "Container", "layout": { "width": 72 }, "children": [ /* template */ ] }
  ] }
```

Dos cosas que no son obvias:

1. **`columns` no viaja a la IR: se convierte en aritmética.** v1 no tiene dims
   fraccionarias (nada expresa "un cuarto de mi padre" — es el mismo límite que hizo
   primitivo al `ProgressBar`), así que "4 por línea" solo puede ser *un ancho de
   celda y un ancho de línea que cuadren*. El componente resuelve el que falte:
   `itemWidth` → `width = columns·itemWidth + (columns−1)·gap + 2·padding`, o
   `layout.width` → `itemWidth = (width − huecos) / columns`. Sin ninguno de los dos,
   error de autoría.
   El redondeo va **en la dirección que preserva la rejilla**: el ancho de línea se
   redondea hacia **arriba** y el de celda hacia **abajo**, porque `n·w` sumado de
   golpe y sumado celda a celda no tienen por qué caer en el mismo float, y un pelo de
   menos empuja la última celda a la línea siguiente. La holgura sobrante es
   subpíxel (o los px que no reparte una división inexacta).
2. **Por eso `gap`/`padding` deben ser números aquí**, y un token (`"{space.2}"`) es
   un error con su mensaje: un token se resuelve **dentro del SDK**, demasiado tarde
   para una suma que ocurre en `zabloo export`. Es el precio de no tener porcentajes,
   y está acotado a `<Grid>`: `<List>` acepta tokens en todo como cualquier nodo.

**La celda es un `Container` por item** (estilable con la prop `cell`), y es lo que
lleva el ancho. Se paga un nodo por elemento; a cambio el ancho no depende de que la
raíz del template resulte ser un primitivo con `layout` (podría ser un componente de
usuario, al que inyectarle `layout` no haría nada). Como el `<Grid>` ya tiene esa
celda, ahí el template **sí** puede ser varios nodos.

## Props, estados y eventos

Ambos heredan `CommonProps` (`id`, `visible`, `layout`, `style`, `states`,
`transition`, `variant`, `autofocus`, `clip`) como cualquier primitivo.

| Prop | Tipo | En `List` | En `Grid` | Qué hace |
|---|---|---|---|---|
| `items` | `string` (requerida) | ✅ | ✅ | path del array; siempre binding |
| `as` | `string` | ✅ | ✅ | alias del template. Default `"item"` |
| `keyPath` | `string` | ✅ | ✅ | path relativo a la identidad → `key` en la IR |
| `empty` | `ReactNode` | ✅ | ✅ | estado vacío → `children[1..]` |
| `children` | nodo o `(item: ItemRef) => nodo` | 1 nodo | N nodos | el template |
| `axis` | `"vertical" \| "horizontal"` | ✅ | — | default `"vertical"` |
| `columns` | `number` (requerida) | — | ✅ | items por línea |
| `itemWidth` | `number` | — | ✅ | ancho de celda en px (o se deduce de `layout.width`) |
| `cell` | props de `Container` | — | ✅ | estilo de la celda |

**Estados:** ninguno propio. El `Repeat` no tiene estado de runtime (a diferencia de
`Collapse`/`Toggle`/`ScrollView`): lo que el SDK guarda por item — foco, `checked`,
offset, transición a medias — se lo guarda a **los nodos instanciados**, y `keyPath`
es lo que hace que viaje con el elemento. `states` y `variant` sobre el `<List>`
estilan **el contenedor**, no los items; un item se estila en su template.

**Eventos:** ninguno propio. Las acciones nacen **dentro** del template
(`<Button onClick="buy">`) y el SDK las dispara con el `ActionContext {path, key,
index}` de ZAB-29 — el authoring no las toca, solo las copia. Igual con los bindings
de lectura/escritura: un `<Checkbox checked={{ bind: it("enabled") }}>` dentro de una
fila escribe en `shop.items.3.enabled` y vuelve por `onDataChanged`, sin API nueva.

**Errores de autoría** (todos con mensaje explícito, como el resto del paquete):

| Cuándo | Mensaje |
|---|---|
| sin `items` | *need an `items` data path* |
| sin template | *need an item template as their children* |
| template de `<List>` con >1 nodo o un fragmento | *is a single node — wrap … in a `<Row>` or `<Column>`* |
| `columns` no entero o < 1 | *must be an integer >= 1* |
| `<Grid>` sin `itemWidth` ni `layout.width` | *pass `itemWidth`, or a numeric `layout.width`* |
| `gap`/`padding` tokenizados en `<Grid>` | *must be a number of px here* |
| `columns` que no caben en el ancho | *does not fit in Npx* |

## Fuera de alcance

- **Pintarlo**: `Repeat` y `wrap` en el renderer web son ZAB-31; Unity, ZAB-30.
  Nada de esto se ve en pantalla hasta entonces, y el criterio de salida de esta
  tarea es la emisión de IR verificada por tests.
- **Virtualización y presupuesto de rendimiento** (cientos de items): ZAB-31, que es
  donde vive el reciclado. Las `keyPath` de aquí son lo que lo hace posible.
- **Ordenar / filtrar / paginar**: sería lógica declarativa. El juego manda el array
  que quiere pintar.
- **Rejilla de N filas** (envolver por columnas) y `align-content`: cuando algo los
  pida; hoy `wrap` es fila-primero.

## Superficie entregada

| Dónde | Qué |
|---|---|
| `@zabloo/format` | `Layout.wrap` |
| `@zabloo/react` | `List`, `Grid`, `ListProps`, `GridProps`, `RepeatProps`, `ItemRef`, `ItemTemplate` |
| `@zabloo/react` (host) | `"Repeat"` en el vocabulario host + serialización y validación de slots |

Tests: emisión completa de `<List>` (template + estado vacío), equivalencia
render-prop ↔ children planos, alias por defecto / `$index` / elemento entero, eje
horizontal, listas anidadas alcanzando el elemento de fuera, componentes de usuario
aplanados dentro del template, geometría del `<Grid>` por los dos caminos y su
redondeo, y cada error de autoría. Los casos en JSX viven en `list.test.tsx`, porque
`createElement` tipa un hijo-función como `ReactNode` y la forma documentada
(la función entre las etiquetas) hay que probarla tal cual se escribe.
