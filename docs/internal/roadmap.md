# Roadmap (documento vivo)

> Documento vivo del producto zabloo/ui. Se actualiza a medida que avanzamos.
> Inicio: 2026-06-24. Público desde 2026-08-23 (el contexto vive en el repo).
> **Revisado 2026-07-06** tras el pivote a **plataforma + SDK "dibujamos nosotros"**.
> **Revisado 2026-07-09**: autoría v1 = **bindings React (`@zabloo/react`)**; editor
> visual web después, sobre la misma IR.
> **Revisado 2026-08-01**: **IR v1 mínima decidida** (7 decisiones) — ver
> `decisions-architecture.md` (2026-08-01). Fase actual: **rebanada vertical**.
> **Revisado 2026-08-10**: rebanada COMPLETA; nuevo plan **SDK feature-complete**
> en 8 fases (F1–F8) + F9 publicación. Ejecución en **Linear** (proyecto
> `@zabloo/ui`); aquí la narrativa.
> **Revisado 2026-08-20**: **F10 — chrome del dev preview** se intercala delante de
> F9 (ZAB-82…101). Ver la fase 10 más abajo.
> **Revisado 2026-08-22**: **F9 ARRANCADA — primera publicación en npm**: `@zabloo/*@0.2.0`
> y `create-zabloo-app@0.1.1`, la parte web, con Unity detrás (enmienda consciente a
> "feature-complete antes de publicar"; ver `decisions-architecture.md` 2026-08-22).
> **Revisado 2026-08-24**: **F11 — SDK de Godot**, y **Godot pasa a ser el primer motor
> que renderiza**: el batch de Unity (U1–U10) se cancela a 4/13 tipos y el SDK es una
> **GDExtension en C++ que ES el core compartido** (ZAB-134). Fase actual: **F11**. Ver
> la fase 11 más abajo y `decisions-architecture.md` (2026-08-24).
> **Revisado 2026-09-04**: **F12 CERRADA** (UN1–UN11): Unity renderiza el catálogo entero
> como adaptador fino sobre el core C++, el corpus pasa por el C ABI y por un `ZablooView`
> real, y el SDK se distribuye como `.tgz` de UPM adjunto a una Release. La verificación en
> un editor de verdad queda como procedimiento — ver la fase 12. Siguiente: **F13**.
> **Revisado 2026-09-04 (alcance de la release):** la versión que se publica ahora cubre
> **tres targets — web, Godot y Unity**. **Unreal (F13) queda para después de esta
> versión**, no dentro de ella: enmienda a la nota del 2026-09-03 de abajo. Falta una
> pasada de revisión de los tres (ZAB-42 y sucesores) antes de publicar.
> **Revisado 2026-09-03**: la próxima versión publicada cubre **cuatro targets** — web,
> Godot, **Unity** y **Unreal** —, así que se abren **F12 — SDK de Unity** y **F13 — SDK de
> Unreal**, en ese orden, las dos como **adaptadores finos sobre el core C++** que nace en
> F11. Con ello el exit review de feature-complete (ZAB-42) deja de ser "web + Godot" y
> pasa a exigir los cuatro. Ver las fases 12 y 13 más abajo.

## Fase inicial (COMPLETADA) — Rebanada vertical (validar la IR v1 de punta a punta)

La IR v1 mínima está **decidida** (2026-08-01): layout Flexbox en runtime del SDK (sin
rects horneados), vocabulario cerrado `Container`/`Text`/`Button`, comportamiento en el
SDK indexado por tipo, paint 100% implícito desde estilo, estilos resueltos por nodo +
diccionario plano de tokens en el envelope, acciones con nombre + bindings por path,
envelope versionado multi-vista y forward-tolerant. Estado detallado por punto: agenda de
`ir-context.md`.

Siguiente paso — **no más diseño en papel**: validar con una rebanada vertical:

```
JSX (<Button onClick="buy"><Text>Comprar</Text></Button>)
  → IR JSON (envelope versionado + tokens)
  → SDK Unity: subset Yoga → teselar rounded-rect + texto → estado pressed → evento C#
```

