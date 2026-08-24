# Spec: lenguaje y forma del SDK de Godot — GDExtension en C++ como core compartido (2026-08-24, ZAB-134)

> Tarea Linear: [ZAB-134] — milestone **F11 — Godot SDK**, track G1.
> Alcance entregado: **solo documentación** — esta spec, la entrada del decision log,
> y la puesta al día de `project.md`, `roadmap.md` e `ir-context.md`. No toca código:
> el chasis lo construye G2, la retirada de Unity de la superficie pública es G17.

## Contexto y problema

Godot pasa a ser **el primer motor que renderiza** (decidido 2026-08-24; el batch de
Unity U1–U10 queda cancelado y `examples/unity-playground` ya se borró). Antes de
escribir una línea del SDK hay que decidir en qué se escribe, porque de esa elección
cuelga todo lo demás del milestone: en qué se testea, qué compila CI, a qué
plataformas llega y si Unreal reutiliza algo o vuelve a empezar.

**Lo que hay que portar, medido y no estimado.** El renderer web es la implementación
de referencia del modelo self-render:

| | líneas |
|---|---|
| `packages/renderer-web/src` sin tests | 12.250 |
| … de eso, específico del target web o del andamiaje (`gl.ts`, `harness.ts`, `golden.ts`, `perf/scenes.ts`) | 1.795 |
| `packages/format/src` sin tests (contrato + funciones normativas) | 2.171 |
| **lógica portable** | **≈ 12.600** |
| tests del renderer (no se portan: se reescriben, y el corpus los cubre) | 10.961 |

Y el contrato de fidelidad ya existe: `golden/` son **18 casos** `(envelope, data,
viewport, clock, pad)` con su `ViewSnapshot` de referencia. La pregunta "¿el port es
fiel?" tiene respuesta mecánica desde el primer día, sea cual sea el lenguaje.

El ticket propone tres opciones. La recomendación era **(a) GDExtension en C++, y ese
C++ ES el core compartido**, y es lo que se decide — pero tres de los datos con los
que llegaba el ticket estaban mal o desfasados, y dos de ellos apuntan en direcciones
contrarias. Se corrigen aquí antes de argumentar nada.

## Tres correcciones de partida

