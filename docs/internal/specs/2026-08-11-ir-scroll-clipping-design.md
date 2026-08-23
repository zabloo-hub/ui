# Spec: scroll y clipping en la IR — `clip` + primitivo `ScrollView` (2026-08-11, ZAB-5)

> Tarea Linear: [ZAB-5] — milestone **F1 — Scroll y clipping**. Alcance de ZAB-5: el
> **contrato de la IR** (tipos + validación en `@zabloo/format`) y el registro de la
> decisión. La implementación en teseladores/SDKs y el `<ScrollView>` de
> `@zabloo/react` son las siguientes tareas de F1.

## Contexto y problema

F1 desbloquea pantallas reales: contenido más alto que la vista. La pregunta de la
tarea es cómo entra el scroll en la IR: ¿primitivo `ScrollView` propio o prop
`overflow`/`scroll` en `Container`? La tensión: vocabulario cerrado (cada primitivo es
un contrato forever ×3 motores) vs prop genérica (degrada mejor en SDKs viejos… en
principio).

## Decisión (aprobada): dos capacidades, dos superficies

El clipping y el scroll son capacidades distintas y reciben el tratamiento que la
arquitectura ya prescribe para cada una:

1. **Clipping = prop de paint `clip?: boolean` en `NodeBase`.** Recortar la
   teselación del subárbol al rect del nodo es puro paint (como `opacity`) — cero
   estado, cero input — así que la regla "behavior keyed by component type" no
   aplica y no justifica un tipo. Cualquier nodo con hijos puede recortar
   (`overflow: hidden` sin scroll: cards, ProgressBar en F7…).
2. **Scroll = primitivo `ScrollView` (5º).** El scroll es el sistema de
   comportamiento más pesado hasta la fecha (estado de offset en runtime + input
   continuo de rueda/drag + scrollbar pintado por el SDK + interacción futura con
   focus). Entra por la puerta legítima del vocabulario: *"new primitives only when
   they force a new system capability"* — igual que `Collapse` con el relayout.
   El comportamiento queda indexado por identidad, como Button y Collapse; la
   focusabilidad/hit-testing siguen derivando de identidad (2026-08-04).

Alternativas descartadas:

- **Prop única `overflow: "visible" | "hidden" | "scroll"` en Container** (modelo
  CSS): rompe "behavior lives in the SDK, keyed by component type" — el SDK pasaría
  a despachar comportamiento por tipo O por prop, dos mecanismos. La supuesta
  ventaja de degradación se neutraliza con el fallback normativo (abajo).
- **Solo `ScrollView`, sin clip independiente**: obligaría a un ScrollView "capado"
  para el caso `overflow: hidden`; un primitivo cuyo único trabajo a veces es
  recortar es un mal contrato forever.

## Contrato IR (tipos en `@zabloo/format`)

```ts
interface NodeBase {
  // ...existente...
  /** Recorta paint y hit-testing de los hijos al rect de layout de este nodo (paint-only). */
  clip?: boolean;
}

export interface ScrollViewNode extends NodeBase {
  type: "ScrollView";
  /** Eje scrolleable. Default: "vertical". */
  axis?: "vertical" | "horizontal" | "both";
  /** Indicador overlay de posición. Default: true. */
  scrollbar?: boolean;
  children?: ZNode[];
}

export type ZNode = ContainerNode | TextNode | ButtonNode | CollapseNode | ScrollViewNode;
```

- `clip` va en `NodeBase`, **no en `Style`**: `Style` es el set de valores
  tematizables (tokens, overrides por estado); `clip` es configuración estructural
  de paint, un booleano que ni se tokeniza ni cambia por estado. Su paralelo es
  `visible`, no `background`.
- **`ScrollView` implica `clip`** — siempre recorta; un `clip: false` explícito se
  ignora (scroll sin recorte no significa nada).
- **Sin offset inicial ni offset bindeable en v1** (ScrollTo/auto-scroll de focus →
  F5, entra después como prop opcional forward-tolerant).
- **`scrollbar` es booleano**: en F1 el indicador lo pinta el SDK con estilo por
  defecto. Estilizarlo (tokens) es extensión futura compatible (booleano → unión u
  objeto sin romper).

## Semántica (spec para los teseladores/SDKs — implementación en otras tareas)

**Layout.** El ScrollView es un flex container normal por fuera (su tamaño =
`width`/`height`/`grow`, como cualquier nodo) y por dentro
(`direction`/`justify`/`align`/`gap`/`padding` aplican a los hijos). La única
diferencia está en la medición: **en el eje scrolleable los hijos se miden sin
restricción** — el contenido mide su tamaño natural y eso define el *content size*
(el padding cuenta como contenido). Desplazamiento máximo:
`max(0, contentSize − viewport)`. En el eje no scrolleable, restricción normal;
`axis: "both"` = ambos ejes sin restricción.