1. ✅ **Spike de texto/atlas de glifos — SUPERADO (2026-08-02).** Glifos self-rendered en
   Unity (atlas propio + métricas propias + quads vía `generateVisualContent`), nítido y
   sin elementos de texto nativos. Hallazgos y lo que sigue abierto (¿quién rasteriza a
   largo plazo: core vs por-motor?): `decisions-architecture.md` (2026-08-02). Código:
   `ui/examples/unity-playground/Assets/Spikes/TextAtlas/`.
2. ✅ **Rebanada del Button — SUPERADA (2026-08-03).** JSX → reconciler (`@zabloo/react`)
   → `zabloo export` (envelope versionado) → SDK Unity (loader forward-tolerant + tokens
   + **flexbox propio** + teselado rounded-rect/texto + estado `pressed` + evento C#
   `action: buy`). Todo en su forma final, sin código desechable. Detalles:
   `decisions-architecture.md` (2026-08-03).
3. ✅ **`Collapse` — SUPERADO (2026-08-03).** 4º primitivo (modelo `<details>/<summary>`:
   hijo 0 = header, resto = contenido con semántica `display:none` vía flag `InLayout`
   genérico). Relayout en runtime probado; reparto decidido: toggle de serie en el SDK
   (tap en header) + API juego→SDK `ZablooView.SetOpen(id, open)` (los bindings de
   `open` usarán ese mismo camino). Ver `decisions-architecture.md` (2026-08-03).
4. ✅ **`Accordion` — SUPERADO (2026-08-03).** Decisión de composites cerrada (§5):
   los composites **se aplanan** en authoring-time; el comportamiento cruzado es un
   `group` declarativo en el Container (`"exclusive-open"`) que el SDK aplica de forma
   genérica. Vocabulario se queda en 4 primitivos; degradación elegante en SDKs
   viejos. `<Accordion>` es azúcar de `@zabloo/react`. Ver `decisions-architecture.md`.

5. ✅ **Bindings de datos — SUPERADO (2026-08-03).** `ZablooView.SetData(path, value)`
   como canal juego→SDK: `Text` bindeado se re-mide y relayoutea en vivo; `visible`
   bindeado entra/sale del layout. Cero cambios en el lado TS (el contrato aguantó).
   Demo: comprar baja el oro en pantalla y revela una fila bindeada. Defaults
   registrados en `decisions-architecture.md` (2026-08-03, bindings).

**La fase de rebanada vertical está COMPLETA** (spike texto → Button → Collapse →
Accordion → bindings). Los dos mecanismos dinámicos de la IR v1 (acciones + bindings)
están implementados y validados. Abierto de la IR: variants, focus/navegación,
estrategia de rasterizado.

6. ✅ **Dev loop — SUPERADO (2026-08-03).** `zabloo dev` (`pnpm dev`) + Dev Mode del
   editor: guardar el `.tsx` = export + push HTTP a localhost + hot-swap en vivo
   (incluso en Play, incluso con Unity sin foco — `runInBackground`). Mismo camino de
   carga que el hot-update de producción (dogfooding diario). Enmienda WS→HTTP
   registrada en `decisions-architecture.md` (2026-08-03, dev loop). Enmienda
   2026-08-10: web-first — el push a Unity es opt-in (`--unity` / `pnpm dev:unity`);
   ver decisions-architecture.md (2026-08-10).

7. ✅ **Renderer web + preview — SUPERADO (2026-08-03).** `@zabloo/renderer-web`:
   tercera implementación del modelo self-render (WebGL2 crudo, layout/teselado/atlas
   propios) — el navegador ya es un target real y el embrión del canvas del editor
   visual. `zabloo dev` sirve el preview en `localhost:5078` (SSE live reload, panel
   de data bindings, log de acciones): **editar la UI ya no requiere Unity**; con
   Unity abierto, ambos targets se actualizan a la vez. Limitación aceptada: texto
   no pixel-idéntico entre targets (converge vía TTF compartida — estrategia de
   texto abierta). Ver `decisions-architecture.md` (2026-08-03, web renderer).

