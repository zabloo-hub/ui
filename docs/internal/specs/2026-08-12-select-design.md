# Spec: `Select` — el desplegable, y el popover que lo hace posible (2026-08-12, ZAB-25)

> Tarea Linear: [ZAB-25] — milestone **F5 — Formularios e input completo**, track C4.
> Alcance entregado: un valor nuevo en el contrato (`@zabloo/format`), el
> comportamiento en `@zabloo/renderer-web`, el azúcar `<Select>`/`<Option>` en
> `@zabloo/react`, el ejemplo en `examples/settings-demo` y esta spec. La paridad en
> el SDK de Unity queda pendiente (batch final, como el resto de F4/F5).

## Contexto y problema

La issue pedía "botón que abre un dropdown en la capa de overlay, lista navegable
(focus + scroll si es larga), selección que cierra y actualiza el valor bindeado", y
sugería **considerar si reusa `group: "exclusive-check"`** en vez de un mecanismo
nuevo. La respuesta corta es que sí lo reusa entero: la selección de un desplegable
es UN valor, exactamente la semántica que ZAB-23 le dejó al RadioGroup.

Lo que no existía era otra cosa. Con lo que había en main, un `<Select>` compuesto
—`Button` + `Overlay` anclado (ZAB-46) + grupo `exclusive-check` dentro de un
`ScrollView`— se quedaba a un requisito:

| Requisito | ¿Expresable antes de esta tarea? |
|---|---|
| Colocarse pegado al botón, voltear si no cabe | **Sí** — `anchor` de ZAB-46, sin tocar nada |
| Bloquear el resto, cerrar con Escape / clic fuera | **Sí** — `modal` + dismiss de ZAB-44 |
| Lista larga con scroll | **Sí** — `ScrollView` |
| La selección escribe el valor | **Sí** — binding de lectura/escritura de ZAB-23 |
| **Que elegir CIERRE el desplegable** | **No** |

Un `Overlay` solo se abre y se cierra por su `visible` bindeado, y nada en la IR
podía escribir ese booleano en respuesta a algo que el jugador hace **dentro**. Un
`Toggle` como trigger (que sí escribe su binding) abre, pero la selección no cierra;
un `Collapse` con el overlay dentro tiene el mismo agujero. Y "abierto" no es un dato
del juego: es estado de runtime, como el `open` del Collapse.

## Decisión 1: `trigger: "press"` — el popover, no un 14º primitivo

`OverlayTrigger` gana un tercer valor. El press del ancla abre el overlay y **el SDK
es dueño de ese estado**, con lo que hay quien pueda cerrarlo.

```ts
export type OverlayTrigger = "hover" | "manual" | "press";
```

Cuatro reglas normativas, todas sobre la relación de ancla que ZAB-46 ya había
establecido:

1. **Pulsar el ancla lo abre y lo cierra.** El mismo press hace las dos cosas, que es
   como se comporta un botón de desplegable. El `onClick` del ancla sigue
   disparándose: abrir es comportamiento, nunca un sustituto de la acción declarada.
2. **Un dismiss lo cierra** — Escape, B del mando, tap en el backdrop si es `modal`.
   La misma vía de la que ya colgaba `onDismiss`.
3. **Una selección dentro lo cierra.** Cuando un grupo `"exclusive-check"` de dentro
   toma un valor nuevo, el popover se cierra — **también al reelegir la opción ya
   marcada**, porque un desplegable que se quedara abierto en "sí, esa misma" es un
   callejón sin salida.
4. **Al abrir, el foco va a la selección** — la opción marcada, para que una lista de
   veinte idiomas abra donde el jugador la dejó; si no hay ninguna, el `autofocus`
   del subárbol y, en último término, **la primera opción**. Un menú que el jugador
   ha abierto es un menú en el que está: uno que abriera sin foco no se podría
   recorrer con las flechas. Al cerrar, el foco vuelve solo a quien lo tenía, que
   para un popover abierto por su ancla es el ancla.

**Por qué esto y no un primitivo `Select`.** La regla del vocabulario es *"primitivo
nuevo solo cuando fuerza una capacidad nueva"*, y la capacidad que falta aquí no es
"un control que elige de una lista" — eso ya es el grupo `exclusive-check` — sino
"un overlay cuyo estado de apertura es del SDK". Eso pertenece a la relación de
ancla, no a un tipo de nodo. Un `Select` primitivo habría duplicado la semántica de
grupo y habría añadido superficie a los tres SDKs para no ganar nada; el popover, en
cambio, sirve además para un menú contextual, un selector de color o una rueda de
emotes. `<Select>` queda como **composite aplanado**, como `<Tabs>`, `<RadioGroup>`,
`<Accordion>` y los tres overlays.

