# Spec: el chasis del core C++ y el adaptador de Godot (2026-08-24, ZAB-135)

> Tarea Linear: [ZAB-135] — milestone **F11 — Godot SDK**, track G2.
> Cierra los dos abiertos que G1 (ZAB-134) dejó explícitamente para aquí: **cómo
> se organiza el core por dentro** y **el estándar de C++ y sus dependencias**.
> Alcance: `core/`, `sdk/godot/`, `examples/godot-playground/` y el CI. El motor
> de texto es G4, el clip y el scroll G6, el foco y los bindings G7.

## Lo que G1 dejó decidido, y lo que faltaba

G1 fijó el lenguaje (GDExtension en C++ que **es** el core compartido), la
frontera (*el core produce un `ViewSnapshot` sin motor alguno*), el mínimo 4.4,
las plataformas, la raíz de `core/` y SCons. Lo que no fijó —a propósito, porque
"se decide compilando"— es el interior: qué módulos, qué modelo de memoria, qué
dependencias y qué forma tiene la API que ve el juego.

## Decisión 1: C++17 y **cero dependencias de terceros**

C++17 porque es lo que pide `godot-cpp` en la rama 4.4, y no hace falta más.

Cero dependencias es la decisión de verdad, y va contra el instinto: lo cómodo
era vendorear `nlohmann/json` y `doctest`, dos headers MIT que habrían ahorrado
un día. Se descarta por dos motivos que apuntan al mismo sitio.

**El parser JSON es nuestro porque la política de carga es nuestra.** ZAB-37 no
pide "parsear JSON": pide rutas de diagnóstico exactas
(`views["hud"].children[2].text`), un tope de profundidad que responde en vez de
desbordar la pila, y **ninguna excepción** — un payload roto es una respuesta
ordinaria, no un caso excepcional. Con una librería, cada una de esas tres cosas
es un mapeo desde su modelo de errores al nuestro, y el mapeo es justo donde la
paridad con `@zabloo/format` se pierde en silencio.

**El harness de tests es nuestro porque `core-tests` es el job que falla en cada
PR.** Es el bucle de feedback más rápido del milestone y un header de 10k líneas
en cada TU es un impuesto sobre él. Lo que un test necesita —declarar un caso,
comparar dos valores, decir dónde rompió— cabe en 120 líneas.

**Coste aceptado:** ~500 líneas más de código propio, que hay que testear (y se
testean: el parser tiene su suite, incluidos los `🌐` y el JSON hostil).

### Dos hallazgos de la máquina que cambian el código, no solo el build

1. **`std::from_chars` para `double` está marcado *unavailable* por debajo de
   macOS 26** en la libc++ de Apple. Usarlo habría atado el deployment target de
   todos los builds de macOS a un detalle del parseo de números.
2. **`strtod` lee el separador decimal del locale.** Un juego que fija un locale
   español o alemán parsearía `"0.5"` como `0`, en silencio, y todas las métricas
   aguas abajo saldrían mal sin que ningún test de aquí lo notara.

Así que la conversión se escribe a mano: mantisa en `uint64_t`, exponente
decimal, y una multiplicación o división por una de las 23 potencias de diez que
son exactamente representables — correctamente redondeado para todo lo que un
envelope lleva de verdad (`16`, `0.35`, `1.5`), degradando en precisión y no en
fallo fuera de ese rango. La gramática de JSON es fija y sin locale; la
conversión también.

**Corolario:** un número con **cero a la izquierda se rechaza**. Ser indulgente
ahí significaría aceptar un payload que el renderer web rechaza, y que los dos
targets difieran en qué carga es exactamente lo que el corpus existe para impedir.

## Decisión 2: el modelo IR es **tipado**, no un DOM

`validate.cpp` no repara un árbol JSON y lo devuelve: construye structs (`Node`,
`Layout`, `Style`, `Bindable<T>`, `Dim`, `ColorValue`). El runtime trabaja sobre
ellos, sin búsquedas por string por frame.

Consecuencia que hay que decir en voz alta: **las props desconocidas se
descartan** en vez de conservarse como hace el envelope reparado de TS. Nadie las
lee — el core no reserializa — y la forward-tolerance que importa (pasar en
silencio, sin diagnóstico) se conserva intacta.

Y una que se deriva de "formas, nunca vocabularios": un miembro desconocido de un
set cerrado (`axis: "diagonal"`) **carga limpio** y cae al default **al leerlo**,
no al validarlo. En el modelo tipado eso significa mapear a enum en el parseo con
fallback; el resultado observable es idéntico y no hay diagnóstico, que es la
regla.

`Node` es **un struct plano con las props de los 13 tipos encima**, no una
jerarquía. La referencia lee un objeto JS igual de plano, layout y paint hacen
`switch` sobre `type` y no sobre una clase, y la alternativa —un `variant` o una
vtable— compra seguridad de tipos que el JSON nunca tuvo a cambio de un cast en
cada uso. Se paga en bytes por nodo, que es lo más barato del fichero.

## Decisión 3: contenido y runtime son árboles separados

`Node` (contenido, inmutable) y `LayoutNode` (runtime: rects, estados,
`resolved`, scratch) son dos árboles, y `View` posee el segundo apuntando al
primero. Es lo que hace que un hot-update sea **cambiar uno y no los dos**, y lo
que permite que el mismo envelope se renderice dos veces sin interferencia.

De ahí una regla de vida que costó un bug: **`View` no se puede mover** (guarda
punteros `parent` dentro de sus propios vectores de hijos) y **el `Envelope` vive
detrás de un puntero** en el `Document`, para que su dirección sobreviva a mover
el documento. En `load`, la vista se destruye **antes** que el envelope que
estaba leyendo.

