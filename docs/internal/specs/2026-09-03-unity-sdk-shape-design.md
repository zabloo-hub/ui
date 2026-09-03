# Spec: la forma del SDK de Unity — plugin nativo tras un C ABI, render por UGUI (2026-09-03, ZAB-194)

> Tarea Linear: [ZAB-194] — milestone **F12 — Unity SDK**, track UN1.
> Alcance entregado: **solo documentación** — esta spec, la entrada del decision log y la
> columna Unity de la tabla cross-engine de `ir-context.md`. No toca código: el ABI lo
> escribe UN2 (ZAB-195), el chasis del paquete UN3 (ZAB-196), y las docs públicas UN11
> (ZAB-204). El mapa de la fase —lo que Godot enseñó y los once tickets— está en
> `plans/2026-09-03-unity-sdk-f12.md`.

## Contexto y problema

Unity vuelve. Se fue el 2026-08-24, cuando el port a C# se canceló a 4 de 13 tipos y Godot
pasó a ser el primer motor que renderiza; y la misma decisión dejó escrito **cómo** volvería:
*"como adaptador fino del core C++ vía plugin nativo, no como el port a C# que planeaba el
batch cancelado"*. El 2026-09-03 se le puso fecha —F12, delante de Unreal— porque la
versión que se publica al cerrar tiene que controlar los tres motores más web.

Lo que esta spec decide es distinto de lo que decidió la de G1. Allí la pregunta era
**en qué se escribe** el SDK, y de la respuesta colgaba todo el milestone. Aquí eso ya
está contestado: el core es C++ y no se reescribe; el adaptador es C# porque en Unity la
mitad que sabe del motor solo puede ser C#. La pregunta de F12 es **la forma del puente**
entre los dos, y con ella cuatro decisiones de motor que en Godot no existieron:

| | Godot (F11) | Unity (F12) |
|---|---|---|
| Lenguaje del adaptador | C++, el mismo del core | **C#**, con un puente por medio |
| Cómo entra el core | GDExtension: el core *es* la extensión | **plugin nativo** (`libzabloo` por plataforma) |
| Cómo llegan los triángulos | `canvas_item_add_triangle_array` | a decidir: UGUI, UI Toolkit, o la cámara |
| Cómo llega el input | `InputEvent`, un solo sistema | a decidir: Input Manager clásico o Input System |
| Cómo se distribuye | zip del addon | a decidir: UPM por git, por `.tgz`, por registry |
| Qué runtime corre el C# | — | Mono en el editor, **IL2CPP** en móvil y consola |

Y una diferencia de riesgo que ordena la fase entera. En Godot el riesgo era el port
(12.600 líneas de un lenguaje con GC a uno sin él) y la red fue el corpus golden corriendo
contra el core sin motor. En Unity el core ya reproduce el corpus byte a byte; **lo que
nadie ha ejercitado es la frontera** — un interop que funciona en Mono dentro del editor
y se cae en AOT es exactamente el fallo que no se ve hasta el build de consola. Por eso el
corpus corre aquí **dos veces más**: por el C ABI en CI desde el primer ticket (UN2), y
dentro de Unity a través de `ZablooView` (UN10). Si el mismo envelope da otra métrica al
cruzar la frontera, el culpable está en el puente y no en el core.

Las seis decisiones de abajo se tomaron al planificar; esta spec las argumenta con
alternativas y coste, para que UN2 y UN3 lean de un sitio y no de una conversación.

## Tres correcciones de partida

Como en G1, tres datos con los que llegaba el planteamiento estaban desfasados o eran
menos simples de lo que parecían. Se corrigen antes de argumentar, porque cambian la
forma del argumento aunque no cambien la decisión.

**1. Unity 2022.3 LTS lleva fuera de soporte desde mayo de 2025.** Salió el 30 de mayo de
2023; el soporte estándar de un LTS son dos años y venció el 7 de mayo de 2025, y el año
extra de Enterprise/Industry ha vencido también a fecha de hoy. "2022.3 LTS mínimo" no es,
por tanto, "el LTS anterior": es un editor que Unity ya no parchea. La decisión se
sostiene igual (§ Decisión 3), pero por un motivo que hay que decir en voz alta —los
proyectos en producción viven años en el LTS en el que arrancaron, y el propio Input
System fija ese mismo suelo—, y no por inercia. El "probado en Unity 6" pasa a nombrar
versiones concretas: **Unity 6.0 LTS** (6000.0, soporte hasta octubre de 2026) y **Unity
6.3 LTS** (6000.3, hasta diciembre de 2027). El estable de hoy es Unity 6.6 (6000.6, 31 de
agosto de 2026), que no es LTS.

**2. UI Toolkit sí tiene shader propio desde Unity 6.3.** El planteamiento descartaba UI
Toolkit por "sin shader propio". Es cierto en nuestro mínimo (2022.3) y deja de serlo en
6.3+, donde **UI Shader Graph** permite shaders de usuario sobre elementos de UI Toolkit.
El argumento que sobrevive es el otro, y es el que decide (§ Alternativas): su **atlas
dinámico** re-empaqueta nuestras texturas por su cuenta y su **batcher** re-agrupa la
geometría por la suya, así que la propiedad "un draw call por batch del core" deja de
poder afirmarse — con o sin shader.