8. ✅ **Variants (§6) + Focus/navegación (§7) — SUPERADOS (2026-08-04). LA AGENDA DE
   LA IR ESTÁ CERRADA (9/9).** Variants = authoring-time (theme + ThemeProvider,
   jamás en la IR — sin cascada). Focus = navegación espacial automática desde los
   rects vivos (`autofocus` + `states.focused`; flechas + Enter en ambos targets;
   hit-testing v1 = rects de layout, cerrado formalmente). Validado en Unity y web.
   Ver `decisions-architecture.md` (2026-08-04).

9. ✅ **`create-zabloo-app` — SUPERADO (2026-08-04).** El scaffolder del funnel,
   implementando el layout decidido el 2026-08-02: `npx create-zabloo-app my-ui` →
   proyecto con `dev` (preview web + push a Unity) y `build` de serie; vista starter
   que ejercita variants/autofocus/bindings/Collapse; `src/components/` con
   componente de usuario de ejemplo; README con el snippet de wiring C#. Flag
   `--workspace` para probarlo dentro del monorepo (smoke test end-to-end:
   scaffold → install → typecheck → export). Los 5 paquetes OSS de la decisión
   2026-08-02 existen ya: format, react, cli, create-zabloo-app, sdk/unity
   (+ renderer-web de propina).

10. ✅ **Consolidación — SUPERADA (2026-08-06).** Set de estilo v1 **cerrado** e
    implementado en ambos targets: `borderWidth`/`borderColor` = **borde INSET**
    (paint-only, modelo border-box: nada pinta fuera del rect de layout) y
    `opacity` = **herencia multiplicativa** por subárbol (alpha por vértice; no es
    opacidad de grupo por render-to-texture). Fill y borde comparten la misma
    parametrización de perímetro en los dos teseladores. Los ejemplos usan el borde
    como focus ring (`states.focused`). Spike de TextAtlas **borrado** (hallazgos en
    el decision log; patrón productizado en `GlyphAtlas`). README público de `ui`
    actualizado: ya cuenta el sistema funcionando, no el estado pre-rebanada. Ver
    `decisions-architecture.md` (2026-08-06).

## Fase siguiente — SDK feature-complete (decidido 2026-08-10)

**Objetivo del milestone:** SDK feature-complete ANTES de publicar nada. La
publicación OSS (npm, docs públicas, releases) es el milestone siguiente (F9), no
parte de este. **Ejecución en Linear** (proyecto `@zabloo/ui`, milestones F1–F9,
issues ZAB-5…42); este archivo guarda la narrativa y el porqué.

**Organización: fases por capacidad, no por componente.** Cada fase introduce UN
sistema nuevo en la IR/SDKs y los componentes que lo necesitan entran en esa fase
como prueba (la regla de siempre, ahora con el mapa completo). Todo se valida en
ambos targets antes de cerrar fase, y cada componente entra con su spec de
props/estados/eventos escrita — la "spec completa del catálogo" se construye por el
camino y se consolida en F8.

1. **F1 — Scroll y clipping**: scissor/stencil en ambos teseladores + input
   rueda/drag. Entra `ScrollView`. Desbloquea pantallas reales.
2. **F2 — Assets e Image**: referencias/manifest en el envelope, empaquetado en
   `zabloo export`, texturas en ambos SDKs. Entra `Image`. Antes que el texto
   porque la TTF compartida es un asset.
3. **F3 — Texto definitivo**: cerrar rasterizador core vs por-motor (el único
   abierto de la rebanada), TTF compartida, multilínea/wrap/ellipsis/alineación.
4. **F4 — Capas y overlays**: z-order, bloqueo de input, focus-trap, timers.
   Entran `Modal`, `Toast`, `Tooltip` (+ `Tabs` azúcar). Prepara el dropdown de F5.
5. **F5 — Formularios e input completo**: `Checkbox/Toggle`, `RadioGroup` (reusa
   `group`), `Slider` (drag F1), `Select` (overlay F4), **`TextInput`** (el más
   caro; teclado en pantalla de consola → v1.x) y **gamepad real** (d-pad/stick →
   focus). Cierre: settings completa 100% navegable con gamepad.
6. **F6 — Listas de datos**: bindings de arrays + item template en la IR +
   reciclado/virtualización. Entran `List`/`Grid`. La capacidad de IR más cara
   que queda; con scroll+assets+texto hechos cae en el mejor momento.
