# zabloo/ui — project context

**zabloo/ui** is a **UI platform for videogames**. Companies build the UI and **dynamic
content** of their games (menus, stores, in-game social feeds, HUDs…) with zabloo/ui's
tools, and an **SDK installed in the game renders that content inside the graphics
engine**. The content lives on the platform and can be **hot-updated** — pushed to live
games without recompiling or shipping through the app/console stores.

## Rendering architecture: "we draw it ourselves" (Flutter/Rive model)

zabloo/ui does **not** map components to each engine's native widgets, and does **not**
embed a browser. Components are described in an engine-agnostic **intermediate format (the
IR)** — a component tree + resolved styles + **vector draw commands** + events — and each
engine's **SDK tessellates that IR into GPU geometry at runtime**.

```
authoring / platform → IR (tree + styles + draw commands + events) → per-engine SDK (tessellate → GPU) → pixels
```

- **zabloo/ui owns** layout, drawing, hit-testing (geometric), states and animations.
- **The engine only provides** meshes and draw calls — a GPU canvas to paint on.
- **Golden rule:** the shared **core never knows about any specific engine**. Each SDK is
  a thin adapter that hands the core's tessellated geometry to its engine.
- There is exactly **one IR**, consumed by every SDK — never a per-engine format.

**Why this model** (see `decisions-architecture.md` for the full trade-off): pixel-
identical results across engines, components impossible with native widgets (e.g. a radial
selector), a light SDK, native performance, and **console compatibility** (consoles have no
Chromium, so an embedded browser is a non-starter).

The IR is the **keystone** of the whole system. Its full design context is in
`ir-context.md` (imported into the product context) — read it before working on the IR.

## Scope

- **v1: only the Unity SDK renders output.** Technical landing path: **UI Toolkit with
  custom geometry** (`generateVisualContent` / the Mesh API). Godot and Unreal are
  **designed from the start** (every IR decision is validated against all three engines)
  but do not render yet.
- **Multi-engine later** via a **shared core** (the tessellator + the IR runtime) plus
  **thin per-engine adapters** (Unity, then Godot, Unreal…). Open decision: when to extract
  the tessellator into a shared **C++** core vs. starting it inside the Unity SDK.
- **Content lives on the platform** and is delivered to the SDK, enabling hot-update.

## Authoring (decided 2026-07-09: React bindings first)

The primary authoring path for v1 is **`@zabloo/react`** — a React binding with its
**own component library** (own components/props/rules; **not** MUI or any web UI kit)
whose JSX **emits the IR** via a custom reconciler (react-three-fiber style: React drives
the tree, nothing renders to DOM). A **visual web editor** comes **later, on top of the
same IR**; its WYSIWYG canvas renders with the **same core renderer** (WebGL) — the
browser is just another engine target, so the preview is pixel-identical to the in-game
result. See `decisions-architecture.md` (2026-07-09) for the trade-offs.

**Workflow (Flutter/RN-style project):** the developer creates a project and writes the
whole UI in React; an **export** step emits the views/scenes as versioned IR JSON, which
the engine SDK **imports and renders**. Important: user-defined React components never
reach the IR — they execute at authoring time and emit zabloo primitives. The SDK loader
treats a manually imported JSON and a platform hot-update as the **same versioned
payload** (one loading path). And the SDK **renders** the IR (tessellation) — it never
"converts" it to the engine's native widgets (Flutter model, not React Native; see
2026-07-09 note).

## Stack

- **TypeScript / Node** for the platform (`app`) and the core's authoring/tooling side.
- The **tessellator + IR runtime** is a candidate for a shared **C++** core; the first SDK
  ships in **Unity (C#)** via UI Toolkit custom geometry.
- npm scope: **`@zabloo/*`**. CLI command: **`zabloo`** (alias `zb`) — role decided
  2026-08-02: `export` (v1), later `dev` / `login` / `push`. Project DX is Flutter/RN-style:
  `create-zabloo-app` scaffold, file-based views in `src/views/`, `pnpm build` = `zabloo
  export` → versioned IR envelope. See `decisions-architecture.md` (2026-08-02).
- Monorepo tooling for `ui`: **pnpm workspaces** for the TS parts (proposed; revisable).

## Repos (org `zabloo-hub`)

- **`ui`** (public, OSS): the shared **core** (tessellator + IR runtime), the **per-engine
  SDKs** (Unity first), the **IR/format spec**, and the **base component library**.
- **`app`** (private, commercial): the **platform** (content authoring + management +
  hosting + hot-update delivery), billing/licensing, team features — landing/product
  pages live on zabloo.com (repo `landing`), decided 2026-08-10.
- **`web`** (private): the zabloo game (own committed context) + the legacy Ghost
  landing it still serves.
- **`landing`** (private): the new zabloo.com landing — brand/business context and the
  brand/org decision log live there.

Every repo is **self-contained**: its own context is committed inside it. This repo's
context is `docs/internal/` (this file, `ir-context.md`, `decisions-architecture.md`,
`roadmap.md`, `specs/`, `plans/`), loaded from `CLAUDE.md`.

### Proposed layout of the `ui` repo (revisable)

```
ui/
├── packages/    core (IR runtime + tessellator) · format (IR spec/types) · authoring tooling
├── sdk/         unity (C#, reference v1) · godot · unreal   (thin engine adapters)
└── components/  base component library (free, open source)
```

## How we work (current phase)

> IMPORTANT: We are in the **vertical-slice** phase (since 2026-08-01). The **IR v1
> minimal scope is decided** (see `decisions-architecture.md` 2026-08-01 and the agenda
> in `ir-context.md`); the next step is validating it end-to-end with a slice
> (JSX → IR JSON → Unity SDK renders a pressable Button), starting with a **text/glyph
> spike**. Spike/slice code is expected — but no premature productization beyond the
> slice. Where a decision is still open (variants, focus, composites, text strategy),
> **argue the trade-offs** instead of silently picking one.

The author is a **solo founder** with ~10 years of frontend/React + Three.js/WebGL,
**learning the engines** (Unity/C#, Godot, Unreal). When something is engine-specific,
**explain it** instead of assuming prior knowledge.

- Do **not** propose solutions based on embedding browsers (CEF/webview): that path is
  **rejected** and the reason is in `decisions-architecture.md`.
- Work across several computers via GitHub: `git pull` before starting, `commit` + `push`
  when done — in each repo.
- **Never** commit secrets (keys, tokens, passwords).
- Record decisions: **architecture** → `decisions-architecture.md` (this repo);
  **product/roadmap** → `roadmap.md` (this repo); **business, brand and org** → the
  private `landing` repo (`docs/decisions-brand-org.md`, `docs/monetization.md`).