**3. El Canvas de UGUI también batchea.** "El número de draw calls sigue siendo el
nuestro" es verdad en Godot (el motor añadió exactamente uno, medido en G15) y **casi**
verdad en UGUI: el Canvas fusiona `CanvasRenderer`s que comparten material y textura
cuando el orden de dibujo lo permite. Con un material por grupo de clip y grupos sin
recorte compartiendo material, dos grupos consecutivos sin recorte pueden salir en un
solo draw call. La frase honesta es **"nuestro recuento es la cota superior"**: el Canvas
puede fusionar hacia abajo y nunca partir hacia arriba, porque un `CanvasRenderer` con
un submesh por batch ya es la unidad mínima que él entiende. Lo verifica UN4 con el
Frame Debugger, igual que G15 lo verificó con `RenderingServer.get_rendering_info`.

## Decisión 1: Unity es un adaptador fino sobre el core C++, detrás de un C ABI

El core entra en Unity como **plugin nativo** —`libzabloo`, un binario por plataforma en
`Runtime/Plugins/`— y `sdk/unity` es **solo C#**: subir triángulos, traducir input, exponer
acciones y datos. Entre los dos, una cabecera **C** (`core/capi/zabloo.h`, C11,
`extern "C"`), que es la segunda puerta del core: Godot y Unreal entran por C++; Unity —y
cualquier cosa con FFI, incluido el canvas WASM del editor visual algún día— entra por C.

**La forma del puente**, que es lo que aquí se fija (el contrato función a función lo
escribe UN2):

1. **Handles opacos** (`zb_document*`, `zb_view*`, `zb_pad*`). Nunca cruza un tipo C++ ni
   un `std::string`; los strings son UTF-8 con longitud explícita.
2. **Sin excepciones por la frontera.** Un payload roto es una respuesta ordinaria del
   core desde G2 (ZAB-135), así que no hay nada que traducir; los `bool` del canal de host
   vuelven como `int`.
3. **Un hilo.** Todo se llama desde el hilo que creó el documento. Unity ya impone que la
   API del motor se use desde el hilo principal, y un core sin locks es un core que el
   corpus puede reproducir determinísticamente.
4. **Valores como JSON en las dos direcciones.** `set_data_json(doc, path, json)` hacia
   dentro, y los `DataChange` drenados llevan `value_json` hacia fuera. Una sola regla de
   marshalling para bool/number/string/array/object, en vez de una API de acceso tipo
   visitor de ~20 funciones. El core ya **lee** JSON (el lector del envelope) y ya escribe
   números sin locale (`snapshot_number`, G3); lo que falta es un escritor pequeño de
   `DataValue` que vive en `capi/` y no en `core/src`, que se queda sin escritor a propósito
   (G14).
5. **Ningún callback nativo→managed: todo se drena.** Acciones, escrituras de datos y
   diagnósticos se leen **después** del frame, con `drain_actions` / `drain_data_changes`
   — que es exactamente lo que el adaptador de Godot ya hace (`flush_events`), y por el
   mismo motivo de allí más uno nuevo. El de allí: un handler que corre a mitad de una
   pasada de layout, o un juego que re-entra desde uno, encuentra la vista a medias. El
   nuevo: es lo que hace el puente **AOT-safe** bajo IL2CPP (§ Alternativas).
6. **Vida de los punteros escrita función a función.** Lo que devuelve `paint` vale hasta
   el siguiente `paint`; los píxeles de un atlas hasta el siguiente `layout_frame`; los
   strings de diagnóstico hasta el siguiente `load`. Es lo que permite a C# leer los
   arrays del core como `NativeArray` **sin copiar** (§ Decisión 2).
7. **El ABI envuelve, no edita.** Si un wrapper necesita algo que `view.h` no expone, es un
   PR pequeño y separado al core, no un parche dentro de `capi/`. Y como el corpus corre
   por la cabecera sola (`test_capi.cpp`, compilado como C), la cabecera no puede dejar
   de ser C sin que CI lo diga.

**Por qué esta forma y no otra.** El criterio es el de siempre —*¿aguanta en móvil y
consola?*— leído para C#: en Unity eso significa **IL2CPP**, el backend AOT que compila el
C# a C++ y es lo que corre en iOS, en Android por defecto y en todas las consolas. Bajo
IL2CPP, un delegado marshalado a puntero de función tiene que ser un método **estático**
con `[MonoPInvokeCallback]`, no puede cerrar sobre estado, y un olvido no es un error de
compilación sino un crash en runtime — en el dispositivo, no en el editor, donde Mono lo
perdona todo. Un puente que **no tiene** callbacks no tiene esa clase de fallo: solo
llamadas managed→native con structs blittables, que es el subconjunto de P/Invoke que
IL2CPP compila sin ambigüedad. Y el drenado ya era la forma correcta en Godot por razones
de reentrada; que además sea la forma AOT-safe es la clase de coincidencia que dice que
la arquitectura estaba bien planteada.

**Coste aceptado:** una cabecera C que mantener espejo a espejo con `view.h` (~60
funciones) y con `NativeMethods.cs` (una transcripción `[DllImport]` campo a campo), un
escritor de JSON en `capi/`, y un test de `sizeof` por struct entre C y C# para cazar un
campo desalineado antes que ningún caso del corpus. Es el precio de tener **una** frontera
en vez de tres: la misma cabecera vale para Unity, para el WASM del editor y para
cualquier lenguaje con FFI.

## Decisión 2: render por UGUI — `Canvas` + un `CanvasRenderer` por grupo de clip + shader propio

La geometría llega al motor por **UGUI**: un `Canvas` del proyecto, y bajo el
`RectTransform` de la vista un `GameObject` hijo con `CanvasRenderer` **por grupo de
clip**, pooleados y reutilizados entre frames, cada uno con un `Mesh` de **un submesh por
batch** y `SetMaterial(mat, i)`. Es la forma UGUI de "un draw por batch", y la traducción
literal del adaptador de Godot: donde allí hay un canvas item hijo por grupo con
`canvas_item_set_clip` + un `ShaderMaterial` para las esquinas (G6), aquí hay un
`CanvasRenderer` por grupo y un shader propio.

