# Spec: `Toggle` — Checkbox/Switch/RadioGroup y bindings de ida y vuelta (2026-08-11, ZAB-23)

> Tarea Linear: [ZAB-23] — milestone **F5 — Formularios e input completo**, track C1.
> Alcance entregado: contrato de la IR, azúcar de autoría en `@zabloo/react`,
> comportamiento en `@zabloo/renderer-web`, ejemplo `examples/settings-demo` y esta
> spec. La paridad en el SDK de Unity queda pendiente (va por detrás: aún no conoce
> `ScrollView`, `Image` ni `clip`).

## Contexto y problema

F5 arranca con los controles de formulario más simples, pero el checkbox es el primer
componente que rompe una asimetría de la IR v1: **los datos solo fluían juego→UI**
(`SetData`) y las acciones volvían **sin payload**. Un ajuste que el jugador cambia
tiene que llegar al juego con su valor. La misma pregunta la van a heredar `Slider`
(ZAB-24), `Select` (ZAB-25) y `TextInput` (ZAB-26), así que se decide aquí para los
cuatro.

Segunda pregunta, la del enunciado de la tarea: **cómo se dibuja el check/knob** sin
capa de paint explícita (sigue diferida a post-v1).

## Decisión 1: `Toggle`, 8º primitivo

El checkbox, el switch y el radio son **un solo tipo**: se diferencian en estilo y en
el grupo donde viven, no en comportamiento. El SDK es dueño del estado `checked` en
runtime (indexado por tipo, como `pressed` de Button y `open` de Collapse) y lo
cambia con tap / Enter / A del gamepad.

Entra por la puerta legítima del vocabulario (*"primitivo nuevo solo cuando fuerza
una capacidad nueva"*): la capacidad es **estado booleano propio + valor de vuelta**.
Descartado `checkable` como prop de `Button`: rompería *"behavior lives in the SDK,
keyed by component type"* — el SDK despacharía comportamiento por tipo Y por prop, el
mismo argumento que hundió `overflow` en ZAB-5.

```ts
export interface ToggleNode extends NodeBase {
  type: "Toggle";
  /** Estado inicial, o binding de lectura/escritura. Default: false. */
  checked?: Bindable<boolean>;
  /** Valor de esta opción dentro de un grupo "exclusive-check" (radio). */
  value?: string | number;
  /** Acción con nombre disparada tras cada cambio. */
  onChange?: string;
  /** children[0] = slot checked; children[1] = slot unchecked; children[2..] = siempre. */
  children?: ZNode[];
}
```

## Decisión 2: los bindings pasan a ser de lectura/escritura

`checked: { bind: "settings.sfx" }` se lee **y se escribe**: al cambiar, el SDK
escribe el valor nuevo en su propio store de datos y avisa al juego con **un callback
único** (`onDataChanged(path, value)` en web; su equivalente C# cuando le toque a
Unity). `onChange: "sfx-changed"` sigue disponible como acción con nombre para quien
prefiera el modelo de eventos. Los dos mecanismos dinámicos de la IR v1 siguen siendo
dos — el de datos deja de ser de un solo sentido.

Descartado "acción con payload" como mecanismo único (obliga al juego a mantener su
propio estado y hacer `SetData` de vuelta para cada control: el binding ya expresa
esa relación) y "acción + API de lectura `GetChecked(id)`" (acopla el juego a los
`id` de la IR y escala mal a Slider/TextInput).

**Consecuencia para el hot-update:** el contenido nuevo llega ya bindeado a los
mismos paths, y ahora también *escribe* en ellos — la superficie de acoplamiento
juego↔UI sigue siendo `SetData` + acciones, sin API nueva por componente.

## Decisión 3: el indicador son dos slots, no un paint nuevo

Convención posicional en `children`, con la misma mecánica de `display:none`
(`InLayout`) que usa el contenido de `Collapse`:

| Índice | En layout cuando | Qué contiene |
|---|---|---|
| `children[0]` | `checked` | el indicador **entero** tal como se ve encendido |
| `children[1]` | `!checked` | el indicador **entero** tal como se ve apagado |
| `children[2..]` | siempre | la etiqueta |

Cada slot pinta el indicador completo, no solo la diferencia. Eso es lo que evita
tener que estilar descendientes por estado (**no hay cascada, nunca**) y hace que un
switch mueva el knob **con layout**: el slot encendido justifica el knob a `end` y el
apagado a `start`. Un checkbox muestra su marca en el slot encendido y una caja vacía
en el apagado.

Descartado "solo `states.checked`" (el knob de un switch no podría moverse: el toggle
degradaría a píldora que cambia de color) e "indicador pintado por el SDK con un
`kind`" (mete paint por componente ×3 motores y adelanta de facto la capa de paint
explícita).

`StateName` += **`"checked"`** para el nodo Toggle en sí (fila resaltada cuando está
encendido). Orden de merge: **base → checked → focused → pressed**.

## Decisión 4: `group: "exclusive-check"` para el RadioGroup

El RadioGroup es un composite aplanado, como el Accordion: `Container` en columna con
`group: "exclusive-check"` y el valor seleccionado en `value` (normalmente un
binding). Un `Toggle` descendiente está marcado mientras su `value` coincida con el
del grupo; al pulsarlo, escribe su `value` en el binding del grupo.

