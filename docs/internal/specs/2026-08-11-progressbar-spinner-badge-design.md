# Spec: `ProgressBar`, `Spinner` y `Badge` — los componentes que estrenan F7 (2026-08-11, ZAB-35)

> Tarea Linear: [ZAB-35] — milestone **F7 — Transiciones (juice)**. Depende de ZAB-33 (el
> contrato `transition` en la IR) y de ZAB-45 (el motor de interpolación web). Alcance de
> ZAB-35: **dos primitivos nuevos** (`ProgressBar`, `Spinner`), **un composite**
> (`Badge`), su implementación en `@zabloo/format` + `@zabloo/react` + `@zabloo/renderer-web`
> y el ejemplo. Unity queda para después de ZAB-34 (su motor de interpolación sigue en
> Backlog); aplicar juice al catálogo existente es ZAB-36.

## Contexto y problema

F7 dejó dicho **cómo** se interpola (ZAB-33) y lo construyó en web (ZAB-45). Faltaba lo
que lo estrena: los tres componentes que el roadmap mete en esta fase. La pregunta real
de la tarea no es "qué props tienen" sino **cuáles de los tres piden superficie de IR
nueva y por qué** — porque la respuesta es distinta para cada uno, y sale de restricciones
que ya estaban decididas:

- **`Bindable` no alcanza al estilo.** Hoy solo `text`, `visible`, el `checked` del Toggle
  y el `value` del grupo son bindeables. Un `ProgressBar` es, por definición, un tamaño
  que depende de datos.
- **No hay fracciones en el layout.** El subset de Yoga v1 tiene `width`/`height` en px y
  `grow` como factor de reparto; nada expresa "el 40 % de mi padre".
- **No hay transform en v1** (2026-08-11 §2): no existe `rotate`, así que **un spinner no
  puede girar**. Lo que sí es expresable, y con paridad exacta entre targets, es modular
  `opacity`.
- **Un loop infinito es comportamiento indexado por identidad** (2026-08-11 §5), como el
  offset del scroll: esa identidad tiene que existir en la IR.

## Decisión (aprobada)

### 1. `ProgressBar` — primitivo nuevo: el nodo ES la pista y `children[0]` ES el relleno

```ts
export interface ProgressBarNode extends NodeBase {
  type: "ProgressBar";
  /** Progreso 0..1 (clampado). Estático o binding de lectura. Default: 0. */
  value?: Bindable<number>;
  /** `children[0]` = el fill; el resto queda reservado (sin uso en v1). */
  children?: ZNode[];
}
```

- **Slot posicional**, como el header del `Collapse` o los indicadores del `Toggle`: el
  paint sigue siendo implícito desde `style`, así que el relleno es un hijo compuesto y no
  un comando de dibujo nuevo. La pista es el propio nodo (`style` pinta la ranura,
  `layout` la dimensiona, `padding` mete el fill hacia dentro).
- **Geometría (normativa).** Sobre `layout.direction` (`"row"` por defecto), el SDK
  dimensiona el fill en `contentMain * value` y lo estira en todo el eje cruzado.
  `layout.justify` lo ancla: `"start"` (default) crece desde la izquierda/arriba, `"end"`
  desde el lado contrario (una barra que se vacía hacia atrás), `"center"` desde el
  medio. El `width`/`height`/`grow` **propios del fill** se ignoran en el eje principal:
  ese número es del SDK.
- **Valor.** 0..1 clampado; lo que no sea número finito (dato ausente, string, NaN) lee
  como **0** — una barra vacía, nunca llena, nunca un crash. `@zabloo/format` exporta
  `clampProgress` como implementación de referencia para que la respuesta sea la misma en
  los tres motores.
- **Movimiento: el `transition` del nodo tweenea el VALOR, no el rect.** El SDK interpola
  la fracción y **después** corre su pasada de layout con ella. Es exactamente la regla de
  ZAB-33 §4 (interpolar inputs declarados, no rects calculados) aplicada a un input que
  calcula el propio componente: una sola pasada de layout por frame, sin bucle
  medida→animación→re-medida, e idéntico en ambos targets. El `transition` del **fill** no
  ve nada, porque su tamaño principal no es uno de sus inputs declarados.
