# Spec: `ScrollView` — props, estados, eventos y contrato de medición (2026-08-11, ZAB-9)

> Tarea Linear: [ZAB-9] — milestone **F1 — Scroll y clipping**, track A3.
> ZAB-5 decidió el **contrato de la IR** (`clip` en `NodeBase` + `ScrollView` como
> primitivo), ZAB-7 el **recorte en el renderer web** y ZAB-8 el **input de rueda y
> drag**. Esta tarea no añade comportamiento: cierra el componente con la spec
> escrita de props/estados/eventos, el ejemplo de referencia
> (`examples/inventory-demo`) y los diferidos registrados. La paridad con Unity se
> valida en ZAB-6 y los golden cross-target en ZAB-38.

## Qué faltaba por escribir

El componente ya existía y funcionaba, pero tres preguntas no tenían respuesta
escrita en ningún sitio, y son justo las que un usuario del catálogo hace primero:

1. **¿Qué `states.*` aplican?** Todos los demás componentes tienen su tabla de
   estados; el scroller nunca la tuvo.
2. **¿Qué eventos emite?** La IR solo tiene acciones con nombre y bindings: ¿hay un
   `onScroll`, se puede bindear el offset, cómo lo mueve el juego?
3. **¿Cómo se mide el contenido?** La regla "los hijos se miden sin restricción en
   el eje scrolleable" estaba en la spec de la IR (ZAB-5) pero no en la del
   componente, que es donde se busca al escribir una pantalla.

## API de autoría (`@zabloo/react`)

```tsx
<ScrollView
  axis="vertical"          // "vertical" (default) | "horizontal" | "both"
  scrollbar                 // default: true — indicador overlay pintado por el SDK
  layout={{ width: 460, height: 340, padding: 8, gap: 4, align: "stretch" }}
  style={{ background: "{color.bg.panel}", radius: "{radius.md}" }}
>
  {items}
</ScrollView>
```

Solo dos props propias; el resto es `CommonProps` (`id`, `layout`, `style`,
`variant`, `visible`, `transition`). No hay prop de offset — ver "Eventos".

- **`axis`** es el eje **que se mide sin restricción**, no la dirección del flex:
  la dirección sigue siendo `layout.direction`. `"both"` libera los dos ejes (un
  mapa, una rejilla grande).
- **`scrollbar`** es booleano en v1; estilarlo es extensión compatible
  (booleano → unión/objeto). Se apaga donde el propio contenido cortado ya dice que
  hay más — una tira de chips, por ejemplo.

**El viewport lo pone el autor.** Un ScrollView sin tamaño (ni `width`/`height`, ni
`grow`, ni un padre que lo estire) abraza su contenido y no tiene nada que
scrollear. No es un bug: es la consecuencia de que por fuera sea un nodo flex
normal, y no hay forma de distinguirlo de "todavía cabe".

## Medición y layout

Por fuera y por dentro es un contenedor flex normal:
`direction`/`justify`/`align`/`gap`/`padding` colocan a los hijos igual que en un
`Container`. La única diferencia es la medición:

- En el **eje scrolleable** los hijos se miden **sin restricción** — miden su tamaño
  natural, y eso define el *content size*. Corolario práctico: un `Text` dentro de
  un scroller horizontal **no hace wrap** (no se le ofrece anchura), y una fila que
  quiera ocupar todo el ancho en un scroller vertical lo consigue por el eje
  **cruzado**, con `align: "stretch"` (que es restricción normal).
- El `padding` cuenta como contenido: mueve a los hijos y amplía el recorrido.
- Desplazamiento máximo por eje: `max(0, contentSize − viewport)`; en el eje no
  scrolleable siempre 0.

Trampa detectada montando el ejemplo, que merece estar escrita porque parece un
fallo del scroller y no lo es: **`align` no cascadea**. Un `<Collapse>` (o cualquier
contenedor) dentro de un ScrollView con `align: "stretch"` se estira él, pero sus
propios hijos vuelven al `align` por defecto y abrazan su contenido. La sección
anidada necesita su propio `align: "stretch"`.

## Offset: estado del runtime, sin representación en la IR

El offset es estado del SDK, como `pressed` de Button u `open` de Collapse:

- **No se serializa** y **no se puede declarar** — no existe prop de offset inicial.
- Se **reclampa en cada relayout** contra los límites nuevos. Es lo que hace que
  cerrar un `Collapse` dentro de la lista deje el scroll pegado al final nuevo en
  vez de colgando más allá del contenido.
- Se aplica como **traslación de los rects de los hijos** en paint y hit-testing,
  así que focus y pulsaciones usan posiciones de pantalla reales.

## Estados: ninguno (decisión de esta tarea)

**`states.*` no aplica al nodo ScrollView.** No es focusable (la focusabilidad
deriva de identidad: Button, Toggle, Slider, header de Collapse), no tiene
`hover`/`pressed`, y no participa en ningún `group`, así que tampoco
`selected`/`checked`. El offset **no es un estado de estilo**: no hay ningún
`states.scrolled`, ni lo habrá — el scroll no cambia cómo se pinta el scroller,
cambia dónde está su contenido.