**Tres piezas, y por qué cada una:**

1. **`CanvasRenderer.SetMesh` es exactamente "aquí tienes triángulos, dibújalos".** Existe
   desde que existe uGUI (4.6) y no interpreta nada: ni layout, ni texto, ni atlas. Los
   vértices entran con `Mesh.SetVertexBufferData` desde `NativeArray`s que son **vistas**
   sobre los punteros del core (`ConvertExistingDataToNativeArray`), con un layout de
   vértice que calca los arrays del core —posición, uv, color en streams separados—, así
   que en régimen estacionario no hay copia managed ni alocación. El eje Y se voltea en la
   **transform** del hijo, nunca por vértice: el core habla Y-abajo y el Canvas Y-arriba, y
   un flip por vértice sería una copia.
2. **Un shader propio (`Zabloo/Canvas`) es lo que permite portar el recorte y el atlas sin
   reinterpretar nada.** Dos uniforms de clip por material —`_ClipRect` y `_ClipRadius`—
   con el SDF de rounded box difuminado sobre `fwidth` copiado de ZAB-7 y de Godot, y un
   `_TextureKind` que dice si la textura es el atlas de un canal (se muestrea la cobertura
   y el RGB es blanco), una imagen, o nada. Sin `RectMask2D` ni stencil: el SDF corta el
   rect exacto cuando `radius = 0`, y son ocho líneas de shader contra un buffer, geometría
   de máscara y una máquina de estados por nivel de anidamiento — el mismo argumento con el
   que ZAB-7 descartó el stencil en web.
3. **El Canvas da lo que cualquier proyecto de UI ya tiene** y que un `MeshRenderer` en
   cámara habría que reconstruir: escalado por `CanvasScaler`, sorting entre canvases,
   integración con el `EventSystem` para *no* pelearse con el resto de la UI del juego, y
   los dos modos —Screen Space-Overlay y Screen Space-Camera— que un HUD y un menú piden.

**Lo que sigue siendo del core, sin excepción:** layout, texto, teselado, clip, estados,
foco. El `RectTransform` de Unity se usa **solo en la raíz** (el rect de la vista y el flip
de Y); ningún nodo de la IR es un `GameObject`. TextMeshPro no se usa para nada: los glifos
salen del rasterizador del core sobre la TTF empotrada, en un atlas de un canal (`R8`, o
`Alpha8` donde `R8` no esté soportado, decidido una vez al arrancar). Es la misma regla que
en Godot hizo que ni los anchors ni el `TextServer` se tocaran, y por el mismo motivo: un
segundo layout o un segundo texto es un segundo resultado.

**Coste aceptado:** un `GameObject` por grupo de clip (decenas, no miles: un grupo es un
scroller o una raíz de pintado, no un nodo), un material pooleado por grupo (un
`MaterialPropertyBlock` no sirve: `CanvasRenderer` no lo acepta), y la corrección 3 de
arriba: el recuento de draw calls es una cota superior, no una igualdad.

## Decisión 3: mínimo Unity 2022.3 LTS, probado en Unity 6.0 LTS y 6.3 LTS

`"unity": "2022.3"` en `package.json`. El adaptador no usa nada posterior a **2019**:
P/Invoke, `NativeArray` (2018.1), `Mesh.SetVertexBufferData` (2019.3),
`CanvasRenderer.SetMesh` (4.6). Es el criterio de "Godot 4.4 mínimo": el mínimo que
**necesitamos**, no el estable de hoy. Elegir alto no compraría ninguna API y recortaría
alcance; elegir más bajo que 2022.3 añadiría filas de matriz para editores que nadie
arranca ya.

**Por qué 2022.3 y no un Unity 6, con la corrección 1 encima de la mesa.** Un LTS fuera
de soporte no es un LTS fuera de uso: un juego que arrancó en 2023 vive en 2022.3 hasta
que shippea, porque migrar de major a mitad de producción es un riesgo que ningún estudio
asume por un SDK de UI. Y hay un segundo motivo que convierte 2022.3 en el suelo natural y
no en una elección nuestra: el **Input System 1.17+ dejó de soportar nada anterior a
2022.3** — el paquete del que dependemos (§ Decisión 4) ya ha fijado ese mismo mínimo.
Bajar más sería soportar un editor que nuestra propia dependencia no soporta.

**Qué significa "probado en":** el playground abre en 2022.3 **y** en Unity 6 sin cambios
(UN3), y los players IL2CPP de UN9 se hacen con un Unity 6 LTS. Un `#if UNITY_6000_0_OR_NEWER`
que apareciera en el adaptador sería una señal de que el mínimo se ha movido de facto y
hay que decidirlo, no un parche.

Suelo duro: **2021.3 y anteriores quedan fuera** por el Input System; **2022.3 queda dentro
sabiendo que Unity no lo parchea** — un bug del editor que solo afecte a 2022.3 se
documenta, no se rodea. Subir el suelo más adelante es aditivo: una línea en `package.json`.

## Decisión 4: el Input System es dependencia del paquete

`com.unity.inputsystem` en las `dependencies` de `com.zabloo.sdk`. Tres cosas que da y que
el Input Manager clásico no:

1. **Un `Gamepad` con mapeo estándar.** `Gamepad.current` viene con `buttonSouth`,
   `buttonEast`, `dpad`, `leftStick`, `rightStick` ya resueltos por dispositivo, así que un
   proyecto que conecta un mando tiene la UI navegable **sin configurar nada** — la
   propiedad que ZAB-47 fijó en web y G13 en Godot. El adaptador traduce esos nombres a los
   índices del mapeo W3C que hablan `gamepad.h` y el guion `pad` del corpus, a la entrada,
   igual que Godot traduce 11–14 → 12–15.