- **`children[1..]` reservados.** v1 no coloca nada más dentro de la pista: una etiqueta
  *encima* de la barra pide posicionamiento superpuesto, que no existe. El renderer los
  saca de layout (y por tanto de paint y de input) en vez de apilarlos detrás del fill.

**Por qué primitivo y no azúcar:** la fracción es justo la capacidad que falta. Las
alternativas eran hacer bindeables las dims de `Layout` (una capacidad de IR grande que
ZAB-33 dejó para "el día que el estilo sea bindeable", y que sin porcentajes obligaría al
juego a mandar píxeles) o inventar un `fill?: Style` como segundo Style por nodo (rompe
"el paint es implícito desde style" y no reutiliza nada).

### 2. `Spinner` — primitivo nuevo: una onda de opacidad que viaja

```ts
export interface SpinnerNode extends NodeBase {
  type: "Spinner";
  /** Ciclo completo en ms. `Dim` → tematizable. Default: 900. <=0 congela la onda. */
  period?: Dim;
  /** Suelo de la onda: el multiplicador de opacidad en su punto más bajo. Default: 0.25. */
  min?: number;
  /** Curva de la rampa de ida y vuelta. Default: "ease-in-out". */
  easing?: Easing;
  /** Las cuentas, en orden de onda — hijos normales en todo lo demás. */
  children?: ZNode[];
}
```

- **No gira: late.** Sin transform no hay arco rotando; con `opacity` sí hay un indicador
  de carga reconocible y portable al último decimal. Los tres puntos que respiran son la
  forma canónica, pero el primitivo es genérico: sus hijos son los que sean (barras de
  distinta altura, iconos) y se colocan con el `direction`/`gap`/`align` de siempre.
- **Onda (normativa).** Con `n` hijos, el hijo `i` lleva la fase
  `frac(elapsed / period - i / n)` y el SDK **multiplica** su `opacity` resuelta por
  `min + (1 - min) * spinnerPulse(fase, easing)`. Multiplicativo como toda opacidad del
  sistema (2026-08-06): un punto autorado a `opacity: 0.5` sigue latiendo, más tenue.
- **`spinnerPulse(phase, easing)` en `@zabloo/format`**, junto a `easeProgress` y por la
  misma razón: rampa simétrica (sube en la primera mitad del ciclo, baja en la segunda)
  construida sobre los mismos polinomios, así la paridad es aritmética y no depende de
  que dos implementaciones de un seno coincidan. `f(0) = 0`, `f(0.5) = 1`, y las fases
  fuera de 0..1 envuelven (la de una cuenta llega negativa).
- **`period` es `Dim`**: el loop se tematiza como el resto del movimiento, y un tema
  "reduce motion" que pone `motion.*` a 0 lo **congela en su primer frame** en lugar de
  hacer desaparecer el spinner.
- **Identidad y reentrada.** El reloj del loop vive en el nodo, como el offset del scroll.
  Salir de layout lo borra: al volver, la onda arranca desde el suelo en vez de saltar a
  mitad de ciclo — la misma regla que hace que un montaje no anime.

### 3. `Badge` — azúcar de authoring, cero IR

`<Badge count={{ bind: "inbox.unread" }}>` emite un `Container` píldora con un `<Text>`
bindeado dentro. No necesita nada nuevo: `Text` es bindeable desde v1. Es un composite
aplanado como `<Accordion>` o `<RadioGroup>`.

Dos límites que se documentan en vez de forzarse:

- **No se oculta solo en cero.** Eso es una expresión, y en la IR no hay expresiones
  (regla de siempre: nada de lógica en el JSON). Quien quiera esconderlo bindea `visible`
  a un flag que el juego calcula.
- **No se ancla a la esquina de un icono.** Pide posicionamiento superpuesto, que v1 no
  tiene; el badge va en flujo, al lado de su etiqueta.

El juice del badge es el `transition` de su propio nodo (fondo, padding, radius): el
**texto salta siempre**, porque `text` no es animable y `fontSize` es la clave del atlas.

