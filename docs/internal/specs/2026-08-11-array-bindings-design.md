# Spec: array bindings — `Repeat`, ámbito de item y acciones con contexto (2026-08-11, ZAB-29)

> Tarea Linear: [ZAB-29] — milestone **F6 — Listas de datos**, track A4.
> Alcance entregado: **solo el contrato de la IR** (`@zabloo/format`: tipos,
> resolución normativa de paths, identidad de item) + esta spec + la decisión.
> La instanciación en web es ZAB-31, en Unity ZAB-30, y `<List>`/`<Grid>` en
> `@zabloo/react` es ZAB-32. Ningún SDK toca esta tarea.

## Contexto y problema

Es la última capacidad cara de la IR y la más delicada de diseñar del roadmap. Hasta
aquí los datos cambiaban **valores** de nodos que ya existían (`text`, `visible`,
`checked`). Una lista cambia **cuántos nodos hay**: la estructura del árbol pasa a
depender de los datos. Eso arrastra cuatro preguntas que se contestan aquí de una vez,
porque contestar solo una deja el resto sin sitio:

1. Qué forma tiene el repetidor y cómo se declara el template de item.
2. Cómo bindea el template contra "su" elemento (y contra el de fuera, si anida).
3. Qué identifica a un item, para que un `SetData` que reordena no revuelva el estado
   que el SDK guarda por nodo (foco, `checked`, offset de scroll, transición en curso).
4. Qué le llega al juego cuando se pulsa un botón **dentro** de un item.

## Decisión 1: `Repeat`, 9º primitivo

```ts
export interface RepeatNode extends NodeBase {
  type: "Repeat";
  /** El array. Siempre binding: los datos no viven en la IR. */
  items: { bind: string };
  /** Alias del ámbito de item dentro del template. Default: "item". */
  as?: string;
  /** Path RELATIVO al item hacia su identidad estable ("id", "meta.sku"). */
  key?: string;
  /** children[0] = template de item; children[1..] = estado vacío. */
  children?: ZNode[];
}
```

Entra por la puerta de siempre (*primitivo nuevo solo cuando fuerza una capacidad
nueva*) y la capacidad es **estructura dirigida por datos**: el primer nodo cuyos
hijos no salen del documento.

**Descartado `each` como prop de `Container`**, que habría dejado el vocabulario en 8:
el SDK pasaría a despachar comportamiento **por tipo Y por prop**, exactamente el
argumento que hundió `checkable` en `Button` (ZAB-23) y `overflow` en `ScrollView`
(ZAB-5). Además un `Container` cuyos `children` no son sus children rompe la lectura
del árbol para cualquiera que lo mire — humano o editor visual.

**Descartado un `List` con eje y columnas:** mezcla repetición con disposición, que el
flex ya sabe hacer, y ocuparía el nombre que ZAB-32 quiere para el azúcar de autoría.

**El `Repeat` ES el contenedor flex de las instancias**: su propio `layout`
(`direction`, `gap`, `padding`, `justify`, `align`) coloca los items. Por eso
`<List axis>` y `<Grid columns>` pueden ser azúcar sobre él y no tipos nuevos de la IR.
*Hueco conocido, para ZAB-32:* el subset Yoga v1 no tiene `wrap`, así que un `<Grid>`
de N columnas necesitará `wrap` (ampliación del subset) o `Repeat` anidados por fila.
No se resuelve aquí.

## Decisión 2: el ámbito de item se declara (`as`), no se reserva

Dentro del template, `{ bind: "item.name" }` resuelve contra el elemento actual. El
alias es **declarado** (`as`, default `"item"`) en vez de una palabra reservada, y eso
es lo que hace alcanzable el caso anidado:

```jsonc
{ "type": "Repeat", "items": { "bind": "shop.cats" }, "as": "cat",
  "children": [
    { "type": "Repeat", "items": { "bind": "cat.items" }, "as": "it",
      "children": [
        { "type": "Text", "text": { "bind": "it.name" } },
        // el id de la categoría, desde dentro del producto
        { "type": "Button", "onClick": "buy", "visible": { "bind": "cat.enabled" } }
      ] } ] }
```

