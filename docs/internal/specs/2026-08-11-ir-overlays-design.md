# Spec: overlays y z-order en la IR — primitivo `Overlay` (2026-08-11, ZAB-19)

> Tarea Linear: [ZAB-19] — milestone **F4 — Capas y overlays**. Alcance de ZAB-19: el
> **contrato de la IR** (tipos + tests en `@zabloo/format`) y el registro de la
> decisión. El render en capas, el bloqueo de input y el focus-trap son ZAB-20; los
> componentes (`Modal`, `Toast`, `Tooltip`) y sus specs, ZAB-21.

## Contexto y problema

F4 introduce la primera capacidad que rompe la premisa "un árbol, un flujo, un orden
de pintado": un modal se pinta por encima de TODO, oscurece lo de debajo, impide
pulsar lo que tapa y confina la navegación por focus. Hasta hoy el orden de pintado
era exactamente el recorrido del árbol y el hit-testing, la intersección de rects de
layout — ambas cosas dejan de bastar.

La pregunta de la tarea: **cómo entra el overlay en la IR** — ¿prop `layer`/`overlay`
en `Container`, slot de overlays en la vista, o tipo propio? Y con ella: backdrop,
bloqueo de input hacia abajo, focus-trap, y qué hace un SDK viejo al recibir un
overlay. Restricciones que no se tocan: paint implícito desde estilo, comportamiento
indexado por identidad de componente, y vocabulario que solo crece cuando una
capacidad lo fuerza.

## Decisión (aprobada): `Overlay` como tipo de nodo, declarado in-place

El overlay entra como **tipo de nodo propio** (7º del vocabulario), por la puerta
legítima de siempre — *"new primitives only when they force a new system
capability"*. Lo que fuerza es un sistema de comportamiento entero, no una variación
de paint: **capa de pintado separada + orden entre overlays + captura de input +
ámbito de focus + restauración del focus al cerrar**. Es exactamente el criterio que
separó `clip` (paint puro → prop en `NodeBase`) de `ScrollView` (estado + input →
tipo) en ZAB-5.

**Se declara in-place en el árbol** — donde vive la UI que lo abre — pero **sale del
flujo de su padre**: no ocupa espacio, no desplaza a sus hermanos, no participa en la
medición del contenedor. El SDK recolecta todos los `Overlay` visibles de la vista en
**una sola capa** pintada sobre el árbol completo. Es el modelo "portal declarado en
sitio": authoring local (el `<Modal>` vive junto al botón que lo abre, con su estado
en el mismo componente React) y render global.

Alternativas descartadas:

- **Prop `layer` en `NodeBase`** (`layer?: "overlay"` en cualquier nodo): permitiría
  un `ScrollView` modal sin anidar, pero obliga al SDK a despachar comportamiento por
  tipo **O** por prop — dos mecanismos, que es justo lo que se rechazó en ZAB-5 con
  `overflow` y en 2026-08-01 #3 ("behavior lives in the SDK, keyed by component
  type"). El caso "modal scrolleable" se resuelve anidando `Overlay > ScrollView`,
  que además se lee mejor.
- **Slot de overlays en la vista** (`views: { id: { root, overlays: [] } }`): separa
  capas explícitamente, pero (a) cambia la forma del envelope — hoy una vista **es**
  un nodo, y todo el loader/preview/dev push lo asume; (b) rompe el authoring local:
  el modal se declararía lejos de lo que lo abre, y el reconciler tendría que
  levantar nodos a otra rama; (c) **degrada peor**: un SDK viejo ignora la clave
  desconocida y el overlay **desaparece entero**, en vez de caer en el fallback
  normativo que preserva children.
- **Sin tipo: composición manual** (un Container a pantalla completa "encima" por
  orden de documento): no existe el concepto de "encima" fuera del flujo — habría que
  inventar posicionamiento absoluto en la IR (no está en el subset Yoga de v1) y aun
  así no daría ni bloqueo de input ni focus-trap.

## Contrato IR (tipos en `@zabloo/format`)

