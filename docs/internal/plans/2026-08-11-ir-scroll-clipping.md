# ZAB-5 — Scroll y clipping en la IR: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** materializar la decisión ZAB-5 (spec `docs/internal/specs/2026-08-11-ir-scroll-clipping-design.md`): `clip` en `NodeBase` + primitivo `ScrollView` en `@zabloo/format`, con tests, entry en el decision log y status en `ir-context.md`, terminando en una PR del repo `ui`.

**Architecture:** solo el contrato (tipos TS + tests) — cero cambios de runtime. `parseEnvelope` no cambia: la validación nueva es a nivel de tipos, y la forward-tolerance existente es precisamente lo que la spec convierte en normativa. Los SDKs/teseladores se tocan en otras tareas de F1.

**Tech Stack:** TypeScript (strict), vitest, pnpm workspaces. Repo: `ui` (worktree rama `ZAB-5-a1-ir-clipping-y-scroll-en-el-formato`); el log de decisiones se commitea directo a `main`.

## Global Constraints

- Working dir del código: `<worktree>/ZAB-5-a1-ir-clipping-y-scroll-en-el-formato`.
- `parseEnvelope` conserva su filosofía: valida SOLO forma del envelope + versión mayor. No añadir validación por nodo.
- Tests tipados **sin casts** (`as`) fuera del caso explícito de passthrough de tipos desconocidos.
- Docstrings/código en inglés (estilo del repo `ui`); docs de `docs/internal/` en español (estilo de los entries recientes).
- Commits en `ui` con el trailer de coautoría de Claude; el log de decisiones se pushea directo a `main` (convención multi-ordenador).

---

### Task 1: tipos `clip` + `ScrollViewNode` y tests en `@zabloo/format`

**Files:**
- Modify: `packages/format/src/index.ts`
- Test: `packages/format/src/index.test.ts`

**Interfaces:**
- Consumes: tipos existentes (`NodeBase`, `ZNode`, `Envelope`, `parseEnvelope`).
- Produces: `ScrollViewNode` (exportado, `type: "ScrollView"`, `axis?: ScrollAxis`, `scrollbar?: boolean`, `children?: ZNode[]`), `ScrollAxis = "vertical" | "horizontal" | "both"` (exportado), `NodeBase.clip?: boolean`, `"ScrollView"` dentro de la unión `ZNode`. Es lo que consumirán `@zabloo/react` y los SDKs en las siguientes tareas de F1.

- [ ] **Step 1: escribir los tests que fallan**

Añadir al final de `packages/format/src/index.test.ts` (añade `Envelope` y el futuro `ScrollViewNode` al import de `./index.js`; `Envelope` es import de tipo):

```ts
describe("scroll & clipping (ZAB-5)", () => {
  // Typed without casts: this file failing `tsc --noEmit` IS the type test.
  const scrollEnvelope: Envelope = {
    v: IR_VERSION,
    tokens: {},
    views: {
      settings: {
        type: "ScrollView",
        axis: "horizontal",
        scrollbar: false,
        layout: { grow: 1 },
        children: [
          {
            type: "Container",
            clip: true,
            children: [{ type: "Text", text: "row" }],
          },
        ],
      },
    },
  };

  it("accepts a ScrollView view with clipped children", () => {
    const env = parseEnvelope(scrollEnvelope);
    expect(env.views.settings?.type).toBe("ScrollView");
  });

  it("axis and scrollbar are optional (defaults live in the SDK)", () => {
    const bare: ScrollViewNode = { type: "ScrollView" };
    const env = parseEnvelope({ v: IR_VERSION, tokens: {}, views: { s: bare } });
    expect(env.views.s?.type).toBe("ScrollView");
  });

  it("unknown node types pass through parse with their subtree intact", () => {
    // What lets an old SDK apply the normative fallback (render as Container
    // preserving children) instead of losing the content.
    const env = parseEnvelope({
      v: IR_VERSION,
      tokens: {},
      views: {
        f: {
          type: "FutureThing",
          futureProp: 1,
          children: [{ type: "Text", text: "kept" }],
        },
      },
    });
    const node = env.views.f as unknown as {
      children: Array<{ text: string }>;
    };
    expect(node.children[0]?.text).toBe("kept");
  });
});
```

- [ ] **Step 2: verificar que falla**

Run: `pnpm --filter @zabloo/format typecheck`
Expected: FAIL — `"ScrollView"` no es asignable a `ZNode` / `ScrollViewNode` no exportado / `clip` no existe en `ContainerNode`.
(`pnpm --filter @zabloo/format test` puede pasar ya — vitest no typechequea; el gate rojo de esta task es el typecheck.)

- [ ] **Step 3: implementación mínima en `packages/format/src/index.ts`**

(a) `clip` en `NodeBase`, junto a `visible`:

```ts
  /**
   * Clips children's paint AND hit-testing to this node's layout rect
   * (paint-only config, like `opacity` — no runtime state). Overflowing
   * children neither draw nor receive input outside the rect.
   */
  clip?: boolean;
```

(b) Tras `CollapseNode`, el 5º primitivo:

```ts
/** Scrollable axis of a ScrollView. */
export type ScrollAxis = "vertical" | "horizontal" | "both";

/**
 * Scrollable region (5th primitive, decision 2026-08-11). A normal flex
 * container on both sides: its own size comes from its layout props, and
 * `direction`/`justify`/`align`/`gap`/`padding` apply to its children — but
 * children are measured UNCONSTRAINED on the scrollable axis, and the SDK owns
 * the runtime scroll offset (clamped to `max(0, contentSize - viewport)` on
 * every relayout) plus the wheel/drag input and the overlay scrollbar.
 * Always clips; an explicit `clip: false` is ignored.
 */
export interface ScrollViewNode extends NodeBase {
  type: "ScrollView";
  /** Scrollable axis. Default: "vertical". */
  axis?: ScrollAxis;
  /** Overlay position indicator painted by the SDK. Default: true. */
  scrollbar?: boolean;
  children?: ZNode[];
}
```

(c) La unión: `export type ZNode = ContainerNode | TextNode | ButtonNode | CollapseNode | ScrollViewNode;`

(d) Docstring de cabecera del archivo — dos líneas cambian:

```
 * - v1 vocabulary is a closed set of 5 primitives: Container, Text, Button,
 *   Collapse, ScrollView.
 * - Forward-tolerant: SDKs ignore unknown props, render unknown node types as a
 *   Container preserving `layout`/`style`/`visible`/`children` (normative rule,
 *   decision 2026-08-11), and refuse only on a major-version mismatch.
```

(La cabecera hoy dice "3 primitives" — estaba desactualizada respecto a `Collapse`; queda corregida de paso. La `NOTE` final de la cabecera sobre el style set en finalización puede borrarse: el set se cerró el 2026-08-06.)

- [ ] **Step 4: verificar que pasa**

Run: `pnpm --filter @zabloo/format typecheck && pnpm --filter @zabloo/format test`
Expected: PASS (typecheck limpio; suite completa en verde, incluidos los 3 tests nuevos).

- [ ] **Step 5: commit (repo `ui`, en la rama del worktree)**

```bash
git add packages/format/src/index.ts packages/format/src/index.test.ts
git commit -m "Add clip + ScrollView (5th primitive) to the IR format (ZAB-5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UVVEU7VxakWa3tWSrMNu9V"
```

---

### Task 2: decision log + status en `ir-context.md`

**Files:**
- Modify: `docs/internal/decisions-architecture.md` (entry nuevo al final)
- Modify: `docs/internal/ir-context.md` (status block + agenda §4)

**Interfaces:**
- Consumes: la decisión tal y como quedó en el spec (`docs/internal/specs/2026-08-11-ir-scroll-clipping-design.md`).
- Produces: contexto que las siguientes tareas de F1 (teseladores, SDKs, react) cargarán vía `CLAUDE.md`.

- [ ] **Step 1: añadir el entry al final de `decisions-architecture.md`**

> Ojo: hay sesiones paralelas tocando este archivo (ZAB-10, ZAB-15) — hacer
> `git pull` antes de editar y añadir el entry AL FINAL del archivo,
> después del último entry existente.

