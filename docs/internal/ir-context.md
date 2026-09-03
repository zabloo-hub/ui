# IR-CONTEXT.md — Designing the Intermediate Representation

> Companion to `project.md`. Purpose: give Claude Code the framing and constraints
> to **define the IR with me** — this is NOT a finished schema. The schema is the thing
> we're going to work out together. Treat the strawman at the bottom as a discussion
> starting point, not a decision.
>
> **Status 2026-08-01: IR v1 minimal scope LOCKED** — see `decisions-architecture.md`
> (2026-08-01, "IR v1: minimal scope"). Per-section "✅ Decided" notes below reflect it.
> Next step is validating v1 with a vertical slice (Button end-to-end in Unity), not more
> paper design. Still open: variants, focus/navigation, composites, text strategy.
>
> **Status 2026-08-02: text spike PASSED** — self-rendered glyphs (own atlas + own
> metrics + quads via `generateVisualContent`) work in Unity; the #1 self-renderer risk
> is retired. See `decisions-architecture.md` (2026-08-02). Text *strategy* narrowed but
> still open (core-owned rasterizer vs per-engine behind an interface).
>
> **Status 2026-08-03: vertical slice PASSED** — Button end-to-end: JSX → reconciler →
> `zabloo export` envelope → Unity SDK (loader + own flexbox pass + tessellation +
> pressed state + C# event). IR v1 is validated in code, not on paper. See
> `decisions-architecture.md` (2026-08-03).
>
> **Status 2026-08-03 (later): Collapse PASSED** — 4th primitive (`<details>`/
> `<summary>` model), runtime relayout on state change proven; toggle split decided
> (SDK tap default + `SetOpen` game API). Vocabulary is now `Container`, `Text`,
> `Button`, `Collapse`.
>
> **Status 2026-08-03 (later): composites DECIDED (§5) via Accordion** — composites
> flatten to primitives at authoring time; cross-child behavior is a declarative
> `group` field on Container (`"exclusive-open"`), enforced generically by the SDK.
> Vocabulary stays at 4.
>
> **Status 2026-08-03 (later): bindings IMPLEMENTED (§7 mechanisms complete)** —
> `SetData(path, value)` drives bound Text (reactive relayout) and bound `visible`.
> Both v1 dynamic mechanisms (named actions + data-path bindings) are now validated
> in code. The vertical-slice phase is COMPLETE.
>
> **Status 2026-08-04: THE AGENDA IS CLOSED (9/9).** Variants (§6) = authoring-time
> only, never in the IR. Focus/navigation (§7) = automatic spatial from live layout
> rects (`autofocus` + `states.focused`; hit-testing = layout rects). Both validated
> in Unity AND the web renderer. Only text rasterizer ownership remains open — an
> implementation strategy, not an IR question. See `decisions-architecture.md`
> (2026-08-04).
>
> **Status 2026-08-06: style set v1 CLOSED** — `borderWidth`/`borderColor` (INSET
> stroke, paint-only) and `opacity` (multiplicative subtree inheritance, per-vertex
> alpha) implemented in both targets. The full v1 set: `background`, `radius`,
> `borderWidth`, `borderColor`, `color`, `fontSize`, `opacity`. See
> `decisions-architecture.md` (2026-08-06).
>
> **Status 2026-08-11: text rasterizer ownership DECIDED (the last open item)** —
> **core-owned rasterization**: one algorithm (stb_truetype) in each target's
> first-class form (StbTrueTypeSharp in C#, WASM on web, `stb_truetype.h` in C++),
> behind the existing `GlyphAtlas`/`FontLibrary` interface. Same metrics + same
> bitmaps everywhere; does NOT pull the shared-C++-core extraction forward. See
> `decisions-architecture.md` (2026-08-11).
>
> **Status 2026-08-11: scroll y clipping DECIDIDOS (ZAB-5, F1)** — `clip` en
> NodeBase (paint-only, recorta paint + hit-testing) + **`ScrollView` como 5º
> primitivo** (axis/scrollbar; hijos medidos sin restricción en el eje
> scrolleable; offset = estado del SDK). Regla normativa nueva de
> forward-tolerance: tipo desconocido → se renderiza como Container preservando
> children. Ver `decisions-architecture.md` (2026-08-11, scroll).
> **Componente CERRADO (ZAB-9)**: sin estados (`states.*` no aplica: no focusable,
> sin hover/pressed, el offset no es estado de estilo) y sin eventos (no hay
> `onScroll` ni offset bindeable; el juego usa `SetScroll`, API de host, no IR).
> Spec: `specs/2026-08-11-scrollview-design.md`.
>
> **Status 2026-08-11: `Toggle` + bindings BIDIRECCIONALES (ZAB-23, F5)** — checkbox/
> switch/radio son **un primitivo `Toggle`** (estado `checked` del SDK; indicador =
> dos slots posicionales en `children`, sin paint nuevo) y **los bindings de los
> controles con valor pasan a ser de lectura/escritura**: el SDK escribe el valor y
> avisa al juego con un callback único. Cierra la asimetría "los datos solo bajan" de
> §7 para todo F5. RadioGroup = `group: "exclusive-check"` (la selección es UN valor).
> Ver `decisions-architecture.md` (2026-08-11, Toggle).
>
> **Status 2026-08-11: `Slider` DECIDIDO y renderizando en web (ZAB-24, F5)** —
> **9º primitivo**: la capacidad nueva es *un número que el jugador fija apuntando,
> cuya geometría es función de ese número*. El **nodo es el track** (paint implícito
> de su propio `style`) y sus **dos slots posicionales los arregla el SDK desde el
> valor** — `children[0]` fill, `children[1]` thumb —, así que el aspecto sigue
> siendo composición y no hace falta capa de paint. Las acciones se parten en
> **`onChange` continuo + `onCommit` al soltar** (el binding se escribe siempre en
> continuo) y **las flechas del eje ajustan mientras las cruzadas siguen navegando**,
> que es lo que salva el criterio de salida de F5 con gamepad. Ver
> `decisions-architecture.md` (2026-08-11, Slider).
>
> **Status 2026-08-11: overlays y z-order DECIDIDOS (ZAB-19, F4)** — `Overlay`
> como tipo de nodo, **declarado in-place** pero fuera del flujo del padre; el
> SDK lo eleva a **una capa única** sobre la vista ordenada por `(z, orden de
> documento)`. `modal` (default true) captura el input hacia abajo y **de él
> deriva el focus-trap**; el backdrop es el `background` del propio nodo (sin
> campo nuevo — paint implícito intacto) y `justify`/`align` posicionan el
> contenido (sin semántica nueva de layout). `visible` sigue siendo el único
> mecanismo de apertura/cierre. Ver `decisions-architecture.md` (2026-08-11,
> overlays). **Ampliado 2026-08-11 (ZAB-44, implementación web):** `autoCloseMs`
> (number, no `Dim`) entra ya en `OverlayNode` — el Toast pide su propio cierre — y
> el dismiss (Escape / backdrop / timer) lo **ejecuta** el SDK escribiendo `false`
> en el `visible` bindeado, además de disparar `onDismiss`. **Ampliado 2026-08-11
> (ZAB-21, componentes):** `Modal`/`Toast`/`Tooltip` como azúcar de `@zabloo/react`
> sobre un `Overlay` expuesto crudo (no tiene slots posicionales que esconder), con
> `position` = nueve anclas que bajan a `justify`/`align`. Un `transition` en el
> Overlay **funde su entrada y su salida** interpolando su **presencia** en la capa
> (no `visible`, que sigue sin ser animable): sin campo nuevo en la IR, y lo que sale
> es solo píxeles — input, focus-trap y timers leen la capa viva, que ya abandonó.
> **Cerrado 2026-08-11 (ZAB-46):** el **anclaje** y el **disparo por hover/focus** entran
> como UN campo, `anchor { id, at?, offset?, trigger? }`, porque son una misma relación.
> `at` son las mismas nueve anclas leídas como lado + alineación alrededor del rect del
> ancla, con **flip** si no cabe y **clamp** después (única colocación de v1 relativa a
> un rect ajeno; el rect del overlay sigue siendo el de la vista, así que un popover
> modal conserva backdrop y captura). `trigger: "hover"` es **hover O focus** —el
> equivalente de mando es el foco, así que la pista llega al gamepad sin mecanismo
> nuevo—, `visible` sigue siendo la puerta de la capa y el overlay disparado así es
> inerte al input. Si el ancla sale de layout o queda recortada, el overlay se va con
> ella; un `id` que no resuelve degrada a colocación de capa (lo que también ve un SDK
> antiguo, que ignora el campo). Ver `specs/2026-08-11-tooltip-anchor-design.md`.
>
> **Status 2026-08-11: transiciones DECIDIDAS (ZAB-33, F7)** — prop
> `transition?: { duration: Dim; easing?: Easing }` en `NodeBase` (no en `Style`:
> `Style` es el "qué", `transition` el "cómo"; `duration` tokenizable ⇒ movimiento
> tematizable). Se animan colores, `opacity`/`radius`/`borderWidth` y las
> **dimensiones de layout** (`width`/`height`/`gap`/`padding`), interpolando los
> **inputs declarados** antes de la pasada de layout — nunca los rects calculados.
> Disparo sin lista de triggers: *cambia un valor resuelto ⇒ transiciona*. Curvas =
> cuatro polinomios cerrados (paridad aritmética entre targets, sin solver de
> bézier), con `easeProgress` en `@zabloo/format` como referencia normativa. Las
> animaciones de entrada/salida siguen fuera del contrato: las cubre el
> comportamiento del componente conduciendo la misma maquinaria — hecho ya para el
> `Overlay` (2026-08-11, ZAB-21: se interpola su presencia en la capa), pendiente para
> el `Collapse`. Keyframes y
> timelines siguen en v2. Ver `decisions-architecture.md` (2026-08-11,
> transiciones).
>
> **Status 2026-08-11: `ProgressBar` + `Spinner` DECIDIDOS y renderizando en web
> (ZAB-35, F7)** — los dos componentes que estrenan las transiciones necesitan
> **identidad en la IR**, cada uno por un motivo distinto y ninguno por estética.
> `ProgressBar`: el nodo **es la pista** y `children[0]` **es el fill**, que el SDK
> dimensiona en `contentMain × value` (nada en v1 expresa "una fracción de mi padre",
> y el estilo aún no es bindeable); su `transition` tweenea **el valor**, no el rect,
> así que la regla "interpolar inputs declarados" vale igual cuando el input lo
> calcula el componente. `Spinner`: un loop infinito es comportamiento indexado por
> identidad, y como **no hay transform en v1 no gira** — sus hijos laten en una onda
> de `opacity` (`period` tokenizable ⇒ un tema "reduce motion" la congela), con
> `spinnerPulse` en `@zabloo/format` como referencia normativa junto a `easeProgress`.
> `Badge` se queda en azúcar (Container + `Text` bindeado): no pide IR nueva, y
> ocultarlo en cero pediría expresiones. Ver `decisions-architecture.md` (2026-08-11,
> ProgressBar/Spinner/Badge).
>
> **Status 2026-08-11: `Image` DECIDIDO y renderizando en web (ZAB-13, F2)** —
> **primitivo propio** (hoja con tamaño intrínseco, como `Text`; la referencia de
> contenido no es estilo, y la forward-tolerance ya lo degrada a `Container`).
> Una prop nueva: `fit` (`contain` default / `cover` / `stretch`), y `cover`
> **recorta por UVs**, así que sigue valiendo *nada pinta fuera del rect de
> layout*. Tinte = `style.color` (el mismo "color del contenido" de los glifos),
> esquinas = `style.radius` recortando la textura, placeholder = el `background`
> del propio nodo: **sin estado `loading`** y con el set de `Style` intacto. Ver
> `decisions-architecture.md` (2026-08-11, Image).
>
> **Status 2026-08-11: array bindings DECIDIDOS (ZAB-29, F6)** — `Repeat` como **9º
> primitivo**: el primer nodo cuyos hijos salen de los **datos** y no del documento
> (`items` bindea un array, `children[0]` es el template, `children[1..]` el estado
> vacío). El ámbito de item se **declara** (`as`, default `"item"`) para que una
> lista anidada alcance el elemento de fuera. Con él, dos cambios de fondo: los
> **data paths dejan de ser claves opacas** y pasan a ser direcciones dentro de los
> datos (segmento numérico = índice de array), en lectura y en escritura; y las
> **acciones dejan de volver vacías** — llevan `ActionContext {path, key, index}`
> cuando nacen dentro de un item, el mismo movimiento que ZAB-23 hizo con los datos.
> Identidad = `key` (path relativo al item), con espacio disjunto del posicional:
> es lo que hace estables los updates por `SetData` y posible la virtualización.
> Ver `decisions-architecture.md` (2026-08-11, array bindings) y
> `specs/2026-08-11-array-bindings-design.md`.
>
> **Status 2026-08-11: `<List>`/`<Grid>` DECIDIDOS (ZAB-32, F6)** — la capa de autoría
> de listas **no estrena tipo de IR**: las dos son azúcar de `@zabloo/react` que emite
> un `Repeat` (que ya era el contenedor flex de sus instancias), y el primitivo no se
> exporta, como `Toggle` y `Slider`. Lo único que sí entra en la IR es **`wrap` en el
> subset de layout** (§2), el hueco que ZAB-29 dejó apuntado: una rejilla es una fila
> que envuelve. El template se escribe con children planos **o** con una render-prop
> que construye los paths del alias (`{(cat) => <Text bind={cat("name")} />}`), y
> `columns` **no viaja a la IR** — sin dims fraccionarias, la geometría se resuelve en
> authoring como ancho de celda + ancho de línea. Ver `decisions-architecture.md`
> (2026-08-11, List/Grid) y `specs/2026-08-11-list-grid-design.md`.
>
> **Status 2026-08-11: juice del catálogo aplicado, con `hover` implementado (ZAB-36, F7)** —
> **cero superficie nueva de IR**: Collapse (anima su propia altura), Toggle (sus dos slots
> comparten caja y hacen crossfade), Slider (planea el valor que empuja el juego, salta el
> del dedo) y Tabs son comportamientos del SDK conduciendo el motor con extremos propios,
> que es exactamente lo que ZAB-33 §5 dejó autorizado. Lo que sí queda fijado como spec del
> **estado**: `hover` (declarado en `StateName` desde v1) se implementa en web con la regla
> de identidad del foco, y el **orden de merge es normativo** —
> `base → selected → checked → hover → focused → pressed`—. Además, un `borderColor` no
> declarado **sostiene el último** en vez de caer al color de error, que es lo que hace
> honesta la salida de un anillo de foco. Ver `decisions-architecture.md` (2026-08-11,
> juice del catálogo) y `specs/2026-08-11-catalog-transitions-design.md`.
>
> **Status 2026-08-11: `TextInput` DECIDIDO y renderizando en web (ZAB-26, F5)** —
> **13º primitivo**, y el primero con **interior**: la capacidad nueva es el **caret**
> (un punto de inserción y una selección dentro de un contenido que el jugador está
> escribiendo), mientras que todos los controles anteriores producían su valor
> *apuntando a geometría*. Hoja con contenido, como `Text`/`Image`; **una línea en v1**,
> con scroll horizontal del contenido — el multilínea es una extensión sobre el wrap de
> ZAB-17, no un flag. El **placeholder es un ESTADO, no un color nuevo**: `empty` entra
> en `StateName` y el orden normativo de ZAB-36 se amplía por la izquierda a
> `base → empty → selected → checked → hover → focused → pressed`. Las **flechas mueven
> el caret y, en el extremo, dejan navegar** (deliberadamente distinto del `Slider`, que
> nunca suelta las de su eje: salir de un texto largo a pulsaciones no es barato), y
> `maxLength` **acota lo que se teclea, no lo que vale el dato**. Caret y resaltado los
> pinta el SDK con el `style.color` del campo, con el parpadeo como comportamiento
> indexado por identidad: cero superficie de `Style` nueva. En web el texto entra por un
> **`<textarea>` oculto espejado en los dos sentidos** (IME real, portapapeles, teclado
> de móvil), que es del target y no del contrato. Ver `decisions-architecture.md`
> (2026-08-11, TextInput) y `specs/2026-08-11-textinput-design.md`.
>
> **Status 2026-08-24: el motor que renderiza es GODOT, y el core es C++ (ZAB-134,
> F11)** — no es una decisión de la IR, pero cambia quién la lee: donde estas notas
> dicen "el SDK", a partir de ahora es una **GDExtension en C++** cuyo C++ **es el core
> compartido**, con `sdk/godot` como adaptador fino. El SDK de Unity queda cancelado a
> 4 de 13 tipos. Para la IR esto no mueve nada — y precisamente que no mueva nada es la
> prueba de que el contrato era engine-agnostic —, pero sí fija **cómo se comprueba**:
> el core produce un `ViewSnapshot` sin motor, así que el corpus `golden/` pasa a ser
> literalmente el test del port. Ver `decisions-architecture.md` (2026-08-24) y
> `specs/2026-08-24-godot-sdk-language-design.md`.

---

## Why the IR is the keystone

zabloo/ui follows the **"we draw it ourselves"** model (Flutter/Rive): authoring/platform →
**IR** → per-engine **SDK that tessellates the IR into GPU geometry at runtime**. The IR is
the contract between the authoring/platform side and every engine SDK. Every SDK depends on
it. If we design it wrong, every SDK pays for it later. So we get this right (enough) before
going wide.

Two properties make this IR different from a "compile-to-native-widgets" IR:

- **It is consumed at runtime, and shipped over the wire.** The platform hot-updates content
  in live games, so the IR is a **payload the SDK loads and renders**, not build-time source
  that generates native UI once. This makes **serialization + versioning first-class** (an
  older SDK may receive newer content — see §8).
- **We render it, not the engine.** Because zabloo/ui owns layout, drawing, hit-testing,
  states and animations, the IR carries **vector draw commands** (see §4). The engine only
  provides a GPU canvas (meshes + draw calls). This actually **removes** the old cross-engine
  tension of matching disparate native widget/layout systems — we don't lower to native
  widgets at all.

The hard part is still the **right level of abstraction**:

- Too web-specific ("it's basically HTML/CSS") → leaks assumptions a self-renderer shouldn't
  make and bloats the SDK.
- Too low-level (raw triangles) → the platform loses the semantic component model that makes
  authoring, states, hit-testing and hot-update tractable.

The IR should sit at the level of a **retained-mode scene of styled components that lowers
to vector draw commands** — a design-system component model with an explicit paint layer.

---

## Design goals for the IR

- **Engine-agnostic.** No concept may assume a specific engine's idioms. The engine is just
  a GPU canvas.
- **Declarative & serializable.** Plain data (JSON-able). No behavior, no code. Events are
  **declared hooks**, not logic.
- **Token-referencing, not value-baked.** Styles reference design tokens so themes swap.
- **Resolved per node, no cascade.** The SDK should consume computed style per node directly
  (no CSS-style inheritance to evaluate at runtime on-device).
- **Self-renderable.** Everything needed to paint a node — geometry, fills, strokes, text —
  must be derivable from the IR by the tessellator, without asking the engine for widgets.
- **Versioned & forward-tolerant.** Because content is hot-updated independently of the SDK,
  the IR must carry a version and degrade predictably when the SDK is older than the content.
- **Stable core, extensible edges.** A small fixed vocabulary of primitives + draw commands +
  a composition model, so we don't churn the IR every time we add a component.

---

## What the IR must capture

Each dimension below needs a decision. The note explains *why* it's not obvious.

### 1. Component tree
Nodes, hierarchy, slots/children, and **component identity** (`Button`, `Panel`, `List`, a
composite?). Because we render ourselves, identity drives **behavior + default paint**, not a
mapping to a native widget.
- Open: fixed primitive vocabulary vs. open/extensible? How do composites (Card, radial
  selector) decompose — kept as composites in the IR, or flattened to primitive + draw-command
  trees the tessellator consumes directly?
- **✅ Decided 2026-08-01 (partially):** v1 vocabulary is a **closed set of 3 primitives:
  `Container`, `Text`, `Button`** (`Row`/`Column` = `Container` sugar in `@zabloo/react`).
  Component identity keys **behavior implemented in the SDK** (IR declares what + initial
  state + hooks; zero logic in the JSON). User-defined React components never reach the IR
  — they execute at authoring time and emit primitives. Composites still open (the
  Accordion will force that decision).

### 2. Layout
Layout primitive is **Flexbox** (Yoga semantics: direction, justify, align, grow/shrink/basis,
wrap, gap, padding/margin, relative/absolute position). **We compute layout ourselves** (the
core runs the layout pass before tessellation), so there is **no dependency on any engine's
layout system** — the old "Godot has no flexbox / Unreal is slot-based" problem disappears.
- ~~Open: which Yoga features are core in v1? Is layout resolved into concrete rects **in the
  IR** (fully baked) or computed by the SDK's runtime from layout props?~~
- **✅ Decided 2026-08-01:** **runtime layout in the SDK — no baked rects.** Interactivity
  (collapse, resize, safe-areas) makes baked rects a dead end. v1 Yoga subset: `direction,
  justify, align, gap, padding, width/height, grow`.
- **✅ Extended 2026-08-11 (ZAB-32): `wrap`** joins the subset — a grid IS a row that
  wraps, so the capability belongs to the layout and serves any node, not only a
  `Repeat`. `justify`/`align` keep meaning what they mean **within a line**; Yoga's
  `align-content` stays out (lines stack from the start). Additive and forward-tolerant:
  an SDK that ignores it lays the children out on one single line.

### 3. Styling & design tokens
Style as **token references** plus a small, well-defined property set (colors, spacing, border,
radius, typography, sizing, opacity, shadow). Resolved per node.
- **✅ Decided 2026-08-01:** confirmed **resolved per node** + a **flat token dictionary in
  the envelope** (`"tokens": { "color.primary": "#…" }`); nodes reference `{color.primary}`,
  the SDK does one flat lookup. Buys theming + theme hot-update without re-emitting the
  tree. **Property set closed 2026-08-06:** `background`, `radius`, `borderWidth`,
  `borderColor` (inset stroke), `color`, `fontSize`, `opacity` (multiplicative).

### 4. Draw commands (the paint layer — specific to a self-renderer)
The IR carries **vector drawing primitives** the tessellator turns into GPU geometry:
**path, arc, rounded-rect, fill, stroke, text, transform** (tentative minimum set, from the
pending decisions). This is what lets us do components impossible with native widgets (radial
selector, custom gauges) and stay pixel-identical across engines.
- **✅ Decided 2026-08-01:** v1 paint is **100% implicit — there is NO explicit draw-command
  layer in the v1 JSON**. A node's style (`background`, `radius`, `borderWidth`…) implies
  the rounded-rect fill/stroke; the tessellator derives it. The explicit `paint` layer
  (paths, arcs → radial selector) comes later as an **optional field**. Text/glyph
  rendering: **spike passed 2026-08-02** (self-rendered glyphs in Unity — own atlas +
  metrics + quads via `generateVisualContent`); rasterizer ownership **decided
  2026-08-11: core-owned** (stb_truetype per target).

### 5. Variants & states
Explicit states: default / hover / pressed / disabled / focused (extensible), modeled as
explicit `state → style/paint overrides` (no pseudo-class magic — we resolve them ourselves).
- Open: how do **variants** (primary/secondary/ghost) relate to states? Variants = named style
  sets; states = transient overrides within a variant?
- **Note 2026-08-01:** who *runs* the states is decided — the **SDK owns runtime state**
  (pressed/hover/focused; later Collapse's open/closed), keyed by component type. The IR
  declares initial state + style overrides per state. The variants model itself stays open.
- **✅ Decided 2026-08-11 (ZAB-33): state changes can be tweened.** A `transition`
  (duration + easing from a closed set) on `NodeBase` interpolates the resolved
  animatable values — including layout dims — whenever they change, whatever the cause.
  Amends the v1 out-of-scope: simple transitions are IN; keyframes/timelines stay v2.
- **✅ Extended 2026-08-11 (ZAB-36 + ZAB-26): the merge order is NORMATIVE** —
  `base → empty → selected → checked → hover → focused → pressed`. Value states first
  (`empty`, added by the `TextInput`, is the weakest thing a control says about its
  value and so opens them), interaction states over them. Reference implementation:
  the web renderer's `states.ts`.

### 6. Input, focus & hit-testing (games-specific)
Because we draw geometry, we also own **geometric hit-testing** (pointer/touch) and **focus +
directional navigation** (up/down/left/right/next/prev, default focus) for **gamepad/keyboard**
— first-class, not an afterthought. The SDK feeds input events into the IR's declared focus map.
- Open: explicit neighbor wiring vs. automatic order with hints; how hit-testing regions are
  derived (from layout rects vs. from draw geometry); how much to model in v1.
- **✅ Decided 2026-08-04:** automatic spatial navigation from live layout rects;
  focusability by component identity; `states.focused` + `autofocus`; hit-testing =
  layout rects.
- **✅ Extended 2026-08-11 (overlays):** hit-testing runs the overlay layer first
  (top-down) and a `modal` Overlay **captures** everything below it; the focus-trap
  **derives from `modal`** (no new field) and the SDK restores the previous focus on
  close. See `decisions-architecture.md` (2026-08-11, overlays).

### 7. Events, bindings & dynamic data
The IR can't contain game logic, but it **declares hooks**: actions a node exposes (`onClick`
named `"buy"`) and **data bindings** (a label bound to `player.gold`, a list bound to a content
collection). Dynamic content is central here — this is what hot-update drives.
- **✅ Decided 2026-08-01:** v1 has **two mechanisms only** — named actions
  (`onClick: "buy"`, exposed idiomatically per engine: C# event / signal / Blueprint) and
  **data-path bindings** (`text: {"bind": "player.gold"}`). No lists/templates/conditionals
  in v1. **Visibility** = a `visible` prop/binding with **`display:none` semantics** (leaves
  layout) — one single hiding mechanism.
- **✅ Amended 2026-08-11 (ZAB-29): lists ARE in.** Still two mechanisms, but both grew
  up: a `Repeat` node instantiates its template once per element of a bound array, so
  **data drives structure**, not just values; paths stop being opaque store keys and
  become addresses into the data (`shop.items.3.name`), read AND write; and named
  actions carry an `ActionContext {path, key, index}` when they fire from inside an
  item, so an action inside a row can finally say WHICH row. Conditionals stay out —
  the IR has no expressions (the empty-list case is a positional slot, not a
  predicate). See `decisions-architecture.md` (2026-08-11, array bindings).

### 8. Serialization & versioning (elevated — content ships over the wire)
The IR is delivered to live SDKs and hot-updated. So: a versioned envelope, forward/backward
compatibility rules, and a defined behavior when the **SDK is older than the content** (ignore
unknown nodes/props? render a fallback? refuse?). Capability/version negotiation lives here.
- **✅ Decided 2026-08-01:** versioned envelope (`v`) with **forward-tolerant rules**: the
  SDK ignores unknown props, renders a fallback for unknown node types, and refuses only on
  a **major-version mismatch**. The envelope supports **multiple documents (views/scenes)**
  from v1. The loader treats every input as a versioned payload — a manually imported JSON
  (v1 dev workflow: `export` from the React project → import in the engine) and a platform
  hot-update go through the **same path**. Migration strategy: still open.

---

## Cross-engine reality (quick reference)

Because we self-render, the relevant question per engine is **"how does it give us a GPU
canvas / let us submit custom geometry?"** — not "what widgets/layout/theming does it have."

| Concern            | Godot (**renders the whole catalog**) | Unreal (**F13**)           | Unity (**F12**, decided 2026-09-03) |
|--------------------|------------------------------------|-------------------------------|-------------------------------|
| Custom geometry    | `RenderingServer.canvas_item_add_triangle_array` | Slate custom widget / RHI | UGUI: `CanvasRenderer.SetMesh`, one renderer per clip group + our own shader |
| How the core gets in | **GDExtension in C++** (`godot-cpp`) — the core *is* the extension | the same C++ core as a module/plugin, no language bridge | the same core as a **native plugin** (`libzabloo`) behind a **C ABI**; the adapter is C# only |
| We provide         | tessellated mesh + texture         | tessellated mesh              | tessellated mesh + material   |
| Engine provides    | draw call + input plumbing         | draw call + input             | draw call + input (Input System) |
| Text/fonts         | our atlas + our rasterizer (`stb_truetype.h`, decided 2026-08-11) | the same, verbatim | the same, verbatim — it runs in the native plugin, so nothing is ported to C# |

Since 2026-08-24 that table has one column that matters and two that are plans: **the
core is C++ and it is shared**, so a new engine adds an adapter — a way to hand over
triangles and a way to receive input — and nothing else. The rest of the row is the same
code. That is also why the "we provide / engine provides" split has stayed identical
across all three columns since the model was chosen: it was never an engine question.

The takeaway driving the IR: **don't model it as CSS/HTML and don't model it as native
widgets.** Model it as a resolved, explicit, declarative component model **with a vector paint
layer**, where styles are computed per node, states are explicit, layout is ours, and
focus/hit-testing/bindings are declared neutrally.

---

## Decisions to make (agenda — status as of 2026-08-01)

1. ✅ Styling: **decided** — resolved per node + flat token dictionary in the envelope.
   (Property set closed 2026-08-06: background, radius, borderWidth/borderColor
   inset, color, fontSize, opacity multiplicative.)
2. ✅ Layout: **decided** — Flexbox, **runtime layout in the SDK** (no baked rects); v1
   Yoga subset `direction, justify, align, gap, padding, width/height, grow`, plus
   `wrap` (2026-08-11, ZAB-32 — what `<Grid>` needed; `align-content` stays out).
3. ✅ Draw commands: **decided for v1** — 100% implicit from style, no explicit paint
   layer in the JSON (added later as optional). ✅ Text/glyph strategy: **spike passed
   2026-08-02** (rendering validated); rasterizer ownership **decided 2026-08-11 —
   core-owned** (stb_truetype per target; shaping/HarfBuzz → v2).
4. ✅ Primitive vocabulary: **decided** — closed set, grown by capability: `Container`,
   `Text`, `Button`, `Collapse` (added 2026-08-03: runtime relayout), `ScrollView` (added 2026-08-11: scroll — offset state + continuous input), `Overlay` (added
   2026-08-11: capa de render + captura de input + ámbito de focus), `Image` (added
   2026-08-11: hoja con tamaño intrínseco), `Toggle` (added
   2026-08-11: estado booleano propio + valor de vuelta), `Repeat` (added 2026-08-11:
   estructura dirigida por datos — sus hijos salen del array bindeado, no del
   documento), `Slider` (added 2026-08-11: valor numérico continuo cuya geometría
   deriva del propio valor), `TextInput` (added 2026-08-11: un caret — punto de
   inserción y selección dentro del contenido que el jugador escribe). Next candidate
   only when it forces a new capability.
5. ✅ Composite handling: **decided 2026-08-03** — composites flatten to primitives at
   authoring time; cross-child behavior = declarative `group` on Container
   (`"exclusive-open"`), enforced generically by the SDK. Composites never reach the
   IR as types.
6. ✅ Variants model: **decided 2026-08-04** — authoring-time only (theme +
   `ThemeProvider`; explicit props win); the IR receives fully resolved nodes.
   No cascade, ever.
7. ✅ Focus / navigation / hit-testing: **decided 2026-08-04** — automatic spatial
   navigation from live layout rects; focusability by component identity;
   `states.focused` + `autofocus`; hit-testing = layout rects. Explicit neighbor
   overrides deferred as escape hatch.
8. ✅ Events / bindings: **decided** — named actions + data-path bindings only; `visible`
   with `display:none` semantics as the single hiding mechanism. Still two mechanisms,
   both grown since: bindings became read/write (2026-08-11, ZAB-23) and then
   **structural** — `Repeat` + paths that address into the data + `ActionContext` on
   actions fired inside an item (2026-08-11, ZAB-29).
9. ✅ Serialization/versioning: **decided** — versioned multi-view envelope,
   forward-tolerant, major-mismatch refusal; one loader path for import and hot-update.
   (Migration strategy open.)

---

## Out of scope for IR v1

- Full animation system — keyframes and timelines — stays deferred to v2.
  **Amended 2026-08-11 (ZAB-33):** simple **transitions** are IN (`transition` on
  `NodeBase`: duration + easing, tweening resolved style/layout values on change).
  The IR was kept from foreclosing animation, and this is the first piece to land.
- Engine-specific escape hatches (raw passthrough) — design later, not in v1.
- 3D / world-space UI beyond flat screen-space canvases.

> Note: unlike the earlier "compile at build time" model, there **is** a runtime in the game
> (the SDK). "No runtime" is no longer a constraint.

---

## Strawman (discussion starter — EXPECT THIS TO CHANGE)

A single Button node might *conceptually* look like this. Bait for critique, not a spec:

```jsonc
{
  "v": 1,                        // IR version (content ships over the wire)
  "type": "Button",              // primitive identity → behavior + default paint
  "id": "buy-btn",
  "variant": "primary",
  "layout": {                    // flexbox/Yoga semantics — WE compute layout
    "paddingX": "{space.4}",
    "paddingY": "{space.2}",
    "alignItems": "center"
  },
  "style": {                     // resolved, token-referenced
    "background": "{color.primary}",
    "radius": "{radius.md}"
  },
  "paint": [                     // explicit draw commands (or implied by style)
    { "cmd": "roundedRect", "fill": "{color.primary}", "radius": "{radius.md}" }
  ],
  "states": {                    // explicit overrides — no pseudo-class magic
    "hover":    { "style": { "background": "{color.primary.hover}" } },
    "disabled": { "style": { "background": "{color.muted}" } }
  },
  "focus": { "focusable": true, "order": 1 },   // gamepad/keyboard nav
  "hit":   { "shape": "layoutRect" },           // geometric hit-testing
  "events": { "onClick": "buy" },               // declared hook, not logic
  "children": [
    { "type": "Label", "text": "Buy", "style": { "color": "{color.on-primary}" } }
  ]
}
```

Questions this immediately raises (good — that's the point): is `variant` a top-level field or
a style set? Are `style` and `paint` separate layers, or is `paint` derived from `style`?
Should `states` live under `style` or be a sibling? Are layout rects baked or computed on
device? How are tokens referenced/resolved, and when? Let's argue these out.

---

## Next step (updated 2026-08-01)

The first working session happened: styling, layout, draw commands, vocabulary, bindings
and versioning are locked for v1 (see the agenda above and `decisions-architecture.md`).
The next step is **not** more paper design — it's the **vertical slice**:

```
JSX (<Button onClick="buy"><Text>Buy</Text></Button>)
  → IR JSON (versioned envelope + tokens)
  → Unity SDK: Yoga subset → tessellate rounded-rect + text → pressed state → C# event
```

One screen, one pressable button — exercises every subsystem with minimal scope. The
**text/glyph-atlas spike goes first** (the #1 self-renderer risk). Then: `Collapse`
(runtime relayout on state change) → `Accordion` (forces the composites decision).