```ts
export interface OverlayNode extends NodeBase {
  type: "Overlay";
  /** Bloquea el input hacia abajo y confina el focus a este subárbol. Default: true. */
  modal?: boolean;
  /** Orden explícito dentro de la capa; los empates rompen por orden de documento. Default: 0. */
  z?: number;
  /** Acción nombrada al pedir cierre (Escape / B / tap en el backdrop). */
  onDismiss?: string;
  children?: ZNode[];
}

export type ZNode =
  | ContainerNode | TextNode | ButtonNode
  | CollapseNode | ScrollViewNode | ImageNode | OverlayNode;
```

Cuatro decisiones dentro del contrato:

- **Sin campo `backdrop`.** El rect del Overlay **es** el rect de la vista, así que su
  propio `background` (con alpha) ya es el backdrop, y sale del paint implícito desde
  estilo sin superficie nueva. Sin `background` = capa transparente (Toast, Tooltip).
  Un campo `backdrop` sería una segunda vía de pintar un rect al margen del estilo —
  precisamente lo que la regla de paint implícito existe para evitar.
- **Sin campo de posición.** `layout.justify`/`align`/`padding` sobre la capa a
  pantalla completa colocan el contenido: modal centrado (`center`/`center`), toast
  abajo a la derecha (`end`/`end` + padding). Cero semántica nueva de layout: es el
  flex que ya existe aplicado a un contenedor del tamaño de la vista.
- **`z` es un número, no un token.** No es un valor tematizable ni cambia por estado
  (el paralelo es `clip`/`visible`, no `background`). Bandas por convención del
  authoring (p. ej. modales 0, toasts 10) sin que el formato imponga una taxonomía.
- **`onDismiss` es una acción nombrada**, el mecanismo que ya existe (`onClick`) — no
  uno nuevo, y sigue sin haber lógica en el JSON.

## Semántica (spec para ZAB-20 — implementación en ambos targets)

**Layout.** El Overlay se saca del flujo de su padre: no se mide, no ocupa espacio,
no afecta a hermanos (mismo mecanismo `InLayout` que ya usan `visible` y el contenido
del `Collapse`, pero por identidad de tipo, no por estado). Se dispone después, con
el rect de la vista como restricción, y sus hijos se miden y colocan dentro con las
props de layout del propio Overlay. `layout.width`/`height` **sobre el Overlay se
ignoran** (una capa no se dimensiona — igual que `clip: false` se ignora en
`ScrollView`); el tamaño va en el hijo. Un Overlay dentro de un `ScrollView` **no
scrollea**: pertenece a la capa, no al contenido, así que el offset de scroll no se
le aplica.

**Orden de pintado.** Primero el árbol normal completo, después la capa: todos los
`Overlay` visibles de la vista, ordenados por `(z, orden de documento en pre-orden)`.
El orden es estable y serializado — nada de "el último abierto arriba" (estado de
runtime no serializable; si algún día hace falta, entra como comportamiento del SDK
sin cambiar el formato).

**Input.** El hit-testing recorre la capa de arriba abajo antes que el árbol normal:

- `modal: true` (default) — **captura**: nada por debajo (ni el árbol normal ni los
  overlays de menor orden) recibe input mientras esté visible. Un tap dentro de su
  rect que no aterrice en ningún hijo es un **tap en el backdrop**: dispara
  `onDismiss` si está definido, y en cualquier caso **no** se propaga hacia abajo.
- `modal: false` — la capa **no** captura: su propio rect es inerte al input y solo
  sus hijos reciben eventos; el resto atraviesa hasta el árbol normal. Es lo que hace
  usable un Toast o un Tooltip a pantalla completa.

**Focus.** El focus-trap **deriva de `modal`**, sin campo nuevo: mientras haya un
overlay modal visible, la navegación espacial (2026-08-04) solo considera candidatos
dentro del subárbol del **modal más alto** de la capa. Al cerrarse, el SDK **restaura
el focus** al nodo que lo tenía antes de abrirlo (estado de runtime del SDK, como el
offset de scroll o el `pressed`). `autofocus` dentro de un overlay marca el candidato
inicial al abrirse. Los overlays no modales no capturan el focus: sus hijos entran en
la navegación normal como cualquier otro nodo — un Toast puede contener un Button
pulsable sin robarle el focus al menú de debajo.