**1. GDExtension no se recompila por versión menor de Godot.** El ticket lo apuntaba
como contra de (a) ("Godot 4 exige recompilar la extensión por versión mayor de
`godot-cpp`"). Lo cierto desde **Godot 4.1** es que la compatibilidad binaria de
GDExtension es **hacia adelante dentro del 4.x**: una extensión compilada contra 4.4
corre en 4.5, 4.6 y 4.7 sin tocarla; lo que no funciona es al revés (una compilada
contra 4.7 no carga en 4.4), y lo que rompe de verdad es el salto de **major**. El
`.gdextension` declara ese suelo con `compatibility_minimum`. Las extensiones de
**4.0** sí son binariamente incompatibles con 4.1+, pero 4.0 está fuera de cualquier
mínimo razonable hoy. El contra, bien planteado, es mucho más pequeño de lo que
parecía — y es lo que hace que elegir mínimo sea una decisión barata (§ Decisión 3).

**2. El estable de hoy es 4.7.2** (18 de agosto de 2026), no 4.4. La propuesta de
mínimo del ticket es de hace año y medio. Sigue siendo la correcta, pero por un motivo
que hay que decir en voz alta y no por inercia.

**3. Las dos opciones vivas tienen un agujero de plataforma, y no es el mismo.** El
ticket cargaba las tintas contra (b) por consolas, y es verdad; lo que no decía es que
(a) también paga peaje, en **web**. Ninguna de las dos llega a todas partes:

| | (a) GDExtension C++ | (b) C# / .NET |
|---|---|---|
| Desktop (linux/macos/windows) | sí | sí |
| Android / iOS | sí (godot-cpp compila a ambos) | **experimental** en los dos, por documentación oficial |
| Web | **experimental**: exige export templates `dlink` y una cadena de Emscripten pinneada; Firefox pide 4.3+ | **no existe**: *"projects written in C# cannot be exported to the web platform"* |
| Consolas | vía porting house, con C++ que es exactamente lo que esperan | vía porting house, y W4 Games marca su soporte de C# como **beta** en Switch y Xbox Series X/S |

## Decisión 1: el SDK de Godot es una GDExtension en C++, y ese C++ ES el core compartido

`godot-cpp`, compilado como GDExtension. El C++ no es "el lenguaje del adaptador de
Godot": es **el core compartido** que 2026-07-06 dejó como decisión abierta —
tessellator + runtime de la IR — y `sdk/godot` es un adaptador fino encima.

**Esto cierra el abierto de 2026-07-06** ("cuándo extraer el teselador a un core C++
compartido vs. empezarlo dentro del SDK de Unity"). Y lo cierra por el único motivo
que hacía honesto cerrarlo: **es la primera vez que la extracción paga por sí sola**.
No se extrae por anticipación ni para tener un core bonito — se extrae porque el
primer motor que renderiza ya lo necesita, y escribirlo dentro del adaptador sería
escribirlo dos veces.

Cuatro razones, con el criterio de siempre (*¿aguanta en Godot, Unreal y consolas?*):

1. **Corre en todo lo que corre Godot, consolas incluidas.** Los ports de consola de
   Godot son C++ y los hacen porting houses aprobadas; un `.so`/`.a` nuestro compilado
   con su toolchain es trabajo que ya saben hacer. No es gratis —una GDExtension añade
   complejidad a un port, y hay que decirlo—, pero es la clase de complejidad que un
   porting house cobra y resuelve, no un "no soportado".
2. **`stb_truetype.h` entra tal cual.** El rasterizador core-owned de 2026-08-11 ya se
   eligió porque es C de dominio público. En C++ es un `#include`; en C# es un port
   (StbTrueTypeSharp) que hay que confiar en que produzca **los mismos bitmaps**, que
   es justo la divergencia silenciosa contra la que se decidió core-owned.
3. **Unreal reutiliza el core, no lo reescribe.** Es la única de las tres opciones que
   convierte el segundo motor en un adaptador y no en un tercer port de 12.600 líneas.
4. **El canvas del editor visual puede ser el mismo core en WASM.** Ya lo es a medias:
   `stb_truetype` corre hoy en el renderer web compilado a WASM. Un core C++ es el
   mismo camino, ensanchado.

**Los contras se aceptan enteros**, y son reales: toolchain nativa (SCons/CMake,
binarios por plataforma en CI, un `.gdextension` que mantener), C++ para un founder que
viene de JS, depuración más dura que un `console.log`, y el peaje de web del cuadro de
arriba. El mayor de todos no está en esa lista: **el port en sí**, 12.600 líneas de
lógica desde un lenguaje con GC a uno sin él, con el corpus golden como única red.

## Decisión 2: la frontera core/adaptador se define por una propiedad testeable

Dónde acaba el core no se decide por gusto arquitectónico. Se decide por esta frase, y
todo lo demás se deriva:

> **El core tiene que poder producir un `ViewSnapshot` completo sin motor alguno.**

De ahí sale el reparto entero, sin discutir caso por caso:

| Vive en `core/` (C++) | Vive en `sdk/godot` (adaptador) |
|---|---|
| Parseo y validación del envelope (la política de ZAB-37) | Cargar el `.tres`/fichero y dárselo al core |
| Layout (el subset Yoga, `wrap` incluido) | — |
| Texto: `stb_truetype`, atlas, kerning, wrap, medida | Subir el atlas como `Texture2D` |
| Teselado: perímetros, bordes inset, clip, UVs | `canvas_item_add_triangle_array` por batch |
| Estados, focus espacial, hit-testing, `disabled` heredado | Traducir `InputEvent` a las intenciones del core |
| Bindings r/w, `Repeat`, virtualización, canal de host | Exponer señales de Godot para acciones y datos |
| Transiciones, presencia de overlays, relojes | Darle el delta de tiempo |
| **`ViewSnapshot`** | — |

Es la misma regla de oro de siempre ("el core nunca sabe de ningún motor"), pero
convertida en algo que un test puede comprobar en vez de algo que hay que recordar. Y
es **lo que hace posible G3**: si el core produce snapshots sin motor, el corpus
`golden/` se puede correr contra un binario nativo en CI, en una CPU pelada, sin
descargar Godot y sin GPU. Cualquier trozo de lógica que se cuele en el adaptador se
cae de esa red automáticamente — y por eso la frontera se defiende sola.

## Decisión 3: mínimo **Godot 4.4**

`compatibility_minimum = 4.4`, y `godot-cpp` compilado contra esa API. Por la
corrección 1, eso significa que el addon carga en 4.4 y en **todas** las 4.x
posteriores, el 4.7.2 de hoy incluido.

El coste de elegir bajo es no poder usar API añadida después, y no necesitamos
ninguna: `canvas_item_add_triangle_array`, `Control`, `Input`, `ImageTexture` y el
ciclo de proceso son de siempre. Elegir alto no compraría nada y recortaría alcance,
así que la elección barata es la correcta. Subir el suelo más adelante es aditivo y
sin drama: se cambia una línea del `.gdextension` y se recompila.

Suelo duro: **4.0 queda fuera** por incompatibilidad binaria real, y 4.1–4.3 quedan
fuera por decisión, no por imposibilidad — no hay a quién servir ahí y cada versión
soportada es una fila más de matriz.

## Decisión 4: plataformas de v1

| Plataforma | v1 | Qué significa |
|---|---|---|
| Linux, macOS, Windows | **soportado** | CI compila, el corpus golden pasa, hay builds reales del playground |
| Android, iOS | **soportado** | CI compila; validación manual en un export real |
| Web | **experimental** | Compila a wasm y **carga en un export `dlink`**. No es criterio de salida de F11 |
| Consolas | **compila, no validado** | No tenemos SDK ni devkit. La afirmación es "el core es C++, que es lo que un porting house espera", nunca "soportado" |

Web se queda fuera del criterio de salida **a propósito**: GDExtension en web depende
de export templates con enlazado dinámico y de una versión concreta de Emscripten, y
atar el cierre de un milestone a esa cadena es atarlo a algo que no controlamos. Nada
de esto afecta al **preview** de `zabloo dev`, que es el renderer TS y no pasa por
Godot. Consecuencia para G15: en web el criterio es *carga*, no *soportado*.

## Decisión 5: layout del repo

```
ui/
├── core/                    el core compartido en C++ (layout · texto · teselado · runtime · snapshot)
│   ├── src/
│   ├── tests/               runner nativo contra golden/, sin Godot
│   └── SConstruct
├── sdk/
│   └── godot/
│       └── addons/zabloo/   el addon instalable: .gdextension + binarios + scripts
├── examples/
│   └── godot-playground/    proyecto Godot que consume el addon localmente
├── packages/                el workspace pnpm (TS): format · react · cli · renderer-web · preview
└── golden/                  el corpus cross-target
```

`core/` va en la **raíz**, hermano de `sdk/`, `packages/` y `golden/`, y no dentro de
ninguno de ellos:

- **No en `packages/`** porque ahí `packages/*` significa *paquete del workspace pnpm*,
  y todos salvo `preview` se publican en npm. Un árbol de C++ con SCons dentro obliga
  a excluirlo del workspace y rompe esa lectura para siempre.
- **No en `sdk/`** porque difumina justo la frontera que la regla de oro protege: los
  `sdk/*` saben de su motor, el core no sabe de ninguno. Que estén al mismo nivel es
  la lectura correcta del reparto: `core/` es el productor, `sdk/godot` un consumidor.

## Decisión 6: toolchain, CI, y cómo se testea el core sin Godot

**Build:** SCons, que es lo que usa `godot-cpp` y lo que su documentación asume.

**Matriz mínima de CI:**

| Job | Qué hace |
|---|---|
| `core-tests` (linux) | Compila el core **solo** (sin `godot-cpp`) y corre el runner contra `golden/`. Es el job que tiene que ser rápido: es el que falla en cada PR |
| `build` × {linux, macos, windows} | Compila la GDExtension y sube el artefacto |
| `build-mobile` × {android, ios} | Compila; no ejecuta |
| `build-web` | Compila a wasm; no ejecuta. Se le permite fallar sin bloquear, hasta que la cadena `dlink` sea estable |

**El runner del core no necesita Godot, y eso es la mitad del valor de la Decisión 2.**
Es un binario nativo que lee `golden/cases.json`, reproduce cada caso `(envelope, data,
viewport, clock, pad)` contra el core y emite el `ViewSnapshot` en JSON, que se compara
con `golden/metrics/<caso>.json`. Sin motor, sin GPU, sin descargar un editor: el
mismo trato que hoy tiene el renderer web, que corre el corpus en una CPU pelada.

Lo que **sí** necesita Godot es la otra mitad —que el adaptador suba la geometría, que
el input llegue, que un export real arranque—, y eso son builds manuales del
`godot-playground` y lo que valide G15. La división es deliberada: el contrato se
verifica en cada PR, la integración con el motor a mano y en las fronteras.

## Decisión 7: qué pasa con Unity, y con `--unity`

- **`sdk/unity` se borra**, en **G17** (ZAB-150), junto con el barrido de las docs
  públicas — para que el repo no quede a medias: un PR que borre el SDK dejaría a
  `README.md` y `docs/getting-started.md` citando un directorio inexistente. El código
  vive en el historial, como `examples/unity-playground` (borrado en `b996877`).
- **Unity volverá**, y volverá como **adaptador fino del core C++** vía plugin nativo,
  no como el port a C# que planeaba el batch cancelado. Las ~1.700 líneas de C# que hay
  hoy (loader, layout, teselador, atlas) no se rescatan: son la mitad de un port a un
  lenguaje que ya no es el camino, y cubren 4 de 13 tipos.
- **`zabloo dev --unity` se queda hasta que exista `--godot`** (G14), y entonces se va
  con él. Quitarlo antes deja la CLI sin ninguna bandera de motor durante todo el
  milestone, que es peor que una bandera que apunta a un SDK congelado.

## Decisión 8: distribución del addon

**v1 = zip por release**, adjunto a la GitHub Release del tag, con el `.gdextension` y
los binarios de la matriz dentro; se descomprime en `addons/` del proyecto. Es lo que
ya sabemos hacer (el pipeline de releases existe desde F9) y no pide infraestructura
nueva.

**Asset Library de Godot, después** — cuando haya algo que enseñar, no antes: una
entrada en la Asset Library es una puerta de entrada pública, y la primera impresión
del primer motor no debería ser un addon a medio catálogo. Se implementa en **G17**;
aquí solo se decide.

**Lo que NO se hace: npm.** El addon no es un paquete npm y no entra en el grupo
`fixed` de versiones de 2026-08-22. Es un artefacto de otra plataforma, con su propio
ciclo (`compatibility_minimum`, binarios por SO) y su propia audiencia.

## Alternativas descartadas

### (b) C# (.NET) en Godot

Era el camino cómodo: lenguaje cercano, tooling bueno, y rescataba el C# que ya existe
en `sdk/unity`. Se descarta por dos motivos que se refuerzan.

**El primero es de producto, y es el que decide.** El modelo self-render existe, entre
otras cosas, **porque las consolas no tienen Chromium** (2026-07-06). Es el argumento
que descartó incrustar un navegador y el que sostiene el pitch entero. Elegir el
runtime cuyo soporte de consola es *beta, de un solo proveedor, y de pago* es cambiar
ese argumento por una nota al pie. Y no hay export web en absoluto — la documentación
oficial del estable de hoy lo dice literal.

**El segundo es de arquitectura:** no adelanta nada. Unreal tendría que empezar de
cero, el core compartido seguiría siendo una decisión abierta, y el rasterizador
core-owned dependería de que un port de C# produzca los mismos bitmaps que el C
original — exactamente la divergencia silenciosa que 2026-08-11 quiso eliminar.

El rescate del C# existente, además, resulta ser pequeño: 4 de 13 tipos, y las piezas
que se salvarían (layout, teselado) son justo las que el corpus golden verifica bien
en cualquier lenguaje.

### (c) GDScript

Se descarta sin pena, y conviene dejar escrito por qué para que nadie lo reabra:

1. **Es un intérprete corriendo el bucle caliente.** El layout, el teselado y el paso
   de resolve corren **por frame** sobre cada nodo; ZAB-55 y ZAB-73 dejaron los
   presupuestos del renderer web en fracciones de milisegundo tras dos pasadas de
   optimización sobre un JIT. La misma carga en GDScript es de otro orden.
2. **No hay stb.** Sin FFI, el rasterizador core-owned no existe, y con él se cae el
   texto pixel-idéntico entre targets — un requisito estructural, no un lujo.
3. **No es compartible.** Es el único de los tres que no le sirve a ningún otro motor.

Lo que GDScript sí es: el lenguaje razonable para los **scripts de conveniencia del
addon** (el panel del editor, el dev mode), donde no hay bucle caliente.

## Lo que esta tarea NO cierra

- **Cómo se organiza el core por dentro** (módulos, gestión de memoria, si hay una capa
  de plataforma) — es G2, y se decide compilando.
- **El estándar de C++ y las dependencias** (más allá de `stb_truetype.h`) — G2.
- **La retirada de Unity de la superficie pública** y el borrado de `sdk/unity` — G17.
- **`zabloo dev --godot`** y el protocolo del dev mode — G14.
- **La versión exacta de `godot-cpp`** dentro de la rama 4.4 — la fija el primer build.

## Fuentes

- Godot docs (estable 4.7), C#/.NET: plataformas soportadas y limitaciones de web,
  Android e iOS — <https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/index.html>
- Godot Engine, Console Support: la Fundación no mantiene ports de consola; van por
  terceros aprobados — <https://godotengine.org/consoles/>
- `godot-cpp`: bindings C++ y build con SCons — <https://github.com/godotengine/godot-cpp>
- Compatibilidad binaria de GDExtension dentro del 4.x y `compatibility_minimum`
- Godot 4.7.2, descarga del estable (18 de agosto de 2026) — <https://godotengine.org/download/>
