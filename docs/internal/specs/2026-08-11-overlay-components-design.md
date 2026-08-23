# Spec: `Modal`, `Toast` y `Tooltip` — la capa de autoría de overlays (2026-08-11, ZAB-21)

> Tarea Linear: [ZAB-21] — milestone **F4 — Capas y overlays**. Alcance: el host
> `Overlay` en `@zabloo/react`, el azúcar `Modal`/`Toast`/`Tooltip` con sus props,
> estados y eventos, y las **transiciones de entrada/salida** de los tres (que la issue
> saca explícitamente de ZAB-36). El contrato de la IR es ZAB-19 y el runtime web
> ZAB-44; ambos estaban ya cerrados. Validación en Unity: batch final.

## Contexto y problema

Después de ZAB-19 (tipo `Overlay` en la IR) y ZAB-44 (capa, captura de input,
focus-trap, restauración, backdrop-tap, Escape y `autoCloseMs` en el renderer web), la
capacidad estaba completa **y era inalcanzable desde JSX**: `Overlay` no estaba en
`HostType`, así que la única forma de producir un overlay era escribir el JSON de la IR
a mano. Esta tarea es la que la abre a la autoría.

Tres preguntas concretas, más una tensión heredada:

1. ¿Se expone `Overlay` crudo o solo el azúcar?
2. ¿Qué son exactamente `Modal`, `Toast` y `Tooltip` en términos de props/estados/eventos?
3. ¿Cómo se posiciona el contenido en una capa a pantalla completa?
4. **La tensión:** la issue sitúa aquí las transiciones de entrada/salida, pero el motor
   de F7 (2026-08-11, ZAB-33) dice literalmente que el **montaje salta** y que `visible`
   **no es animable** — y al pasar `visible` a `false` el nodo sale de layout, así que
   hasta hoy *no existía salida que animar*.

## Decisión (aprobada)

### 1. `Overlay` se exporta crudo; el azúcar va encima

`Overlay` entra en `HostType` y se exporta como componente de primer nivel, al contrario
que `Toggle`, `Slider` y `ProgressBar`, que se esconden. El criterio es el mismo que los
esconde a ellos: **esos tienen slots posicionales** (`children[0]` = indicador marcado,
`children[1]` = pulgar…) y el azúcar es el único sitio donde esa convención está escrita
bien. `Overlay` no tiene ninguna: sus hijos son hijos, como en `Container`. Esconderlo
solo obligaría a inventar un componente por cada forma de overlay que se le ocurra a
alguien.

`Modal`, `Toast` y `Tooltip` son **composites aplanados** (2026-08-03 §5): emiten un
`Overlay` con un `Container` dentro y no existen en la IR, exactamente como `Badge`,
`Tabs` o `RadioGroup`.

### 2. `position`: nueve anclas sobre la capa, cero semántica nueva

```ts
type OverlayPosition =
  | "center" | "top" | "bottom" | "left" | "right"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";
```

Se traduce a `layout.justify`/`align` sobre la capa, que es lo que la spec de ZAB-19 ya
prescribía a mano. Dos detalles que hacen que sea azúcar honesto y no una capa de
abstracción:

- El overlay se emite **siempre como `direction: "row"`**, de modo que `justify` es
  siempre el eje X y `align` siempre el Y. Sin eso, "bottom-right" significaría cosas
  distintas según la dirección del contenido y el autor tendría que pensar en eje
  principal vs transversal — justo lo que el azúcar existe para ahorrar.
- El `layout` explícito del autor **pisa** el placement (`{...PLACEMENT[position],
  padding: 24, ...layout}`), así que la prop nunca es una jaula.

Descartado un campo `position` en la IR: no aporta nada que `justify`/`align` no den ya,
y sería vocabulario nuevo para un caso que el flex resuelve — el mismo criterio que dejó
fuera el campo `backdrop` en ZAB-19.

### 3. Los tres componentes

Superficie común (heredada de `Overlay`, menos `modal` que cada uno fija):
`id`, `visible`, `layout`, `style`, `states`, `transition`, `variant`, `autofocus`,
`clip`, `z`, `onDismiss`, `autoCloseMs`, `position`, `children`.

| | `modal` | `z` | `position` | `autoCloseMs` | `style` es… | contenedor interno |
|---|---|---|---|---|---|---|
| `<Modal>` | `true` (fijo) | 0 | `center` | — | **el backdrop** (`#00000099`) | `panel` — la tarjeta |
| `<Toast>` | `false` | 10 | `bottom` | 3000 | la capa (transparente) | `panel` — la píldora |
| `<Tooltip>` | `false` | 20 | `top` | — | la capa (transparente) | `panel` — la burbuja |