**Alocación:** el scratch del pase (qué hijos fluyen, cuánto mide cada item,
dónde rompen las líneas) vive **en el nodo** y solo se limpia, así que un
relayout en régimen estacionario no aloca. Igual el `GeometryBuilder`, que se
`reset()`ea conservando capacidad.

## Decisión 4: los batches salen en arrays separados

`Batch` lleva `positions`, `uvs`, `colors` e `indices` por separado, y no
entrelazados como los empaqueta el renderer web para un buffer de GL. Es la forma
que pide la API inmediata de cualquier motor —Godot toma cuatro arrays
empaquetados—, así que entrelazar aquí sería desentrelazar en el adaptador.

## Decisión 5: `Text` mide **0 × lineHeight** hasta G4

No es un placeholder arbitrario: es **exactamente lo que la referencia hace con
un string vacío** (ZAB-65). La etiqueta conserva su hueco y sus gaps, la fila no
se re-espacia, y cuando lleguen los glifos la caja crece **a lo ancho** sin que
nada salte de línea. Un stub que inventara anchuras plausibles produciría rects
que parecen correctos y no lo son, que es peor que un cero honesto.

## Decisión 6: el nodo de Godot **es** el handle estable

En Unity el `ZablooDocument` era un objeto aparte porque las vistas eran
desechables. En Godot el `Control` vive en el árbol de escena, así que **`ZablooView`
es el handle**: posee el `zabloo::Document`, y la caché de `set_data` vive ahí, de
modo que los datos que el juego empujó **sobreviven a un cambio de contenido** sin
API nueva. Un solo camino de carga (`load_envelope`) para import manual, dev push
y hot-update.

La superficie que ve el juego es deliberadamente pequeña, porque es la de v1
entera: **acciones con nombre hacia fuera** (señal `action(name, context)`) y
**datos hacia dentro** (`set_data`). El `context` viaja vacío hasta que G12 dé a
una acción nacida dentro de un `Repeat` su path, key e índice.

**El layout de Godot no se usa.** `ZablooView` es un `Control` por su input y su
rect; todos los rects de dentro los calcula nuestro pase flex. Anchors y
Containers serían un segundo sistema de layout discrepando con el que corre en
todos los demás targets.

## Decisión 7: el addon llega al playground **por copia**

`scons install` en `sdk/godot` copia `addons/zabloo/` dentro del proyecto del
playground, que lo tiene gitignoreado. Es el mismo movimiento que descomprimir un
zip de release (G1, Decisión 8), así que el playground consume el addon como lo
hará un juego.

Descartado un **symlink** committeado (Git en Windows lo escribe como fichero de
texto si el usuario no tiene permiso, y entonces el proyecto no abre) y descartado
que el `.gdextension` apunte fuera del proyecto con `res://../` (Godot normaliza
y no deja escapar de la raíz del proyecto).

## Decisión 8: la matriz de CI que entra hoy

| Job | Qué hace |
|---|---|
| `core-tests` (linux) | Compila el core **solo**, con `werror`, y corre sus tests |
| `godot-extension` × {linux, macos, windows} | Compila la GDExtension y sube el artefacto |

`werror` solo en el primero: ese código es nuestro y se compila con un compilador
que elegimos. El segundo compila también `godot-cpp`, que no nos toca mantener
sin warnings.

**Móvil y web no entran todavía.** Compilar para Android/iOS pide NDK y SDK en el
runner, y web pide la cadena `dlink` de Emscripten que G1 dejó fuera del criterio
de salida a propósito. Los añade **G15 (ZAB-148)**, que es quien tiene "builds
reales" y quien puede verificar que lo que compila además arranca. Escribir hoy
YAML que no puedo ejecutar sería añadir jobs que nadie ha visto pasar.

## Lo que NO hace G2, y por qué se ve en el playground

El chasis renderiza `Container`, `Button` y el paint implícito, y lo demás
**degrada** en vez de desaparecer — la misma forward-tolerance que un juego
recibe de un SDK más viejo que su contenido:

| Degrada así | Lo cierra |
|---|---|
| `Text` sin glifos (mide una línea de alto, cero de ancho) | G4 (ZAB-137) |
| `Image` sin textura (pinta su fondo) | G5 (ZAB-138) |
| `ScrollView` sin recorte ni offset: el contenido desborda | G6 (ZAB-139) |
| Bindings que leen "sin valor"; `visible` bindeado empieza oculto | G7 (ZAB-140) |
| El foco se siembra con `autofocus` y no se mueve | G7 (ZAB-140) |
| `transition` ignorado: los cambios saltan | G8 (ZAB-141) |
| `Overlay` fuera del flujo pero sin capa propia | G9 (ZAB-142) |
| `Toggle`/`Slider`/`ProgressBar`/`Spinner` como contenedores | G10 (ZAB-143) |
| `Collapse` y `exclusive-select` muestran todas sus secciones | G10 (ZAB-143) |

## Cómo se comprueba

- **Paridad del loader:** un envelope hostil (`core/tests/fixtures/hostile.json`)
  pasado por `@zabloo/format` da 28 diagnósticos; el test afirma los **mismos
  códigos, las mismas rutas y el mismo orden**. Más los cuatro casos del criterio
  de salida cargando como declara `golden/cases.json`.
- **Paridad del layout:** `flex-layout` —el único caso del corpus sin `Text`— se
  compara **rect a rect** contra `golden/metrics/flex-layout.json`, sus 20 nodos.
- **Paridad del estilo:** `states-tokens` se compara contra los `style` grabados,
  que no dependen de las métricas de texto: tokens planos, orden de merge y
  opacidad por nodo, con `autofocus` poniendo el foco donde el corpus dice.
- **El motor:** a mano, en `examples/godot-playground`. Es la mitad que el corpus
  no cubre por diseño, y G15 la formaliza.
