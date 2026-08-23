# Spec: `TextInput` — caret, selección y entrada de texto (2026-08-11, ZAB-26)

> Tarea Linear: [ZAB-26] — milestone **F5 — Formularios e input completo**, track C4.
> Alcance entregado: contrato de la IR, azúcar de autoría en `@zabloo/react`,
> comportamiento en `@zabloo/renderer-web`, ejemplo en `examples/settings-demo` y
> esta spec. La paridad en el SDK de Unity queda pendiente (va por detrás: aún no
> conoce `ScrollView`, `Image`, `clip`, `Overlay`, `Toggle` ni `Slider`).

## Contexto y problema

Era el componente más caro del roadmap y no existía nada: ni tipo en `ZNode`, ni
entrada en `HostType`, ni componente React, ni manejo en el renderer (`grep
TextInput|caret` = 0 resultados). Los controles anteriores producían su valor
**apuntando a geometría** — un booleano (`Toggle`), un número (`Slider`), un índice
(Tabs) —, y ninguno tenía **interior**: un punto de inserción que el jugador mueve
por dentro de un contenido que él mismo está escribiendo.

Eso trae tres problemas que ningún componente anterior tuvo:

1. **Un caret hay que colocarlo entre glifos**, con los mismos números con los que
   se pintan (kerning incluido), o se ve al lado de la costura y no encima.
2. **Las flechas ya están cogidas dos veces**: desde 2026-08-04 mueven el focus
   espacial, y desde ZAB-24 ajustan el `Slider` enfocado.
3. **Un canvas recibe pulsaciones, pero no TEXTO.** Composición IME, portapapeles y
   teclado virtual del móvil pertenecen a un elemento editable de verdad.

## Decisión 1: `TextInput`, 13º primitivo