Lo que sí funciona con normalidad es todo lo de dentro: los `Button` de las filas
conservan sus estados, y arrastrar para scrollear **no se convierte en un click**
sobre el que quedó debajo del dedo (umbral drag-vs-tap de ZAB-8, y el release se
cancela si el nodo salió de la región visible). `variant` sí resuelve el estilo base
del scroller, como en cualquier primitivo.

## Eventos: ninguno, y un canal de host

- **No hay `onScroll`** en v1. Los dos mecanismos dinámicos de la IR son acciones
  con nombre y bindings por path; un evento continuo de scroll no tiene consumidor
  hoy (nadie pinta cabeceras parallax) y abriría la puerta a acciones a 60 Hz.
- **El offset no es bindeable** (ni de lectura ni de escritura), a diferencia del
  valor de `Toggle`/`Slider`.
- El juego lo mueve por el **canal de host**: `SetScroll(id, x, y)` —
  `view.setScroll(id, x, y)` en el renderer web, hermano de `setOpen`/`setChecked`/
  `setValue`. Es **API, no IR**: no viaja en el envelope y clampa contra los
  límites del último relayout.

## `clip` implícito

Un ScrollView **siempre recorta**, paint **y** hit-testing; un `clip: false`
explícito se ignora (scroll sin recorte no significa nada). El rect efectivo de un
nodo es la intersección con los clips de sus ancestros, así que una fila desbordada
ni se pinta ni recibe input. Un nodo focusable fuera de la región visible sigue
siendo alcanzable con rueda/drag, pero **no se auto-scrollea** hasta él (diferido a
la fase de gamepad).

## Scrollbar

Overlay pintado por el SDK dentro del rect del ScrollView, en el borde del eje
(derecha / abajo): largo proporcional a la fracción visible del contenido, posición
proporcional al offset, con un largo mínimo para que siga siendo visible en listas
muy largas. **No participa en layout ni en hit-testing** — no se arrastra, el scroll
es rueda/drag del contenido — y solo aparece cuando hay desbordamiento.

## Input hoy (verificado en el preview con el ejemplo)

Lo que hay implementado en web es **fiel al eje**, y eso tiene dos consecuencias que
conviene tener escritas antes de que alguien las descubra como "bugs":

1. **La rueda mapea 1:1**: `deltaX → x`, `deltaY → y`, cada uno clampado a su
   límite. En un scroller **solo horizontal** el `deltaY` de un ratón normal **no
   hace nada**; hace falta gesto horizontal (swipe de trackpad = `deltaX`).
2. **Un drag que empieza sobre un `Button`/`Toggle` no scrollea**: el `pointerdown`
   toma la rama de pulsación y sale, sin registrar el gesto de scroll. En una tira
   de chips (todo botones) el drag solo agarra en los huecos entre ellos.

Ninguna de las dos es del componente — son del input de ZAB-8 — pero las dos se ven
en el ejemplo. Propuesta para cuando se retome el input (fase de gamepad o un
issue propio de F1): que el `deltaY` caiga al eje horizontal cuando es el único
scrolleable (lo que hacen navegadores y motores), y que la pulsación registre
también el gesto de scroll, cancelando la pulsación al superar el umbral — el
`up` ya sabe cancelar el tap si el nodo se ha movido.

## Degradación (SDK viejo recibe un ScrollView por hot-update)

Regla normativa de ZAB-5: un tipo desconocido se renderiza como `Container`
preservando `layout`, `style`, `visible` y `children`. La peor degradación es "la
pantalla se desborda": el contenido nunca desaparece.

## Ejemplo de referencia

`examples/inventory-demo` — una tienda con desbordamiento real, base del ejemplo de
listas de F6 (hoy las filas se construyen con un `map` en autoría; F6 sustituye ese
`map` por un `Repeat` bindeado). Cubre: lista vertical de 14 filas ricas (icono,
nombre, detalle, precio y botón de compra), tira horizontal de categorías con
`axis="horizontal"` y `scrollbar={false}`, un `Collapse` **dentro** del scroller
para ver el reclamp del offset, y clic en un botón interior sin que el drag se lo
coma. `examples/scroll-demo` se queda como banco de pruebas mínimo de ZAB-7/ZAB-8.

## Diferidos (todos extensiones compatibles)

| Diferido | Cuándo | Forma prevista |
|---|---|---|
| ScrollTo programático / offset declarado o bindeable | fase de gamepad (F5) | prop opcional forward-tolerant |
| Auto-scroll hasta el nodo enfocado | fase de gamepad (F5) | comportamiento del SDK, sin IR nueva |
| Inercia / momentum | después | comportamiento del SDK |
| Scrollbar estilable | después | `scrollbar` booleano → unión/objeto |
| Snap | después | prop nueva |

## Fuera de alcance

Paridad de comportamiento con Unity (ZAB-6) y golden tests cross-target (ZAB-38).