2. **`onTextInput` para el texto.** Un canvas recibe teclas, no texto; el texto tiene que
   entrar por el evento que lo produce, con las muertas y los modificadores ya dentro
   (G11). El Input System lo expone; el Input Manager obliga a reconstruirlo desde
   keycodes, que en un teclado español dicen otra cosa. Y `SetIMEEnabled` +
   `onIMECompositionChange` para la composición, con el mismo contrato que Godot: el motor
   da solo la cadena en composición, así que el core guarda la base.
3. **`InputTestFixture` para input sintético en tests.** Un `Gamepad` o un `Keyboard`
   falsos que el PlayMode conduce, así que "una pulsación = un paso, un segundo mantenido
   = 8" y "desenchufar a media pulsación cancela" se afirman en un test (UN6) y no en un
   procedimiento a mano. En Godot hubo que improvisarlo con escenas desechables.

**Coste aceptado:** el proyecto del usuario tiene que tener el Input System activo en
Player Settings (*Active Input Handling* = Input System o *Both*), que es una casilla y un
reinicio del editor, y va en el README y en `troubleshooting.md`. Y `ZablooView` **no es**
`Selectable`: si el proyecto navega su propia UI con el `EventSystem`, este no debe enviar
eventos de navegación mientras la vista es dueña del teclado, o las flechas se las come
antes — el mismo fenómeno que en Godot obligó a dejar la vista en `FOCUS_NONE`.

## Decisión 5: plataformas de v1, e IL2CPP como requisito

| Plataforma | Binario | v1 | Qué significa |
|---|---|---|---|
| macOS | `libzabloo.bundle` (universal x64 + arm64) | **soportado** | CI compila; el corpus pasa por el ABI y dentro de Unity; player IL2CPP real (UN9) |
| Windows x64 | `zabloo.dll` | **soportado** | CI compila; player IL2CPP real (UN9) |
| Linux x64 | `libzabloo.so` | **soportado** | CI compila; el editor y el corpus corren; player no ejecutado aquí |
| Android arm64-v8a | `libzabloo.so` (NDK) | **compila, no validado** | CI compila con el NDK del runner; ningún dispositivo |
| iOS arm64 | `libzabloo.a` **estática**, `DllImport("__Internal")` | **compila, no validado** | CI compila con el SDK de iOS; ningún dispositivo |
| Consolas | — | **compila, no validado** | No tenemos SDK ni devkit. El core es C++ y el puente es C sin callbacks, que es lo que un porting house espera; nunca "soportado" |
| WebGL | — | **fuera** | Ver abajo |

**Android e iOS van a la misma cesta que ZAB-193**: el addon de Godot tampoco se ha
ejecutado nunca en un teléfono, y la validación en dispositivo de los cuatro targets se
hace junta, con hardware delante, fuera del criterio de salida de la fase. Lo que sí es
criterio es que **compilen en CI**: una plataforma que nadie compila se pudre hasta el día
en que tiene que funcionar (G15, hallazgo 5), y en iOS la biblioteca es estática porque
Unity linka los plugins nativos de iOS dentro del binario de la app y el `DllImport` tiene
que nombrar `__Internal`.

**WebGL queda fuera, y no es la misma exclusión que en Godot.** Un plugin nativo para
WebGL se compila con Emscripten como `.a` de objetos wasm, y la versión de Emscripten
**tiene que coincidir** con la que trae el editor de Unity que hace el build — es
literalmente la cadena que dejó a Godot web en experimental (G15: un libc++ distinto
enlaza y aborta al cargar). En Godot al menos había un export `dlink` que probar; en Unity
sería mantener una fila de matriz por versión de editor para un target que no es criterio
de nada. Nada de esto afecta al preview de `zabloo dev`, que es el renderer TS.

**IL2CPP es requisito, no opción.** Es lo que corre en iOS, en Android por defecto y en
todas las consolas, así que el interop se valida **bajo IL2CPP** y no solo en Mono: un
player de macOS y otro de Windows con Scripting Backend = IL2CPP y stripping alto, sobre el
playground (UN9). Lo que ese player comprueba y queda escrito en el README del SDK: structs
blittables (`zb_abi_sizes` asertado), ningún `Marshal.GetDelegateForFunctionPointer` ni
callback, ninguna excepción cruzando, `link.xml` si el stripping se lleva algo de
`NativeMethods`, y que un `.a` de iOS dentro de `Plugins/` no rompe el build de desktop.
**Unity en CI no se hace**: necesita licencia en el runner, y se añade cuando compre algo
— el mismo argumento que el Asset Library de Godot. El README lo dice en vez de fingir
cobertura.

## Decisión 6: paquete UPM `com.zabloo.sdk`, versión del grupo `fixed`, `.tgz` en la Release

- **Nombre:** `com.zabloo.sdk`. Assembly definitions `Zabloo.Sdk` (runtime, con
  `allowUnsafeCode` para los punteros de los batches) y `Zabloo.Sdk.Editor`.
- **Versión = la del grupo `fixed` de npm** (`@zabloo/format` y compañía), estampada en
  `package.json` al empaquetar desde `packages/format/package.json`. Es la regla que G17
  fijó para el addon de Godot y vale aquí por el mismo motivo: el SDK y los paquetes se
  ponen de acuerdo en exactamente una cosa, **el formato**, y el transporte del dev loop
  es un segundo contrato entre las mismas dos mitades. Un número contesta "qué SDK va con
  los paquetes que instalé"; dos números son una tabla de compatibilidad para una pregunta
  con una sola respuesta. El ciclo sigue siendo propio: se publica cuando el SDK cambia, no
  en cada publish de npm.