```markdown
## 2026-08-11 — Scroll y clipping en la IR: `clip` en NodeBase + primitivo `ScrollView` (5º)

**Decision (ZAB-5, cierra el diseño de F1 en la IR):** dos capacidades, dos
superficies:
1. **Clipping = prop de paint `clip?: boolean` en `NodeBase`.** Recortar el
   subárbol al rect del nodo es puro paint (como `opacity`) — cero estado, cero
   input — así que la regla "behavior keyed by component type" no aplica.
   Cualquier nodo puede recortar sin scroll (overflow:hidden: cards, ProgressBar
   en F7…). El clip recorta **paint y hit-testing** (un hijo desbordado ni se
   pinta ni recibe input fuera del rect; rect efectivo = intersección con el clip
   de los ancestros — "hit-testing = rects de layout" sigue honesto).
2. **Scroll = primitivo `ScrollView`** (`axis: "vertical" | "horizontal" |
   "both"`, default vertical; `scrollbar: boolean`, default true; implica clip).
   Entra por la puerta legítima del vocabulario ("new primitives only when they
   force a new system capability"): estado de offset en runtime + input continuo
   (rueda/drag) + scrollbar overlay del SDK. Comportamiento indexado por
   identidad, como Button/Collapse; focusabilidad/hit-testing siguen derivando de
   identidad (2026-08-04). Vocabulario: 5.

**Semántica clave:** flex container normal por fuera y por dentro; la única
diferencia es que en el eje scrolleable los hijos se miden SIN restricción (el
contenido define el content size; padding cuenta como contenido; desplazamiento
máx = `max(0, contentSize − viewport)`). El offset es estado del runtime del SDK
(no se serializa; se reclampa en cada relayout). Hit-testing y focus espacial usan
los rects trasladados (posiciones en pantalla). El borde inset (2026-08-06)
garantiza que el clip por scissor rectangular no puede cortar un borde.

**Forward-tolerance, regla normativa nueva:** un tipo de nodo desconocido se
renderiza como **`Container` preservando `layout`/`style`/`visible`/`children`**
(props específicas ignoradas). Con esto un SDK pre-F1 que recibe un `ScrollView`
muestra el contenido entero sin recortar ni scrollear — el contenido nunca
desaparece, misma degradación que habría dado una prop. Esto desmonta el
argumento pro-prop: la diferencia real nunca fue la degradación sino dónde vive
el comportamiento.

**Diferidos:** ScrollTo/offset bindeable y auto-scroll del focus con gamepad
(→ F5), inercia/momentum, scrollbar estilable (booleano → objeto, compatible),
snap.
**Alternatives considered:** prop única `overflow: "visible"|"hidden"|"scroll"`
en Container (modelo CSS — rechazada: el SDK despacharía comportamiento por tipo
O por prop, dos mecanismos; rompe la decisión 2026-08-01 #3); ScrollView sin
clip independiente (rechazada: obligaría a un ScrollView "capado" para
overflow:hidden). Spec: `docs/internal/specs/2026-08-11-ir-scroll-clipping-design.md`.
```

- [ ] **Step 2: actualizar `ir-context.md`**

(a) Añadir al final del bloque de status de la cabecera (tras el status de
2026-08-11 del texto):

```markdown
>
> **Status 2026-08-11: scroll y clipping DECIDIDOS (ZAB-5, F1)** — `clip` en
> NodeBase (paint-only, recorta paint + hit-testing) + **`ScrollView` como 5º
> primitivo** (axis/scrollbar; hijos medidos sin restricción en el eje
> scrolleable; offset = estado del SDK). Regla normativa nueva de
> forward-tolerance: tipo desconocido → se renderiza como Container preservando
> children. Ver `decisions-architecture.md` (2026-08-11, scroll).
```

(b) En la agenda, punto 4 (primitive vocabulary), actualizar la lista:
`Container`, `Text`, `Button`, `Collapse` → añadir `ScrollView` con la nota
"(added 2026-08-11: scroll — offset state + continuous input)".

- [ ] **Step 3: commit + push directo a `main`**

```bash
cd docs/internal && git pull && git add ui/decisions-architecture.md ui/ir-context.md && git commit -m "ZAB-5: scroll y clipping decididos — clip en NodeBase + primitivo ScrollView

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UVVEU7VxakWa3tWSrMNu9V" && git push
```

---

### Task 3: PR del repo `ui`

**Files:** ninguno nuevo (push + PR de la rama `ZAB-5-a1-ir-clipping-y-scroll-en-el-formato`).

**Interfaces:**
- Consumes: el commit de la Task 1.
- Produces: PR contra `main` de `zabloo-hub/ui`, enlazada a ZAB-5 en Linear por el nombre de rama.

- [ ] **Step 1: verificación final del workspace**

Run (desde la raíz del worktree): `pnpm -r typecheck && pnpm -r test`
Expected: PASS en todos los paquetes (los tipos nuevos no rompen a los consumidores — `react`, `cli`, `renderer-web` no cambian).

- [ ] **Step 2: push + PR**

```bash
git push -u origin ZAB-5-a1-ir-clipping-y-scroll-en-el-formato
gh pr create --title "IR: clip + ScrollView (5th primitive) in @zabloo/format (ZAB-5)" --body "## Qué

La parte de formato de F1 (ZAB-5): \`clip?: boolean\` en \`NodeBase\` (paint-only: recorta paint + hit-testing del subárbol) y el 5º primitivo \`ScrollView\` (\`axis\`, \`scrollbar\`; implica clip), con tests tipados y el caso de passthrough de tipos desconocidos que sustenta el fallback normativo (tipo desconocido → Container preservando children).

Sin cambios de runtime: \`parseEnvelope\` conserva su filosofía (forma del envelope + versión mayor). Teseladores/SDKs/react llegan en las siguientes tareas de F1.

## Decisión

Spec y racional completos: \`docs/internal/specs/2026-08-11-ir-scroll-clipping-design.md\` y \`decisions-architecture.md\` (2026-08-11).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01UVVEU7VxakWa3tWSrMNu9V"
```

Expected: PR creada; Linear la adjunta a ZAB-5 automáticamente (rama `zab-5-…`).