7. **F7 — Transiciones (juice)**: transiciones declarativas de estilo entre
   estados (duración + easing, set cerrado de curvas) + loop mínimo (`Spinner`).
   Entran `ProgressBar`, `Spinner`, `Badge`; se anima el catálogo existente.
   Enmienda al out-of-scope de la IR v1: las transiciones simples ENTRAN; el
   sistema completo (keyframes/timelines) sigue fuera → v2.
8. **F8 — Hardening y spec**: validación robusta del envelope + errores legibles,
   suite de tests cross-target (golden envelopes), test de forward-compat,
   presupuestos de perf (draw calls/atlas/memoria, build real), y consolidación
   de la spec del formato + specs de todos los componentes. **Criterio de salida:
   F9 puede empezar.**
9. **F9 — Publicación OSS** — **ARRANCADA 2026-08-22**: primera publicación manual
   (bootstrap con OTP) de `@zabloo/format|react|renderer-web|cli@0.2.0` y
   `create-zabloo-app@0.1.1`, 5 GitHub Releases, `npx create-zabloo-app` verificado
   desde el registry público. Queda: Trusted Publishers en npmjs (→ el botón `publish`
   de CI), y las releases siguientes por el ritual de `releasing.md`. Unity se publica
   cuando exista (UPM, no npm).
10. **F10 — Chrome del dev preview** (abierta 2026-08-20, ZAB-82…101, batches 10–13).
    Intercalada delante de F9 a propósito: la página que sirve `zabloo dev` es lo
    primero que ve alguien que instala esto, y publicar con el canvas pelado de la
    rebanada vertical habría sido enseñar la herramienta por su peor lado. El
    preview pasa a ser una app propia —`packages/preview`, React + Vite +
    Tailwind v4 + shadcn/ui + zustand, **privada**, servida estática por la CLI—
    con topbar (vistas, presets de viewport, DPR, tema, zen), consola tipo IDE
    (Actions / Problems / Stats), statusbar, y panel flotante de bindings con
    editores **tipados por el sitio donde está atado el path**, no por el valor.
    El renderer no cambia: esto es el chrome ALREDEDOR del canvas.
    Ver `decisions-architecture.md` (2026-08-20, ampliada 2026-08-21) y el diseño
    archivado en `specs/2026-08-20-dev-preview-chrome-design/`.
    **Criterio de salida:** el chrome viaja dentro del tarball de `@zabloo/cli` y
    `verify:pack` lo sirve desde ahí; todo componente con su suite propia (la
    convención de tests de 2026-08-21); las docs públicas describen la página que
    existe; `wip/` fuera del repo público; y QA visual contra los cinco artboards
    (1a–1e) pasada. Deuda aceptada y con ticket: sin code splitting (ZAB-107).