- **Distribución: `.tgz` de UPM adjunto a la GitHub Release** `unity-sdk@<version>`, por
  `workflow_dispatch` con `dry-run` y `publish` idempotente (el espejo de
  `godot-addon.yml`). Un `.tgz` es lo que `Packages/manifest.json` acepta por `file:` y lo
  que el Package Manager instala con *Install package from tarball*; el script que lo monta
  lee la lista de binarios **de los `.meta` de `Plugins/`**, y un binario declarado y
  ausente es un error y no un tarball más pequeño — el criterio del `.gdextension` en G17.
- **Lo que no se hace:** **git URL** (exigiría committear los binarios por plataforma en el
  repo, y un `.bundle` universal son megabytes por release) y **OpenUPM**, que queda como
  paso documentado: un catálogo compra algo cuando hay algo que enseñar, y la primera
  entrada no debería ser un SDK a medio catálogo. Sale de UN11; aquí se decide.

## Decisión 7: la frontera core/adaptador, y por dónde corre el corpus

La regla de G1 no cambia — **el core tiene que poder producir un `ViewSnapshot` completo
sin motor alguno** — y el reparto tampoco: el adaptador de Godot mide ~1.400 líneas de
traducción, y el de Unity tiene que medir lo mismo más el binding. Lo que cambia es que
ahora hay **dos** fronteras en fila, y cada una tiene su red:

| Frontera | Quién la cruza | Dónde se comprueba | Qué caza |
|---|---|---|---|
| `core/src` → `core/capi` | la cabecera C | `test_capi.cpp` en CI (`capi-tests`), 17 casos byte a byte + `future-major` rechazado, **usando solo la cabecera** | un wrapper que cambia la respuesta: marshalling de datos, vida de punteros, locale |
| `core/capi` → `sdk/unity` | `NativeMethods.cs` y la fontanería del adaptador | `GoldenTests.cs` (PlayMode, UN10), los mismos casos desde dentro de Unity | el tamaño que se le da al core, el reloj, el escritor JSON de C#, la traducción de índices del pad |

Y la tabla de reparto, con las filas de Unity al lado de las de Godot para que se vea que
son la misma columna:

| Vive en `core/` | Vive en `sdk/godot` | Vive en `sdk/unity` |
|---|---|---|
| Parseo y validación, layout, texto, teselado, clip, estados, foco, bindings, `Repeat`, transiciones, overlays, el bucle del pad, `ViewSnapshot` | — | — |
| — | Cargar el fichero y dárselo al core | `Load(TextAsset)` y dárselo al core |
| — | `canvas_item_add_triangle_array` por batch | `CanvasRenderer.SetMesh`, un submesh por batch |
| — | `ImageTexture` desde el atlas LA8 / `Image.load_png_from_buffer` | `Texture2D` `R8` desde el atlas / `Texture2D.LoadImage` |
| — | `InputEvent` → intenciones del core | Input System → intenciones del core |
| — | Señales `action` / `data_changed` | `event`s de C# `OnAction` / `OnDataChanged` |
| — | Índices de `JoyButton` → mapeo W3C | `GamepadButton` → mapeo W3C |
| — | Un dueño del input por proceso (`input_owner.h`) | Un dueño del input por proceso (`InputOwner.cs`) |

Todo lo de la columna de Unity es **traducción**. Si algo más acaba en `sdk/unity`, se ha
caído de la red del corpus — y si Unity acaba pidiendo lógica que ya vive en el core, la
señal no es "Unity es raro" sino que la frontera se ha movido, y se arregla en el core
(2026-09-03, la apertura de F12/F13).

## Lo que Godot enseñó, y cómo se aplica

Diecisiete tickets de Godot dejaron un adaptador que reproduce el corpus byte a byte. El
plan de la fase lista los veintiún learnings con el ticket de Unity que recoge cada uno;
aquí se argumentan por bloques, porque varios son la misma decisión vista desde sitios
distintos.

**El pintado es contrato, no detalle de implementación** (G5, G6, G9, G11). Cuatro reglas
que el adaptador de Godot aprendió una a una y el de Unity hereda de golpe: el orden
dentro de un grupo es sólidos → imágenes → texto; los grupos van en orden de entrada y
nunca se re-entran; la identidad de una región de clip es su **ordinal** y no su rect
(dos raíces de pintado pueden compartir región y aun así tener que ordenarse una detrás
de otra, y un adaptador que agrupe comparando rects fusiona en silencio lo que no debe);
y **se tesela antes de subir el atlas**, porque un `TextInput` mete sus glifos al pintar y
subir antes deja esos glifos un frame tarde — para siempre en una pantalla quieta. En UGUI
las cuatro son: agrupar por el `group` del batch, un `CanvasRenderer` por grupo en orden
de hijos (el Canvas dibuja en orden de jerarquía), y `paint()` → barrido de atlas →
subida.

**Las texturas se cachean por contenido y se barren, no se notifican** (G4, G5). Atlas
keyed por handle + `version`; imágenes por **hash** — un hot-update reconstruye el
documento entero, así que toda dirección del core cambia, y sin embargo una imagen cuyos
bytes no cambiaron conserva su `Texture2D`. El adaptador barre la lista viva del core en
cada frame y lo que sobra se libera: un mecanismo contesta "¿ha crecido?" y "¿ya no
está?", y el core no necesita callback de evicción — que es además la única forma de que
lo tenga un core sin callbacks. Un decode fallido se recuerda y su batch se salta; queda
el `background` del nodo, que es el placeholder autorado de ZAB-13. El codec es del motor
(`Texture2D.LoadImage`): el core no lleva ninguno, y no por la regla de cero dependencias
sino porque los píxeles no entran en ninguna métrica.

