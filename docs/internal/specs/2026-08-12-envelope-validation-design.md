# Spec: validación robusta del envelope (2026-08-12, ZAB-37)

> Tarea Linear: [ZAB-37] — proyecto **@zabloo/ui**, hito **F8 — Hardening y spec**.
> Alcance: la política de carga en `@zabloo/format`, los mensajes legibles (formato y
> CLI), y la degradación del loader web. La paridad del loader de Unity entra con el
> batch final de Unity; el contrato y los `code`s se fijan **aquí**, que es donde ambos
> targets lo comparten.

## Contexto y problema

Hasta F8, `parseEnvelope` era deliberadamente mínima y forward-tolerant (decisión
2026-08-11, ZAB-10): comprobaba la forma del sobre, la versión mayor y la forma de cada
entrada del manifest — y nada más. No entraba en `views` en ningún momento, así que un
nodo malformado llegaba intacto al renderer, y las refs colgantes (token, asset, anchor)
se toleraban a propósito, con la validación exhaustiva aplazada a F8.

Eso deja tres agujeros, y los tres tienen el mismo coste: **la sesión del jugador**.

1. **El payload roto llega al frame.** Un `Text` sin `text`, un `children` que no es un
   array, un `layout` que es un string: cada consumidor tiene que defenderse solo, en
   cada nodo y en cada frame, o petar. Y son dos consumidores (web y Unity), o sea dos
   implementaciones de la misma defensa, divergiendo.
2. **Los errores no se leen.** `JSON.parse` de un envelope truncado da un
   `SyntaxError` de deserialización: ni qué vista, ni qué nodo, ni qué campo.
3. **El hot-update podía tirar la UI viva.** `reload()` llamaba al mismo camino que
   `mount()`, así que un push corrupto lanzaba en medio de una sesión ya renderizando.

## Decisión (aprobada)

### 1. Tres niveles, y la frontera es una sola pregunta

*¿Queda árbol que renderizar?* Si no queda, es `fatal`. Si queda, se repara y se avisa.

| Nivel | Casos |
|---|---|
| **`fatal`** | JSON inválido o truncado · no es objeto · `v` ausente o no numérica · major incompatible · `views` ausente o no es objeto · cero vistas utilizables tras reparar |
| **`warn`** | Vista que no es nodo → descartada · nodo malformado → descartado · prop de tipo erróneo → caída a su default · entrada de asset inválida → descartada · ref colgante de token/asset/anchor → ignorada · id duplicado · path de binding malformado · subárbol más profundo que el tope |
| **silencio** | Props desconocidas y **tipos de nodo desconocidos** — la forward-tolerance es una feature, no un error (regla normativa 2026-08-11) |

Un asset inválido **deja de ser error duro** (lo era): un icono corrupto cuesta su
textura, nunca la carga de la UI.

### 2. Formas, nunca vocabularios

Un set cerrado (`Easing`, `ImageFit`, `AnchorAt`, `GroupBehavior`, `ScrollAxis`…) se
comprueba que sea **string** y hasta ahí. El vocabulario es exactamente lo que crece en
una versión posterior, y todos los consumidores ya caen a su default ante un valor que
no conocen. Validar el valor convertiría el contenido de mañana en el error de hoy —
justo lo contrario de para lo que existe este pase.

### 3. Se REPARA, no solo se reporta

`readEnvelope` devuelve una **copia** sin las partes rotas. Es la única forma de que la
robustez se escriba una vez y la hereden los dos targets: quien cargó un envelope puede
fiarse de su forma en vez de defenderse nodo a nodo, frame a frame. Las props
desconocidas sobreviven la copia intactas, y el objeto del llamante nunca se muta.

**Slots posicionales.** En los tipos cuyos hijos son slots que el SDK lee por posición
(`Collapse`, `Toggle`, `Slider`, `ProgressBar`, `Repeat`, y un `Container` con
`group: "exclusive-select"`), un hijo descartado se sustituye por un `Container` inerte
en vez de eliminarse: quitarlo renumeraría los siguientes y cambiaría en silencio lo que
significan. En un flujo normal sí se elimina.