Entra por la puerta legítima del vocabulario (*"primitivo nuevo solo cuando fuerza
una capacidad nueva"*): la capacidad es **el caret** — un punto de inserción y una
selección dentro del contenido. Es una **hoja con contenido**, como `Text` e
`Image`: no acepta hijos y pinta su propio valor por el camino de texto de siempre.

```ts
export interface TextInputNode extends NodeBase {
  type: "TextInput";
  /** Texto actual, o binding de lectura/escritura. Default: "". */
  value?: Bindable<string>;
  /** Se ve mientras el valor está vacío; se estiliza con el estado `empty`. */
  placeholder?: string;
  /** Acción en cada edición (el hook en vivo). */
  onChange?: string;
  /** Acción al confirmar el campo (Enter). */
  onSubmit?: string;
  /** Tope de lo que puede TECLEAR el jugador (no de lo que puede valer el dato). */
  maxLength?: number;
}
```

El SDK es dueño del estado de runtime — el texto, el caret, la selección y el
scroll horizontal del contenido —, indexado por tipo como el `checked` del `Toggle`
y el `value` del `Slider`.

Descartado un **`Text` editable** (`editable: true`): el SDK despacharía
comportamiento por tipo **y** por prop, que es lo que ya hundió `overflow` en ZAB-5,
`checkable` en ZAB-23 y `Repeat` como prop de `Container` en ZAB-29. Y un `Text`
mide su contenido, mientras que un campo **no puede crecer con lo que se teclea**.

## Decisión 2: una sola línea en v1

El nodo mide **una línea de alto y ancho cero** — el ancho sale de su propio
`layout` (`<TextInput>` pone 220 por defecto, como `<Slider length>`) — y el
contenido **hace scroll horizontal** para mantener el caret dentro. Un `\n` nunca se
inserta: al pegar un texto de dos líneas se convierte en espacio, que deja la
primera línea en la caja en vez de fallar en silencio.

El campo multilínea es una extensión compatible sobre el wrap de ZAB-17 (un caret
con fila además de columna, selección por rangos de línea, scroll vertical) y queda
diferido: es otro componente de trabajo, no un flag.

## Decisión 3: el placeholder es un estado, no un color nuevo

`placeholder` se pinta **con el estilo de texto del propio campo** y el estado nuevo
**`empty`** es lo que lo viste:

```tsx
<TextInput
  value={{ bind: "profile.name" }}
  placeholder="Tu nombre"
  states={{ empty: { style: { color: "{color.muted}" } } }}
/>
```

Con eso, `Style` no gana un solo campo y el placeholder hereda gratis todo lo que ya
existe (tokens, `transition`, variantes del theme). El orden normativo de estados
pasa a ser:

```
base → empty → selected → checked → hover → focused → pressed
```

`empty` abre los estados de valor porque es **la afirmación más débil que hace un
control sobre su valor**: cualquier cosa que el autor diga de un campo enfocado o
seleccionado debe ganarle al placeholder.

Descartado un **slot posicional** (`children[0]` visible mientras está vacío): el
nodo ya pinta el valor, así que meter el placeholder por composición partía en dos
sitios el mismo texto y convertía la hoja en contenedor. Y descartado un
**`placeholderColor`** en `Style`: es exactamente la cascada de propiedades por
componente que el set cerrado de estilo evita.

## Decisión 4: las flechas mueven el caret y, en el extremo, dejan navegar

Con el campo enfocado, ←/→ mueven el caret (shift extiende la selección) y ↑/↓
navegan siempre. **Cuando el caret ya está contra un extremo sin nada seleccionado,
la tecla se devuelve** a la navegación espacial: el jugador entra y sale del campo
con el mando sin modo de edición invisible y sin quedarse atrapado.

Es una diferencia deliberada con el `Slider` (ZAB-24), donde las flechas del eje
**nunca** navegan: un slider tiene un recorrido corto y saltar de valor es barato,
mientras que salir de un texto largo pulsando → treinta veces no lo es. Lo que
comparten es la regla de fondo: *el control se queda solo las teclas que puede usar*.

| Tecla | Qué hace |
|---|---|
| ←/→ | mueve el caret; en el extremo, navega |
| shift+←/→ | extiende la selección (y también la encoge: `anchor` no se mueve) |
| Home/End, Cmd/Ctrl+←/→ | caret al principio/final |
| Backspace/Delete | borra la selección, o un carácter a un lado |
| Enter | dispara `onSubmit` |
| Cmd/Ctrl+A | selecciona todo |
| Cmd/Ctrl+C/X/V/Z | los hace el navegador (ver decisión 5) |
| Espacio, Enter/A del mando | **no activan nada**: no hay nada que pulsar |

## Decisión 5: en web, un `<textarea>` oculto conduce el campo

Un canvas no recibe texto: recibe teclas. Composición IME, portapapeles y teclado
virtual pertenecen a un elemento editable real, así que el renderer mantiene **un
`<textarea>` fuera de pantalla** (no `display:none` — un elemento oculto así no toma
foco, y sin foco no hay composición ni teclado) que se enfoca mientras un TextInput
tiene el foco, y se **espeja en los dos sentidos**: nuestro buffer va hacia él, y lo
que el navegador haya hecho vuelve como *"este es el valor nuevo y aquí está el
caret"*. Es el mismo truco de Figma y Docs.

Lo que compra: **IME real**, pegar/copiar/cortar, autocorrección y el teclado de
móvil, sin escribir ninguno de ellos. Lo que cuesta: el valor entero se vuelve a
leer en cada `input`, así que `maxLength` y la regla de una línea se aplican **a la
entrada** — pasando el valor por el mismo `insert()` del modelo, como una sustitución
completa, para que la regla viva en un solo sitio y sea la misma que portará Unity
(que sí recibirá caracteres de uno en uno).

**Durante la composición IME el campo enseña lo que se está componiendo, pero el
juego no se entera**: media sílaba no es un valor. `compositionend` es lo que
escribe el binding y dispara `onChange`, una sola vez.

Este es el único trozo de la tarea que es del target y no del contrato: Unity tendrá
su propia respuesta (Input System + `TouchScreenKeyboard`), y el modelo de edición
que las dos comparten está en `textinput.ts`.

## Decisión 6: el caret y la selección los pinta el SDK con el color del contenido

Los dos salen del `style.color` del propio campo — el mismo *"color del contenido de
este nodo"* que ya colorea glifos y tiñe imágenes —, así que siguen un
`states.*.style.color` gratis y `Style` no gana nada. El parpadeo (periodo fijo,
reiniciado en cada edición para que el caret esté **sólido mientras se teclea**) es
comportamiento del SDK indexado por identidad, como el loop del `Spinner`. Poder
estilizarlos es una extensión compatible, exactamente como con el scrollbar del
`ScrollView` (ZAB-9).

El caret **desaparece mientras hay un rango seleccionado**: el resaltado ya dice
dónde va a caer la edición.

## Decisión 7: `maxLength` acota lo que se teclea, no lo que vale el dato

Un valor más largo que el tope, empujado por el juego con `SetData`, **se muestra
entero**. Recortar el dato del juego sería mentir sobre lo que contiene, y el binding
es de lectura/escritura precisamente para que las dos direcciones sean honestas.
`maxLength` es lo que el jugador puede escribir, y cuenta **el campo entero**: pegar
en un campo lleno mete el prefijo que quepa.

## Los índices se cuentan en code points

El modelo indexa `Array.from(text)`: un caret que puede caer entre las dos mitades de
un emoji es un caret que puede partirlo. Los clusters de grafemas (una bandera, una
familia, un acento combinante) son un paso más fino y quedan diferidos — piden una
tabla de segmentación, que es la misma razón por la que el shaping es v2.

## API de autoría (`@zabloo/react`)

`TextInput` **sí se exporta como primitivo**, a diferencia de `Toggle` y `Slider`:
es una hoja sin slots posicionales, así que no hay convención que el azúcar tenga
que esconder — solo defaults (`width` 220, `padding` 8 y una caja neutra para que se
vea sin tema).

```tsx
<TextInput
  id="player-name"
  value={{ bind: "profile.name" }}
  placeholder="Tu nombre"
  maxLength={16}
  onSubmit="name-accept"
  states={{ empty: { style: { color: "{color.muted}" } } }}
/>
```

Errores de autoría (fallan en el export, no en el juego): un `value` que no sea
string ni binding, un `maxLength` no positivo y cualquier hijo.

## Comportamiento en el SDK (`@zabloo/renderer-web`)

- **Focusable y hoverable por identidad**, sumándose a Button, Toggle, Slider y el
  header de Collapse (la regla de ZAB-36: hoverable = focusable).
- **Una sola vía de mutación** (`applyEdit`): escribe el buffer, escribe el path
  bindeado y dispara `onChange`. El caret y su parpadeo se reinician con ella.
- **El puntero se lo queda el campo antes que nadie**, como el Slider: el press
  coloca el caret (`indexAtX`, a la costura más cercana) y el drag selecciona, y
  ninguno de los dos puede convertirse en un scroll de la pantalla donde vive.
- **El scroll del contenido se sincroniza después del arrange**, donde las cajas ya
  son finales: lee rects y escribe solo lo suyo, así que no realimenta el layout.
- `setText(id, text)` es el canal juego→SDK, hermano de `setChecked`/`setValue`.
- La lógica pura (`insert`, `remove`, `moveCaret`, `moveToEdge`, `selectAll`,
  `caretX`, `indexAtX`, `scrollFor`, `caretVisible`, y los puentes UTF-16 ↔ code
  points) vive en `textinput.ts`, testeada sin canvas — y es la referencia literal
  para el SDK de Unity.

**Verificado en el preview real** (`zabloo dev`), porque la vista no tiene tests
unitarios: teclear escribe el binding y el `<Text bind>` de al lado lo sigue; el
placeholder se va al primer carácter; shift+flechas resalta y el caret desaparece;
un pegado de 38 caracteres se queda en 16 mientras un `setData` de 28 se ve entero;
el click pone el caret a mitad de palabra; el drag de derecha a izquierda deja una
selección hacia atrás; un valor más largo que la caja se desplaza y se recorta al
borde; y Enter deja `action: name-accept` en el log del preview.

## Degradación (SDK viejo recibe un campo por hot-update)

| Novedad | Qué hace un SDK viejo | Resultado |
|---|---|---|
| Tipo `TextInput` | fallback normativo: `Container` con sus children (no tiene) | se ve la caja vacía; no se escribe |
| `value` / `placeholder` / `maxLength` | props desconocidas, se ignoran | sin texto |
| `onChange` / `onSubmit` | props desconocidas, se ignoran | sin acciones |
| Estado `empty` | estado desconocido, nunca casa | el campo se pinta con su estilo base |

## Fuera de alcance

- **Paridad en Unity** (tarea propia, batch final de cross-target).
- **Teclado en pantalla para consola** → v1.x, como fijó el roadmap de F5.
- **Multilínea**, **selección por palabra** (doble click) y **deshacer propio**.
- **Máscara de contraseña**, **tipo de teclado** (numérico, email) y **validación**:
  el primero es paint por componente y los otros dos piden vocabulario nuevo; los
  tres son extensiones compatibles.
- **Estado `disabled`** real y **solo lectura**: entran cuando entren para todos.
- **`onBlur`/`onCommit`**: el par `onChange` + `onSubmit` cubre los dos momentos que
  un formulario pregunta; perder el foco no es una decisión del jugador.
