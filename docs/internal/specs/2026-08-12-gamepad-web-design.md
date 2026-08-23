# Spec: gamepad en el preview web — d-pad, sticks y auto-scroll (2026-08-12, ZAB-47)

> Tarea Linear: [ZAB-47] — milestone **F5 — Formularios e input completo**, track C2.
> Alcance entregado: módulo puro `gamepad.ts` en `@zabloo/renderer-web`, cableado en
> `view.ts`, auto-scroll hasta el nodo enfocado, indicador de mando en la página de
> preview del `zabloo dev`, y esta spec. La contraparte Unity (Input System) es
> ZAB-27 y no depende de esta más que como referencia de reglas.

## Contexto y problema

El foco espacial y su manejo por teclado existen desde 2026-08-04 y no han parado de
crecer con cada control de F5: el `Slider` se quedó las flechas de su eje (ZAB-24), el
`TextInput` las suyas hasta el extremo del texto (ZAB-26), y Escape es desde ZAB-21 la
petición de cierre del modal que tiene el input. Lo que faltaba no era un modelo de
input nuevo: era **la fuente que un mando de consola representa**, para poder probar la
navegación real sin abrir Unity.

Tres preguntas, y ninguna es "cómo se lee un mando":

1. **Quién paga los frames.** La Gamepad API se **consulta**, no empuja: un botón
   mantenido es un estado, no un evento. Pero el renderer pinta *bajo demanda* — el
   bucle de `scheduleFrame` existe para terminar una transición y se apaga en cuanto
   acaba.
2. **Qué hace el d-pad sobre un `TextInput`.** Es la interacción que ZAB-47 estaba
   esperando a que aterrizara ZAB-26 para decidirla con el código delante.
3. **Adónde mira el jugador.** Navegar con mando dentro de una lista larga mueve el
   foco a filas que están fuera de la vista: sin rueda ni drag, el foco existe y su
   resalte es invisible.

## Decisión 1: una fuente de input más, no un segundo modelo

Todo lo que el mando produce se resuelve a las intenciones que el teclado ya
produce — una dirección unitaria, una pulsación, un dismiss, un scroll — y se mete por
los **mismos handlers**. El mapeo estándar entra entero en una función:

| Entrada | Intención | Dónde acaba |
|---|---|---|
| d-pad (12-15) / stick izquierdo | dirección unitaria | la cascada del `keydown`: caret → eje del slider → `moveFocus` |
| A (0) | press/release | `pressFocused`, por flancos |
| B (1) | back | `requestDismiss` del modal superior — el Escape de la web |
| stick derecho | scroll | `setScrollOffset` del `ScrollView` que contiene el foco |

El d-pad **gana al stick** (un botón pulsado es una dirección inequívoca y un stick
apoyado no debe pelearla) y una diagonal colapsa a su componente **horizontal**: la
navegación espacial se mueve en un eje, y un desempate estable vale más que alternar
entre dos con la misma entrada.

Lo que compra reusar la cascada del teclado: el `Slider` se queda las direcciones de su
eje y el `TextInput` el caret **sin una segunda copia de esas reglas** que se separe de
la primera al siguiente componente. Lo que cuesta: `editKey` pasa a recibir una
**intención** (`key`, modificadores, `repeat`, `preventDefault`) en vez de un
`KeyboardEvent` — que un evento real satisface tal cual, así que el teclado no cambia.

## Decisión 2: bucle propio, vivo solo mientras hay mando

`requestAnimationFrame` propio, arrancado por `gamepadconnected` y parado con el último
`gamepaddisconnected` (y en `dispose`). Aparte del `scheduleFrame` de las transiciones,
porque son dos preguntas distintas: aquel se apaga cuando nada anima, y este tiene que
seguir vivo mientras haya un mando que consultar. **Sin mando conectado no se programa
ni un frame**: un preview sin mando cuesta exactamente lo que costaba.

Dos reglas de cierre, que son las mismas que ya rigen para el puntero:

- Un mando desenchufado a media pulsación **cancela** (no activa): tirar de un cable no
  es como compra el jugador.
- Un slider en movimiento cuando el mando desaparece **sí asienta** (`onCommit`): el
  valor en el que se quedó está en pantalla.

**Zona muerta e histéresis.** El stick registra dirección a partir de 0.5 y no la suelta
hasta 0.35: un stick apoyado cerca del umbral, sin margen, dispararía y soltaría sin que
nadie lo mueva, que es lo que se ve como una lista atascada. El umbral de salida solo
vale para la dirección **que ya se está manteniendo**; cualquier otra es una intención
nueva y paga el umbral entero.

**Repetición al mantener** (400 ms de espera, luego 90 ms de periodo): dispara en el
instante de la pulsación, cambiar de dirección reinicia el ciclo entero, y **como mucho
un movimiento por frame** aunque el navegador haya estado parado — el mando es una
fuente de intenciones, no una cola de trabajo atrasado que recuperar.

**El stick derecho es velocidad, no desplazamiento**: px por segundo escalados por la
duración del frame, con respuesta cuadrática (control fino cerca del centro, velocidad
plena en el borde) y su propia zona muerta, más baja — un scroll no tiene escalón
discreto que fallar.