- **La selección es UN valor, no N booleanos.** Es la semántica real de un radio, le
  deja el terreno hecho a `Select` (ZAB-25) y evita que el juego reciba tres eventos
  para un cambio.
- Dentro del grupo, el `checked` de cada opción es **derivado**, nunca almacenado.
- **Pulsar la opción ya seleccionada no la desmarca**: un grupo exclusivo no se queda
  vacío. Un grupo sin valor no marca nada (y una opción sin `value` no coincide con
  "sin selección", por muy iguales que sean dos `undefined`).
- Comparación por valor tolerando el cruce string/número (un juego que empuja `2`
  selecciona la opción autorada como `"2"`): el contenido bindeado a datos vivos no
  puede depender de qué lado hizo el parseo.

> ⚠️ **Colisión de nombres con ZAB-22 (Tabs), resuelta aquí.** La decisión de Tabs
> registró `"exclusive-select"` con un contrato **posicional** (barra + paneles) y
> anticipaba que RadioGroup reusaría ese mismo valor. No encaja: el radio selecciona
> **por valor**, no por índice, y no tiene barra. Se usa un valor distinto y queda una
> familia coherente, `exclusive-<estado>`:
>
> | `group` | Estado que gobierna | Composite |
> |---|---|---|
> | `"exclusive-open"` | `open` de `Collapse` | Accordion |
> | `"exclusive-select"` | `selected` (índice) | Tabs |
> | `"exclusive-check"` | `checked` de `Toggle` | RadioGroup |
>
> **Fusión ya hecha** (main traía Tabs, Overlay y transiciones): las uniones
> `GroupBehavior` y `StateName` quedan unidas — `checked` y `selected` conviven (una
> casilla se marca, una pestaña se selecciona) y el orden de merge de estilo es
> **base → selected/checked → focused → pressed**, ya que ningún nodo lleva los dos.
> La activación por tap y por Enter/gamepad, que Tabs había unificado en una función,
> pasa a cubrir también el Toggle: una sola vía, no dos. Consolidación final en F8.

## API de autoría (`@zabloo/react`)

`Toggle` **no se exporta como componente**: sus slots son posicionales, así que el
azúcar es el único camino soportado y la convención vive en un solo sitio.

```tsx
<Checkbox checked={{ bind: "settings.subtitles" }} onChange="subtitles-changed">
  <Text>Subtítulos</Text>
</Checkbox>

<Switch checked={{ bind: "settings.sfx" }} checkedTrack={{ background: "{color.on}" }}>
  <Text>Efectos de sonido</Text>
</Switch>

<RadioGroup value={{ bind: "settings.quality" }}>
  <Radio value="low"><Text>Baja</Text></Radio>
  <Radio value="high"><Text>Alta</Text></Radio>
</RadioGroup>
```

- `size` (px) fija la geometría; el resto del aspecto entra por `box`/`checkedBox`/
  `mark` (Checkbox y Radio) o `track`/`checkedTrack`/`knob` (Switch), con defaults
  neutros para que el control se vea sin tema.
- Los **variants se indexan por primitivo**, así que el tema los define bajo
  `Toggle` — es donde vive `states.checked` de la fila.
- Bindear el `value` de un `<Radio>` es un error de autoría: la selección se bindea
  en el grupo.

## Comportamiento en el SDK (`@zabloo/renderer-web`)

- **Focusabilidad por identidad**: `Toggle` es focusable (se suma a Button y al
  header de Collapse). Enter/Espacio lo cambian, igual que el tap.
- **Una sola vía de mutación** (tap, teclado, `setChecked(id, checked)` del juego):
  aplica el estado, aplica el grupo, escribe en el path bindeado y dispara la acción.
  `setChecked` es exactamente "un tap dado por el juego", acción incluida.
- La lógica pura (`slotShown`, `isSelected`, `nextChecked`) vive en `toggle.ts`,
  testeada sin canvas — y es la referencia literal para el SDK de Unity.
- El preview de `zabloo dev` cierra el círculo: el panel de bindings muestra los
  valores que **escribe la UI**, además de empujar los del juego.

## Degradación (SDK viejo recibe estos controles por hot-update)

| Novedad | Qué hace un SDK viejo | Resultado |
|---|---|---|
| Tipo `Toggle` | fallback normativo: se renderiza como `Container` con sus children | se ven **los dos** slots y la etiqueta; nada desaparece, no es pulsable |
| `group: "exclusive-check"` | valor desconocido de `group`, se ignora | opciones independientes |
| `states.checked` | estado desconocido, se ignora | la fila encendida no se resalta |
| `checked` / `value` / `onChange` | props desconocidas, se ignoran | sin estado ni acción |

## Fuera de alcance

- **Paridad en Unity** (tarea propia; el C# es del tamaño de `WireCollapse`).
- **Estado `disabled`** real: el `StateName` existe desde v1, pero ningún SDK lo
  aplica todavía — entra cuando entre para todos los componentes.
- **Transición del knob**: es F7 (ZAB-33/34); hoy el movimiento es un relayout seco.
- **Marca de check vectorial** (el "tick" de verdad, con path): espera a la capa de
  paint explícita. Hoy la marca es un rect redondeado dentro de la caja.