**Campos requeridos** (su ausencia hunde el nodo, porque sin ellos el tipo no es nada):
`Text.text`, `Image.src` (además con forma `asset:<id>`), `Repeat.items.bind` no vacío.
Un `anchor` inutilizable pierde el campo, **no** el nodo: el overlay conserva su
placement de capa, que es el tooltip pre-ZAB-46 al que degrada.

### 4. La API

```ts
readEnvelope(input: unknown): { envelope: Envelope | null; diagnostics: Diagnostic[] }
parseEnvelope(data: unknown): Envelope        // lanza EnvelopeError en el 1er fatal

interface Diagnostic {
  level: "warn" | "fatal";
  code: DiagnosticCode;   // identidad estable: es el contrato
  path: string;           // views["hud"].children[2].text
  message: string;        // legible y autocontenido (ya nombra ruta, campo y motivo)
}
```

`readEnvelope` **nunca lanza** y acepta texto JSON además de un valor ya parseado — que
es lo que convierte un truncamiento en un `fatal` legible en vez de un stack trace.
`parseEnvelope` se mantiene con su semántica de siempre (valor ya parseado, lanza) para
no romper a nadie: un string ahí sigue siendo simplemente "no es un objeto".

Las claves de mapa van entre corchetes en `path` (`views["main-menu"]`,
`assets["icons/coin.png"]`, `tokens["color.primary"]`) porque los ids de vista, los de
asset y los nombres de token llevan puntos propios.

### 5. Tope de profundidad

`MAX_DEPTH = 256`. Nada autorizado se acerca (una pantalla real anida decenas de niveles,
no cientos); lo que sí llega ahí es un payload hostil o corrupto. Todo lo que viene
detrás es recursivo — este walk, layout, paint, hit-testing —, así que un árbol capaz de
desbordar la pila deja de ser un árbol en la puerta. El corte es un warning como
cualquier otro: cae el subárbol, carga el resto.

## Consumidores

**Loader web.** `mount()` lanza el `EnvelopeError` con el mensaje legible: no hay nada
en pantalla que proteger todavía, y un juego que no puede cargar su UI quiere enterarse.
`reload()` **nunca lanza**: reporta y descarta el payload, conservando el envelope que
ya está en pantalla — un hot-update corrupto cuesta la actualización, no la sesión. Los
warnings salen como líneas `[zabloo]`, igual que el resto de errores de autoría.

El warning de token desconocido **sale del bucle de frames**: resolvía en cada pase de
estilo, así que se repetía frame tras frame; ahora lo emite el pase de carga una sola
vez, nombrando el nodo y la propiedad donde está.

**`zabloo export`.** Valida el envelope **antes de escribirlo**: un fatal aborta con
exit 1 y los warns entran en el resumen `⚠` que ya existía. Lo que se escribe es el
árbol que produjeron los componentes del autor, **nunca el reparado**: descartar en
silencio un nodo del artefacto escondería justo el bug que el warning acaba de nombrar.

**Preview.** `load()` captura y pinta el error en su log; una promesa rechazada dejaría
un canvas que simplemente dejó de actualizarse, que es el peor reporte posible.

## Fuera de alcance

Paridad del loader de Unity (batch final de Unity), test de forward-compat (ZAB-39),
goldens cross-target (ZAB-38) y la consolidación de la spec del formato (ZAB-41).

## Implementación

`packages/format/src/validate.ts` (política + walk, con `IR_VERSION`,
`supportsVersion`, `isAssetRef` y `assetIdFromRef` mudados ahí y reexportados desde
`index.ts`, que se queda con los tipos y las implementaciones normativas),
`packages/renderer-web/src/envelope.ts` (dónde van los diagnósticos en web),
`packages/cli/src/export.ts` y el cliente de `preview-server.ts`.
Tests: `format/src/validate.test.ts` y `renderer-web/src/envelope.test.ts`.