**El tiempo es del core; el motor solo lo lee** (G8, G11, G13). El reloj se **inyecta**
(`set_now` con un monótono en ms) y el `deltaTime` se ignora: un frame perdido aterriza el
tween donde dice el reloj de pared. Los frames son bajo demanda por dos motivos distintos
—el movimiento se acaba solo, un mando conectado no, porque se consulta—, y aunque
`Update` corre siempre en Unity, el pipeline corre solo cuando `MarkDirty()` lo pidió,
`animating` es true o hay pad. El caret es un reloj de dos frames por periodo y un
**repaint sin pasada de layout**, con contador de generación para que un timer rancio no
haga nada. Y **todo se cuenta en `double` y sin locale**: el `printf`/`strtod` que G2/G3
evitaron en C++ es `CultureInfo.InvariantCulture` en C#, porque un juego corriendo en
español que escribiera `0,5` en un `set_data_json` dejaría de comparar en silencio.

**Los eventos se drenan después del frame, incluido uno de puro movimiento** (G7, G9). Un
`autoCloseMs` dispara **desde dentro** del pase de layout; en Godot el `_process` no
drenaba y las señales del toast llegaban con el siguiente input del jugador. UN7 lo hereda
resuelto: `Flush()` corre tras cada frame, venga de input o de motion. Y los diagnósticos
se reportan **tras el primer relayout**, porque el aviso de "ancla no focusable" necesita
la pasada de resolve.

**El input tiene un dueño, y el motor no debe adelantarse** (G7, G13, ZAB-70). Teclado y
pad son del **proceso**, el puntero es por vista por construcción; dueño = la primera
vista habilitada, tocar una se lo lleva, al deshabilitarse pasa a la más antigua. Y la
navegación de foco del motor se come las flechas antes de que la vista las vea: en Godot
`FOCUS_NONE`, en Unity `ZablooView` no es `Selectable` y el `EventSystem` no debe enviar
navegación. El `PadController` es **propiedad del adaptador y no de la vista**: todo su
estado es del dispositivo, y una vista es desechable — limpiarlo con ella haría que una A
mantenida se leyera como recién pulsada tras un hot-update y presionara lo que el árbol
nuevo tuviera enfocado. Desenchufar cancela una pulsación y asienta un slider, y "perder
el input" entra por la misma puerta que "perder el cable". `settle_slider_keys` lo dice el
adaptador en el key up, porque al core solo se le cuentan pulsaciones y el `onCommit`
pertenece al final del gesto.

**El texto entra por el evento que produce texto** (G11): `onTextInput`, no keycodes; se
descartan los controles y todo lo que va con Ctrl/Cmd, un Alt suelto no; el portapapeles
es del motor y el pegado vuelve por `insert_text` para que `maxLength` y la regla de una
línea se apliquen como a una tecla; y en IME el core guarda la base porque el motor da
solo la cadena en composición.

**Las constantes que la referencia no puede entregar se fijan y se escriben** (G6). La
rueda del Input System llega en unidades que cambian por plataforma (±120 por muesca en
Windows, píxeles en macOS); se normaliza a **50 px por muesca**, la constante de Godot, y
los ejes siguen 1:1 con la referencia — el hueco (a) de ZAB-9 (un scroller solo horizontal
no se mueve con la rueda de un ratón normal) se deja igual en los tres targets a propósito,
porque arreglarlo en uno sería una divergencia.

**El dev loop vive donde está la vista viva** (G14). En Godot eso era el juego, otro
proceso; en Unity es **el editor** (Play mode), y además el envelope es un asset que hay
que reimportar. El transporte es el de ZAB-14/G14: envelope fino + `x-zabloo-assets`, el
motor pide solo los hashes que no tiene, loopback, `{"views": n}` antes de rehidratar,
pushes colapsados y "no alcanzable" dicho una vez (UN8).

**Distribución y builds** (G15, G17): la versión es la del grupo `fixed` y lo que va
dentro lo dice el manifiesto (§ Decisión 6); hay que probar las dos mitades del artefacto
—el editor y un player— por separado, porque un paquete al que le falte una de las dos
pasa una de las dos pruebas y falla la otra sin decir por qué; objetos de build fuera de
`core/src/` (`core/obj/capi/`), flags de SDK guardados por *target* y no por host, y una
fila de matriz por cada binario que los `.meta` declaran.

**Verificar en motor es escenas desechables + capturas** (G10–G14), y lo que el corpus no
puede ver se escribe como procedimiento en el README del playground. Unity tiene además
`InputTestFixture`, que Godot no tenía, así que parte de ese procedimiento se convierte en
tests PlayMode.

**Lo que en Unity es distinto, y hay que vigilar** — cuatro cosas sin equivalente en Godot:

- **El plugin nativo no se descarga en el editor.** Cambiar el `.bundle` exige reiniciar
  Unity, y un handle huérfano tras un domain reload es un crash en el siguiente Play: el
  documento se destruye en `OnDestroy` **y** en `AppDomain.DomainUnload`.
- **El Canvas habla Y-arriba y el core Y-abajo**: flip en la transform del hijo, nunca por
  vértice.
- **Los arrays del core se leen sin copiar** (`NativeArray` como vista + `SetVertexBufferData`),
  y hay un test que afirma cero alocaciones por frame en régimen estacionario — el
  `buffer_growths = 0` de Godot en versión C#, y lo que vigila que nadie meta un `new` por
  batch.
- **Unity en CI necesita licencia**: el plugin se compila en CI por plataforma; los tests
  dentro de Unity corren en el editor y en local, y el README lo dice.