**Offset = estado del runtime, propiedad del SDK** (como `pressed` de Button u
`open` de Collapse): no se serializa; se reclampa en cada relayout (si el contenido
encoge — p. ej. un Collapse dentro del scroll se cierra — el offset se ajusta al
nuevo máximo). El scroll se aplica como traslación de los rects de los hijos en
paint/hit-testing.

**Hit-testing y focus usan los rects trasladados** (posiciones en pantalla). El
clip recorta **paint y hit-testing**: un hijo desbordado ni se pinta ni recibe
input fuera del rect (recortar solo paint dejaría botones invisibles pulsables).
El rect efectivo de un nodo = intersección con el clip de sus ancestros — la
premisa "hit-testing = rects de layout" sigue honesta. Nodo focusable fuera de la
región visible: en F1 no se auto-scrollea hasta él (ScrollTo diferido); sigue
alcanzable con rueda/drag. Nota para teseladores: el borde inset (2026-08-06)
garantiza que nada pinta fuera del rect ⇒ el clip por scissor rectangular es
exacto, no puede cortar un borde.

**Scrollbar**: overlay pintado por el SDK dentro del rect del ScrollView, en el
borde del eje (derecha / abajo); largo proporcional al ratio viewport/contenido,
posición proporcional al offset. Visible solo cuando hay overflow;
`scrollbar: false` lo oculta. No participa en layout ni en hit-testing en F1 (no
es draggable — el scroll es rueda/drag del contenido).

**Input F1**: rueda (web/editor) + drag de puntero/táctil. Diferidos: inercia/
momentum, ScrollTo programático, scroll con gamepad (F5), snap.

## Forward-tolerance: fallback normativo

La regla vaga "renderiza un fallback para tipos desconocidos" se concreta y pasa a
ser normativa:

> **Un tipo de nodo desconocido se renderiza como `Container`, preservando
> `layout`, `style`, `visible` y `children`.** Las props específicas del tipo se
> ignoran como cualquier prop desconocida.

Matriz de degradación (SDK pre-F1 recibe contenido F1 por hot-update):

| Contenido nuevo | SDK viejo renderiza | Efecto |
|---|---|---|
| `Container` con `clip: true` | prop ignorada | sin recortar (nicety perdida) |
| `ScrollView` | Container con los mismos hijos | todo visible, sin recorte ni scroll |

El contenido nunca desaparece; la peor degradación es "la pantalla se desborda" —
idéntica entre prop y primitivo. Esto desmonta el argumento que favorecía la prop:
la diferencia real entre las opciones no era la degradación sino dónde vive el
comportamiento. El caso inverso (SDK nuevo, contenido viejo) es trivial: sin
`clip`/`ScrollView` en el JSON, nada cambia.

Ajustar el código de fallback de los SDKs a esta regla pertenece a las tareas de
implementación de F1, no a ZAB-5 (hoy no existe ningún tipo publicado fuera del
vocabulario, así que no hay regresión posible).

## Cambios en `@zabloo/format` (el código de ZAB-5)

`packages/format/src/index.ts`:

1. `clip?: boolean` en `NodeBase` con docstring (paint-only; recorta paint +
   hit-testing del subárbol).
2. `ScrollViewNode` (docstrings con defaults y semántica resumida) + `"ScrollView"`
   en la unión `ZNode`.
3. Docstring de cabecera actualizado: vocabulario de 5 primitivos; la regla del
   fallback normativo junto a la nota de forward-tolerance.
4. `parseEnvelope` **no cambia**: sigue validando solo forma del envelope + versión
   mayor (la tolerancia a lo desconocido ES la spec). La "validación" de la tarea
   queda a nivel de tipos + tests.

`packages/format/src/index.test.ts`:

- Envelope con `ScrollView` (con y sin `axis`/`scrollbar`) y `clip` en Container
  pasa `parseEnvelope` y tipa sin casts.
- Props y tipos desconocidos atraviesan el parse intactos (lo que permite al
  fallback del SDK preservar children).

## Registro

- Entry en `decisions-architecture.md` (2026-08-11): decisión en dos piezas,
  semántica de medición/offset/clip, fallback normativo + matriz de degradación,
  diferidos y alternativas descartadas.
- `ir-context.md`: status update (vocabulario pasa a 5 con `ScrollView`; §1 nota).

## Fuera de alcance (siguientes tareas F1)

Scissor/stencil en ambos teseladores, input rueda/drag, scrollbar, estado de
offset, fallback-como-Container en ambos SDKs, `<ScrollView>` en `@zabloo/react`,
y la pantalla de demo scrolleable en los ejemplos.
