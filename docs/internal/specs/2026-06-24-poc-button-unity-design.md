# PoC — Button (React) → IR → Unity (UI Toolkit)

**Fecha:** 2026-06-24
**Estado:** diseño aprobado, pendiente de plan de implementación.
**Naturaleza:** Proof of Concept / código de aprendizaje. Objetivo: **validar el flujo
end-to-end** y **alimentar el diseño de la IR**, NO congelar la IR ni ser código de
producción. Vive en el repo `ui`.

---

## 1. Objetivo

Construir el flujo completo con un único componente (`Button`):

1. Autorar el botón en **React real** (`.tsx`).
2. Convertirlo a **IR** (JSON resuelto por nodo) vía un renderer con `react-reconciler`
   + resolución de tokens en el core.
3. Consumirlo desde un **plugin de Unity** (Editor, C#) que baja la IR a **UXML + USS**
   de UI Toolkit y lo deja renderizado.

Criterio de éxito: ver el botón renderizado en Unity (padding/fondo/radio correctos,
`:hover` funcionando), partiendo de código React, pasando por un `zabloo build`.

## 2. Decisiones tomadas (en brainstorming)

| Tema | Decisión |
|------|----------|
| Authoring → IR | **React real + `react-reconciler`** (no JSX-runtime propio, no funciones planas). |
| Alcance de la IR | **Representativo**: tokens resueltos + 1 estado (`hover`) + 1 `variant`. |
| Target Unity | **UI Toolkit**, generando **UXML + USS** (texto). |
| Estructura | **Tres paquetes finos** (core/react/cli) + plugin Unity + example. Fiel al producto. |
| Tooling | pnpm workspaces + TypeScript. Node 25 / pnpm 10 disponibles. Tests TS con `vitest`. |
| Sample Unity | Se genera `UIDocument` + sample para ver el botón al instante. |

## 3. Estructura del repo `ui`

```
ui/
├── pnpm-workspace.yaml · package.json · tsconfig.base.json
├── packages/
│   ├── core/    @zabloo/core — tipos de la IR, tema/tokens, resolve()
│   ├── react/   @zabloo/react — <Button>/<Label> + renderToIR() (react-reconciler)
│   └── cli/     @zabloo/cli — comando `zabloo build`
├── plugins/
│   └── unity/   paquete Unity (Editor C#): IrToUxml + ventana "Import IR" + sample
└── examples/
    └── button/  app.tsx (authoring)  →  out/button.ir.json (generado)
```

## 4. Flujo de datos

```
examples/button/app.tsx
   │  JSX con referencias a tokens
   ▼
@zabloo/react  renderToIR(<App/>)     ← react-reconciler construye árbol de nodos IR crudos
   │  árbol IR "crudo" (referencia tokens "color.primary")
   ▼
@zabloo/core   resolve(tree, theme)    ← baja tokens a valores concretos, estilo por nodo
   │  IR resuelta
   ▼
@zabloo/cli    zabloo build app.tsx    ← orquesta y escribe el archivo
   ▼
examples/button/out/button.ir.json     ← el contrato (JSON)
   ▼
plugins/unity  "zabloo → Import IR…"    ← IrToUxml(json) → escribe en Assets/Zabloo/
   ▼
Button.uxml + Button.uss + sample      ← renderizado en UI Toolkit
```

Regla de oro respetada: **TS produce la IR resuelta; el plugin Unity solo sabe leer la
IR**. El core nunca conoce Unity; el plugin nunca conoce React.

## 5. Authoring (`@zabloo/react`)

`examples/button/app.tsx`:

```tsx
import { Button, Label } from "@zabloo/react";

export default function App() {
  return (
    <Button
      id="buy-btn"
      variant="primary"
      onClick="buy"                      // hook declarado, no implementación
      padding={{ x: "space.4", y: "space.2" }}
      background="color.primary"
      radius="radius.md"
      states={{ hover: { background: "color.primary.hover" } }}
    >
      <Label color="color.on-primary">Buy</Label>
    </Button>
  );
}
```

- Props llevan **referencias a tokens** (strings tipo `"color.primary"`), no valores.
  Sin cascade: cada nodo declara su estilo.
- `Button`/`Label` son *host components* del reconciler.

### Renderer

`renderToIR(element) → RawIRNode`. Host config mínimo de `react-reconciler`:

- `createInstance(type, props)` → nodo IR crudo `{ type, props, children: [] }`.
- `appendChild` / `appendInitialChild` / `appendChildToContainer` → arman el árbol.
- `createTextInstance` para el texto de `Label`.
- `prepareUpdate`/`commitUpdate`/`removeChild` → stubs no-op: render **one-shot**
  (construir árbol → serializar → fin). Sin re-render, sin eventos, sin estado de runtime.
- Se documenta cada callback porque es la pieza menos familiar para el autor.

## 6. La IR (`@zabloo/core`)

### Tema (PoC)

```ts
export const theme = {
  color: {
    primary: "#4f46e5",
    "primary.hover": "#4338ca",
    "on-primary": "#ffffff",
  },
  space:  { "2": 8, "4": 16 },     // px
  radius: { md: 8 },                // px
};
```

### `resolve(rawTree, theme)`

Recorre el árbol crudo y, por nodo: baja cada referencia (`"color.primary"` → `#4f46e5`),
convierte spacing/radius a px, y deja el estilo **resuelto y explícito**. Token inexistente
→ **error claro** (no silencioso).

### IR resuelta — `out/button.ir.json`

```jsonc
{
  "version": "0.0.1-poc",
  "root": {
    "type": "Button",
    "id": "buy-btn",
    "variant": "primary",
    "layout": { "paddingX": 16, "paddingY": 8, "alignItems": "center" },
    "style": {
      "background": "#4f46e5",
      "radius": 8,
      "states": { "hover": { "background": "#4338ca" } }
    },
    "actions": { "onClick": "buy" },
    "children": [
      { "type": "Label", "text": "Buy", "style": { "color": "#ffffff" } }
    ]
  }
}
```

### Decisiones de IR que el PoC valida

- **`layout` vs `style` separados** — layout = caja/flex (Yoga); style = pintura.
- **`states` dentro de `style`** — overrides explícitos por estado (no pseudo-clase
  mágica). Unity los baja a `:hover` en USS; Godot/Unreal los bajarían a StyleBox/brush
  por estado.
- **`variant`** = campo **informativo** en el PoC (no genera estilos extra; el estilo ya
  está resuelto). Marca la pregunta abierta "variant = set de estilos con nombre" sin
  resolverla.
- **`actions.onClick`** = nombre declarado, sin lógica.

Fuera de alcance del PoC: `capabilities`, versionado/migración de la IR, focus/navegación,
animaciones.

## 7. Plugin Unity (`plugins/unity`)

Paquete con scripts de **Editor** (C#). Tres piezas:

### 7.1 `IrToUxml` — conversor puro (pieza clave, testeable sin abrir Unity)

`(string irJson) → (string uxml, string uss)`. Función pura, sin dependencias del editor.

```xml
<!-- Button.uxml -->
<ui:UXML xmlns:ui="UnityEngine.UIElements">
  <ui:Button name="buy-btn" text="Buy" class="zb-buy-btn" />
</ui:UXML>
```

```css
/* Button.uss */
.zb-buy-btn {
  padding-left: 16px; padding-right: 16px;
  padding-top: 8px;  padding-bottom: 8px;
  align-items: center;
  background-color: #4f46e5;
  border-radius: 8px;
  color: #ffffff;          /* del Label hijo */
}
.zb-buy-btn:hover { background-color: #4338ca; }
```

**Decisión de lowering Unity-específica:** UI Toolkit tiene un `Button` nativo con `text`,
así que un `Label` hijo de texto simple se **colapsa** en `text` + `color` del propio
botón (no se genera `<ui:Label>` anidado). Primera "decisión de lowering" real: la IR es
genérica (Button+Label), el plugin la adapta al idiom del motor. Va comentado en el código.

### 7.2 `onClick`

El `<ui:Button>` lleva `name="buy-btn"`. Se genera además un stub C# mínimo y comentado:

```csharp
// Button.binding.cs (stub generado)
// root.Q<Button>("buy-btn").clicked += () => OnBuy();
```

Valida la idea "el plugin genera los *stubs* de wiring en el idiom del motor" sin lógica
de juego.

### 7.3 Ventana de editor `zabloo → Import IR…`

Pide la ruta de `button.ir.json`, llama a `IrToUxml`, y escribe `Button.uxml` +
`Button.uss` + stub en `Assets/Zabloo/`. Genera además un `UIDocument` + sample mínimo
para ver el botón renderizado de inmediato.

## 8. Verificación

### TS (automatizable, sin Unity) — `vitest`

- Snapshot: `renderToIR(<App/>)` → `resolve()` → IR esperada (JSON fijo).
- Error: token inexistente (`"color.nope"`) lanza error claro.
- `zabloo build` produce `out/button.ir.json` y coincide con el snapshot.

### Unity (parte automatizable + parte visual)

- `IrToUxml` puro → snapshot del **texto UXML/USS** generado (Unity Test Framework,
  EditMode; no requiere Play ni escena).
- Visual (manual): abrir Unity → `zabloo → Import IR…` → ver el botón en el sample;
  `:hover` cambia el color.

### Criterio de "done"

1. `pnpm test` verde (IR correcta y determinista).
2. `zabloo build` genera el `button.ir.json`.
3. En Unity, importar la IR produce un botón visible con padding/fondo/radio correctos y
   `:hover` funcionando.

## 9. Orden de implementación (lo detalla el plan)

core (tipos + theme + resolve) → react (componentes + renderer) → cli → example + snapshot
→ plugin Unity (conversor + tests) → ventana + sample → verificación visual.

## 10. Out of scope (PoC)

- Más de un componente / más estados / más variants.
- `capabilities`, versionado/migración de la IR.
- Focus/navegación, bindings ricos, animaciones.
- Godot / Unreal (solo se respeta que la IR no asuma idioms de Unity).
- Estado de runtime / eventos reales en React (render one-shot).