## Layout del repo

```
ui/
├── core/
│   ├── src/                   el core, intacto: el ABI envuelve, no edita
│   ├── capi/                  zabloo.h (C11) + su implementación + el escritor JSON de DataValue
│   ├── tests/test_capi.cpp    el corpus por la cabecera sola, compilado como C
│   └── obj/capi/              objetos del plugin, nunca junto a la fuente
├── sdk/
│   ├── godot/
│   └── unity/                 el paquete UPM com.zabloo.sdk — solo C#
│       ├── package.json
│       ├── Runtime/
│       │   ├── Interop/NativeMethods.cs      la transcripción de zabloo.h (UN2)
│       │   ├── ZablooView.cs                 partial: ciclo de vida, reloj, MarkDirty (UN3)
│       │   ├── ZablooView.Render.cs          partial: Paint() (UN4)
│       │   ├── ZablooView.Pointer.cs / .Keyboard.cs   (UN5)
│       │   ├── ZablooView.Pad.cs             (UN6)
│       │   ├── ZablooView.Host.cs            partial: Flush() y la API pública (UN7)
│       │   ├── Render/ · Input/ · Json/ · Shaders/
│       │   └── Plugins/<plataforma>/         binarios gitignorados + .meta a mano
│       ├── Editor/                           dev mode (UN8)
│       └── Tests/                            GoldenTests, AbiSizeTests, AllocationTests
├── examples/
│   ├── godot-playground/
│   └── unity-playground/      2022.3, Input System activo, Canvas Overlay 960×600
└── golden/                    solo se lee
```

Dos decisiones de forma que están aquí y no en UN3 porque condicionan a todos los demás:
`ZablooView` es una **`partial class`** desde el chasis, partida por capacidad, para que los
cuatro tickets de Wave B no compitan por un fichero; y `core/capi/` es un directorio
hermano de `core/src/`, no un subdirectorio, para que la regla "envuelve, no edita" se lea
en el árbol.

## Alternativas descartadas

### Callbacks nativo→managed (delegados marshalados a punteros de función)

Era lo "natural" para un desarrollador de C#: `OnAction` como delegado que el core llama
cuando dispara una acción. Se descarta porque bajo IL2CPP eso es la clase exacta de
problema que se convierte en crash de consola: el método tiene que ser estático y llevar
`[MonoPInvokeCallback]`, no puede cerrar sobre estado (así que hay que pasar un handle y
resolverlo en un diccionario estático), y un olvido es un fallo en runtime que Mono en el
editor no enseña. Y no compra nada: el core ya acumula y drena sus eventos por razones de
reentrada (G7), así que el callback habría sido una segunda vía hacia el mismo dato.

### C++/CLI

Un binding gestionado escrito en C++ que llama al core directamente, sin cabecera C. Es
**solo Windows** (el compilador de C++/CLI es de MSVC y el runtime es .NET Framework/.NET
Core en Windows), no existe bajo IL2CPP, y no le serviría al canvas WASM del editor visual
ni a ningún otro consumidor con FFI. Descartado sin más vueltas.

### UI Toolkit (`generateVisualContent` / `MeshGenerationContext.Allocate`)

Era el camino del spike de 2026-08-02 y del SDK cancelado, y por eso hay que descartarlo
con cuidado. Lo que el spike demostró es que `Allocate` acepta nuestra textura y nuestros
quads, y eso sigue siendo verdad. Lo que **no** demostró —porque entonces no era la
pregunta— es que el resultado siga siendo el nuestro:

1. **Su atlas dinámico re-empaqueta nuestras texturas.** El spike ya lo vio: en Unity 6 el
   renderer remapea las UVs al meter nuestra textura en su atlas. Para un atlas de glifos
   que **crece** (dobla su lado al llenarse, G4) y para imágenes keyed por hash, eso es un
   segundo atlas encima del nuestro, con su propia política de evicción, entre nosotros y
   la GPU.
2. **Su batcher re-agrupa por su cuenta.** UI Toolkit decide qué elementos van en qué draw
   call con su propia lógica de estado y de textura, así que "un draw call por batch del
   core" pasa a ser algo que no se puede afirmar ni verificar contra el Frame Debugger — la
   propiedad que G15 midió en Godot y que UN4 tiene que poder medir aquí.
3. **Sin shader propio en nuestro mínimo.** UI Shader Graph llega en Unity 6.3 (corrección
   2); en 2022.3 el recorte redondeado y el atlas de un canal habría que hacerlos con las
   herramientas de UI Toolkit (`overflow: hidden` rectangular, RGBA), es decir
   reinterpretando lo que en Godot y en web es un fragment shader de ocho líneas.

Con UGUI las tres desaparecen porque UGUI no hace nada: `SetMesh` dibuja lo que se le da.

### `MeshRenderer` / `CommandBuffer` en cámara

Daría control total y cero re-batching, a cambio de reconstruir lo que un Canvas ya tiene
y que cualquier proyecto de UI espera: escalado con resolución (`CanvasScaler`), sorting
entre la UI de zabloo y la UI propia del juego, los modos Overlay/Camera, y no pelearse con
el raycast del `EventSystem`. Un HUD sobre una cámara de mundo es exactamente el caso en
que un `CommandBuffer` empieza a pedir su propio sistema de capas. Descartado por producto:
zabloo tiene que **convivir** con la UI que el juego ya tiene, no sustituir su pipeline.

### Input Manager clásico

El mando exige **ejes configurados por proyecto** (`Horizontal`, `Fire1`… por índice de
eje y de botón, distintos por sistema operativo y por mando), que es justo el "factory
layout sin configurar" que se quiere evitar; el texto y la composición IME solo se pueden
**pollear** por frame (`Input.inputString`, `Input.compositionString`), sin el evento que dice
cuándo empieza y cuándo asienta una composición; y no tiene fixture de test. Descartado por
lo que no da.