Con un `item` reservado, el template interior **sombrea** al exterior y no hay forma de
alcanzar la categoría desde el producto. Una tienda real lo necesita.

**Reglas de resolución** (`resolveBinding` en `@zabloo/format` es la referencia
normativa, como `easeProgress`):

| Entrada | Resultado |
|---|---|
| `"item.name"` con ámbito `item → shop.items.3` | path `shop.items.3.name` |
| `"item"` (alias pelado) | path `shop.items.3` — el elemento entero |
| `"item.$index"` | **índice** `3`, que no es un path: no está en los datos |
| `"item.a.$index"` | path `shop.items.3.a.$index` — solo la hoja exacta está reservada |
| `"player.gold"` (alias no reconocido) | path `player.gold`, intacto |

El ámbito **más interno gana**. Consecuencia aceptada y documentada: un alias
**sombrea una raíz absoluta que se llame igual** (`as: "player"` deja `player.gold`
inalcanzable dentro de ese template). Se resuelve eligiendo nombres que no sean raíces
de datos; validarlo es de ZAB-37 (validación robusta), no de aquí.

### Los paths pasan a tener estructura

Es el efecto de fondo de esta decisión. Hasta ahora un path era una **clave opaca**
del store (`player.gold` es literalmente la clave). Con arrays, un path es una
**dirección dentro de los datos**: `shop.items.3.name` recorre objeto → array →
objeto. `readPath` fija esa semántica para los tres targets:

- separador `.`, y un segmento **numérico** indexa un array — nada más lo hace
  (`items.length` no es un campo);
- lo que falte, o lo que se recorra a través de un primitivo, devuelve `undefined`;
  nunca lanza. La UI bindeada degrada a "sin valor", no rompe el frame.

**Y esto vale también para escribir.** Los bindings de lectura/escritura de ZAB-23
siguen funcionando dentro de un item: un `Toggle` con `checked: {bind:
"item.enabled"}` escribe en `shop.items.3.enabled` y el juego lo recibe por el
callback único, `onDataChanged("shop.items.3.enabled", true)`. Sin API nueva por
componente y sin canal nuevo.

## Decisión 3: identidad de item — `key` relativo, con espacios disjuntos

`key` es un path **relativo al item** hacia un campo estable (`"id"`, `"meta.sku"`).
Sin `key`, la identidad es **posicional**.

Para qué sirve: la identidad es lo que el SDK usa para reconciliar tras un `SetData`
que reordena, inserta o borra. Con `key`, el estado que el SDK guarda por nodo — foco,
`checked` de un Toggle de la fila, offset de un ScrollView interno, transición a medias
— **viaja con el item**; sin `key`, se queda clavado a la posición. Es también lo que
hace posible la virtualización de ZAB-31: reciclar instancias exige saber cuál es cuál.

Dos funciones, no una, porque son dos conceptos distintos:

- **`itemKey(item, keyPath)` → `string | number | undefined`**: la key **cruda**, la
  que viaja al juego. Solo un string no vacío o un número finito identifican; un
  objeto, un campo ausente o `""` significan "este elemento no tiene key".
- **`itemIdentity(key, index)` → `string`**: la clave de reconciliación **interna del
  SDK**. Con key → `"k:<key>"`; sin ella → `"<index>"`.

**El prefijo no es decoración: mantiene los dos espacios disjuntos.** En una lista
donde solo algunos elementos resuelven su `key`, `{id: "0"}` y el elemento sin key en
la posición 0 compartirían identidad y heredarían el estado del otro. Es el detalle
que un test caza y el navegador no.

## Decisión 4: las acciones dejan de volver vacías — `ActionContext`

Un `onClick: "buy"` dentro de un item tiene que decir **cuál**. La acción pasa a
llevar un contexto opcional cuando nace dentro de un item repetido:

```ts
export interface ActionContext {
  path: string;            // "shop.items.3" — ruta absoluta del item
  key?: string | number;   // la key cruda; ausente si la lista es posicional
  index: number;
}
```