11. **F11 — SDK de Godot** (abierta 2026-08-24, ZAB-134…150, tickets `[G#]`).
    **Godot es el primer motor que renderiza**, y el batch de Unity se cancela: el
    SDK de Unity se quedó en **4 de 13 tipos** y no se termina. La decisión que abre
    la fase (**G1**, ZAB-134) es de lenguaje y forma, y es grande: el SDK es una
    **GDExtension en C++**, y ese C++ **ES el core compartido** — layout, texto,
    teselado, runtime de estados/bindings/transiciones y el `ViewSnapshot` —, con
    `sdk/godot` como adaptador fino que sube triángulos y traduce input. Con eso se
    **cierra el abierto de 2026-07-06** ("cuándo extraer el teselador a un core C++"):
    se extrae ahora porque el primer motor que renderiza ya lo necesita.

    Lo que hace la fase verificable es una propiedad, no un proceso: **el core
    produce un `ViewSnapshot` sin motor alguno**, así que el corpus `golden/` (18
    casos) corre contra un binario nativo en CI, en una CPU pelada, sin Godot y sin
    GPU. Por eso el orden es **decisión → chasis (G2) → harness golden (G3)** y solo
    después las capacidades, cada una cerrando contra su caso del corpus, en el mismo
    orden en que las cerró el web: texto → assets → clip/scroll → estados/focus/canal
    de host → transiciones → overlays → controles → TextInput → Repeat → gamepad →
    dev loop → perf/builds → forward-compat → docs y distribución.

    El renderer web queda como **implementación de referencia**: sus módulos puros
    son la referencia literal que se porta (~12.600 líneas de lógica entre
    `renderer-web` sin su capa GL y `@zabloo/format`), y el corpus es el árbitro
    cuando los dos targets discrepan.

    **Plataformas v1:** desktop y móvil soportados; **web experimental** (GDExtension
    en web pide export templates `dlink`) y **fuera** del criterio de salida;
    consolas "compila, no validado". **Mínimo Godot 4.4** — por la compatibilidad
    hacia adelante de GDExtension, eso cubre también 4.5, 4.6 y 4.7.
    **Criterio de salida:** el corpus golden completo pasa en Godot (métricas
    byte-idénticas salvo tolerancia documentada), `examples/settings-screen` es 100 %
    navegable con mando en un export real, `zabloo dev --godot` recarga en vivo, el
    addon se instala desde un zip, y las docs públicas describen Godot como primer
    motor. Ver `decisions-architecture.md` (2026-08-24) y
    `specs/2026-08-24-godot-sdk-language-design.md`.

    **Nota sobre G17 (2026-09-03):** el ticket llevaba tres cosas y se entrega con
    dos — docs públicas con Godot delante, y distribución del addon (zip por
    release, versión del grupo `fixed`, Asset Library documentado). La **retirada de
    Unity de la superficie** (`sdk/unity`, `zabloo dev --unity`, `dev:unity`) sale a
    su propio ticket inmediatamente detrás: borrar código y reescribir prosa son dos
    revisiones distintas, y la segunda es la que cierra el criterio de salida
    "`grep -ri unity` solo devuelve menciones históricas".

