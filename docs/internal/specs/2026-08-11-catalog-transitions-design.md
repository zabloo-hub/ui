# Spec: juice del catálogo existente — comportamientos que conducen el motor de transiciones (2026-08-11, ZAB-36)

> Tarea Linear: [ZAB-36] — milestone **F7 — Transiciones (juice)**. Aplica al catálogo que
> YA existe el motor de ZAB-45 (que implementa el contrato de ZAB-33). Alcance: `Button`
> (hover/pressed), anillo de foco, `Collapse`, `Toggle`, `Slider`, `Tabs`, defaults de
> `transition` en el theme y la vista starter de `create-zabloo-app`. Fuera: `Modal`/`Toast`
> (ZAB-21: sus transiciones entran con los componentes) y la paridad Unity (batch de Unity).
>
> **Nada de esto añade superficie a la IR.** Todo se apoya en la regla §5 de ZAB-33: *un
> comportamiento propiedad del SDK, indexado por identidad de componente, puede conducir la
> misma maquinaria de interpolación con extremos que él calcula.*

## Contexto y problema

ZAB-45 dejó el motor funcionando y dos componentes estrenándolo (`ProgressBar`, `Spinner`).
El catálogo anterior seguía saltando: al pulsar un botón, al abrir un `Collapse`, al marcar
un `Toggle`, al cambiar de pestaña. Aplicar juice destapó cuatro cosas que **no** eran
"poner una prop" y que por tanto son decisiones:

1. `hover` existe en `StateName` desde v1 pero **el renderer web nunca lo implementó**.
2. El `Collapse` mete y saca su contenido del layout: no hay valor intermedio (§5 lo
   anticipaba), así que hacía falta escribir de dónde salen sus extremos.
3. El `Toggle` cambia de indicador **intercambiando dos subárboles** (ZAB-23): tampoco hay
   valor intermedio, y la posición del knob de un `Switch` es `justify` — un enum.
4. Un anillo de foco que se va pintaba **magenta** a mitad de camino.

## Decisiones

### 1. `hover` se implementa en el renderer web, con la regla de identidad del foco

El nodo bajo el puntero recibe `states.hover`, y **hoverable = focusable** (`Button`,
`Toggle`, `Slider`, header de `Collapse`): lo que toma input es lo que puede verse distinto
bajo el puntero. Es la misma regla de identidad de componente que ya decide `pressed` y la
navegación, así que no hay una tercera lista que mantener.

- **Solo ratón** (`pointerType === "mouse"`): un dedo que toca y se va dejaría el control
  encendido sin nada encima. El backdrop de un modal captura, así que no ilumina nada debajo.
- **Orden de estados (normativo), de menos a más específico:**
  `base → selected → checked → hover → focused → pressed`.
  Los estados de valor van primero (lo que el control **es** es la base); `hover` va debajo
  de `focused` para que un ratón de paso no tape un anillo de foco; `pressed` gana siempre,
  porque dura exactamente lo que el dedo está abajo. Vive en `states.ts`, puro y testeado,
  para que Unity porte la misma tabla.
- `disabled` sigue declarado en la IR y sin estado en runtime: nunca activa.

### 2. `Collapse`: el comportamiento anima su propia altura, con los extremos del último measure

> Extremo cerrado = **la caja del header** (`header.natural.y + padding*2`).
> Extremo abierto = **la altura natural medida con el contenido dentro**.

- El contenido **entra en layout al empezar** la animación y sale **al terminarla**: un
  `Collapse` cerrado sigue sin costar nada, que es la premisa de `display:none` de v1.
- **Clip forzado mientras dura** (`forcedClip`, runtime): la caja está recortando contenido
  que no cabe, y pedirle al autor que se acuerde de `clip` sería una trampa.
- Los extremos salen del **measure anterior**, nunca de este frame: interpolar entradas
  antes del layout es justo lo que evita el bucle medida→animación→re-medida (ZAB-33 §4).
  De ahí una consecuencia visible y aceptada: **la primera apertura gasta un frame** en el
  que la caja se queda cerrada mientras ese mismo measure aprende la altura abierta
  (`collapseTarget(open, natural, closed)` devuelve `closed` cuando aún no la sabe).
- **Solo la altura.** El ancho salta a lo que pida el contenido en el primer frame: v1 no
  tiene un "medir sin afectar" y animar los dos ejes pediría dos extremos más por nada —
  el efecto que se busca es el vertical.
- **Un `layout.height` declarado gana**: si el autor fijó la caja, el comportamiento no
  pelea con él (abre y cierra como antes, instantáneo).
- Sin `transition` usable ⇒ comportamiento pre-F7 exacto. Un `Accordion` cierra al hermano
  por el mismo camino, así que uno se abre mientras el otro se cierra.
- Sacar el nodo del layout a mitad de animación **la cancela** y lo deja en su estado
  lógico: vuelve abierto o cerrado, nunca a medias de un movimiento que nadie vio.

### 3. `Toggle`: los dos slots comparten caja y hacen crossfade

El modelo de dos slots posicionales de ZAB-23 se mantiene; lo que cambia es **dónde se
colocan**: `children[1]` se arregla **encima** de `children[0]`, no después, y la opacidad
decide cuál se ve (`slotOpacity(index, progress)`, con `progress` tweeneado por el motor).