**Visibilidad y apertura.** `visible` sigue siendo el único mecanismo de ocultación
(`display:none`): un Overlay oculto no aporta capa, ni backdrop, ni bloqueo de input,
ni candidatos de focus. Abrir/cerrar un modal es, por tanto, mover ese booleano — vía
binding (`visible: { bind: "ui.confirmOpen" }` + `SetData`) o vía la API juego→SDK
que ZAB-21 defina, siguiendo el split por capas del `Collapse` (comportamiento por
defecto en el SDK + API para el juego). **La IR no gana ningún mecanismo de apertura
nuevo.**

**Anidamiento.** Un Overlay dentro de otro es legal y se aplana en la misma capa
(orden por `z` y documento); "modal sobre modal" funciona porque la captura de input
y el trap miran siempre al modal más alto.

## Forward-tolerance

Aplica la regla normativa vigente (2026-08-11, scroll): **un tipo desconocido se
renderiza como `Container` preservando `layout`/`style`/`visible`/`children`**, y las
props específicas del tipo se ignoran como cualquier prop desconocida.

| Contenido nuevo | SDK viejo (pre-F4) renderiza | Efecto |
|---|---|---|
| `Overlay` oculto (`visible` false/bindeado a false) | Container oculto | nada visible — el caso normal de un modal cerrado |
| `Overlay` modal abierto | Container inline en el flujo, con su `background` de fondo | el contenido del modal aparece **dentro** de la pantalla, empujando el layout; sin backdrop encima, sin bloqueo de input |
| `Overlay` no modal (toast) | Container inline al final del flujo | el toast aparece en el flujo en vez de flotando |
| `modal` / `z` / `onDismiss` | props ignoradas | sin captura de input, sin orden, sin dismiss |

El contenido nunca desaparece — la peor degradación es "el modal se ve como una
sección más de la pantalla". Es la misma degradación que habría dado una prop `layer`
(que también se ignoraría dejando el nodo inline), lo que confirma otra vez que la
elección no se decide por degradación sino por dónde vive el comportamiento. El caso
inverso (SDK nuevo, contenido viejo) es trivial: sin `Overlay` en el JSON, no hay
capa.

Recomendación de authoring que se deriva: **declarar los modales ocultos por
defecto** (`visible` bindeado), que además es lo que se quiere funcionalmente — así
un SDK viejo no muestra nada raro hasta que el juego intenta abrirlos.

## Cambios en `@zabloo/format` (el código de ZAB-19)

`packages/format/src/index.ts`:

1. `OverlayNode` con docstrings (defaults, rect = vista, backdrop = estilo propio,
   `width`/`height` ignorados, semántica de `modal`) + `"Overlay"` en la unión
   `ZNode`.
2. Docstring de cabecera: vocabulario actualizado + la regla de la capa única
   ordenada por `(z, orden de documento)`.
3. `parseEnvelope` **no cambia**: sigue validando forma del envelope + versión mayor
   (la tolerancia a lo desconocido ES la spec), igual que en ZAB-5.

`packages/format/src/index.test.ts`: vista con modal (backdrop por estilo + `visible`
bindeado + `onDismiss`) y toast (`modal: false`, `z`); `Overlay` desnudo (todo
opcional); aserciones de tipo negativas para `modal`/`z` y para la **ausencia** del
campo `backdrop`; overlay anidado dentro de un `ScrollView`.

## Registro

- Entry en `decisions-architecture.md` (2026-08-11, overlays).
- `ir-context.md`: nota de status + §1 (vocabulario) y §6 (input/focus).

## Fuera de alcance (siguientes tareas)

- **ZAB-20 (C2):** render en capas en ambos teseladores, hit-testing consciente de la
  capa, focus-trap y restauración, timers de auto-cierre.
- **ZAB-21 (C3):** `Modal`, `Toast`, `Tooltip` como azúcar de `@zabloo/react` sobre
  `Overlay`, sus specs de props/estados/eventos, y la API juego→SDK de apertura.
- **Diferidos explícitos:** `autoCloseMs` del Toast (→ ZAB-21, campo aditivo
  compatible); **anclaje a un nodo** para el Tooltip (`anchor?: <id>` — pide
  posicionamiento relativo a un rect ajeno, capacidad nueva de layout → se decide con
  el componente); orden por apertura en runtime; transiciones de entrada/salida
  (→ F7); scroll-lock del contenido de debajo mientras hay un modal (hoy innecesario:
  el modal ya captura la rueda).