- **`style` del `<Modal>` ES el backdrop.** No hay prop `backdrop`, por la misma razón
  por la que no hay campo `backdrop` en la IR: el rect del overlay es el de la vista, así
  que su propio `background` con alpha ya lo es, y el paint sigue siendo implícito desde
  estilo. La tarjeta se estiliza con `panel`, igual que el `Slider` pinta el rail con
  `style` y los slots con `fill`/`thumb`.
- **Bandas de `z` por convención** (modales 0, toasts 10, tooltips 20), no por
  taxonomía del formato: son defaults del componente que el autor pisa. Así una
  confirmación sigue viéndose sobre un diálogo abierto.
- **`autoCloseMs` por defecto solo en el `Toast`** (3 s): es lo que lo distingue de un
  overlay no modal cualquiera. Un `autoCloseMs <= 0` es **error de autoría** (el runtime
  lo ignora, y un typo que se traduce en "no se cierra nunca" es peor callado).
- **Mensaje de texto suelto envuelto en `<Text>`** en `Toast` y `Tooltip` (como el
  `label` de `<Tab>`); pasar nodos sustituye el mensaje entero.
- **Estados:** ninguno propio. Un overlay no tiene `hover`/`pressed`/`checked` — quien
  los tiene es lo que hay dentro. `autofocus` en un hijo marca quién recibe el focus al
  abrirse; al cerrarse el SDK lo devuelve a quien lo tenía.
- **Eventos:** `onDismiss` y nada más. Los botones de dentro llevan su `onClick`.

### 4. Apertura y cierre: `visible` y nada más (sin API nueva)

La issue pedía "definir la API juego→SDK de apertura". **No hay API nueva**: es
`SetData` sobre el path bindeado de `visible`, decidido en ZAB-19 y ya implementado en
ZAB-44 (el dismiss escribe `false` por el binding de lectura/escritura y dispara
`onDismiss`). Lo que esta tarea añade es que la recomendación de authoring quede en el
código: los tres componentes se declaran con `visible` bindeado y ninguno tiene prop
`open`.

Corolario que el ejemplo explota: como el binding es de ida y vuelta, un `<Switch
checked={{bind:"ui.confirmOpen"}}>` abre el modal **y se apaga solo** cuando el jugador
pulsa Escape. Ese es el bucle completo sin una línea de juego.

### 5. Transiciones de entrada/salida: `presence`, no `visible`

> Un `Overlay` con `transition` **funde su entrada y su salida en la capa**. Lo que se
> interpola es su **presencia** (0…1), no `visible`.

Es el patrón que F7 ya dejó abierto: *"el comportamiento de un componente puede mover
esta misma maquinaria con extremos que calcula él"* (2026-08-11 §5) — el `progress` del
`ProgressBar` y el loop del `Spinner`. `presence` es el tercero. Consecuencias:

- **No se toca el contrato de la IR.** Ni campo nuevo, ni `visible` animable, ni
  `z`/`modal` animables. La duración y la curva salen del `transition` que el nodo ya
  tenía, así que un overlay sin `transition` aparece y desaparece de golpe: el frame
  pre-F7, byte a byte.
- **La duración es un token** (`{motion.base}`), luego un tema "reduce motion" a 0
  desactiva los fundidos con todo lo demás.
- **La salida sobrevive a su propio `visible`.** Un overlay cerrado se sigue pintando
  exactamente una duración más. Es la única excepción a "fuera de layout no se pinta", y
  está acotada a la capa.
- **Lo que sale es píxeles y nada más.** El input, el focus-trap, la pila de modales y
  los timers de `autoCloseMs` leen la capa **viva** (`inLayout`), que el overlay ya
  abandonó: un modal en salida no captura clicks, no atrapa el focus, no re-arma su
  timer y no impide que el de debajo vuelva a mandar. El fundido es puramente visual, que
  es lo que evita la clase entera de bugs de "el modal cerrado seguía comiéndose los
  clicks".
- **El montaje salta.** La primera observación de la presencia siembra el valor sin
  animar (regla de `stepValue`), así que un modal ya abierto al cargar la vista no hace
  fade-in — y un `reload` tampoco, porque el estado muere con el documento.