- La caja compartida es **la mayor de las dos**, así que el control no cambia de tamaño al
  cambiar de estado. El resto de hijos (la etiqueta) fluye normal detrás.
- Es una generalización del pase de layout — `flowItems` devuelve *cajas*, normalmente una
  por hijo — no un caso especial pegado al Toggle.
- Sin `transition` el progreso solo vale 0 o 1: **idéntico al swap pre-F7**.
- **El knob no se desliza**: sin transform en v1 no hay posición animable (y `justify` es un
  enum). Un deslizamiento real pediría semántica de arrange nueva y queda diferido; el
  crossfade es lo que da juice sin tocar el contrato.
- Consecuencia menor y asumida: un Toggle con slots de tamaños distintos reserva el mayor
  siempre. Es lo correcto para que no baile, y los controles del catálogo los emiten iguales.

### 4. `Slider`: glide para lo que viene del juego, salto para lo que viene del dedo

El nodo gana un **valor pintado** (`sliderDisplay`) que sigue al lógico (`sliderValue`) a
través del motor. Mientras hay un gesto en curso — drag de puntero o flechas mantenidas — el
paso se da **sin transición**: un pulgar que va por detrás del dedo se lee como un control
roto, no como juice. Un `SetData` o un `setValue` del juego sí planean. El layout sigue
derivando la geometría de un número, como el `ProgressBar`: se interpola el valor, nunca el
rect.

### 5. Anillo de foco: un `borderColor` no declarado **sostiene** el último

Al salir de `focused`, `borderWidth` interpolaba 2→0 mientras `borderColor` pasaba a
`undefined`, y el paint caía a `MISSING_COLOR`: **un flash magenta** en cada desenfoque. La
regla nueva: un color de borde no declarado conserva el último resuelto. Es honesto porque
el borde solo se pinta si hay `borderWidth`, así que sostenerlo no inventa nada — solo deja
que el anillo se vaya con su propio color. (Los demás colores siguen saltando cuando no se
declaran: sin `background` no hay nada pintado y no hay extremo honesto.)

### 6. `Tabs`: se anima el botón, no el panel

`states.selected` del botón de la barra transiciona con la maquinaria declarativa, sin nada
nuevo. Los **paneles siguen saltando**: entrar y salir del layout es una animación de
entrada/salida, que sigue diferida (ZAB-33 §5) — un nodo en flujo no puede sobrevivir a su
propia eliminación como sí puede un `Overlay`.

### 7. Defaults de `transition` en el theme, por componente

```ts
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
  Collapse: { duration: "{motion.slow}", easing: "ease-in-out" },
};
```

- **Misma clave que `variants`** (el nombre del primitivo), porque responde a la misma
  pregunta un nivel más arriba: cómo se ve y cómo se mueve un `Button` en este proyecto.
- Precedencia: **prop del nodo > variante (`VariantDef.transition`) > theme**. No se mergea
  campo a campo: `transition` es un objeto por nodo (ZAB-33), así que gana entero el más
  específico.
- **Se descartó un default global único**: metería `transition` en *cada* nodo del envelope
  (payload) y animaría cosas que nadie pidió. Con `duration` tokenizada, un tema sigue
  ajustando todo el movimiento desde un sitio (`motion.*`).
- Se resuelve en **autoría** (`useVariant`), como los variants: al envelope llega el nodo
  resuelto, nunca el theme. Precio de una clave plana: los `Container` que emite el azúcar
  (los raíles de un `Switch`, los paneles de `Tabs`) cuentan como `Container`.

## Cambios en el código

- `@zabloo/react`: `ThemeTransitions`, `ZablooTheme.transitions`, `VariantDef.transition`,
  `useVariant` devolviendo la transición resuelta y `primitive()` emitiéndola.
- `@zabloo/cli`: el export pasa `transitions` al `ThemeProvider` (junto a `variants`).
- `@zabloo/renderer-web`: `states.ts` (orden de estados, puro) y `collapse.ts` (extremos,
  puro) nuevos; `toggle.ts` cambia `slotShown` por `slotOpacity`; `layout.ts` gana
  `createLayoutNode`, el tamaño `natural` y `flowItems` (cajas compartidas); `hit.ts`
  respeta `forcedClip`; `view.ts` implementa hover y los cuatro comportamientos.
- Autoría: theme y vista del starter, `examples/hello-button`, `settings-demo` y
  `tabs-settings`.

## Verificado

Tests unitarios de los módulos puros (`states`, `collapse`, `toggle`, `layout` con caja
compartida y tamaño natural) y de la resolución del theme en `@zabloo/react`. El resto es la
vista, que no tiene tests: **verificado en el preview real** (`zabloo dev`, duraciones
exageradas para poder capturar frames intermedios) — hover encendiendo la fila bajo el
puntero, crossfade del `Switch` con los dos knobs a la vez, `Collapse` a media apertura con
el contenido recortado y lo de abajo desplazado, `Slider` planeando hacia un valor empujado
por `setData` y asentando, y el anillo de foco adelgazando **en blanco** hasta desaparecer.

## Diferidos (sin cambios de contrato cuando lleguen)

Deslizamiento real del knob del `Switch` (pide posición animable: transform o semántica de
arrange nueva), animación de entrada/salida genérica (paneles de `Tabs`, contenido en
flujo), `hover` en Unity, transiciones por propiedad y por estado, `delay`, keyframes y
timelines (v2).
