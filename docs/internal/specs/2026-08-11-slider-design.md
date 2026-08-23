# Spec: `Slider` — valor continuo, drag y flechas (2026-08-11, ZAB-24)

> Tarea Linear: [ZAB-24] — milestone **F5 — Formularios e input completo**, track C3.
> Alcance entregado: contrato de la IR, azúcar de autoría en `@zabloo/react`,
> comportamiento en `@zabloo/renderer-web`, ejemplo en `examples/settings-demo` y
> esta spec. La paridad en el SDK de Unity queda pendiente (va por detrás: aún no
> conoce `ScrollView`, `Image`, `clip`, `Overlay` ni `Toggle`).

## Contexto y problema

ZAB-23 cerró la asimetría de los datos: los bindings de los controles con valor son
de lectura/escritura y el SDK avisa al juego con un callback único. El `Toggle`
gastó ese mecanismo con un booleano; el `Slider` es el primero que lo usa con un
**número continuo**, y con él llegan tres preguntas que ningún componente anterior
tenía:

1. **Su geometría no sale del layout.** El thumb está donde diga el valor, no donde
   lo ponga el flex. Es la primera vez que una posición depende de un estado
   numérico del SDK.
2. **Cuándo se entera el juego.** Un volumen quiere oírse mientras se arrastra; una
   resolución de pantalla no quiere aplicarse sesenta veces por segundo.
3. **Las flechas ya están cogidas.** Desde 2026-08-04 las flechas mueven el focus
   espacial. Un slider enfocado las necesita para ajustar.

## Decisión 1: `Slider`, 9º primitivo