## Decisión 3: sobre un `TextInput`, el d-pad es el teclado

←/→ del d-pad mueven el caret y, **en el extremo sin selección, devuelven la dirección**
a la navegación espacial; ↑/↓ navegan siempre. Es literalmente la decisión 4 de la spec
del `TextInput` (2026-08-11), que se escribió pensando en este momento: *"el jugador
entra y sale del campo con el mando sin modo de edición invisible y sin quedarse
atrapado"*. Se implementa reusando `editKey`, no reescribiéndola.

Descartado **que el d-pad navegue siempre con un campo enfocado** (más simple, y en
consola no se puede teclear igualmente): habría hecho el caret inalcanzable desde el
mando y, sobre todo, habría separado teclado y mando en la única interacción donde el
usuario espera que sean idénticos. El teclado en pantalla de consola sigue en v1.x, y
cuando llegue encontrará el caret ya navegable.

## Decisión 4: el foco arrastra el scroll (diferido de ZAB-9, cerrado aquí)

La spec del `ScrollView` dejó el **auto-scroll hasta el nodo enfocado** para "la fase de
gamepad", que es esta. Es comportamiento del SDK, **sin IR nueva**: al mover el foco, el
nodo se trae a la vista.

- **El movimiento mínimo**, y ninguno si ya cabe: navegar no puede dar saltos a la lista
  bajo un jugador que ya está viendo adónde fue el foco.
- **Burbujea como `scrollIntoView`**: cada scroller revela al hijo suyo que contiene el
  foco — el nodo en el más interno, y el scroller de abajo en cada uno de arriba —, así
  que los anidados convergen en una pasada en vez de medir un rect que el scroll interno
  acaba de mover.
- Un objetivo **más grande que el viewport** alinea su borde de entrada; si ya lo cubre
  entero, no se mueve.
- Solo lo llama la **navegación**: una pulsación de puntero enfoca lo que el jugador ya
  está mirando, y el foco que restaura un modal aterriza dentro de un render, donde un
  scroll llegaría un frame tarde de todos modos.

Lo hereda el teclado, que es como debe ser: el foco es uno solo.

## Sin superficie de API nueva

Ni opción en `mount` ni callback: el renderer arranca y para su bucle con los eventos
del navegador. **El indicador del preview escucha esos mismos eventos** por su cuenta —
el `zabloo dev` enseña `🎮 gamepad` en la cabecera mientras hay uno. Un mando anunciado
antes de montar la vista se recoge en la misma llamada de arranque.

Nota de la Gamepad API que conviene tener escrita antes de que alguien la reporte como
bug: **el navegador no admite que hay un mando hasta la primera pulsación** (protección
anti-fingerprinting). Hasta entonces, ni indicador ni polling.

## Qué se verificó, y cómo

Módulos puros con tests (`gamepad.ts`, y `revealDelta` en `scroll.ts`): zona muerta,
histéresis, eje dominante, diagonales, mando que reporta menos botones/ejes de los del
mapeo estándar, NaN en un eje, la secuencia completa del repeat, el reinicio al cambiar
de dirección, y el mínimo movimiento de revelado en sus cuatro casos.

End-to-end en el preview real con un mando sintético inyectado en la página
(`inventory-demo`, `settings-demo`, `overlays-demo`): el indicador se enciende al
conectar; una pulsación = un paso de foco; un segundo mantenido = 8 pasos (1 + 6
repeticiones, lo que dicen 400/90); A activa el control enfocado y deja su acción en el
log; B cierra el modal y escribe su binding; el stick derecho scrollea la lista; el foco
que baja por una lista de 20 filas la arrastra consigo; sobre el campo de texto el d-pad
mueve el caret (índice 0→3 y vuelta) y ↓ lo abandona; y sobre un slider las direcciones
de su eje mueven el valor y sueltan un `onCommit` al liberar.

**Un detalle del entorno, no del código:** una pestaña oculta suspende
`requestAnimationFrame`, y con él el polling. En la verificación se sustituyó la fuente
de frames por un temporizador porque la ventana no estaba en primer plano; con la
ventana visible el bucle es el de siempre. Es comportamiento del navegador — y el
correcto: un mando no debe mover una UI que nadie está mirando.

## Diferidos

| Diferido | Cuándo | Forma prevista |
|---|---|---|
| Gatillos/bumpers (paginar, cambiar de pestaña) | cuando un componente los pida | más entradas del mismo `readPad` |
| Vibración (`GamepadHapticActuator`) | v1.x | comportamiento del SDK |
| Mapeo no estándar (`mapping !== "standard"`) | si aparece un mando real que lo necesite | tabla por `id`, fuera del núcleo |
| Varios mandos a la vez | no previsto | el preview tiene un jugador |
| `ScrollTo` programático | pendiente de ZAB-9 | prop opcional forward-tolerant |

## Fuera de alcance

La paridad Unity (ZAB-27, mismo mapeo sobre el Input System, con `gamepad.ts` como
referencia literal de las reglas) y el teclado en pantalla de consola (v1.x).