Es el mismo movimiento que ZAB-23 hizo con los datos (`onDataChanged(path, value)`),
ahora del lado de las acciones: el mecanismo se mantiene en **dos** (acciones con
nombre + bindings), y el que faltaba deja de volver sin información. Fuera de un
`Repeat`, la acción sigue disparándose sin contexto: nada cambia para el catálogo
existente.

El contexto describe el item **más interno**, y con eso basta para listas anidadas
porque `path` ya lleva dentro todos los índices de fuera (`shop.cats.2.items.5`): el
juego reconstruye la cadena entera desde ahí sin que la IR tenga que mandar una pila.

**Descartado "solo la key"** (el juego no recibiría el path absoluto y tendría que
reconstruirlo para su `SetData` de vuelta) y **"sin payload, correlacionando por
datos"** (exigiría lógica declarativa que la IR no tiene, por diseño).

## Decisión 5: el estado vacío es un slot, no una expresión

Convención posicional, la misma familia que el header de `Collapse` y los slots del
`Toggle`:

| Índice | En layout cuando | Qué contiene |
|---|---|---|
| `children[0]` | siempre (una vez por elemento) | el **template** de item |
| `children[1..]` | el array está vacío, ausente o no es un array | el **estado vacío** |

Sin el slot, "muéstrame *No hay items*" pediría una expresión booleana sobre los datos
(`items.length === 0`) y **la IR no tiene expresiones, por diseño**. Un valor bindeado
que no es un array cuenta como vacío: comportamiento determinista, sin error, en línea
con `readPath`.

## Forward-tolerance y degradación

`parseEnvelope` **no cambia**, igual que en ZAB-19: la tolerancia a lo desconocido *es*
la spec — el parser valida el sobre y la versión mayor, no los nodos. Lo estructural de
`Repeat` (que `items` sea un binding y no datos literales; que `key` sea un path) se
enforcea **en tipos**, y su validación en runtime es de ZAB-37 (F8), donde vive el
recorrido del árbol.

**Qué ve un SDK pre-F6:** `Repeat` es un tipo desconocido, así que cae en la regla
normativa de ZAB-5 — se renderiza como `Container` preservando `layout`/`style`/
`visible`/`children`. El resultado es **una copia estática del template con los
bindings de item sin resolver** (un `item.name` no coincide con ninguna clave del store
→ texto vacío), seguida del estado vacío. Se pierde la lista; no se pierde ni la
pantalla ni el resto del contenido. Es la degradación correcta para contenido
hot-updateado por delante del SDK instalado.

## Fuera de alcance (y por qué no queda foreclosed)

- **Virtualización / reciclado**: es asunto del renderer (ZAB-31), no del formato. La
  IR no lleva hints de tamaño de item; las **keys** son justo lo que la hace posible.
- **Ordenar/filtrar/paginar en la IR**: sería lógica declarativa. El juego manda el
  array que quiere pintar; `SetData` ya es el canal.
- **Validar el alias** (que no choque con una raíz de datos): ZAB-37.
- **`wrap` en el subset de layout**, que `<Grid>` necesitará: ZAB-32.

## Superficie entregada en `@zabloo/format`

| Export | Qué es |
|---|---|
| `RepeatNode`, en la unión `ZNode` | el 9º tipo |
| `ItemScope`, `ResolvedBind` | la pila de ámbitos y el resultado de resolver |
| `resolveBinding(bind, scopes)` | resolución normativa de paths relativos |
| `readPath(root, path)` | lectura por segmentos, con índices numéricos |
| `itemPath(arrayPath, index)` | `"shop.items" + 3 → "shop.items.3"` |
| `itemKey(item, keyPath)` | la key cruda para `ActionContext` |
| `itemIdentity(key, index)` | la clave de reconciliación del SDK |
| `ActionContext` | forma normativa del payload de acción |
| `ITEM_ALIAS`, `INDEX_SEGMENT` | `"item"`, `"$index"` |

Las funciones puras son **la referencia literal que porta cada SDK**, el mismo papel
que `easeProgress` (ZAB-33): si los tres targets no calculan el mismo path y la misma
identidad, el mismo envelope con los mismos `SetData` deja de dar el mismo resultado —
que es el criterio de cierre de ZAB-30 y ZAB-31.