### Los dos inputs tras una interfaz

Soportar Input Manager e Input System detrás de un `IInputSource` habría comprado que un
proyecto en el Input Manager instale el SDK sin activar el paquete. Cuesta el doble de
superficie, el doble de tests y el doble de filos (dos traducciones del mando, dos de
teclado), para un caso —un proyecto nuevo en 2026 que siga en el Input Manager— que Unity
mismo desaconseja. Descartado; la casilla de Player Settings es el coste.

### Git URL para el paquete

`"com.zabloo.sdk": "https://github.com/…#v0.x"` es cómodo de instalar y exige **committear
los binarios** de cada plataforma en el repo — un `.bundle` universal, un `.dll`, un `.so`,
un `.a` de iOS y otro `.so` de Android por release, en un repo público cuya historia los
acumularía para siempre. Descartado; el `.tgz` de una Release es un artefacto y no un
commit.

### Resucitar el C# del SDK cancelado

Las ~1.700 líneas de `sdk/unity` (loader, layout, teselador, atlas, dev server) cubren 4 de
13 tipos de un camino que ya no es el camino: son la mitad de un port que el core ya hace
entero. Se borran en UN3, como G1 dejó escrito; el código vive en el historial junto al
`examples/unity-playground` anterior (b996877). Lo único que se conserva es el
**conocimiento**: que el dev mode vive en el editor, que `runInBackground` hay que
activarlo al entrar en Play (2026-08-03), y que el spike de texto ya enseñó cómo se
comporta el atlas dinámico de UI Toolkit.

## Lo que esta tarea NO cierra

- **El contrato del ABI función a función** (nombres, structs, vida de cada puntero) — UN2,
  y se decide compilando `test_capi.cpp`.
- **El layout de vértice exacto y el shader** — UN4.
- **La ortografía de la API de C#** (`PascalCase`, `event`s, qué devuelve cada operación
  del canal de host) y su tabla en `docs/format/host-channel.md` — UN7.
- **El protocolo del dev mode en el editor** y el puerto de `--unity` — UN8.
- **La matriz exacta de CI** (NDK, SDK de iOS, `arch`) — UN9.
- **La validación en dispositivo** de Android e iOS — ZAB-193, fuera de la fase.
- **Unreal** — F13. Comparte el core y ninguna de estas decisiones: entra por C++ sin
  puente, y su render es un widget de Slate.

## Fuentes

- Unity, *Unity 6 Releases & Support* — Unity 6.0 LTS soportado hasta octubre de 2026 y
  Unity 6.3 LTS hasta diciembre de 2027; LTS = dos años, más uno para Enterprise/Industry —
  <https://unity.com/releases/unity-6/support>
- endoflife.date, *Unity* — 2022.3 LTS: salida 2023-05-30, fin de soporte 2025-05-07;
  6000.0 LTS hasta 2026-10-16; 6000.3 LTS hasta 2027-12-04; Unity 6.6 estable desde
  2026-08-31 — <https://endoflife.date/unity>
- Unity Manual, *IL2CPP limitations* — un método llamado desde nativo tiene que ser
  estático y llevar `[MonoPInvokeCallback]`; instancias no soportadas —
  <https://docs.unity3d.com/6000.3/Documentation/Manual/scripting-restrictions.html>
- Unity Manual, *WebGL native plug-ins for Emscripten* — la versión de Emscripten del
  plugin tiene que coincidir con la del editor; `.a` de objetos wasm desde 2021.2 —
  <https://docs.unity3d.com/2022.3/Documentation/Manual/webgl-native-plugins-with-emscripten.html>
- Unity Scripting API, `CanvasRenderer.SetMesh` y `CanvasRenderer.SetMaterial(Material, int)` —
  <https://docs.unity3d.com/ScriptReference/CanvasRenderer.SetMesh.html>,
  <https://docs.unity3d.com/ScriptReference/CanvasRenderer.SetMaterial.html>
- Unity Scripting API, `Mesh.SetVertexBufferData` — acepta `NativeArray<T>`; requiere
  `SetVertexBufferParams` — <https://docs.unity3d.com/ScriptReference/Mesh.SetVertexBufferData.html>
- Unity Manual, *Introduction to UI Shader Graph* (Unity 6.3) — shaders de usuario en UI
  Toolkit — <https://docs.unity3d.com/6000.3/Documentation/Manual/ui-systems/introduction-to-ui-shader-graph.html>
- Input System, *Changelog* — 1.19.0 (2026-02-24); 1.17.0 retiró el soporte a editores
  anteriores a 2022.3 LTS — <https://docs.unity3d.com/Packages/com.unity.inputsystem@1.19/changelog/CHANGELOG.html>
- Unity Manual, *Install a UPM package from a local tarball file* y *Local folder or tarball
  paths* (`file:` en `manifest.json`) — <https://docs.unity3d.com/Manual/upm-ui-tarball.html>,
  <https://docs.unity3d.com/Manual/upm-localpath.html>
- Unity Manual, *Native plug-ins for iOS* — plugins de iOS linkados estáticamente,
  `DllImport("__Internal")` — <https://docs.unity3d.com/2022.3/Documentation/Manual/PluginsForIOS.html>
- `specs/2026-08-24-godot-sdk-language-design.md` — la decisión de la que esta es la
  segunda mitad, y el modelo de esta spec.
- `plans/2026-09-03-unity-sdk-f12.md` — los veintiún learnings con su ticket, y el
  desglose de la fase.
