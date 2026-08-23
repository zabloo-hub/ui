# Spec: anclaje de overlays y disparo por hover/focus (2026-08-11, ZAB-46)

> Tarea Linear: [ZAB-46] — proyecto **@zabloo/ui**, continuación directa de
> [ZAB-21] §6. Alcance: las dos capacidades que aquella issue sacó del `<Tooltip>` a
> propósito — **anclar un overlay al rect de otro nodo** y **dispararlo por el
> hover/focus de ese nodo** —, en el contrato (`@zabloo/format`), en el renderer web
> y en la capa de autoría. Unity: batch final, como los tres componentes de ZAB-21.

## Contexto y problema

El `<Tooltip>` que salió de ZAB-21 es honesto pero corto: una burbuja colocada en la
capa por `position` y mostrada por su `visible` bindeado, exactamente como el `<Toast>`.
Sirve para el tooltip que enciende el juego ("pulsa A para saltar" cuando el jugador
está en el borde), y no sirve para el caso que todo el mundo llama tooltip: una pista
**pegada a un control** que aparece **cuando el jugador está en él**.

Las dos piezas que faltaban no eran azúcar, y por eso no se decidieron dentro de un
ticket de autoría:

1. **Anclaje**: posicionar un rect respecto del rect de OTRO nodo. No está en el subset
   Yoga de v1 y no sale de `justify`/`align`, que solo alinean un hijo **dentro** de su
   padre. Es layout nuevo, y hay que decidir qué se ancla, qué pasa cuando no cabe, y
   qué pasa cuando el ancla se oculta o se va de pantalla (p. ej. dentro de un
   `ScrollView`, donde su rect se mueve con el offset).
2. **Disparo por hover/focus**: que un nodo muestre a otro es comportamiento indexado
   por una **relación** que el formato no tenía. La IR no tiene expresiones y `states`
   solo overridea estilo, así que no había forma de escribirlo con lo que ya existía.

## Decisión (aprobada)

### 1. Un campo, porque las dos son la misma relación

```ts
interface OverlayNode {
  anchor?: {
    id: string;                        // el nodo contra el que se coloca
    at?: AnchorAt;                     // una de las NUEVE anclas. Default: "top"
    offset?: Dim;                      // separación con su borde. Default: 8
    trigger?: "hover" | "manual";      // Default: "manual"
  };
}
```

Un objeto y no cuatro campos hermanos: un `trigger` sin ancla no tiene de quién leer el
hover, y una colocación sin el rect contra el que se coloca no significa nada. El campo
entero es la relación.

**El placement de capa se sigue emitiendo.** Un overlay anclado lleva igualmente su
`layout.justify`/`align`, así que un SDK que no conozca `anchor` lo ignora (regla de
forward-tolerance) y pinta **el tooltip de v1**: en la capa, donde dice `position`. La
redundancia se paga a cambio de que la degradación sea un tooltip visible y no un hueco.

### 2. Colocación: las mismas nueve anclas, ahora leídas alrededor del ancla

`AnchorAt` reusa el vocabulario de `OverlayPosition` con una lectura de lado +
alineación, que es como se lee un tooltip:

| `at` | dónde |
|---|---|
| `top` / `bottom` | encima / debajo, centrado sobre el ancho del ancla |
| `top-left`, `top-right`, `bottom-left`, `bottom-right` | **el mismo lado**, a ras del borde izquierdo/derecho del ancla — no una esquina en diagonal |
| `left` / `right` | al lado, centrado sobre su alto |
| `center` | centrado SOBRE el ancla, ignorando `offset` (una insignia sobre un icono) |

Y el ajuste es determinista, sin campo propio:

- **Flip** al lado opuesto si el preferido no cabe **y** el otro sí.
- **Clamp** dentro de la vista después, y solo después. Nunca las dos cosas en el mismo
  eje, y por el mismo motivo: una burbuja que no cabe arriba pertenece abajo, mientras
  que una que se sale por el costado solo necesita deslizarse — voltearla ahí la
  alejaría de la palabra a la que apunta.
- El **`padding` del overlay anclado es el margen que guarda con los bordes de la
  vista**: el mismo número hace el mismo trabajo que el `LAYER_INSET` de un overlay sin
  ancla, solo que aplicado al clamp.

El rect **del overlay** sigue siendo el de la vista; lo que se coloca son sus hijos. Eso
es lo que mantiene intacto el resto del modelo: un popover anclado y `modal` sigue
atenuando y capturando toda la pantalla, y `layout.width`/`height` sobre un `Overlay`
siguen ignorándose (el contenido se mide por su tamaño natural — una capa no se
dimensiona, se dimensiona el hijo).

### 3. Disparo: `hover` es hover **o** focus, y `visible` sigue mandando

`trigger: "hover"` mantiene el overlay en la capa mientras su ancla esté **hovered o
focused**. Un solo valor para los dos porque son la misma pregunta hecha desde
dispositivos distintos — "el jugador está atendiendo a esto" —, y porque el equivalente
de mando **es** el foco: la pista llega al gamepad sin mecanismo nuevo y sin esperar a
la fase de gamepad. Consecuencias:

- **`visible` sigue siendo la puerta de la capa**: un `visible` bindeado a `false` apaga
  las pistas (un ajuste "sin tooltips") sin tocar nada más. Y como el default es `true`,
  un tooltip anclado funciona **con cero datos**, que es exactamente lo que le faltaba.
- **El SDK no escribe nunca** por el disparo: lo que abre y cierra es el hover, no un
  dismiss. `autoCloseMs` se ignora en un overlay con disparo por hover — lo que lo
  cierra es salir del ancla, y un timer se lo llevaría de debajo del puntero.
