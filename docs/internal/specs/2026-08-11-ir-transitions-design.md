# Spec: transiciones declarativas de estilo en la IR — `transition` en `NodeBase` (2026-08-11, ZAB-33)

> Tarea Linear: [ZAB-33] — milestone **F7 — Transiciones (juice)**. Alcance de ZAB-33: el
> **contrato de la IR** (tipos + helper de easing + tests en `@zabloo/format`) y el
> registro de la decisión. El motor de interpolación en ambos targets es **ZAB-34**; los
> componentes que lo estrenan (`ProgressBar`, `Spinner`, `Badge`) son **ZAB-35**; aplicar
> juice al catálogo existente (Collapse, Modal, Toast, focus, starter) es **ZAB-36**.

## Contexto y problema

F7 es la fase del juice: hoy un `hover`/`pressed`/`focused` salta de golpe entre estilos.
La pregunta de la tarea es qué superficie mínima añade eso a la IR sin abrir el sistema
completo de animaciones (keyframes/timelines), que sigue diferido a v2 (roadmap, out of
scope de la IR v1 con la enmienda 2026-08-10).

Cuatro decisiones concretas: **dónde vive** la configuración, **qué propiedades** se
animan (y en particular la pregunta abierta de la issue: *¿layout animado? el open/close
del Collapse lo pide*), **qué dispara** una transición y **qué curvas** existen — con el
requisito estructural de siempre: Unity y web tienen que dar **el mismo número** en cada
frame, no "parecido".

## Decisión (aprobada)

### 1. `transition` es una prop de `NodeBase`

```ts
export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export interface Transition {
  /** Duración en ms. `Dim` → tokenizable (`"{motion.fast}"`); <= 0 es instantáneo. */
  duration: Dim;
  /** Default: "ease-out". */
  easing?: Easing;
}

interface NodeBase {
  // ...existente...
  transition?: Transition;
}
```

- Va en **`NodeBase`, no en `Style`** — mismo criterio que `clip` (2026-08-11, scroll):
  `Style` es el set de **valores** tematizables que se interpolan; `transition` es la
  configuración de **cómo** se interpolan. Su paralelo es `clip`/`visible`, no
  `background`. Además, meterla en `Style` la haría overridable por estado, que es
  justo la extensión que estamos difiriendo.
- **Un objeto por nodo, aplicable a todas sus props animables.** Lo mínimo que
  funciona. Las dos extensiones previsibles son aditivas y no rompen nada: un
  allowlist `properties?: AnimatableProp[]`, y duración/curva por propiedad (objeto →
  unión con un mapa o con un array, igual que `scrollbar: boolean` se diseñó para
  poder crecer a objeto).
- **`duration` es `Dim`** (número o `TokenRef`): el movimiento se tematiza como el
  color. Un tema "reduce motion" pone `motion.*` a 0 y la UI entera deja de animar sin
  reemitir el árbol — la misma propiedad que ya daba el diccionario de tokens.
- **Se lee solo del nodo base.** Sin cascada (un nodo nunca hereda la `transition` del
  padre — la regla "resuelto por nodo, sin cascada" no se toca) y sin
  `states.hover.transition` (entrada/salida asimétricas → extensión futura aditiva).

### 2. Set animable (normativo)

| Grupo | Props animables | Cómo se interpola |
|---|---|---|
| Color | `background`, `borderColor`, `color` | lerp componente a componente en **sRGB directo con alpha directo** (r,g,b,a en 0..1, cada canal independiente) |
| Escalar de paint | `opacity`, `radius`, `borderWidth` | lerp numérico tras resolver tokens |
| Dimensión de layout | `width`, `height`, `gap`, `padding` | lerp numérico tras resolver tokens, **antes** de la pasada de layout |

**No animables — saltan (normativo):**

- **`fontSize`**: es la clave del atlas de glifos. Animarla rasterizaría un tamaño
  nuevo por frame (churn de atlas) y re-mediría todo el texto en cada uno. Si alguna
  vez hace falta, el camino es escalar la geometría, no re-rasterizar; queda diferido.
- **`grow`**: es un factor de reparto flex, no una dimensión; interpolarlo produce
  movimiento no lineal e inintuitivo. Se anima el resultado (`width`/`height`), no el
  factor.
- **Enums de layout** (`direction`, `justify`, `align`): no hay valor intermedio.
- **Todo lo estructural**: `visible`, `clip`, `text`, `open`, `src`, `axis`,
  `scrollbar`, `group`, `onClick`, `children`, y el `z`/`modal` del `Overlay`
  (2026-08-11, ZAB-19) — `z` es numérico pero es orden, no una magnitud visual.

**Sin transform en v1:** no hay `translate`/`rotate`/`scale` en el set de estilo, así
que no hay "offset animado" ni rotación declarativa. Entran con la capa de paint
explícita (diferida desde 2026-08-01), no aquí.