`visible` sigue siendo la puerta (un `false` bindeado lo mantiene cerrado), el SDK
**nunca escribe `visible`** por un popover —el estado abierto es suyo, no del dato
del juego— y `autoCloseMs` se ignora, como con `hover`: un menú se cierra, no caduca.

**Degradación.** Un SDK anterior lee un `trigger` desconocido como `manual`, así que
el desplegable se queda abierto en la capa, anclado donde diga su ancla o, si tampoco
conoce `anchor`, donde diga el placement de capa que se emite igualmente. Una lista
visible e inerte, nunca un control que no aparece.

## Decisión 2: el botón cerrado enseña el VALOR

La cara cerrada lleva un `<Text>` bindeado al mismo path que el grupo. Enseña `"high"`,
no `"Alta"`: la IR **no tiene expresiones**, así que no hay con qué buscar una
etiqueta a partir del valor, y ninguna de las alternativas se paga sola en v1 —
espejar el subárbol de la opción marcada es una relación nueva ("un nodo pinta el
contenido de otro") que habría que portar a Unity, y un slot por opción en el trigger
tocaría la semántica de `value` dentro de un grupo.

Consecuencia que hay que decir en voz alta: **no hay `placeholder`**. Un valor vacío
deja el botón en blanco, por el mismo motivo por el que no hay etiqueta. Quien quiera
texto legible autora los strings de display como `value` (`<Option value="Español">`),
que es lo que hace el ejemplo. El split value/label es extensión compatible.

## Decisión 3: el popover revela la opción sobre la que abre

Esta tarea llegó a implementar el auto-scroll al foco entera, y **ZAB-47 la aterrizó
en main mientras estaba en review** (`revealDelta` + `revealFocused`). En el rebase se
tira la duplicada y se reusa la suya: la mitad del "lista navegable" que pedía la
issue ya estaba hecha.

Lo que sí se añade es el caso que aquella regla **excluye a propósito**.
`revealFocused` solo lo llama la navegación, con este motivo escrito: *"un press del
puntero enfoca lo que el jugador ya está mirando, y el foco que restaura un modal cae
durante un render, donde un scroll suyo llegaría un frame tarde"*. Un popover es
justo eso y aun así lo necesita: abre **sobre su selección**, y esa opción se acaba de
disponer en el frame en que la lista aparece — sin revelarla, una lista de veinte
idiomas abre por arriba con el foco invisible, que es exactamente el bug que
`revealFocused` existe para evitar.

La respuesta es no dejarlo para el frame siguiente sino para el **pase siguiente**:
`revealOpenedPopover` corre después del arrange, donde las cajas son finales, y solo
escribe offsets — que es lo único que el arrange lee de vuelta —, así que un segundo
arrange lo asienta en el mismo frame.

## API de autoría (`@zabloo/react`)

```tsx
<Select id="language" value={{ bind: "settings.language" }} onChange="language-changed">
  <Option value="Español"><Text>Español</Text></Option>
  <Option value="English"><Text>English</Text></Option>
</Select>
```

Aplana a un `Button` con el `id` (la cara cerrada) que contiene **dentro** el
`Overlay` del desplegable — que es donde vive un overlay (declarado en el sitio donde
está la UI que lo abre) y lo que mantiene `<Select>` como **un solo elemento**: un
`Overlay` nunca entra en el flow de su padre, así que no añade nada a la caja del
botón.

```
Button#language                       ← la cara cerrada, con el <Text bind>
└ Overlay modal anchor={id:"language", at:"bottom", trigger:"press"}
    └ ScrollView (width, maxHeight, align:"stretch")
        └ Container group="exclusive-check" value={bind} align="stretch"
            ├ Toggle value="Español"
            └ Toggle value="English"
```

- **`id` es obligatorio**: el anclaje es la única relación de v1 que direcciona otro
  nodo por nombre. Sin él es error de autoría, no un desplegable que no abre.
- `<Option>` es el mismo `Toggle` que `<Radio>`, vestido de fila: la marca en la
  opción elegida y la fila entera resaltada por `states.checked`, más un
  `states.focused` **después** de `checked` en el orden normativo de merge — sin él,
  recorrer la lista con el teclado no se ve, porque la fila enfocada y la elegida
  serían la misma cosa.
- **`align: "stretch"` en la lista y en el grupo**: es lo que hace que la fila entera
  sea el objetivo. Sin ello cada opción es tan ancha como su etiqueta y la mitad
  vacía de la fila es un clic que no hace nada (encontrado en el preview).
- Props de aspecto: `width` (botón y lista), `maxHeight` (a partir de ahí scrollea),
  `position` (el lado por el que abre; voltea igual cuando no cabe), `button`,
  `label` y `panel`.

## Bug de pintado encontrado en el preview (y arreglado)

El `GeometryBuilder` solo abría un grupo de batches nuevo **cuando cambiaba el clip**,
y dentro de un grupo se dibujan todos los sólidos antes que todos los glifos. Como
una entrada de la capa sin `clip` propio seguía llenando el grupo del árbol, **el
texto del árbol salía por encima del panel opaco que flotaba sobre él** — el
desplegable se veía transparente con "Baja/Media/Alta" atravesándolo.

Es un bug **anterior a esta tarea** (cualquier overlay con panel opaco sobre texto lo
tenía; con el backdrop translúcido de un `<Modal>` pasaba desapercibido). Se arregla
con `startRoot()`: cada entrada de la capa es un **paint root** y abre grupo sí o sí,
que es justo lo que `setClip` no puede expresar — dos roots pueden compartir región
de recorte (los dos sin clip, típicamente) y aun así tener que ordenarse uno detrás
del otro. Con test de regresión.

## Cambios

**`@zabloo/format`**: `"press"` en `OverlayTrigger` con las cuatro reglas en el
docstring, y la nota en `GroupBehavior` de que `"exclusive-check"` respalda también
el `<Select>`.

**`@zabloo/renderer-web`**
- `overlay.ts`: `isPressTriggered`, `checkGroupsIn`, `selectedOptionIn`, y `"press"`
  en la lectura tolerante de `anchorSpec`.
- `layout.ts`: `LayoutNode.popoverOpen`.
- `tessellator.ts`: `startRoot()`.
- `view.ts`: `anchorAllows` lee el flag para `"press"` — y con eso input, foco,
  timers y el tween de presencia lo leen todos por `this.layer`, sin cableado propio
  en ningún otro sitio —, `popoversOf`/`togglePopovers`/`closeEnclosingPopover`,
  el enganche en `activate`, `requestDismiss` y `setToggleChecked`, el foco inicial
  en `autofocus`, y `revealOpenedPopover` tras el arrange (sobre el `revealFocused` de
  ZAB-47). `textBox` pasa a ser
  `contentBox` (el mismo cálculo lo necesitaban dos sitios).
- Tests: los predicados del popover, el foco inicial (con selección, sin ella, con
  la opción fuera de layout, con grupo anidado), que el popover **sí** toma el
  puntero (al contrario que un hint de hover), y el orden de los paint roots.

**`@zabloo/react`**: `<Select>` y `<Option>` con sus props, exports, y tests de IR
1:1 (el árbol aplanado entero, el mapeo de `position`, la etiqueta vacía sin binding
y el error de `id`).

**Ejemplo**: `examples/settings-demo` gana un desplegable de idioma con diez opciones
—bastantes para que scrollee de verdad— bindeado a `settings.language`.

## Verificación

`typecheck` / `test` / `lint` en verde, y comprobado en el preview real
(`zabloo dev`), que es donde salieron los tres defectos de arriba: abre pulsando el
botón y cierra al volver a pulsarlo; la lista abre **sobre la opción en uso** y
scrolleada hasta ella; con nada elegido abre sobre la primera; las flechas recorren
la lista **arrastrando el scroll** con el foco; Enter y el clic eligen, escriben el
binding (el panel de datos y el `<Text bind>` de al lado lo siguen) y cierran;
reelegir la opción ya marcada cierra sin anunciar nada; Escape y el clic fuera
cierran **sin tocar el dato**; y el panel se ve opaco sobre el texto de debajo.

El **volteo** cuando no cabe abajo no se pudo forzar en el preview (el redimensionado
de la ventana no llegaba a la captura): es `anchorBox`, que esta tarea no toca y que
ZAB-46 dejó con tests para justo ese caso.

## Degradación (SDK viejo recibe un desplegable por hot-update)

| Novedad | Qué hace un SDK viejo | Resultado |
|---|---|---|
| `trigger: "press"` | valor desconocido → se lee `manual` | la lista se queda abierta en su sitio anclado, inerte |
| `anchor` (si tampoco lo conoce) | prop desconocida, se ignora | la lista sale donde diga el placement de capa |
| `group: "exclusive-check"` | valor desconocido de `group`, se ignora | opciones independientes |
| `states.focused` en la fila | ya existe desde v1 | — |

## Fuera de alcance

- **Paridad en Unity**: el popover y el scroll-sigue-al-foco, en el batch final.
- **Gamepad** (abrir con A, navegar con d-pad, cerrar con B): ZAB-47 / ZAB-27. El
  equivalente de teclado ya está, y el foco es el mismo mecanismo que usará el mando.
- **Split value/label y `placeholder`** de la cara cerrada (§2), extensiones
  compatibles.
- **Multi-selección** (pide un grupo que no sea exclusivo: N booleanos, que es lo que
  `exclusive-check` deliberadamente no es), **búsqueda dentro del desplegable** y
  **grupos/separadores** en la lista.
- **Transición de apertura**: un `transition` en el `Overlay` ya funde su presencia
  (ZAB-21); el desliz del panel pide transform, que v1 no tiene.