- **Un overlay disparado por hover es inerte al input.** Si se comiera el puntero,
  apagaría el hover que lo sostiene y los dos parpadearían mientras el puntero estuviera
  entre ellos. Es una pista, no una superficie.
- **El ancla tiene que ser algo que tome input** (`Button`, `Toggle`, `Slider`, cabecera
  de `Collapse`): el hover ilumina exactamente el conjunto focusable (2026-08-11,
  ZAB-36), así que cualquier otra cosa no se hoverea NI se enfoca. El renderer avisa una
  vez por consola en vez de quedarse a oscuras. Ampliar el conjunto hoverable a
  "cualquier nodo que sea ancla" es una extensión compatible, pero tocaría una regla
  normativa (la identidad hover/foco) y dejaría la pista sin equivalente de mando: se
  descarta hoy a propósito.

**El disparo NO se deriva de `anchor`.** Un popover anclado que abre el juego (o un
botón) es igual de legítimo — es el dropdown del `Select` de F5 —, así que anclar y
disparar tienen que poder pedirse por separado.

### 4. Un tooltip nunca apunta a nada

- Ancla **fuera de layout** (su `visible` se apagó, su panel de tab se cerró) o
  **totalmente recortada** (scrolleada fuera de un `ScrollView`): el overlay **sale de la
  capa**, con su fundido de salida, como cualquier otro cierre.
- Ancla con un **`id` que no resuelve**: eso no es estado de runtime, es error de
  autoría. Warn **una vez** (repetirlo por frame entierra la consola) y colocación de
  capa — un typo degrada a un tooltip visible, no a silencio.
- El recorte se comprueba con los rects **del frame ya dispuesto**, así que un scroll se
  lleva la burbuja un frame después. Es invisible, y la alternativa sería disponer el
  árbol dos veces por frame para responder a una pregunta sobre una burbuja.

### 5. Autoría: `anchor` es una prop más, como se prometió

```tsx
<Button id="jump-btn" onClick="jump"><Text>Saltar</Text></Button>
<Tooltip anchor="jump-btn" position="top">Pulsa A para saltar</Tooltip>
```

- `anchor` (string), `offset` y `trigger` son props planas de los tres composites;
  `position` pasa a ser **el lado alrededor del ancla** cuando hay ancla. El `<Overlay>`
  crudo recibe el objeto de la IR tal cual, como corresponde a un primitivo expuesto.
- **`<Tooltip>` con ancla asume `trigger="hover"`**: una pista colgada de un control es
  una pista *sobre ese control*, y mostrarla mientras el jugador está en él es su razón
  de existir. `trigger="manual"` se sale — y es el popover anclado que abre el juego.
  `<Modal>` y `<Toast>` no asumen nada: un menú se abre, no se roza.
- Un `anchor` sin `id` es error de autoría en el `toIR`, como el `autoCloseMs <= 0`.

## Cambios

**`@zabloo/format`**: `OverlayAnchor`, `AnchorAt` y `OverlayTrigger`, más
`anchor?: OverlayAnchor` en `OverlayNode` con las reglas normativas en el docstring.

**`@zabloo/renderer-web`**

- `overlay.ts`: `anchorSpec` (defaults + lectura tolerante del `at`), **`anchorBox`**
  (colocación + flip + clamp, puro y con tests: la referencia literal para el ticket de
  Unity, como `stepPresence`), `isHoverTriggered`, `isOnScreen` (en layout con todos sus
  ancestros y no recortado del todo), y el salto de los overlays de hover en
  `resolveHit`.
- `view.ts`: el predicado de la capa pasa a ser `inLayout && anchorAllows`, de modo que
  input, foco, timers y el objetivo del tween de presencia leen las dos capacidades
  nuevas **sin cableado propio en ningún otro sitio**; `arrangeOverlay` coloca los hijos
  en la caja anclada conservando el rect de la vista para el overlay; `syncAutoClose`
  salta los de hover; warn una sola vez por `id` no resuelto.
- `overlay.test.ts`: las nueve colocaciones, flip, clamp contra los bounds, contenido
  más ancho que la vista, ancla fuera de layout / scrolleada fuera, y los dos casos de
  input (el de hover es inerte, el manual no).

**`@zabloo/react`**: `anchor` en `OverlayProps` (objeto) y en los tres composites
(plano), `layerLayout(..., anchored)`, el default de `<Tooltip>` y la validación en
`host.ts`. Tests de IR 1:1, del mapeo `position` → `at` y de los errores.

**Ejemplo**: `examples/overlays-demo` gana dos tooltips anclados sin `visible` — uno
encima de un botón y otro a su derecha — junto al de binding, que se queda como lo que
es: el tooltip que enciende el juego.

## Verificación

`typecheck`/`test`/`lint` en verde, y comprobado en el preview web real: la burbuja
aparece pegada al botón al pasar el ratón, aparece igual al llegar el **foco** con el
teclado (con el ratón fuera), **voltea** al lado contrario cuando el preferido no cabe
al estrechar la ventana, y se va al soltar el ancla. Sin warnings en consola.

## Fuera de alcance

- **Unity**: anclaje y disparo, en el batch final junto a `Modal`/`Toast`/`Tooltip` y el
  fundido de presencia.
- **Anclas no focusables** para el disparo por hover (ampliar el conjunto hoverable):
  extensión compatible, hoy descartada — ver §3.
- **Flecha/pico** de la burbuja apuntando al ancla: pide geometría propia, y v1 no tiene
  capa de paint explícita.
- **Anclar a un rect que no es un nodo** (una celda de `Repeat` por índice, un punto del
  mundo): el `id` es la única identidad que la IR tiene hoy.