### 4. La maquinaria compartida: `stepValue`

El motor de ZAB-45 tenía las tracks indexadas por prop animable. ZAB-35 generaliza la
clave a `AnimatableProp | BehaviorKey` y expone `stepValue(anim, key, target, transition,
now)` para un escalar cuyos extremos calcula el comportamiento (hoy `"progress"`). El
componente decide **qué** se mueve; `transition.ts` sigue decidiendo **cómo**: una sola
regla de interrupción, un solo reloj, un solo set de curvas, y el mismo comportamiento
frente a `duration <= 0` (instantáneo) o a un montaje (salta). Es la regla §5 de ZAB-33
convertida en código en vez de en un segundo motor paralelo.

## Forward-tolerance

Cambio **aditivo dentro de v1 — sin bump de versión**: dos tipos de nodo nuevos, y la
regla normativa de tipos desconocidos (2026-08-11) ya dice qué hace un SDK viejo.

| Contenido nuevo | SDK viejo renderiza | Efecto |
|---|---|---|
| `ProgressBar` | Container con `layout`/`style`/`children` | la pista, con un fill sin dimensionar: se pierde la fracción, nunca el layout de alrededor |
| `Spinner` | Container con sus hijos | las cuentas se ven, quietas |
| `period`/`min`/`easing` desconocidos | props ignoradas | igual que cualquier prop nueva |
| `Badge` | — | ya era Container + Text: invisible al cambio |

El caso inverso (SDK nuevo, contenido viejo) es trivial: sin estos nodos en el JSON, nada
cambia.

## Cambios en el código

`packages/format/src/index.ts`: `ProgressBarNode` y `SpinnerNode` (con las reglas de arriba
en los docstrings), ambos al union `ZNode`, `spinnerPulse` y `clampProgress` como
implementaciones de referencia normativas, y el docstring de `Transition` ampliado con la
frontera comportamiento/set animable. `parseEnvelope` **no cambia** (la tolerancia a lo
desconocido ES la spec).

`packages/renderer-web/src/`: `progress.ts` y `spinner.ts` nuevos (geometría del fill y
matemática de la onda, puros y testeables sin canvas, como `scroll.ts`); `transition.ts`
generaliza las tracks y expone `stepValue`; `layout.ts` gana `progress`/`loopStartedAt` en
`LayoutNode` y especializa el arrange del fill (como ya especializaba el `ScrollView`);
`view.ts` resuelve la fracción (lee el binding, clampa, tweenea) antes de los hijos y
aplica la onda después de ellos, manteniendo vivo el frame loop mientras el ciclo corre.

`packages/react/src/`: dos `HostType` nuevos con sus validaciones de authoring
(`<ProgressBar>` exige exactamente un hijo, `<Spinner>` al menos uno), y los tres
componentes públicos — `<ProgressBar value fill size>` (construye el fill y clipa por
defecto, para que el relleno respete las esquinas de la pista), `<Spinner dots size dot
period min easing>` (construye las cuentas o acepta las tuyas) y `<Badge count label>`.

`examples/hello-button`: barra de vida bindeada con transición, spinner con `motion.loop`
y badge en la cabecera de Social. Verificado en el preview: la barra desliza al recibir
`SetData` (y re-apunta a mitad de recorrido), la onda avanza y el contador sigue al dato.

## Registro

- Entry en `decisions-architecture.md` (2026-08-11, ProgressBar/Spinner/Badge).
- README público: catálogo actualizado + línea de motion.

## Fuera de alcance (siguientes tareas)

Unity (bloqueado por ZAB-34); juice del catálogo existente (ZAB-36). Diferidos de diseño:
barra **indeterminada** (el mismo loop conduciendo un fill que barre; aditivo cuando
aparezca el caso), etiqueta **encima** de la barra y badge anclado a una esquina (ambos
piden posicionamiento superpuesto), ocultar el badge en cero (pide expresiones), spinner
**giratorio** (entra con la capa de paint explícita y su transform), y `properties`/
duración por propiedad en `transition` (ya diferidos en ZAB-33).
