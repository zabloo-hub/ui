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

- **Godot is the first engine that renders** (decided 2026-08-24), through a
  **GDExtension in C++** — and that C++ **is the shared core**: layout, text, tessellation,
  the state/binding/transition runtime and the `ViewSnapshot`. `sdk/godot` is a thin
  adapter that uploads triangles (`canvas_item_add_triangle_array`) and translates input.
  Unreal is **designed from the start** (every IR decision is validated against all three
  engines) but does not render yet.
- **The core is extracted now, not later.** The 2026-07-06 open question ("when to extract
  the tessellator into a shared C++ core") is closed for one reason: the first engine that
  renders needs it, so writing it inside an adapter would mean writing it twice. Every
  further engine — Unreal, and Unity when it comes back — is a **thin adapter** on the same
  core, never another port.
- **The core must be able to produce a `ViewSnapshot` with no engine at all.** That is what
  draws the core/adapter line, and it is what lets the `golden/` corpus run against a
  native binary in CI on a bare CPU — no engine, no GPU.
- **The Unity SDK is cancelled** at 4 of 13 node types (`sdk/unity` is deleted in F11's
  G17). Unity returns some day as a thin adapter over this core, not as a C# port.
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
- The **tessellator + IR runtime** is a shared **C++** core (`core/`), decided 2026-08-24
  and built with SCons. The first SDK ships it as a **GDExtension for Godot 4.4+**
  (`godot-cpp`); v1 platforms are desktop and mobile, with web experimental (GDExtension
  on the web needs `dlink` export templates) and consoles "compiles, not validated".
- npm scope: **`@zabloo/*`**. CLI command: **`zabloo`** (alias `zb`) — role decided
  2026-08-02: `export` (v1), later `dev` / `login` / `push`. Project DX is Flutter/RN-style:
  `create-zabloo-app` scaffold, file-based views in `src/views/`, `pnpm build` = `zabloo
  export` → versioned IR envelope. See `decisions-architecture.md` (2026-08-02).
- Monorepo tooling for `ui`: **pnpm workspaces** for the TS parts (proposed; revisable).

## Repos (org `zabloo-hub`)

- **`ui`** (public, OSS): the shared **core** (tessellator + IR runtime), the **per-engine
  SDKs** (Godot first), the **IR/format spec**, and the **base component library**.
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

### Layout of the `ui` repo (`core/` decided 2026-08-24; see `docs/project-structure.md`)

```
ui/
├── core/        the shared C++ core: layout · text · tessellation · runtime · ViewSnapshot
├── packages/    the pnpm workspace (TS): format · react · cli · renderer-web · preview
├── sdk/         godot (thin adapter + installable addon) · unreal later
├── examples/    zabloo projects, plus one engine playground per SDK
└── golden/      the cross-target corpus: envelopes + the metrics every target reproduces
```

`core/` sits at the **root**, a sibling of `sdk/` and `packages/`, on purpose. Not inside
`packages/`, where `packages/*` means *pnpm workspace package* (all published to npm but
`preview`); and not inside `sdk/`, which would blur the very line the golden rule protects —
the `sdk/*` know about their engine, the core knows about none.

## How we work (current phase)

> IMPORTANT: We are in the **Godot SDK** phase (F11, since 2026-08-24). The IR agenda is
> closed, the catalog is complete and hardened in the **web renderer** — which is the
> **reference implementation**, and whose pure modules (`states.ts`, `overlay.ts`,
> `slider.ts`, `textinput.ts`, `transition.ts`, `gamepad.ts`…) are the literal reference
> being ported — and `@zabloo/*` 0.2.0 is published on npm. The work now is building the
> **C++ core** and the **Godot adapter** on top of it, capability by capability, each one
> closing against its case in the `golden/` corpus.
>
> Two rules that follow from that: the **corpus is the contract** (same envelope → same
> metrics; if Godot and the web disagree, one of them is wrong and the spec says which),
> and **the web renderer's behavior is not up for reinterpretation** during the port —
> if the port finds a genuine bug in it, fix it there and re-record the corpus, rather
> than letting the two targets drift.

The author is a **solo founder** with ~10 years of frontend/React + Three.js/WebGL,
**learning the engines** (Godot, Unreal) and **not a C++ native**. When something is
engine- or C++-specific, **explain it** instead of assuming prior knowledge.

- Do **not** propose solutions based on embedding browsers (CEF/webview): that path is
  **rejected** and the reason is in `decisions-architecture.md`.
- Work across several computers via GitHub: `git pull` before starting, `commit` + `push`
  when done — in each repo.
- **Never** commit secrets (keys, tokens, passwords).
- Record decisions: **architecture** → `decisions-architecture.md` (this repo);
  **product/roadmap** → `roadmap.md` (this repo); **business, brand and org** → the
  private `landing` repo (`docs/decisions-brand-org.md`, `docs/monetization.md`).