Entra por la puerta legítima del vocabulario (*"primitivo nuevo solo cuando fuerza
una capacidad nueva"*): la capacidad es **un número que el jugador fija apuntando,
cuya geometría es función de ese número**. Ningún primitivo podía expresarla — el
layout resuelve tamaños desde props declaradas, no desde estado de runtime.

```ts
export interface SliderNode extends NodeBase {
  type: "Slider";
  /** Valor actual, o binding de lectura/escritura. Default: `min`. */
  value?: Bindable<number>;
  min?: number;   // default 0
  max?: number;   // default 1
  /** Cuantización desde `min`. Ausente (o <= 0) = continuo. */
  step?: number;
  axis?: "horizontal" | "vertical";  // default "horizontal"
  /** Acción en cada cambio (el hook en vivo). */
  onChange?: string;
  /** Acción al terminar el gesto (el valor en el que se quedó). */
  onCommit?: string;
  /** children[0] = fill; children[1] = thumb. */
  children?: ZNode[];
}
```

Descartado `Toggle` con rango (un control de dos estados y uno continuo no
comparten ni estado ni input) y `Container` + prop `value` (el SDK despacharía
comportamiento por tipo **y** por prop: el mismo argumento que hundió `overflow` en
ZAB-5 y `checkable` en ZAB-23).

## Decisión 2: el nodo ES el track, y sus dos slots los coloca el valor

El paint sigue 100% implícito (la capa explícita sigue diferida), así que el carril
lo pinta el `style` del propio nodo — sin comando de dibujo nuevo y sin un tercer
hijo. Los dos hijos son posicionales, como el header de `Collapse` o el indicador
de `Toggle`, pero aquí el SDK no los mete/saca del layout: **los arregla desde el
valor**.

| Índice | Qué es | Dónde lo pone el SDK |
|---|---|---|
| `children[0]` | el fill | del inicio del carril hasta la fracción del valor |
| `children[1]` | el thumb | su propio tamaño, centrado en la posición del valor |

Reglas de la geometría (implementadas en `slider.ts`, referencia literal para
Unity):

- **El recorrido del thumb está metido hacia dentro medio thumb** (`travel =
  largo - thumb`). Así el thumb nunca se sale del rect del nodo por el eje del
  carril, y —más importante— **el punto bajo el dedo es el centro del thumb
  durante todo el drag**, sin deriva en los extremos.
- **El fill sí ocupa la fracción del largo completo**, así que en `max` llega al
  final del carril. Los dos criterios se cruzan medio thumb en los extremos; es lo
  que hace todo el mundo y es lo que se ve bien.
- **A lo ancho, cada slot conserva su tamaño y se centra**: el caso normal es un
  thumb gordo sobre un carril fino, así que el thumb **desborda a su padre por el
  eje cruzado**. Es ordinario desde ZAB-7 (el `clip` es el único corte de paint y
  de input); la invariante de 2026-08-06 es que un nodo no pinta fuera de **su
  propio** rect, no que un hijo no pueda salirse del padre.
- **El Slider se mide como hoja**: los slots nunca suman a su tamaño (un thumb de
  18px no puede definir un carril de 200px). El largo y el grosor son sus propias
  props de layout. `padding` mete el carril hacia dentro, como en todas partes.
- **Vertical de abajo arriba**, como un fader físico: `min` abajo.

Descartado **tres slots** (track/fill/thumb) — un nodo más y un contrato más largo
para una capacidad que el paint implícito ya da — y **que el SDK dibuje el
indicador** como hace con el scrollbar: mete paint por componente ×3 motores y
adelanta de facto la capa de paint explícita (es justo lo que se descartó en
ZAB-23).

## Decisión 3: dos hooks, `onChange` continuo y `onCommit` al soltar

El binding se escribe **siempre en continuo**: es el mecanismo de datos, es barato
y es lo que hace que un `Text` bindeado al mismo path siga al dedo. Encima de eso,
las acciones con nombre se parten en dos porque son dos preguntas distintas:

| Hook | Cuándo | Para qué |
|---|---|---|
| `onChange` | en cada cambio, lo cause quien lo cause | preview en vivo (el volumen suena mientras se arrastra) |
| `onCommit` | al terminar el gesto (soltar el puntero o la flecha) | aplicar lo caro (calidad gráfica, resolución) |

`onCommit` **solo salta si el valor cambió durante el gesto**: es "el valor en el
que se quedó el jugador", no "hubo un gesto". Un tap en el track que cae en el
mismo valor no dispara nada.

Descartado **solo continuo** (obliga a cada juego a escribir su propio debounce
para el 50% de los casos) y **solo al soltar** (deja sin canal el preview en vivo, y
sería asimétrico con el `onChange` de `Toggle`).

## Decisión 4: las flechas del eje ajustan, las cruzadas navegan

Con el slider enfocado, ←/→ en uno horizontal (↑/↓ en uno vertical) mueven el valor
y **no** mueven el focus; las del otro eje siguen navegando. El jugador nunca queda
atrapado en el control y no hace falta un modo de edición invisible.

- Sin `step`, la flecha mueve **el 5% del rango** — el teclado tiene que ser usable
  sin obligar a declarar una cuantización que el autor no quería.
- En vertical, arriba es más: el valor crece hacia donde crece el carril.
- Enter/Espacio (y la A del gamepad) **no hacen nada** sobre un slider: no hay nada
  que activar. Es explícito en el código porque, sin ese corte, el nodo caía en la
  rama del header de `Collapse`.
- `max` **siempre es un stop válido**, aunque el rango no sea un número entero de
  pasos (0..1 de 0.3 en 0.3 se queda en 0.9): el jugador ve el final del carril, y
  dejarlo inalcanzable se lee como un control roto. El precio es un último escalón
  corto.
- Los valores cuantizados se limpian del ruido binario (`0.1 * 3` es
  `0.30000000000000004`): el número viaja al juego y puede mostrarse como texto.

Descartado **que las cuatro flechas ajusten** (rompe la navegación espacial en una
pantalla de ajustes con gamepad, justo el criterio de salida de F5) y **el modo
edición con Enter** (patrón de consola clásico, pero es un estado modal que el
jugador no ve).

## API de autoría (`@zabloo/react`)

`Slider` **no se exporta como primitivo**: sus slots son posicionales, así que el
azúcar es el único camino soportado y la convención vive en un solo sitio (igual
que `Toggle`).

```tsx
<Slider
  value={{ bind: "settings.volume" }}
  onChange="volume-preview"
  onCommit="volume-apply"
  fill={{ background: "{color.on}" }}
/>

<Slider min={0} max={100} step={10} axis="vertical" length={120} />
```

- `length` (200), `thickness` (6) y `thumbSize` (18) fijan la geometría; el aspecto
  entra por `style` (el carril), `fill` y `thumb`, con defaults neutros para que el
  control se vea sin tema.
- El azúcar emite los dos slots y no acepta hijos: la etiqueta se compone al lado,
  en una `<Row>`.
- `max <= min` es un error de autoría (falla en el export, no en el juego).

## Comportamiento en el SDK (`@zabloo/renderer-web`)

- **Focusable por identidad**: `Slider` se suma a Button, Toggle y el header de
  Collapse.
- **Una sola vía de mutación** (`setSliderValue`): clampa y cuantiza, escribe en el
  path bindeado y dispara `onChange`. El commit es aparte, porque pertenece al
  final del gesto y no al cambio.
- **El puntero se lo queda el slider antes que nadie**: el gesto empieza en el
  press (el thumb salta al dedo) y el control vive dentro de pantallas
  scrolleables, donde arrastrar tiene que mover el valor y no la lista. Sin umbral
  de drag: no hay ambigüedad tap/drag que resolver, el press ya fijó un valor.
- `setValue(id, value)` es el canal juego→SDK, hermano de `setChecked`/`setScroll`:
  exactamente "un gesto dado por el juego", commit incluido.
- La lógica pura (`resolveRange`, `quantize`, `fractionOf`, `valueAt`, `stepBy`,
  `sliderGeometry`) vive en `slider.ts`, testeada sin canvas — y es la referencia
  literal para el SDK de Unity.

## Degradación (SDK viejo recibe un slider por hot-update)

| Novedad | Qué hace un SDK viejo | Resultado |
|---|---|---|
| Tipo `Slider` | fallback normativo: `Container` con sus children | se ve el carril con el fill y el thumb apilados por flex; no se arrastra |
| `value` / `min` / `max` / `step` / `axis` | props desconocidas, se ignoran | sin valor ni rango |
| `onChange` / `onCommit` | props desconocidas, se ignoran | sin acciones |

## Fuera de alcance

- **Paridad en Unity** (tarea propia, batch final de cross-target).
- **Estado `disabled`** real: entra cuando entre para todos los componentes.
- **Transición del thumb**: `transition` no anima el valor a propósito (es estado
  que el jugador está arrastrando, no una magnitud visual que deba ir con retraso).
  Animar un salto del juego (`setValue`) es una extensión compatible, no v1.
- **Rango doble** (dos thumbs) y **marcas de escala**: los pide el catálogo, no la
  capacidad; esperan a la capa de paint explícita.
- **Auto-scroll hasta el focusable** cuando el slider queda fuera de la región
  visible: sigue siendo trabajo de F5 (spec de ZAB-5), no de esta tarea.
