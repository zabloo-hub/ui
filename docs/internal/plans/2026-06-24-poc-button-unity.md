# PoC Button (React → IR → Unity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autorar un `Button` en React real, compilarlo a una IR JSON resuelta por nodo con `zabloo build`, y consumir esa IR desde un plugin de Unity que la baja a UXML + USS de UI Toolkit, renderizado en el editor.

**Architecture:** Monorepo pnpm en el repo `ui`. `@zabloo/react` usa `react-reconciler` para convertir el árbol React en una IR con referencias a tokens; `@zabloo/core` resuelve los tokens y envuelve el documento IR; `@zabloo/cli` orquesta (`zabloo build`). El plugin Unity (C# Editor) lee la IR con una función pura `IrToUxml` y escribe UXML/USS + un sample. El core nunca conoce Unity; el plugin nunca conoce React.

**Tech Stack:** TypeScript, Node 25, pnpm 10 (workspaces), React 18.3, react-reconciler 0.29, esbuild (transform de `.tsx` en la CLI), vitest (tests TS). Lado Unity: C# (UI Toolkit), Newtonsoft.Json (UPM), Unity Test Framework (EditMode).

## Global Constraints

- **PoC / código de aprendizaje:** validar el flujo y alimentar el diseño de la IR; NO es producción y NO congela la IR.
- **Versión IR del PoC:** `"0.0.1-poc"` (string literal en el documento).
- **Regla de oro:** `@zabloo/core` no importa nada de Unity ni de React-DOM; el plugin Unity no conoce React. La única frontera es el JSON de la IR.
- **Tokens:** las props de authoring son **referencias** string (`"color.primary"`, `"space.4"`, `"radius.md"`), nunca valores. La resolución vive en `@zabloo/core`.
- **Sin cascade:** estilo resuelto y explícito por nodo.
- **npm scope:** `@zabloo/*`. Comando CLI: `zabloo`.
- **Estructura de IR del botón** (objetivo de salida, `out/button.ir.json`):

```jsonc
{
  "version": "0.0.1-poc",
  "root": {
    "type": "Button", "id": "buy-btn", "variant": "primary",
    "layout": { "paddingX": 16, "paddingY": 8, "alignItems": "center" },
    "style": {
      "background": "#4f46e5", "radius": 8,
      "states": { "hover": { "background": "#4338ca" } }
    },
    "actions": { "onClick": "buy" },
    "children": [ { "type": "Label", "text": "Buy", "style": { "color": "#ffffff" } } ]
  }
}
```

---

## File Structure

```
ui/
├── package.json                     # workspace root, scripts (test)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── packages/
│   ├── core/
│   │   ├── package.json             # @zabloo/core (sin deps de runtime)
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types.ts             # tipos IR (IRNode, IRDocument, RawIRNode...)
│   │       ├── theme.ts             # tokens del PoC
│   │       ├── resolve.ts           # resolve() + token()
│   │       ├── document.ts          # buildDocument()
│   │       ├── index.ts             # re-exporta
│   │       └── resolve.test.ts
│   ├── react/
│   │   ├── package.json             # @zabloo/react (deps: react, react-reconciler, @zabloo/core)
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── components.tsx       # Button, Label (host wrappers)
│   │       ├── host-config.ts       # config de react-reconciler
│   │       ├── serialize.ts         # árbol host crudo → IRNode (token refs)
│   │       ├── render.ts            # renderToIR()
│   │       ├── index.ts
│   │       └── render.test.tsx
│   └── cli/
│       ├── package.json             # @zabloo/cli, bin "zabloo" (deps: core, react, esbuild)
│       ├── tsconfig.json
│       └── src/
│           ├── build.ts             # loadAuthoring() + buildToFile()
│           ├── bin.ts               # entry CLI
│           └── build.test.ts
├── examples/
│   └── button/
│       ├── app.tsx                  # authoring
│       └── out/                     # button.ir.json (generado; gitignored salvo snapshot)
└── plugins/
    └── unity/
        ├── package.json             # UPM com.zabloo.ui (dep newtonsoft)
        ├── Editor/
        │   ├── Zabloo.Editor.asmdef
        │   ├── IrToUxml.cs          # función pura (string)->(uxml,uss)
        │   └── ImportIrWindow.cs    # EditorWindow + menú + escribe assets/sample
        └── Tests/Editor/
            ├── Zabloo.Editor.Tests.asmdef
            └── IrToUxmlTests.cs
```

---

## Task 1: Monorepo scaffold + `@zabloo/core` (tipos + theme)

**Files:**
- Create: `ui/package.json`, `ui/pnpm-workspace.yaml`, `ui/tsconfig.base.json`, `ui/vitest.config.ts`
- Create: `ui/packages/core/package.json`, `ui/packages/core/tsconfig.json`
- Create: `ui/packages/core/src/types.ts`, `ui/packages/core/src/theme.ts`, `ui/packages/core/src/index.ts`
- Test: `ui/packages/core/src/theme.test.ts`

**Interfaces:**
- Produces: `theme` (objeto de tokens); tipos `RawIRNode`, `IRNode`, `IRLabelNode`, `IRButtonNode`, `IRDocument`.

- [ ] **Step 1: Crear los configs raíz del workspace**

`ui/pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "examples/*"
```

`ui/package.json`:
```json
{
  "name": "zabloo-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build:example": "node --import @zabloo/cli/register packages/cli/src/bin.ts build examples/button/app.tsx"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```
(El script `build:example` se ajusta en Task 5; déjalo así de momento.)

`ui/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "declaration": true,
    "composite": false
  }
}
```

`ui/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/**/*.test.{ts,tsx}"] },
});
```

- [ ] **Step 2: Crear el paquete `@zabloo/core`**

`ui/packages/core/package.json`:
```json
{
  "name": "@zabloo/core",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`ui/packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Definir los tipos de la IR**

`ui/packages/core/src/types.ts`:
```ts
// Árbol "crudo" que produce el renderer de React: estilos con referencias a tokens (strings).
export interface RawIRButton {
  type: "Button";
  id: string;
  variant: string;
  layout: { paddingX: string; paddingY: string; alignItems: string };
  style: {
    background: string;
    radius: string;
    states?: { hover?: { background: string } };
  };
  actions: { onClick?: string };
  children: RawIRNode[];
}
export interface RawIRLabel {
  type: "Label";
  text: string;
  style: { color: string };
}
export type RawIRNode = RawIRButton | RawIRLabel;

// IR resuelta: tokens bajados a valores concretos (px numéricos, colores hex).
export interface IRButton {
  type: "Button";
  id: string;
  variant: string;
  layout: { paddingX: number; paddingY: number; alignItems: string };
  style: {
    background: string;
    radius: number;
    states?: { hover?: { background: string } };
  };
  actions: { onClick?: string };
  children: IRNode[];
}
export interface IRLabel {
  type: "Label";
  text: string;
  style: { color: string };
}
export type IRNode = IRButton | IRLabel;

export interface IRDocument {
  version: "0.0.1-poc";
  root: IRNode;
}
```

- [ ] **Step 4: Definir el theme**

`ui/packages/core/src/theme.ts`:
```ts
export interface Theme {
  color: Record<string, string>;
  space: Record<string, number>;
  radius: Record<string, number>;
}

export const theme: Theme = {
  color: {
    primary: "#4f46e5",
    "primary.hover": "#4338ca",
    "on-primary": "#ffffff",
  },
  space: { "2": 8, "4": 16 },
  radius: { md: 8 },
};
```

`ui/packages/core/src/index.ts`:
```ts
export * from "./types.js";
export * from "./theme.js";
```

- [ ] **Step 5: Escribir el test del theme**

`ui/packages/core/src/theme.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { theme } from "./theme.js";

describe("theme", () => {
  it("expone los tokens del PoC", () => {
    expect(theme.color.primary).toBe("#4f46e5");
    expect(theme.color["primary.hover"]).toBe("#4338ca");
    expect(theme.space["4"]).toBe(16);
    expect(theme.radius.md).toBe(8);
  });
});
```

- [ ] **Step 6: Instalar y correr**

Run:
```bash
cd ui && pnpm install && pnpm test
```
Expected: vitest corre, 1 test PASS (`theme`).

- [ ] **Step 7: Commit**

```bash
cd ui && git add -A && git commit -m "chore: scaffold pnpm workspace + @zabloo/core types & theme"
```

---

## Task 2: `@zabloo/core` — `resolve()` y `buildDocument()` (TDD)

**Files:**
- Create: `ui/packages/core/src/resolve.ts`, `ui/packages/core/src/document.ts`
- Modify: `ui/packages/core/src/index.ts`
- Test: `ui/packages/core/src/resolve.test.ts`

**Interfaces:**
- Consumes: `RawIRNode`, `IRNode`, `IRDocument`, `Theme` (de Task 1).
- Produces:
  - `token(ref: string, theme: Theme): string | number`
  - `resolve(node: RawIRNode, theme: Theme): IRNode`
  - `buildDocument(root: IRNode): IRDocument`

- [ ] **Step 1: Escribir el test de `resolve` (falla)**

`ui/packages/core/src/resolve.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolve, token, buildDocument } from "./index.js";
import { theme } from "./theme.js";
import type { RawIRButton } from "./types.js";

const rawButton: RawIRButton = {
  type: "Button",
  id: "buy-btn",
  variant: "primary",
  layout: { paddingX: "space.4", paddingY: "space.2", alignItems: "center" },
  style: {
    background: "color.primary",
    radius: "radius.md",
    states: { hover: { background: "color.primary.hover" } },
  },
  actions: { onClick: "buy" },
  children: [{ type: "Label", text: "Buy", style: { color: "color.on-primary" } }],
};

describe("token", () => {
  it("resuelve referencias a su valor concreto", () => {
    expect(token("color.primary", theme)).toBe("#4f46e5");
    expect(token("space.4", theme)).toBe(16);
    expect(token("color.primary.hover", theme)).toBe("#4338ca");
  });
  it("lanza error claro con un token inexistente", () => {
    expect(() => token("color.nope", theme)).toThrow("Unknown token: color.nope");
  });
});

describe("resolve", () => {
  it("baja tokens a valores concretos por nodo", () => {
    expect(resolve(rawButton, theme)).toEqual({
      type: "Button",
      id: "buy-btn",
      variant: "primary",
      layout: { paddingX: 16, paddingY: 8, alignItems: "center" },
      style: {
        background: "#4f46e5",
        radius: 8,
        states: { hover: { background: "#4338ca" } },
      },
      actions: { onClick: "buy" },
      children: [{ type: "Label", text: "Buy", style: { color: "#ffffff" } }],
    });
  });
});

describe("buildDocument", () => {
  it("envuelve la raíz con la versión del PoC", () => {
    const doc = buildDocument(resolve(rawButton, theme));
    expect(doc.version).toBe("0.0.1-poc");
    expect(doc.root.type).toBe("Button");
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd ui && pnpm test resolve`
Expected: FAIL (`resolve`/`token`/`buildDocument` no existen).

- [ ] **Step 3: Implementar `resolve` y `token`**

`ui/packages/core/src/resolve.ts`:
```ts
import type { Theme } from "./theme.js";
import type { RawIRNode, IRNode } from "./types.js";

export function token(ref: string, theme: Theme): string | number {
  const dot = ref.indexOf(".");
  const category = ref.slice(0, dot);
  const key = ref.slice(dot + 1);
  const table = (theme as Record<string, Record<string, string | number>>)[category];
  if (!table || !(key in table)) throw new Error(`Unknown token: ${ref}`);
  return table[key];
}

export function resolve(node: RawIRNode, theme: Theme): IRNode {
  if (node.type === "Label") {
    return { type: "Label", text: node.text, style: { color: token(node.style.color, theme) as string } };
  }
  const states = node.style.states?.hover
    ? { hover: { background: token(node.style.states.hover.background, theme) as string } }
    : undefined;
  return {
    type: "Button",
    id: node.id,
    variant: node.variant,
    layout: {
      paddingX: token(node.layout.paddingX, theme) as number,
      paddingY: token(node.layout.paddingY, theme) as number,
      alignItems: node.layout.alignItems,
    },
    style: {
      background: token(node.style.background, theme) as string,
      radius: token(node.style.radius, theme) as number,
      ...(states ? { states } : {}),
    },
    actions: { ...node.actions },
    children: node.children.map((c) => resolve(c, theme)),
  };
}
```

`ui/packages/core/src/document.ts`:
```ts
import type { IRNode, IRDocument } from "./types.js";

export function buildDocument(root: IRNode): IRDocument {
  return { version: "0.0.1-poc", root };
}
```

`ui/packages/core/src/index.ts` (añadir):
```ts
export * from "./types.js";
export * from "./theme.js";
export * from "./resolve.js";
export * from "./document.js";
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd ui && pnpm test resolve`
Expected: PASS (token, resolve, buildDocument).

- [ ] **Step 5: Commit**

```bash
cd ui && git add -A && git commit -m "feat(core): resolve() de tokens + buildDocument()"
```

---

## Task 3: `@zabloo/react` — componentes + `renderToIR` (react-reconciler)

**Files:**
- Create: `ui/packages/react/package.json`, `ui/packages/react/tsconfig.json`
- Create: `ui/packages/react/src/components.tsx`, `host-config.ts`, `serialize.ts`, `render.ts`, `index.ts`
- Test: `ui/packages/react/src/render.test.tsx`

**Interfaces:**
- Consumes: `RawIRNode`, `RawIRButton`, `RawIRLabel` (de `@zabloo/core`).
- Produces:
  - Componentes `Button(props: ButtonProps)`, `Label(props: LabelProps)`.
  - `ButtonProps = { id: string; variant: string; onClick?: string; padding: { x: string; y: string }; background: string; radius: string; states?: { hover?: { background: string } }; children?: React.ReactNode }`
  - `LabelProps = { color: string; children?: React.ReactNode }`
  - `renderToIR(element: React.ReactElement): RawIRNode`

> **Nota de versión:** la API de `react-reconciler` cambia entre versiones. Este plan usa `react@^18.3.1` y `react-reconciler@^0.29.2`. Si `createContainer`/`getCurrentEventPriority` se quejan, ajusta la firma a la de la versión instalada (los campos del host config siguen siendo los mismos conceptualmente).

- [ ] **Step 1: Crear el paquete**

`ui/packages/react/package.json`:
```json
{
  "name": "@zabloo/react",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@zabloo/core": "workspace:*",
    "react": "^18.3.1",
    "react-reconciler": "^0.29.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-reconciler": "^0.28.8"
  }
}
```

`ui/packages/react/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Run: `cd ui && pnpm install`

- [ ] **Step 2: Escribir el test de `renderToIR` (falla)**

`ui/packages/react/src/render.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { Button, Label, renderToIR } from "./index.js";

function App() {
  return createElement(
    Button,
    {
      id: "buy-btn",
      variant: "primary",
      onClick: "buy",
      padding: { x: "space.4", y: "space.2" },
      background: "color.primary",
      radius: "radius.md",
      states: { hover: { background: "color.primary.hover" } },
    },
    createElement(Label, { color: "color.on-primary" }, "Buy"),
  );
}

describe("renderToIR", () => {
  it("convierte el árbol React en IR cruda con referencias a tokens", () => {
    expect(renderToIR(createElement(App))).toEqual({
      type: "Button",
      id: "buy-btn",
      variant: "primary",
      layout: { paddingX: "space.4", paddingY: "space.2", alignItems: "center" },
      style: {
        background: "color.primary",
        radius: "radius.md",
        states: { hover: { background: "color.primary.hover" } },
      },
      actions: { onClick: "buy" },
      children: [{ type: "Label", text: "Buy", style: { color: "color.on-primary" } }],
    });
  });
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `cd ui && pnpm test render`
Expected: FAIL (módulos no existen).

- [ ] **Step 4: Implementar los componentes (host wrappers)**

`ui/packages/react/src/components.tsx`:
```tsx
import { createElement, type ReactNode } from "react";

export interface ButtonProps {
  id: string;
  variant: string;
  onClick?: string;
  padding: { x: string; y: string };
  background: string;
  radius: string;
  states?: { hover?: { background: string } };
  children?: ReactNode;
}

export interface LabelProps {
  color: string;
  children?: ReactNode;
}

// Button/Label son componentes que renderizan "host components" con tipo string.
// El reconciler los reconoce por ese tipo y construye nodos IR crudos.
export function Button(props: ButtonProps) {
  return createElement("zabloo:button", props, props.children);
}

export function Label(props: LabelProps) {
  return createElement("zabloo:label", props, props.children);
}
```

- [ ] **Step 5: Implementar el host config**

`ui/packages/react/src/host-config.ts`:
```ts
import { DefaultEventPriority } from "react-reconciler/constants.js";

// Nodo host crudo que produce el reconciler.
export interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: Array<HostNode | TextNode>;
}
export interface TextNode { text: string }
export interface Container { children: Array<HostNode | TextNode> }

const noop = () => {};

export const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  getRootHostContext: () => null,
  getChildHostContext: (parent: unknown) => parent,
  getPublicInstance: (i: unknown) => i,
  prepareForCommit: () => null,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  shouldSetTextContent: () => false,
  getCurrentEventPriority: () => DefaultEventPriority,
  clearContainer: (c: Container) => { c.children = []; },
  detachDeletedInstance: noop,

  createInstance: (type: string, props: Record<string, unknown>): HostNode => ({
    type, props, children: [],
  }),
  createTextInstance: (text: string): TextNode => ({ text }),
  appendInitialChild: (parent: HostNode, child: HostNode | TextNode) => { parent.children.push(child); },
  appendChild: (parent: HostNode, child: HostNode | TextNode) => { parent.children.push(child); },
  appendChildToContainer: (container: Container, child: HostNode | TextNode) => { container.children.push(child); },
  finalizeInitialChildren: () => false,
  prepareUpdate: () => null,

  // No-ops: render one-shot, sin updates ni eventos.
  commitUpdate: noop,
  commitTextUpdate: noop,
  removeChild: noop,
  removeChildFromContainer: noop,
  insertBefore: noop,
  commitMount: noop,
  hideInstance: noop,
  unhideInstance: noop,
  hideTextInstance: noop,
  unhideTextInstance: noop,
};
```

- [ ] **Step 6: Implementar `serialize` (host tree → IR cruda)**

`ui/packages/react/src/serialize.ts`:
```ts
import type { RawIRNode, RawIRButton, RawIRLabel } from "@zabloo/core";
import type { HostNode, TextNode } from "./host-config.js";

function isText(n: HostNode | TextNode): n is TextNode {
  return (n as TextNode).text !== undefined;
}

export function serialize(node: HostNode): RawIRNode {
  if (node.type === "zabloo:label") {
    const p = node.props as { color: string };
    const text = node.children.map((c) => (isText(c) ? c.text : "")).join("");
    const label: RawIRLabel = { type: "Label", text, style: { color: p.color } };
    return label;
  }
  if (node.type === "zabloo:button") {
    const p = node.props as {
      id: string; variant: string; onClick?: string;
      padding: { x: string; y: string };
      background: string; radius: string;
      states?: { hover?: { background: string } };
    };
    const childNodes = node.children.filter((c): c is HostNode => !isText(c)).map(serialize);
    const button: RawIRButton = {
      type: "Button",
      id: p.id,
      variant: p.variant,
      layout: { paddingX: p.padding.x, paddingY: p.padding.y, alignItems: "center" },
      style: {
        background: p.background,
        radius: p.radius,
        ...(p.states?.hover ? { states: { hover: { background: p.states.hover.background } } } : {}),
      },
      actions: { onClick: p.onClick },
      children: childNodes,
    };
    return button;
  }
  throw new Error(`Unknown host type: ${node.type}`);
}
```

- [ ] **Step 7: Implementar `renderToIR`**

`ui/packages/react/src/render.ts`:
```ts
import Reconciler from "react-reconciler";
import type { ReactElement } from "react";
import type { RawIRNode } from "@zabloo/core";
import { hostConfig, type Container, type HostNode } from "./host-config.js";
import { serialize } from "./serialize.js";

const reconciler = Reconciler(hostConfig as any);

export function renderToIR(element: ReactElement): RawIRNode {
  const container: Container = { children: [] };
  // tag 0 = LegacyRoot → el mount inicial es síncrono.
  const root = reconciler.createContainer(
    container, 0, null, false, null, "", (e: unknown) => { throw e; }, null,
  );
  reconciler.updateContainer(element, root, null, null);
  if (container.children.length !== 1) {
    throw new Error(`renderToIR espera exactamente 1 nodo raíz, recibió ${container.children.length}`);
  }
  return serialize(container.children[0] as HostNode);
}
```

`ui/packages/react/src/index.ts`:
```ts
export { Button, Label } from "./components.js";
export type { ButtonProps, LabelProps } from "./components.js";
export { renderToIR } from "./render.js";
```

- [ ] **Step 8: Correr el test (debe pasar)**

Run: `cd ui && pnpm test render`
Expected: PASS. Si falla por la firma de `createContainer`/constants, ajusta a la versión instalada (ver nota de versión).

- [ ] **Step 9: Commit**

```bash
cd ui && git add -A && git commit -m "feat(react): componentes Button/Label + renderToIR con react-reconciler"
```

---

## Task 4: Ejemplo de authoring + snapshot end-to-end (TS)

**Files:**
- Create: `ui/examples/button/package.json`, `ui/examples/button/app.tsx`
- Create: `ui/examples/button/out/button.ir.json` (snapshot esperado, versionado)
- Create: `ui/examples/button/.gitignore`
- Test: `ui/examples/button/app.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Label`, `renderToIR` (`@zabloo/react`); `resolve`, `buildDocument`, `theme` (`@zabloo/core`).
- Produces: `app.tsx` con `export default App`; `out/button.ir.json` como artefacto/snapshot.

- [ ] **Step 1: Crear el paquete del ejemplo**

`ui/examples/button/package.json`:
```json
{
  "name": "@zabloo-example/button",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@zabloo/core": "workspace:*",
    "@zabloo/react": "workspace:*",
    "react": "^18.3.1"
  }
}
```

`ui/examples/button/.gitignore`:
```
# El JSON resuelto se versiona como snapshot esperado; los temporales no.
*.tmp.mjs
```

Run: `cd ui && pnpm install`

- [ ] **Step 2: Escribir el authoring**

`ui/examples/button/app.tsx`:
```tsx
import { Button, Label } from "@zabloo/react";

export default function App() {
  return (
    <Button
      id="buy-btn"
      variant="primary"
      onClick="buy"
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

- [ ] **Step 3: Escribir el test end-to-end (falla)**

`ui/examples/button/app.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToIR } from "@zabloo/react";
import { resolve, buildDocument, theme } from "@zabloo/core";
import App from "./app.js";

describe("example button end-to-end", () => {
  it("authoring → IR resuelta coincide con el documento esperado", () => {
    const doc = buildDocument(resolve(renderToIR(createElement(App)), theme));
    expect(doc).toEqual({
      version: "0.0.1-poc",
      root: {
        type: "Button",
        id: "buy-btn",
        variant: "primary",
        layout: { paddingX: 16, paddingY: 8, alignItems: "center" },
        style: { background: "#4f46e5", radius: 8, states: { hover: { background: "#4338ca" } } },
        actions: { onClick: "buy" },
        children: [{ type: "Label", text: "Buy", style: { color: "#ffffff" } }],
      },
    });
  });
});
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd ui && pnpm test app`
Expected: PASS. (Importar `./app.js` desde un `.tsx` lo resuelve vitest/esbuild.)

- [ ] **Step 5: Escribir el snapshot esperado en disco**

Crea `ui/examples/button/out/button.ir.json` con exactamente el JSON del objetivo (ver "Global Constraints"). Este archivo es el snapshot que la CLI debe reproducir en Task 5.

- [ ] **Step 6: Commit**

```bash
cd ui && git add -A && git commit -m "feat(example): authoring del Button + snapshot IR end-to-end"
```

---

## Task 5: `@zabloo/cli` — comando `zabloo build`

**Files:**
- Create: `ui/packages/cli/package.json`, `ui/packages/cli/tsconfig.json`
- Create: `ui/packages/cli/src/build.ts`, `ui/packages/cli/src/bin.ts`
- Test: `ui/packages/cli/src/build.test.ts`

**Interfaces:**
- Consumes: `renderToIR` (`@zabloo/react`); `resolve`, `buildDocument`, `theme` (`@zabloo/core`).
- Produces:
  - `loadAuthoring(absPath: string): Promise<React.ReactElement>` — transforma `.tsx` con esbuild y devuelve `createElement(default)`.
  - `buildToFile(srcPath: string): Promise<string>` — escribe `<dir-de-src>/out/button.ir.json`, devuelve la ruta escrita.

- [ ] **Step 1: Crear el paquete CLI**

`ui/packages/cli/package.json`:
```json
{
  "name": "@zabloo/cli",
  "version": "0.0.0",
  "type": "module",
  "bin": { "zabloo": "src/bin.ts" },
  "dependencies": {
    "@zabloo/core": "workspace:*",
    "@zabloo/react": "workspace:*",
    "esbuild": "^0.23.0",
    "react": "^18.3.1"
  }
}
```

`ui/packages/cli/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Run: `cd ui && pnpm install`

- [ ] **Step 2: Escribir el test de la CLI (falla)**

`ui/packages/cli/src/build.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { buildToFile } from "./build.js";

const here = dirname(fileURLToPath(import.meta.url));
const appPath = resolvePath(here, "../../../examples/button/app.tsx");

describe("buildToFile", () => {
  it("genera el documento IR esperado desde app.tsx", async () => {
    const outPath = await buildToFile(appPath);
    const written = JSON.parse(await readFile(outPath, "utf8"));
    expect(written.version).toBe("0.0.1-poc");
    expect(written.root.style.background).toBe("#4f46e5");
    expect(written.root.style.states.hover.background).toBe("#4338ca");
    expect(written.root.layout.paddingX).toBe(16);
    expect(written.root.children[0].text).toBe("Buy");
  });
});
```

- [ ] **Step 3: Correr el test (debe fallar)**

Run: `cd ui && pnpm test build`
Expected: FAIL (`buildToFile` no existe).

- [ ] **Step 4: Implementar `build.ts`**

`ui/packages/cli/src/build.ts`:
```ts
import { transform } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createElement, type ReactElement, type FunctionComponent } from "react";
import { renderToIR } from "@zabloo/react";
import { resolve as resolveTokens, buildDocument, theme } from "@zabloo/core";

// Transforma app.tsx a ESM (JSX automático) y devuelve createElement(default).
export async function loadAuthoring(absPath: string): Promise<ReactElement> {
  const src = await readFile(absPath, "utf8");
  const { code } = await transform(src, {
    loader: "tsx",
    jsx: "automatic",
    format: "esm",
    sourcefile: absPath,
  });
  const tmp = absPath.replace(/\.tsx$/, ".tmp.mjs");
  await writeFile(tmp, code, "utf8");
  try {
    const mod = await import(pathToFileURL(tmp).href + `?t=${process.hrtime.bigint()}`);
    const App = mod.default as FunctionComponent;
    return createElement(App);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function buildToFile(srcPath: string): Promise<string> {
  const element = await loadAuthoring(srcPath);
  const doc = buildDocument(resolveTokens(renderToIR(element), theme));
  const outDir = join(dirname(srcPath), "out");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "button.ir.json");
  await writeFile(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return outPath;
}
```

> **Nota:** `app.tsx` solo importa de `@zabloo/react` (paquete del workspace, resuelto en runtime junto al `.tmp.mjs`) y de `react/jsx-runtime`. No hay imports relativos que empaquetar, por eso basta `transform` (no `build`).

- [ ] **Step 5: Implementar el entry `bin.ts`**

`ui/packages/cli/src/bin.ts`:
```ts
import { resolve } from "node:path";
import { buildToFile } from "./build.js";

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== "build" || !file) {
    console.error("uso: zabloo build <archivo.tsx>");
    process.exit(1);
  }
  const outPath = await buildToFile(resolve(process.cwd(), file));
  console.log(`IR escrita en ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Correr el test (debe pasar)**

Run: `cd ui && pnpm test build`
Expected: PASS.

- [ ] **Step 7: Verificar la CLI a mano y refrescar el snapshot**

Run:
```bash
cd ui && node --experimental-strip-types packages/cli/src/bin.ts build examples/button/app.tsx
```
Expected: imprime `IR escrita en .../examples/button/out/button.ir.json`. Si Node no ejecuta `.ts` directamente en esta versión, córrelo con `pnpm dlx tsx packages/cli/src/bin.ts build examples/button/app.tsx`.

Comprueba que el archivo generado coincide con el snapshot de Task 4:
```bash
cd ui && git diff --exit-code examples/button/out/button.ir.json && echo "snapshot OK"
```
Expected: sin diff → `snapshot OK`.

- [ ] **Step 8: Actualizar el script raíz `build:example`**

En `ui/package.json`, sustituye el script por el invocador que te funcionó en el Step 7, p. ej.:
```json
"build:example": "tsx packages/cli/src/bin.ts build examples/button/app.tsx"
```
(añade `tsx` a `devDependencies` del root si lo usas: `"tsx": "^4.0.0"`, y `pnpm install`.)

- [ ] **Step 9: Commit**

```bash
cd ui && git add -A && git commit -m "feat(cli): zabloo build (.tsx → IR JSON) + verificación end-to-end"
```

---

## Task 6: Plugin Unity — `IrToUxml` (conversor puro + test EditMode)

**Files:**
- Create: `ui/plugins/unity/package.json`
- Create: `ui/plugins/unity/Editor/Zabloo.Editor.asmdef`, `ui/plugins/unity/Editor/IrToUxml.cs`
- Test: `ui/plugins/unity/Tests/Editor/Zabloo.Editor.Tests.asmdef`, `ui/plugins/unity/Tests/Editor/IrToUxmlTests.cs`

**Interfaces:**
- Consumes: el JSON `button.ir.json` (texto).
- Produces: `Zabloo.Editor.IrToUxml.Convert(string irJson) → (string uxml, string uss)`.

> **Verificación:** los tests C# corren con el **Unity Test Runner** (Window → General → Test Runner → EditMode). No hay CI de Unity en el PoC; este task se valida abriendo el proyecto Unity y corriendo los tests EditMode.

- [ ] **Step 1: Crear el paquete UPM**

`ui/plugins/unity/package.json`:
```json
{
  "name": "com.zabloo.ui",
  "version": "0.0.1",
  "displayName": "Zabloo UI (PoC)",
  "description": "Importa IR de zabloo y genera UXML/USS de UI Toolkit.",
  "unity": "2022.3",
  "dependencies": { "com.unity.nuget.newtonsoft-json": "3.2.1" }
}
```

- [ ] **Step 2: Crear los asmdef**

`ui/plugins/unity/Editor/Zabloo.Editor.asmdef`:
```json
{
  "name": "Zabloo.Editor",
  "rootNamespace": "Zabloo.Editor",
  "references": ["Newtonsoft.Json"],
  "includePlatforms": ["Editor"],
  "overrideReferences": false,
  "autoReferenced": true
}
```

`ui/plugins/unity/Tests/Editor/Zabloo.Editor.Tests.asmdef`:
```json
{
  "name": "Zabloo.Editor.Tests",
  "references": ["Zabloo.Editor", "UnityEngine.TestRunner", "UnityEditor.TestRunner"],
  "includePlatforms": ["Editor"],
  "overrideReferences": true,
  "precompiledReferences": ["nunit.framework.dll"],
  "defineConstraints": ["UNITY_INCLUDE_TESTS"]
}
```

- [ ] **Step 3: Escribir el test EditMode (falla)**

`ui/plugins/unity/Tests/Editor/IrToUxmlTests.cs`:
```csharp
using NUnit.Framework;
using Zabloo.Editor;

public class IrToUxmlTests
{
    const string Ir = @"{
      ""version"": ""0.0.1-poc"",
      ""root"": {
        ""type"": ""Button"", ""id"": ""buy-btn"", ""variant"": ""primary"",
        ""layout"": { ""paddingX"": 16, ""paddingY"": 8, ""alignItems"": ""center"" },
        ""style"": { ""background"": ""#4f46e5"", ""radius"": 8,
          ""states"": { ""hover"": { ""background"": ""#4338ca"" } } },
        ""actions"": { ""onClick"": ""buy"" },
        ""children"": [ { ""type"": ""Label"", ""text"": ""Buy"", ""style"": { ""color"": ""#ffffff"" } } ]
      }
    }";

    [Test]
    public void Convert_EmitsButtonUxmlWithNameTextAndClass()
    {
        var (uxml, _) = IrToUxml.Convert(Ir);
        StringAssert.Contains("<ui:Button", uxml);
        StringAssert.Contains("name=\"buy-btn\"", uxml);
        StringAssert.Contains("text=\"Buy\"", uxml);
        StringAssert.Contains("class=\"zb-buy-btn\"", uxml);
        StringAssert.Contains("src=\"Button.uss\"", uxml);
    }

    [Test]
    public void Convert_EmitsUssWithResolvedStyleAndHover()
    {
        var (_, uss) = IrToUxml.Convert(Ir);
        StringAssert.Contains("padding-left: 16px", uss);
        StringAssert.Contains("padding-top: 8px", uss);
        StringAssert.Contains("background-color: #4f46e5", uss);
        StringAssert.Contains("border-radius: 8px", uss);
        StringAssert.Contains("color: #ffffff", uss);
        StringAssert.Contains(".zb-buy-btn:hover", uss);
        StringAssert.Contains("background-color: #4338ca", uss);
    }
}
```

- [ ] **Step 4: Implementar `IrToUxml.cs`**

`ui/plugins/unity/Editor/IrToUxml.cs`:
```csharp
using System.Text;
using Newtonsoft.Json.Linq;

namespace Zabloo.Editor
{
    public static class IrToUxml
    {
        // Lee la IR resuelta y baja el Button a UXML + USS de UI Toolkit.
        public static (string uxml, string uss) Convert(string irJson)
        {
            var root = (JObject)JObject.Parse(irJson)["root"];
            string id = (string)root["id"];
            string cls = "zb-" + id;
            var layout = (JObject)root["layout"];
            var style = (JObject)root["style"];

            // Decisión de lowering (Unity): el Button nativo de UI Toolkit tiene `text`,
            // así que colapsamos el Label hijo de texto simple en text + color del botón
            // (no generamos un <ui:Label> anidado).
            string text = "";
            string textColor = "#ffffff";
            foreach (var child in (JArray)root["children"])
            {
                if ((string)child["type"] == "Label")
                {
                    text = (string)child["text"];
                    textColor = (string)child["style"]["color"];
                    break;
                }
            }

            var uxml = new StringBuilder();
            uxml.AppendLine("<ui:UXML xmlns:ui=\"UnityEngine.UIElements\">");
            uxml.AppendLine("  <Style src=\"Button.uss\" />");
            uxml.AppendLine($"  <ui:Button name=\"{id}\" text=\"{text}\" class=\"{cls}\" />");
            uxml.AppendLine("</ui:UXML>");

            int px = (int)layout["paddingX"];
            int py = (int)layout["paddingY"];
            string bg = (string)style["background"];
            int radius = (int)style["radius"];
            string align = (string)layout["alignItems"];

            var uss = new StringBuilder();
            uss.AppendLine($".{cls} {{");
            uss.AppendLine($"  padding-left: {px}px; padding-right: {px}px;");
            uss.AppendLine($"  padding-top: {py}px; padding-bottom: {py}px;");
            uss.AppendLine($"  align-items: {align};");
            uss.AppendLine($"  background-color: {bg};");
            uss.AppendLine($"  border-radius: {radius}px;");
            uss.AppendLine($"  color: {textColor};");
            uss.AppendLine("}");

            var hover = style["states"]?["hover"];
            if (hover != null)
            {
                string hbg = (string)hover["background"];
                uss.AppendLine($".{cls}:hover {{ background-color: {hbg}; }}");
            }

            return (uxml.ToString(), uss.ToString());
        }
    }
}
```

- [ ] **Step 5: Correr los tests EditMode en Unity**

Abre el proyecto Unity que incluya este paquete (vía Package Manager → Add package from disk → `ui/plugins/unity/package.json`). Window → General → Test Runner → EditMode → Run All.
Expected: `IrToUxmlTests` (ambos) PASS.

- [ ] **Step 6: Commit**

```bash
cd ui && git add -A && git commit -m "feat(unity): IrToUxml conversor puro IR→UXML/USS + tests EditMode"
```

---

## Task 7: Plugin Unity — ventana de import + sample renderizable

**Files:**
- Create: `ui/plugins/unity/Editor/ImportIrWindow.cs`
- Modify: (ninguno; usa `IrToUxml` de Task 6)

**Interfaces:**
- Consumes: `IrToUxml.Convert` (Task 6).
- Produces: menú `zabloo → Import IR…`; escribe `Assets/Zabloo/Button.uxml`, `Button.uss`, `Button.binding.cs` y crea un `UIDocument` de sample en la escena activa.

> **Verificación:** manual/visual en Unity. Es el "ver que tal todo" del PoC.

- [ ] **Step 1: Implementar la ventana de import**

`ui/plugins/unity/Editor/ImportIrWindow.cs`:
```csharp
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Editor
{
    public class ImportIrWindow : EditorWindow
    {
        private string _irPath = "";

        [MenuItem("zabloo/Import IR…")]
        public static void Open() => GetWindow<ImportIrWindow>("Zabloo Import IR");

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Ruta del button.ir.json");
            using (new EditorGUILayout.HorizontalScope())
            {
                _irPath = EditorGUILayout.TextField(_irPath);
                if (GUILayout.Button("…", GUILayout.Width(28)))
                {
                    var picked = EditorUtility.OpenFilePanel("Selecciona button.ir.json", "", "json");
                    if (!string.IsNullOrEmpty(picked)) _irPath = picked;
                }
            }
            using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(_irPath) || !File.Exists(_irPath)))
            {
                if (GUILayout.Button("Importar")) Import(_irPath);
            }
        }

        private static void Import(string irPath)
        {
            string irJson = File.ReadAllText(irPath);
            var (uxml, uss) = IrToUxml.Convert(irJson);

            const string dir = "Assets/Zabloo";
            Directory.CreateDirectory(dir);
            File.WriteAllText($"{dir}/Button.uxml", uxml);
            File.WriteAllText($"{dir}/Button.uss", uss);
            File.WriteAllText($"{dir}/Button.binding.cs",
                "// Stub generado por zabloo (PoC). Wiring de onClick:\n" +
                "// root.Q<UnityEngine.UIElements.Button>(\"buy-btn\").clicked += () => OnBuy();\n");
            AssetDatabase.Refresh();

            CreateSample($"{dir}/Button.uxml", dir);
            EditorUtility.DisplayDialog("Zabloo", "IR importada en Assets/Zabloo.", "OK");
        }

        // Crea un UIDocument en la escena activa para ver el botón al instante.
        private static void CreateSample(string uxmlAssetPath, string dir)
        {
            var vta = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(uxmlAssetPath);

            string panelPath = $"{dir}/ZablooPanelSettings.asset";
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(panelPath);
            if (panel == null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panel, panelPath);
                AssetDatabase.SaveAssets();
            }

            var existing = GameObject.Find("ZablooSample");
            if (existing != null) Object.DestroyImmediate(existing);

            var go = new GameObject("ZablooSample");
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = panel;
            doc.visualTreeAsset = vta;
            Selection.activeGameObject = go;
        }
    }
}
```

- [ ] **Step 2: Verificación visual en Unity**

1. Genera la IR: `cd ui && tsx packages/cli/src/bin.ts build examples/button/app.tsx`.
2. En Unity: menú `zabloo → Import IR…` → selecciona `ui/examples/button/out/button.ir.json` → Importar.
3. Comprueba: aparece `Assets/Zabloo/Button.uxml` + `.uss` + `.binding.cs`, y un GameObject `ZablooSample` con `UIDocument`.
4. En Game/Play view el botón se ve con fondo `#4f46e5`, padding 16/8, esquinas redondeadas; al pasar el ratón cambia a `#4338ca`.

Expected: botón visible y `:hover` funcionando.

- [ ] **Step 3: Commit**

```bash
cd ui && git add -A && git commit -m "feat(unity): ventana Import IR + sample UIDocument renderizable"
```

---

## Done (criterio de cierre del PoC)

1. `cd ui && pnpm test` → verde (core, react, example, cli).
2. `zabloo build examples/button/app.tsx` → genera `out/button.ir.json` idéntico al snapshot.
3. En Unity, `zabloo → Import IR…` produce un botón visible con padding/fondo/radio correctos y `:hover` funcionando.

## Out of scope (recordatorio)

Más componentes/estados/variants, `capabilities`, versionado/migración de IR, focus/navegación, bindings ricos, animaciones, Godot/Unreal, estado de runtime en React.