### 3. Disparo: cualquier cambio de un valor resuelto (sin lista de triggers)

> **Una transición arranca cuando un valor animable resuelto de un nodo cambia,
> sea cual sea la causa.**

Esto cubre de un golpe entrar/salir de un estado (`hover`, `pressed`, `focused`,
`disabled`), un `SetData` que mueve un input bindeado, y un cambio de tema que
reescribe el token. Y cubre gratis los valores bindeados el día que el estilo sea
bindeable (hoy `Bindable` solo alcanza a `text` y `visible`) o que llegue el `value`
de `ProgressBar` en ZAB-35 — sin tocar el contrato.

Reglas de borde:

- **Los dos extremos tienen que resolver a número/color.** Si uno es `undefined`
  (auto, prop no declarada), **salta**. Interpolar hacia "auto" exige una segunda
  pasada de medida con el árbol objetivo; está descrito abajo como camino de v2, no
  construido.
- **El montaje salta** (no hay valor previo del que salir). Animaciones de entrada
  → diferidas.
- **Una recarga de envelope salta.** El hot-update reemplaza el documento: sin
  identidad de nodo entre documentos no hay "valor anterior" honesto, y animar una
  pantalla entera al recargar sería un artefacto, no juice. Las transiciones viven
  **dentro** de la vida de un documento cargado.
- **Interrupción: se re-apunta desde el valor interpolado actual, con la duración
  completa** (modelo CSS). Soltar un botón a mitad de la animación de pulsado sale
  desde el color que se ve, no desde el del estado base. Descartado "el tiempo que
  quedaba": produce salidas antinaturalmente rápidas justo en el caso común
  (interacciones cortas).
- **`duration <= 0`, no finita, o `transition` ausente ⇒ instantáneo** (el
  comportamiento pre-F7 exacto).

### 4. Layout animado: sí, pero interpolando **inputs**, no rects calculados

Las dimensiones de layout entran en el set animable. La clave está en **dónde** se
aplica la interpolación:

> El SDK interpola los **inputs declarados** (los valores resueltos de `Style` y de
> `Layout`) y **después** corre su pasada normal de medida/arrange con esos valores.

- Una sola pasada de layout por frame, como hoy; el árbol que ve el layout es un árbol
  normal. Determinista, y por tanto idéntico en ambos targets.
- Nada de bucle medida→animación→re-medida: no interpolamos el rect calculado, así que
  el resultado del layout nunca realimenta su propia entrada.
- El padre **sí** reflowea: al animar la altura de un hijo, lo de abajo se desplaza —
  que es exactamente el efecto que se busca.
- **Hit-testing usa los rects animados**: lo que se ve es lo que se pulsa (la premisa
  "hit-testing = rects de layout", 2026-08-04, sigue honesta).
- **ScrollView**: animar el tamaño de un hijo mueve el content size cada frame; el
  offset ya se re-clampa en cada relayout (2026-08-11, scroll), así que no hace falta
  regla nueva.
- Coste: un nodo animando layout implica relayout mientras dura. Nuestro layout ya se
  recalcula por frame en el renderer web, y el presupuesto de perf de F8 (ZAB-40) es
  quien pone el listón si algún día molesta.

### 5. La frontera: Collapse, Modal/Toast, Spinner

El camino **declarativo** de arriba **no** anima el open/close del `Collapse` ni la
apertura de un `Overlay`: en ambos casos el nodo *entra y sale del layout*
(`visible`/`open`, semántica `display:none`), y eso no es un cambio numérico sino una
animación de **entrada/salida** — el nodo tendría que sobrevivir a su propia
eliminación. Como capacidad genérica sigue diferida. Lo que sí queda establecido, y es
lo que da juice al catálogo en ZAB-36:

> **Un comportamiento propiedad del SDK (indexado por identidad de componente) puede
> conducir la misma maquinaria de interpolación con extremos que él calcula.** Esos
> extremos y esas curvas son **spec del componente**, no superficie de la IR.

Con esa regla, los tres casos de F7 tienen camino y ninguno pide contrato nuevo:

- **`Overlay` (Modal, Toast, Tooltip)** — cierra el diferido "transiciones de
  entrada/salida (→ F7)" de 2026-08-11 (ZAB-19). Es el caso **fácil, y por una razón
  estructural**: un Overlay está **fuera del flujo de su padre** (no se mide, no ocupa
  espacio, no afecta a hermanos), así que su comportamiento puede **mantenerlo vivo**
  mientras hace su fade/scale de salida y soltarlo al terminar **sin desplazar nada**.
  Un nodo en flujo no tiene esa propiedad — y por eso el caso genérico es el que sigue
  diferido, no por falta de ganas.
- **`Collapse`** — el contenido sí está en flujo, así que no se le mantiene vivo: el
  comportamiento del `Collapse` anima **su propia altura** entre la altura medida del
  contenido y la del header, con `clip`, que es un cambio numérico de un nodo que no
  desaparece.