12. **F12 — SDK de Unity** (abierta 2026-09-03, ZAB-194…204, tickets `[UN#]`). Unity vuelve, y
    vuelve por la vía que dejó escrita la decisión del 2026-08-24: **adaptador fino
    sobre el core C++** a través de un plugin nativo, nunca el port a C# que se canceló
    a 4 de 13 tipos: el `sdk/unity` que G17 está retirando de la superficie no es el
    que vuelve, es el que se borra. El core ya no se reescribe — lo que hay que
    construir es la mitad que sabe de Unity (subir la geometría teselada, traducir
    input, exponer acciones y datos idiomáticamente en C#) y el puente de interop que
    la conecta con el core, que es el riesgo real de la fase (P/Invoke, IL2CPP/AOT,
    consolas).
    **Tres decisiones tomadas al abrirla:** render por **UGUI** (`Canvas` + un
    `CanvasRenderer` por grupo de clip + shader propio — la traducción literal del
    adaptador de Godot, y el número de draw calls sigue siendo el nuestro), **Unity
    2022.3 LTS mínimo** probado en Unity 6, e **Input System** como dependencia del
    paquete. El puente es un **C ABI** (`core/capi/`) con valores como JSON y eventos
    drenados en vez de callbacks — lo que hace el interop AOT-safe bajo IL2CPP, y lo que
    permite correr el corpus **por el ABI** en CI sin Unity. Desglose en cuatro waves
    (label = grupo paralelo, zonas disjuntas): A decisión/spec + C ABI + chasis UPM; B
    render, puntero/teclado, mando, canal de host; C dev loop, builds/IL2CPP/perf, golden
    en Unity; D docs y distribución. Los learnings de F11 que aplican, y el mapa, en
    `plans/2026-09-03-unity-sdk-f12.md`.
    **Criterio de salida:** el corpus golden completo reproduce sus métricas byte a byte a
    través del C ABI **y** dentro de Unity, `examples/settings-screen` es 100 % navegable
    con mando en un player real (IL2CPP), `zabloo dev --unity` recarga en vivo, y el
    paquete se instala desde un `.tgz` en un proyecto limpio. Fuera, a propósito: móvil en
    dispositivo y la revisión final de los cuatro targets (misma cesta que ZAB-193).

    **CERRADA 2026-09-04 (UN11, ZAB-204)**, con una reserva que hay que decir entera: los
    once tickets se escribieron en una máquina **sin Unity**. Lo que está cerrado de verdad
    es lo que el corpus y CI pueden ver — el core, el C ABI con el corpus pasando por él en
    tres sistemas, el plugin compilando para las cinco plataformas, la fontanería del
    adaptador de punta a punta (tamaño → core → `SetData` → reloj → mando → `Snapshot`)
    contra el plugin real bajo un shim de `UnityEngine`, y la distribución (`pack-upm.mjs`
    + workflow `unity-sdk.yml`, probados en local con el binario de macOS). Lo que queda
    **escrito como procedimiento y no corrido**, y dónde vive cada cosa:

    | Pendiente | Dónde está el procedimiento |
    |---|---|
    | Instalar el `.tgz` de un `dry-run` en un proyecto limpio (2022.3 y Unity 6) y ver `hello-button` con Enter → `buy` | `docs/releasing.md` › *The Unity package* |
    | Las suites PlayMode en el Test Runner (corpus, input, alocaciones) y las escenas de verificación | `examples/unity-playground/README.md` |
    | Los players IL2CPP de macOS/Windows y `settings-screen` con mando en uno | `sdk/unity/README.md` › *IL2CPP* |
    | La tabla de rendimiento de Unity (hoy con forma y sin cifras) | `docs/performance.md`, con el bench de `sdk/unity/README.md` |
    | Android e iOS en dispositivo | ZAB-193, fuera de milestone como en Godot |

    Es una tarde con el editor, convertida en checklist a propósito; hasta que se corra, la
    fila de Unity del README lo dice tal cual.

13. **F13 — SDK de Unreal** (planificada 2026-09-03, sin desglosar; **fuera de la
    release actual** desde 2026-09-04 — va después de publicar web + Godot + Unity). El core entra
    como módulo/plugin de C++ **sin puente de lenguaje**, que es lo que lo hace el
    adaptador más barato de los tres; lo específico es la superficie de motor (widget
    de Slate que recibe la geometría, input, y exponer acciones/datos a Blueprint).
    **Criterio de salida:** el mismo — corpus golden en verde, `settings-screen`
    navegable con mando en un build real, y plugin instalable.

    Las dos fases comparten la tesis que F11 existe para probar: **un motor nuevo es
    un adaptador, no otro port**. Si alguna de las dos acaba pidiendo lógica que ya
    vive en el core, eso es la señal de que la frontera core/adaptador se ha movido —
    y se arregla en el core, no duplicándola.

> Sin fechas: fases ordenadas por dependencias técnicas, cada una con criterio de
> salida. El ritmo lo marca la disponibilidad (solo founder).

## Hitos posteriores (alto nivel, por confirmar)

- ~~Extracción (o no) del **teselador a un core C++ compartido** + adaptadores finos por
  motor.~~ **Decidido 2026-08-24 y en curso: se extrae, y es F11.** El core C++ nace como
  la GDExtension de Godot; el siguiente motor es un adaptador sobre él, no otro port.
- **Plataforma** (repo `app`): MVP de creación/gestión de contenido + hosting + entrega de
  hot-update. El **editor visual web** (WYSIWYG con el mismo renderer vía WebGL) viene
  después, sobre la misma IR.
- ~~Adaptador de **Unreal** sobre el core C++, y el regreso de **Unity** si llega.~~
  **Planificados 2026-09-03: dejan de ser "por confirmar" y son F12 (Unity) y F13
  (Unreal)**. La versión que se publica ahora lleva web + Godot + Unity; Unreal va detrás.
- Landing / página de producto de zabloo/ui (en zabloo.com, repo `landing`).
- Primeros **blocks/templates premium**.

## Out of scope (IR v1)

- Sistema de **animaciones** completo (keyframes/timelines) — se difiere a v2.
  **Enmienda 2026-08-10:** las **transiciones simples** de estilo entre estados SÍ
  entran (F7 del plan feature-complete).
- Escape hatches específicos de motor (passthrough en crudo).
- UI 3D / world-space más allá de canvases planos en screen-space.

> Nota: a diferencia del modelo antiguo ("compilar en build time, sin runtime"), **sí hay
> runtime en el juego** (el SDK). "Sin runtime" ya **no** es una restricción.