- **Sin `scale`.** v1 no tiene transform, así que "fade + scale" no es expresable sin
  inventar geometría; interpolar `width`/`height` solo funcionaría con tamaños
  explícitos y no escalaría el texto. El fundido es de opacidad y punto; el scale entra
  con la capa de paint explícita, no aquí.

Implementación web: `stepPresence` en `overlay.ts` (puro, con tests, y por tanto la
referencia literal para el ticket de Unity) + una pasada por frame en `view.ts` que
recorre **todos** los `Overlay` del árbol — también los ocultos, que tienen que estar
sentados en 0 para que abrirlos sea un cambio del que salir en vez del snap que daría una
primera observación. El estado de la presencia vive **fuera** del `NodeAnim` del nodo,
porque la pasada de resolve lo tira cuando el nodo sale de layout: una salida que borra su
propio punto de partida no se anima.

### 6. `Tooltip` en v1: sin anclaje y sin hover

El `Tooltip` que sale de aquí es **una burbuja colocada en la capa y mostrada por
binding**, no un tooltip anclado. Las dos capacidades que le faltan no son azúcar:

- **Anclaje a un nodo** (`anchor?: <id>`): pide posicionar un rect respecto de otro
  ajeno, que es layout nuevo — no está en el subset Yoga de v1 y no sale de
  `justify`/`align`.
- **Disparo por hover/focus del ancla**: la IR no tiene expresiones y `states` solo
  overridea estilo; que un nodo muestre a otro es comportamiento de SDK indexado por una
  relación que hoy no existe en el formato.

Meterlas ahora habría sido decidir dos capacidades de la IR dentro de un ticket de
autoría. Se difieren a una issue propia, con esta spec como punto de partida; el
componente que se entrega hoy no queda inservible (un tooltip de mando se muestra por
estado del juego, que es exactamente el binding) y su API no cambia cuando el anclaje
llegue: `anchor` será una prop más.

## Cambios (el código de ZAB-21)

**`@zabloo/react`**

- `host.ts`: `"Overlay"` en `HostType`/`HOST_TYPES`/mensaje de vocabulario; props
  `modal`/`z`/`onDismiss`/`autoCloseMs`; `case "Overlay"` en `toIR` con la validación de
  `autoCloseMs`.
- `components.ts`: `Overlay` (primitivo expuesto), `OverlayPosition` + `PLACEMENT`,
  `Modal`, `Toast`, `Tooltip` con sus defaults de estilo.
- `index.ts`: exports. `index.test.ts`: IR 1:1, defaults de los tres, mapeo de
  `position`, el `layout` que pisa, y el error de `autoCloseMs`.

**`@zabloo/renderer-web`**

- `overlay.ts`: `collectLayer(root, present?)` con predicado, y `stepPresence`.
- `transition.ts`: `"presence"` en `BehaviorKey`.
- `view.ts`: pasada de presencia por frame, capa **viva** vs capa **pintada**, guardas de
  `resolve`/`paint` para el saliente, y la presencia como `parentOpacity` de cada
  entrada.
- `overlay.test.ts`: entrada, salida, instantáneo sin `transition`, snap en la carga,
  reapertura a media salida (retarget desde lo que se ve), y que el saliente no está en la
  capa viva.

**`@zabloo/format`**: solo docstrings (`Transition` y `OverlayNode`) — el fundido es
comportamiento, no contrato.

**Ejemplo**: `examples/overlays-demo` — modal de confirmación con modal anidado, toast
que se cierra solo y tooltip, todos bindeados a interruptores que muestran el bucle de
ida y vuelta.

## Verificación

`typecheck`/`test`/`lint` en verde, y el fundido comprobado en el renderer real (preview
web, leyendo el píxel del backdrop mientras se abre y se cierra). Esa comprobación
encontró un bug que los tests unitarios no podían ver: en el frame en que un overlay
abre, su presencia es 0 y, al no registrarse en el mapa, el default lo pintaba opaco —
un destello justo antes del fade.

## Fuera de alcance

- **Anclaje del tooltip y disparo por hover/focus** (issue propia, §6).
- **Unity**: los tres componentes y el fundido de presencia, en el batch final.
- **Transiciones asimétricas** (entrada distinta de salida): extensión aditiva de
  `transition`, ya prevista en ZAB-33.
- **Orden por apertura en runtime** y **scroll-lock** del contenido de debajo: siguen
  diferidos desde ZAB-19.