- **Loop del `Spinner`** (ZAB-34/35) — giro infinito = comportamiento del SDK indexado
  por identidad, como el offset del scroll. No añade nada a la IR.

Y por eso esta decisión no abre la puerta a keyframes ni timelines: lo que se comparte
es la maquinaria de interpolación, no una superficie declarativa nueva.

### 6. Curvas: polinomios cerrados, no cubic-bézier

Set cerrado de cuatro, definidas como **polinomios cúbicos de forma cerrada** sobre el
progreso lineal `t ∈ [0,1]`:

| Curva | Definición | f(0.25) | f(0.5) | f(0.75) |
|---|---|---|---|---|
| `linear` | `t` | 0.25 | 0.5 | 0.75 |
| `ease-in` | `t³` | 0.015625 | 0.125 | 0.421875 |
| `ease-out` | `1 − (1−t)³` | 0.578125 | 0.875 | 0.984375 |
| `ease-in-out` | `t < 0.5 ? 4t³ : 1 − (−2t+2)³/2` | 0.0625 | 0.5 | 0.9375 |

Por qué polinomios y no las keywords de CSS: un `cubic-bezier(x1,y1,x2,y2)` obliga a
**resolver** la bézier (Newton-Raphson o bisección) para cada `t`, y entonces la paridad
entre targets depende de que dos solvers converjan igual — precisamente la clase de
divergencia silenciosa que la rebanada vertical nos enseñó a evitar (misma lógica que
llevó a la rasterización core-owned, 2026-08-11). Con forma cerrada, la paridad es
aritmética. Curvas con rebote (back/overshoot) y béziers arbitrarias quedan como
extensión compatible: el tipo es una unión de strings y ampliarla es aditivo.

`@zabloo/format` exporta `easeProgress(easing, t)` como **implementación de
referencia normativa** (misma razón que `decodeAssetData`/`isAssetRef`): la comparten el
renderer web y el preview del CLI, y el SDK de Unity porta esos mismos polinomios. Clampa
fuera de `[0,1]` y **cae a lineal ante una curva desconocida** — contenido nuevo en un
lector viejo anima recto en vez de negarse a animar.

## Forward-tolerance

Cambio **aditivo dentro de v1 — sin bump de versión**: `transition` es una prop nueva y
un SDK pre-F7 la ignora como cualquier prop desconocida.

| Contenido nuevo | SDK viejo renderiza | Efecto |
|---|---|---|
| Nodo con `transition` | prop ignorada | los cambios de estilo saltan (comportamiento pre-F7 exacto) |
| `easing` que no conoce | cae a `linear` (`easeProgress`) | anima, con otra curva |
| `duration` con token `{motion.*}` | lookup normal en el diccionario | igual que cualquier `Dim` |

La degradación es la ausencia del juice, nunca la pérdida de contenido ni un cambio de
layout. El caso inverso (SDK nuevo, contenido viejo) es trivial: sin `transition` en el
JSON, todo salta como hoy.

## Cambios en `@zabloo/format` (el código de ZAB-33)

`packages/format/src/index.ts`:

1. `Easing` y `Transition` exportados, con docstrings que fijan el set animable, el
   disparo por cambio de valor resuelto, la regla de extremos y la interrupción.
2. `transition?: Transition` en `NodeBase` (docstring: sin cascada, se lee del nodo
   base, per-state diferido).
3. `easeProgress(easing, t)` — los cuatro polinomios, clamp y fallback a lineal.
4. Docstring de cabecera: las transiciones simples entran en v1; keyframes/timelines no.
5. `parseEnvelope` **no cambia**: sigue validando solo forma del envelope + versión
   mayor (la tolerancia a lo desconocido ES la spec).

`packages/format/src/index.test.ts`: envelope con `transition` (con y sin `easing`, con
duración tokenizada) que parsea y tipa **sin casts**; `transition` en varios primitivos;
`@ts-expect-error` para curva inválida y para `duration` ausente; y para `easeProgress`,
extremos fijados, clamp/NaN, monotonía, los valores exactos de la tabla y el fallback a
lineal.

## Registro

- Entry en `decisions-architecture.md` (2026-08-11, transiciones).
- `ir-context.md`: status update (§5 estados: las transiciones simples entran en v1;
  el sistema completo sigue en v2).

## Fuera de alcance (siguientes tareas de F7)

Motor de interpolación en Unity y renderer-web + loop del Spinner (ZAB-34); `<Transition>`
/ prop `transition` en `@zabloo/react` y en el theme; `ProgressBar`, `Spinner`, `Badge`
(ZAB-35); juice del catálogo existente (ZAB-36). Diferidos de diseño: animaciones de
entrada/salida, extremos `auto` (interpolar hacia una altura medida), transiciones por
propiedad y por estado, `delay`, transform (translate/rotate/scale), keyframes y
timelines (v2).
