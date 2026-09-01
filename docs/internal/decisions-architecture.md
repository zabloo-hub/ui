# Decision log (architecture)

Every important **architecture / structure / convention** decision is recorded here with
its date and reason, so context travels with the repo across computers and Claude Code
loads it on start (imported from `CLAUDE.md`).

> Business decisions (monetization, pricing, brand/org strategy) are **not** kept here —
> they live in the private `landing` repo (`docs/`). This public log is architecture only.

## Template

```
## YYYY-MM-DD — Title
**Decision:** what was decided.
**Reason:** why.
**Alternatives considered:** optional.
```

---

## 2026-06-24 — Project: a "shadcn/ui for game engines"
**Decision:** zabloo/ui is a copy-paste, you-own-the-code UI component library. Developers
author UI once (React/JSX-style + design tokens) and it compiles to native UI for Unity,
Godot and Unreal.
**Reason:** author once, ship native UI to any engine; own the generated code.
**⚠️ Superseded by 2026-07-06 — Product pivot: UI platform + rendering SDK (hot-update).**
The copy-paste / you-own-the-code / compile-to-native-widgets framing no longer holds.

## 2026-06-24 — Architecture: a compiler (core → IR → plugins)
**Decision:** the system is a compiler — `authoring → IR → per-engine plugin → native
UI`. An engine-agnostic **core** produces the **IR**; a **plugin per engine** lowers it.
The core never knows about any specific engine.
**Reason:** the IR is the single contract between the frontend and every backend; keeping
the core engine-agnostic lets us add engines without touching it.
**⚠️ Partly superseded by 2026-07-06 — Rendering: "we draw it ourselves".** The pipeline
`authoring → IR → per-engine SDK` and the engine-agnostic-core golden rule **survive**;
"per-engine plugin **lowers to native UI**" is replaced by "per-engine **SDK tessellates
the IR to GPU geometry at runtime**".

## 2026-06-24 — Core in TypeScript → a single IR (JSON); lowering in native plugins
**Decision:** the **core (TypeScript)** does `authoring → IR (a single JSON)`, resolving
tokens and computing **style per node**. There are **three native plugins** (Unity/C#,
Godot/GDScript|C#, Unreal/C++); each **reads that IR JSON and does the lowering** to
native UI. There is **no per-engine intermediate JSON** — one IR, three native readers.
**Reason:** one shared, typed contract (the IR) keeps the pipeline coherent; native
plugins integrate with each engine's editor and handle engine-specific output (e.g.
Unreal's binary `.uasset` codegen) that text copy-paste cannot.
**Alternatives considered:** TS-based lowering emitting native text for all engines —
rejected because Unreal needs native codegen anyway and native plugins give better editor
integration. Trade-off accepted: native lowering is tested per engine; cheap snapshot
tests in TS cover `authoring → IR`.
**⚠️ Superseded by 2026-07-06 — Shared core (tessellator + runtime) + thin SDK adapters.**
"One IR, engine-agnostic core" survives; "native plugins **lower to native widgets** /
codegen `.uasset`" is replaced by "**SDKs tessellate the IR to GPU geometry at runtime**".

## 2026-06-24 — IR: resolved-per-node, no cascade, capability-aware
**Decision:** the IR is declarative, serializable JSON; styles reference design tokens;
style is **computed/resolved per node** (no CSS-style cascade); states are explicit; the
IR is **capability-aware** (plugins declare gaps rather than mis-rendering). Layout
primitive is **Flexbox (Yoga semantics)**.
**Reason:** two of three target engines (Godot, Unreal) have no cascade; the IR must be
consumable directly per node. See `ir-context.md` for the full design context.
**♻️ Mostly still valid (updated 2026-07-06).** Resolved-per-node, no cascade, explicit
states and Flexbox **survive**. Two updates under the self-render model: (a) the IR now
also carries **vector draw commands** and **events**, and is **consumed at runtime + hot-
updated over the wire** (so serialization/versioning is first-class); (b) "capability
gaps" matter less — we render everything ourselves rather than mapping to native widgets.

## 2026-06-24 — v1 generates for Unity only; Godot/Unreal designed in parallel
**Decision:** in v1 **only Unity produces native output** (UI Toolkit ≈ Yoga Flexbox,
closest to the IR → reference plugin). Godot and Unreal flows/builders are designed from
the start and every IR decision is validated against all three engines.
**Reason:** focus delivery on one engine while keeping the IR honest for all three.
**♻️ Still valid (updated 2026-07-06).** Unity-first survives; the landing path is now
**UI Toolkit custom geometry** (`generateVisualContent` / Mesh API), not native-widget
generation. See the new 2026-07-06 decision.
**⚠️ Superseded by 2026-08-24 — Godot is the first engine that renders.** "One engine
first, with the IR kept honest for all three" **survives**; the engine is now **Godot**,
via a GDExtension in C++ that *is* the shared core. The Unity SDK is cancelled at 4/13
node types.

## 2026-06-24 — Authoring model: hybrid (local code + CLI primary)
**Decision:** the **primary** authoring path is **local code + CLI** (`zabloo build` → IR
→ native plugin import). The landing is a **showcase/registry**. A **web playground** is a
later phase, not the main path.
**Reason:** fits "you own the code" and build-time compilation; avoids building a full
visual editor up front; works for all three engines (text copy-paste only covers
Unity/Godot, not Unreal's binary assets).
**⚠️ Superseded by 2026-07-06 — Platform-centric authoring + hot-update.** Content is
created/managed on the **platform** and delivered to the SDK; the authoring language
(HTML/CSS-like that compiles to the IR vs. bespoke format) is an **open decision**. CLI's
role is TBD.

## 2026-06-24 — Stack: TypeScript/Node; native plugins per engine
**Decision:** TypeScript/Node for **core + CLI + landing**; each plugin in its engine's
native language. npm scope **`@zabloo/*`**; CLI command **`zabloo`** (alias `zb`).
Monorepo tooling: **pnpm workspaces** (proposed; revisable).
**Reason:** React/JSX authoring maps naturally to a TS/React renderer emitting JSON;
end-to-end types over the IR; one toolchain for core + CLI + web.
**♻️ Updated 2026-07-06.** TS/Node for the platform + authoring tooling survives; npm
scope `@zabloo/*` and CLI `zabloo` survive. Change: the **tessellator + IR runtime** is a
candidate **shared C++ core**, and per-engine code is a **thin SDK adapter** (Unity/C#
first) rather than a native lowering plugin.

## 2026-06-24 — Repository split: public `ui` + private `app`
**Decision:** the project lives in two repos under the `zabloo-hub` org: **`ui`** (this
repo — public, OSS pipeline) and **`app`** (private — web app/landing and commercial
parts). A third private repo, **`ai-docs`**, held the shared AI/working context
(retired 2026-08-23 — see the entry at the end of this log).
**Reason:** the frequently co-edited parts (IR + plugins) are all open and stay together
in this monorepo; the closed/commercial parts only consume the published packages, so
they break out cleanly into a separate private repo.
**Supersedes:** the earlier placeholder decision "zui as a monorepo of services
(landing, core, ...)".
**♻️ Still valid (updated 2026-07-06).** The split is unchanged. Under the platform pivot,
the contents map as: `ui` = shared **core** (tessellator + IR runtime) + per-engine
**SDKs** + IR/format spec + base components; `app` = the **platform** (authoring +
hosting + hot-update delivery) + landing + premium + billing.

---

## 2026-07-06 — Product pivot: a UI platform for videogames (+ rendering SDK, hot-update)
**Decision:** zabloo/ui is a **platform** where companies build the UI and **dynamic
content** of their games (menus, stores, in-game social, HUDs…), and an **SDK installed in
the game renders that content inside the engine**. Content lives on the platform and can
be **hot-updated** to live games without recompiling or shipping through app/console
stores.
**Reason:** owning the creation side bounds the technical problem (we don't support "the
open web") and enables the business model — zabloo/ui is the creation, distribution and
rendering layer for game UI.
**Supersedes:** 2026-06-24 "shadcn/ui for game engines" (copy-paste, you-own-the-code,
compile-to-native-widgets, build-time, no runtime).
**Note (to validate):** hot-updating UI/content has **store/console policy** implications
(Apple/Google/first-party cert rules on downloadable content and changing app behavior).
Flag for later legal/policy review; not a blocker for the IR work.

## 2026-07-06 — Rendering: "we draw it ourselves" (Flutter/Rive model)
**Decision:** zabloo components are described in the IR (component tree + resolved styles +
**vector draw commands** + events) and each engine SDK **tessellates them to GPU geometry**.
The engine only provides meshes and draw calls; zabloo owns **layout, drawing, geometric
hit-testing, states and animations**.
**Reason:** pixel-identical results across engines; components impossible with native
widgets (e.g. a radial selector); light SDK; native performance; **console compatibility**
(no Chromium on consoles).
**Alternatives considered:**
- **Embed a browser** (CEF/webview → texture): rejected — 100+ MB binary, Chromium
  overhead, unsupported on consoles.
- **Map components to each engine's native widgets** (the previous model): rejected —
  inconsistent look across engines and a catalog limited to each engine's widgets.
- **Build a browser from scratch:** rejected — person-years of scope (text, layout, a JS
  engine) incompatible with reaching a product.

## 2026-07-06 — Runtime SDK in the game (replaces build-time-only)
**Decision:** there **is** a runtime in the game — the SDK loads the IR, runs layout,
tessellates and renders, handles input/hit-testing and applies **hot-updates**.
**Reason:** dynamic content and hot-update require an on-device runtime; the IR is a
payload the SDK renders, not build-time source.
**Supersedes:** 2026-06-24 "anything requiring a runtime in the game is out of scope; we
compile at build time."
**Consequence:** IR **serialization + versioning + SDK↔content compatibility** become
first-class (an older SDK may receive newer content). See `ir-context.md` §8.

## 2026-07-06 — First engine: Unity, via UI Toolkit custom geometry
**Decision:** the first SDK targets **Unity**, landing through **UI Toolkit with custom
geometry** (`generateVisualContent` / the Mesh API). Multi-engine comes later via a
**shared core** (tessellator + IR runtime) + **thin per-engine adapters** (Unity, then
Godot, Unreal…).
**Reason:** Unity lets us validate the rendering model fast; core + thin adapters fits the
`ui` monorepo (shared core + per-engine SDKs).
**Open:** when to extract the tessellator into a shared **C++** core vs. starting it inside
the Unity SDK; the minimal draw-command set; the v1 component catalog (button, text, image,
list, flex container + 1–2 "showy" components like the radial selector); text/glyph
strategy (the hardest part of a self-renderer).
**⚠️ Superseded by 2026-08-24 — Godot first, and the C++ core is extracted now.** "Shared
core + thin per-engine adapters" **survives and is being built**; Unity is no longer the
first adapter. That entry also **closes the `Open:` above**: the tessellator is extracted
into a shared C++ core now, because the first engine that renders needs it — writing it
inside an adapter would mean writing it twice. (The other three `Open:` items were closed
earlier: draw commands 2026-08-01, catalog by F1–F7, text 2026-08-02 + 2026-08-11.)

## 2026-07-09 — Authoring v1: React bindings (`@zabloo/react`) that emit IR; visual editor later
**Decision:** the primary authoring path for v1 is **`@zabloo/react`** — a React binding
with its **own component library** (own components/props/rules) whose JSX **emits the IR**
via a custom reconciler (react-three-fiber style: React drives the tree, nothing renders
to DOM). The **visual web editor** comes **later, on top of the same IR**; its WYSIWYG
canvas renders with the **same core renderer** (WebGL) — the browser is just another
engine target, so the preview is pixel-identical to what the in-game SDK renders.
**Reason:** leverages the founder's React expertise and is the fastest path to usable
authoring; because both paths emit the same IR, nothing built for the bindings is thrown
away when the editor arrives.
**Alternatives considered:**
- **Visual editor first:** more upfront tooling for a solo founder; deferred, not dropped.
- **Both at once:** dispersion risk; rejected for v1.
- **MUI (or any web UI kit) as the component base:** rejected — MUI renders via DOM/CSS
  (cascade, Emotion, Material ripples), so matching it in the tessellator means
  reimplementing browser rendering = the already-rejected "build a browser" path; and
  Material Design is the wrong aesthetic for games. MUI stays fine for the **editor's own
  chrome** (panels, inspectors), which is a normal web app.
**Note:** the self-render model was **reconfirmed** in this session against a React
Native–style "export to native widgets per engine" alternative — RN works because
iOS/Android widget toolkits are roughly equivalent; Unity/Godot/Unreal's are not
(UI Toolkit vs. Control nodes vs. Slate/UMG). The right analogy stays **Flutter, not RN**.

## 2026-08-01 — IR v1: minimal scope (7 decisions)
**Decision:** the IR v1 is locked to a deliberately small, semantic core. Guiding
principle: *a small semantic IR + a runtime that does the work* — anything derivable is
not serialized.

1. **Layout: runtime Flexbox in the SDK — no baked rects.** The SDK carries the layout
   engine (Yoga-subset semantics) and recomputes on change. Interactivity (collapse,
   resize, safe-areas) makes baked rects a dead end. v1 subset: `direction, justify,
   align, gap, padding, width/height, grow`. This **closes** ir-context §2's open question.
2. **v1 vocabulary: 3 closed primitives — `Container`, `Text`, `Button`.** Each primitive
   is a forever-contract across all engines, so the set stays tiny. `Row`/`Column` are
   **not** primitives — they're `Container` sugar in `@zabloo/react`. New primitives enter
   only when they force a new system capability.
3. **Behavior lives in the SDK, keyed by component type.** The IR declares *what* a node
   is (+ initial state + hooks); the SDK implements *how it behaves* (Button:
   pressed/hover/focused + event dispatch; later Collapse: toggle + relayout). Zero logic
   in the JSON. Functionality is runtime code, not IR data.
4. **Paint: 100% implicit in v1 — no explicit draw-command layer in the JSON.** A node's
   style (`background`, `radius`, `borderWidth`…) *implies* the rounded-rect fill/stroke;
   the tessellator derives it. The explicit `paint` layer (paths, arcs → radial selector)
   is added later as an optional field. Halves the v1 IR surface without foreclosing it.
5. **Styles: resolved per node + a flat token dictionary in the envelope.** Nodes
   reference `{color.primary}`; the SDK does a flat lookup. Near-zero-cost indirection
   that buys theming and **theme hot-update without re-emitting the tree**.
6. **Events & bindings: two mechanisms only.** Named actions (`onClick: "buy"` → exposed
   idiomatically per engine: C# event / signal / Blueprint) and data-path bindings
   (`text: {"bind": "player.gold"}`). No lists/templates/conditionals in v1. Visibility =
   a `visible` prop/binding with **`display:none` semantics** (leaves layout) — a single
   hiding mechanism.
7. **Versioning: decided now.** Versioned envelope (`v`), forward-tolerant rules: the SDK
   **ignores unknown props, renders a fallback for unknown node types**, and refuses only
   on a major-version mismatch. The envelope supports **multiple documents (views/scenes)**
   from v1. The loader treats every input as a versioned payload — a manually imported
   JSON and a platform hot-update go through the same path.

**Reason:** solid products come from small contracts validated end-to-end, not large
specs validated on paper. Every item above minimizes IR surface while keeping the doors
open (explicit paint, more primitives, richer bindings) — see next decision for the
validation method.
**Deferred (explicitly open):** variants model (§5), focus/directional navigation model
(§6), composites (kept-vs-flattened — the Accordion will force this), text/glyph strategy
(spiked early, see below), animation.

## 2026-08-01 — Method: validate the IR with a vertical slice (Button end-to-end)
**Decision:** stop designing on paper beyond IR v1 and validate with a **vertical
slice**: `JSX (<Button onClick="buy"><Text>Buy</Text></Button>) → IR JSON → Unity SDK
(Yoga subset + tessellate rounded-rect + text + pressed state + C# event)`. One screen,
one pressable button — it exercises every subsystem (reconciler, format, runtime layout,
tessellation, states, events) with minimal scope. An early **text/glyph-atlas spike** is
mandatory: text is the #1 technical risk of a self-renderer and must be hit at the very
start of the slice, not after designing 20 components.
**Sequencing:** `Collapse` is step 2 (proves runtime relayout on state change);
`Accordion` is step 3 (forces the composites decision — cross-child behavior like
"only one open"). Each new component enters only when it forces a new capability.
**Reason (rendering-as-mesh validated):** all UI everywhere is GPU triangles — Unity UI
Toolkit/UGUI, Slate, Godot's canvas, Flutter (Skia/Impeller) and Dear ImGui all generate
meshes; the only question is *who* generates them. Performance is a solved problem given
three standard techniques: retained mode with **dirty flags** (re-tessellate only what
changed — `generateVisualContent` already works this way), **batching + atlases** (glyph
atlas, few draw calls per screen), and **adaptive curve tessellation + geometric AA**.
UI geometry is trivially small next to game geometry. Known costs accepted: CPU cost on
change, atlas memory (a few MB), and clipping/scissor + AA + text to implement.

## 2026-08-02 — Developer experience: project model, CLI role and OSS tooling packages
**Decision:** zabloo adopts a Flutter/RN-style **project DX**, defined now as the north
star and implemented incrementally. The full loop:

```
npx create-zabloo-app my-game-ui   # scaffold a TS project
pnpm dev                            # (deferred) watch → re-emit IR → push to SDK dev mode
pnpm build                          # = zabloo export → versioned IR envelope in dist/
zabloo push                         # (future, platform) hot-update to live games
```

1. **No bundler for the game — "build" = execute authoring code.** User React code runs
   at authoring time in Node with the `@zabloo/react` reconciler; exporting = serializing
   the resulting tree into the versioned envelope. The dev loop is watch → re-execute →
   emit IR, not a JS bundle pipeline (nothing ships to the device but JSON).
2. **v1 (vertical slice): NO dev loop.** Manual `zabloo export` + import into Unity only.
   The dev hot-push channel is **defined but deferred**: the SDK's editor **dev mode**
   listens on localhost (WebSocket) and `zabloo dev` pushes the envelope on save — the
   **same payload/loader path as production hot-update** (dogfooding it locally). Until
   the WebGL core renderer exists, the *preview is the Unity editor* — `pnpm dev` opens a
   channel to the engine, not a browser.
3. **Views are file-based (convention).** Every `.tsx` in `src/views/` is one document of
   the multi-view envelope; the filename is the view ID the SDK loads by. Mitigation for
   "rename breaks deployed content": a view file may `export const id = "…"` to pin a
   stable ID overriding the filename.
4. **Scaffold layout** (`create-zabloo-app`): `package.json` (scripts delegate to the
   CLI), `zabloo.config.ts` (theme entry, outDir), `src/views/`, `src/components/` (user
   components — authoring-time only, never reach the IR), `src/theme.ts` (tokens → flat
   envelope dictionary).
5. **CLI role settled** (was TBD since the platform pivot): `zabloo` (alias `zb`) owns
   `export` and (later) `dev`, `login`, `push`. Platform-side commands come with `app`.
6. **OSS packages this implies in `ui`** (all open source — the adoption funnel must be
   free for the format to standardize): `@zabloo/format` (IR types + envelope
   validation), `@zabloo/react` (components + reconciler), `@zabloo/cli`,
   `create-zabloo-app`, `sdk/unity` (+ dev mode later).

**Reason:** the DX (scaffolder → dev → export) is the adoption funnel of the open layer;
defining names, commands and project layout now means slice code lands in its final
shape without premature productization. Deferring the dev loop keeps the slice minimal,
and choosing WS-push *later* over a second file-watcher path keeps one loading mechanism.
**Alternatives considered:** disk-write + file watcher for dev (rejected: creates a
second loader path that would be migrated to WS anyway); explicit view registry in
`zabloo.config.ts` (rejected in favor of file-based convention for less boilerplate;
`export const id` covers the stable-ID concern).

## 2026-08-02 — Text spike PASSED: self-rendered glyphs validated in Unity (UI Toolkit)
**Result:** the #1 self-renderer risk is retired. The spike
(`ui/examples/unity-playground/Assets/Spikes/TextAtlas/`) renders `"Comprar"` with
**zero native text elements**: a self-owned RGBA32 glyph atlas + our own metrics table +
textured quads emitted in `generateVisualContent`. Verified visually: correct
orientation, crisp at 48px, correct `Measure()` output. Findings:

1. **`MeshGenerationContext.Allocate(verts, indices, texture)` accepts our texture.**
   In Unity 6 the renderer **auto-remaps UVs** when it packs our texture into its
   dynamic atlas (`MeshWriteData.uvRegion` is obsolete) — we write plain 0..1 atlas
   UVs. One VisualElement can mix shape geometry + glyph quads → the custom-geometry
   landing path is confirmed viable for the whole tessellator.
2. **There is NO clean public API to make Unity rasterize into OUR texture.**
   `FontEngine.TryAddGlyphToTexture` (what TMP uses) is `internal`
   (`InternalsVisibleTo` TMP only). The "engine fills our atlas" shortcut doesn't
   exist publicly.
3. **Validated spike path (public API only):** legacy `Font.RequestCharactersInTexture`
   + `Font.GetCharacterInfo` → engine rasterizes into its internal dynamic font
   texture → we **snapshot** (GPU blit → CPU read) into an atlas **we own** and keep
   our own metrics. After the snapshot, engine-side repacking/eviction can't touch us.
4. **Direct raster at target px is crisp** — SDF is not needed to validate the model
   (stays as a later option for free scaling).

**Still open (text strategy — narrowed, not closed):** who rasterizes long-term:
(a) **core-owned rasterizer** (stb_truetype/FreeType — identical across engines and the
natural fit for the future shared C++ core) vs. (b) **per-engine rasterizer behind a
common interface** (the spike validated the Unity variant of this). Finding #2 pushes
toward (a): if even Unity needs a snapshot workaround, per-engine rasterization is
second-class everywhere. Also open: shaping/kerning, multi-size strategy (SDF?),
dynamic charsets. Decide during/after the Button slice.
**✅ Rasterizer ownership DECIDED 2026-08-11 — (a) core-owned (stb_truetype per
target); see that entry.**
**Alternatives considered for the spike:** reflection over the internal FontEngine API
(rejected: unsupported, teaches nothing cross-engine); vendoring StbTrueTypeSharp now
(deferred: it's the likely long-term answer, but public-API-first got pixels fastest).

## 2026-08-03 — Vertical slice PASSED: Button end-to-end (JSX → IR JSON → Unity SDK)
**Result:** the IR v1 is validated end-to-end. `hello-button`'s
`<Button onClick="buy"><Text>Comprar</Text></Button>` exports to a versioned envelope
and the Unity SDK renders it, presses it and fires the C# event. Every subsystem
exercised, all landing in its final shape (no throwaway code):

- **`@zabloo/react`** — custom reconciler (react-reconciler 0.33, mutation mode,
  sync one-shot via `updateContainerSync` + LegacyRoot). Host components ARE the IR
  primitives; `Row`/`Column` sugar lower to `Container`; user components + hooks
  execute at authoring time and never reach the IR. Full mutation config on purpose:
  the same reconciler will drive the future dev loop (watch → re-render → WS push).
- **`@zabloo/cli`** — `zabloo export`: runs views via jiti with resolution based in
  the user's project (single React instance shared with the reconciler — the classic
  dual-React trap avoided by design), file-based view IDs (`export const id`
  override), envelope written to `dist/zabloo.ir.json`.
- **`sdk/unity`** — envelope loader (Newtonsoft; forward-tolerance = deserializer
  default + explicit major-mismatch refusal + unknown-type fallback), flat token
  resolver, **own flexbox pass** (v1 Yoga subset, measure/arrange — UI Toolkit's
  layout is deliberately unused: cross-engine golden rule), tessellator (implicit
  paint: style → rounded-rect fan; text quads from the self-owned glyph atlas),
  Button behavior owned by the SDK keyed by type (pressed style override), named
  actions as `event Action<string>`. Per-node `VisualElement`s positioned by OUR
  rects; the engine provides draw calls + input plumbing only.

**Notes for the next steps:** hit-testing currently rides on UI Toolkit's per-element
rects (= IR default `hit: layoutRect`) — fine for v1, revisit when paint shapes
diverge from layout rects. Bindings (`visible`, `text`) parse but don't evaluate yet.
Style set implemented so far: background/radius/color/fontSize (+ pressed overrides);
border/opacity pending — the v1 property set closes with `Collapse`/`Accordion`.
**Next:** `Collapse` (runtime relayout on state change), then `Accordion` (forces the
composites decision).

## 2026-08-03 — Collapse: 4th primitive; runtime relayout PROVEN; the toggle split
**Decision (model):** `Collapse` enters the vocabulary as the 4th primitive (as
anticipated in the 2026-08-01 decision: new primitives only when they force a new
capability) with the **`<details>`/`<summary>` model**: `children[0]` is the header —
always visible, tapping it toggles — and the rest is content that enters/leaves layout
with **`display:none` semantics**. `open` in the IR is the *initial* state only; the
SDK owns the runtime state, keyed by type (same pattern as Button's pressed).
**Decision (who toggles — the "SDK default vs game binding" split):** both, layered:
1. **Default behavior in the SDK:** tap on the header toggles. Zero logic in the JSON.
2. **Game-driven:** `ZablooView.SetOpen(id, open)` — the first game→SDK state API.
   When bindings are evaluated, an `open` binding will ride this same path, so there
   is one state-mutation mechanism, not two.

**Capability proven:** runtime relayout on state change. Implementation detail that
generalizes: a `InLayout` flag on the layout node that measure/arrange skip — the
exact mechanism `visible` bindings will use later (one hiding mechanism, as decided).
Toggling re-runs the SDK's flexbox pass at the current view size and the whole view
recenters — validated in the editor.
**Alternatives considered:** `collapsed` as a Container prop (rejected: behavior is
keyed by component identity, and a prop would leak behavior into every Container);
explicit toggle wiring in the IR (e.g. a Button targeting a Collapse id — rejected:
that's logic in the JSON; named actions + game code or the future `open` binding
cover it without a new mechanism).
**Next:** `Accordion` — cross-child behavior ("only one open") forces the composites
decision (§5).

## 2026-08-03 — Composites DECIDED: flatten + declarative group behaviors (Accordion)
**Decision:** composites are **NOT IR types**. They are authoring-time compositions
that flatten to primitives, and **cross-child behavior is declared, not typed**: the
parent `Container` carries a `group` field (first behavior: `"exclusive-open"`) that
the SDK enforces **generically** — when a child `Collapse` opens, its siblings close.
`<Accordion>` in `@zabloo/react` is pure sugar (Container + group + column), exactly
like `Row`/`Column`. This **closes ir-context §5**.
**Reason:**
1. **The vocabulary stays closed at 4 primitives.** Every primitive is a forever
   contract ×3 engines; a per-composite type (Accordion, Tabs, RadioGroup, Dropdown…)
   would multiply that cost indefinitely.
2. **Graceful degradation over the wire.** An old SDK ignores the unknown `group`
   prop and renders independent Collapses — versus rendering a fallback box for an
   unknown `Accordion` type. For hot-updated content this is the difference between
   "loses a nicety" and "breaks".
3. **Business alignment:** premium blocks/templates are composites; as flattened
   compositions they render on ANY SDK version — no SDK upgrade coupling for the
   content the platform sells.
**Trade-off accepted:** `group` introduces a small behavior vocabulary that must be
governed (grow it as slowly as the primitives). All Collapse state mutations (header
tap, `SetOpen`, future `open` bindings) go through one path that enforces the group.
**Alternatives considered:** Accordion as 5th primitive (rejected: vocabulary growth +
bad degradation); flatten with no declared behavior, game enforces via `SetOpen`
(rejected: components must work out of the box).
**Consequence for the platform/editor:** composites are defined AS CODE (React
components emitting primitives), so the block marketplace ships authoring code or
flattened IR — never schema extensions.

## 2026-08-03 — Data bindings implemented: SetData is the game→SDK data channel
**Result:** the second dynamic mechanism of the IR v1 (data-path bindings) is
implemented and validated: `ZablooView.SetData(path, value)` updates bound `Text`
(re-measure → reactive relayout) and bound `visible` (display:none). Demo loop in the
playground: buying decrements bound `player.gold` live and reveals a `visible`-bound
row. Notably, **zero TS-side changes were needed** — `@zabloo/format` and the
reconciler supported bindings since day one; the contract held.
**Decisions taken (defaults):**
1. **Data model = flat path→value store** (`"player.gold"` as an opaque key). Nested
   object graphs can come later without changing the IR.
2. **Absent data:** bound Text renders `""`; bound `visible` starts **hidden**
   (data-driven visibility means "visible when data says so").
3. **Hiding composition:** `visible` (bound/static) and Collapse's open state are
   separate flags (`VisibleFlag` × `SectionShown`) composed into one `InLayout` —
   still a single display:none mechanism, two writers without conflicts.
4. **Bound text rasterizes printable ASCII** by default at its font size. Non-ASCII
   dynamic charsets belong to the open text strategy (rasterizer ownership).
**Consequence:** hot-updated content arrives already bound to the same data paths —
new UI reacts to live game data without touching C#. `SetData` + named actions are
the complete game↔UI coupling surface of v1.

## 2026-08-03 — Dev loop SHIPPED: `zabloo dev` + editor dev mode (save → live reload)
**Result:** the deferred half of the 2026-08-02 DX decision is implemented and
validated. The loop went from 4 manual steps to **saving the file**: `zabloo dev`
(alias `pnpm dev`) watches the project, re-exports and pushes the envelope to the
Unity editor's dev mode (menu: Zabloo → Dev Mode), which hot-swaps live views during
Play and keeps the imported asset in sync. **The push goes through the exact
production hot-update path** (`ZablooDocument.Reload` ← same call for manual import /
dev push / future platform hot-update) — the dev loop dogfoods hot-update daily, as
designed.
**Decisions / amendments:**
1. **Channel = plain HTTP POST on localhost:5077, not WebSocket** (amends the
   2026-08-02 note, letter not spirit): the flow is unidirectional (CLI pushes →
   editor receives) and `HttpListener` needs zero dependencies on both sides; a WS
   server in the Unity editor would mean vendoring websocket-sharp. Revisit only if
   the editor ever needs to push back to the CLI.
2. **Each export runs in a child process** — clean module graph per save (no stale
   jiti cache, exactly one React instance per run). ~1s/save; optimize later if it
   ever hurts.
3. **`ZablooDocument` is the game's stable handle; views are disposable.**
   `SetData` caches on the document and replays into every (re)loaded view — pushed
   game data survives content swaps. This is production hot-update behavior, not
   just dev convenience.
4. **Dev mode enables `Application.runInBackground` on entering Play.** Learned the
   hard way: with it off (default) the editor SUSPENDS the whole player loop when
   unfocused, so pushes applied from the editor tick sat unlaid-out/unrendered
   until refocus (blank Game view). Repaint nudges are insufficient; keeping the
   game running in background is the correct fix for a live-push workflow.

## 2026-08-03 — Web renderer SHIPPED: `@zabloo/renderer-web` + `zabloo dev` preview
**Result:** the browser became a real render target (as decided 2026-07-09: "the
browser is just another engine target"), earlier than planned: `zabloo dev` now
serves a live preview on `localhost:5078` — **editing the UI requires no Unity at
all**, and with Unity open both targets update on every save (live multi-engine).
`@zabloo/renderer-web` is the **third implementation of the self-render model**
(~600 lines TS) and the seed of the visual editor's WYSIWYG canvas. This partially
amends 2026-08-02 ("until the WebGL core renderer exists, the preview is the Unity
editor") — the first cut of that renderer now exists.
**Decisions:**
1. **Raw WebGL2, no Three.js** (and no DOM/CSS mapping — that's the rejected
   native-widgets model in browser form). Our job is exactly "upload tessellated
   vertices/indices + atlas + ortho matrix → draw": one shader, two buffers. A
   scene-graph library would fragment our batching — the IR tree IS the scene
   graph. Keeps the future editor canvas lean and dependency-free.
2. **Glyphs: the spike pattern, browser variant.** Canvas2D (`fillText` +
   `measureText`) rasterizes; we snapshot into OUR atlas with OUR metrics and
   upload as a texture — same "per-engine rasterizer behind a common interface"
   shape as the Unity SDK. A reserved white pixel lets solids and text share
   textures (batching). Glyph quads snap to the physical pixel grid (fractional
   layout positions + LINEAR filtering blur text by half a pixel).
3. **Preview page plays the game's role.** It scans the envelope for `{bind}`
   paths and renders a data panel (inputs → `setData`), plus an action log and a
   view selector. The UI-declares / game-provides-data split stays intact — the
   page is just a surrogate game. Values replay across hot reloads.
4. **Known limitation (accepted): text is not pixel-identical across targets** —
   browser Arial vs Unity LegacyRuntime, different rasterizers. The convergence
   path is shipping the same TTF as an asset to every target and owning
   rasterization — i.e., the open text-strategy decision; the preview does not
   foreclose it.
**Ops note:** on Windows, killing a shell does not kill child node processes — a
zombie `zabloo dev` can hold the preview port serving a stale page; EADDRINUSE is
now reported loudly.

## 2026-08-04 — Variants DECIDED (§6): authoring-time only, never in the IR
**Decision:** variants (primary/secondary/ghost…) are an **authoring-time concept**.
`<Button variant="primary">` resolves against the project theme (`src/theme.ts`
exports `variants`, keyed by component then variant name; the exporter wraps views
in a `ThemeProvider`) and the envelope receives nodes **fully resolved** — no
`variant` field, no shared style dictionary. Merge rules: variant style/states
UNDER explicit props (explicit always wins; per-state style shallow-merge); unknown
variants throw at export time. This **closes ir-context §6**.
**Reason:** preserves the founding IR rule — resolved per node, NO cascade. A
variants dictionary in the envelope would reintroduce merge semantics ×3 engines
forever. Same pattern as composites: design-system concepts live in authoring.
Validated with zero SDK/renderer changes — both targets rendered variants without
knowing they exist, which is the whole point.
**Trade-off accepted:** redefining a variant means re-emitting the tree (hot-update
ships whole envelopes anyway; token VALUES still flow through the flat dictionary).

## 2026-08-04 — Focus & directional navigation DECIDED (§7): automatic spatial
**Decision:** navigation is **automatic spatial** — the runtime moves focus using
the live layout rects it already owns (console-UI algorithm: candidate must lie in
the direction of travel, `score = projection + 2×orthogonal`, lowest wins).
Implemented identically in the Unity SDK and the web renderer. The IR surface is
minimal:
1. **Focusability derives from component identity** (Button, Collapse header) —
   no IR field.
2. **`states.focused`** styles the focused node — a day-one IR field, used for the
   first time. Style merge order: base → focused → pressed.
3. **`autofocus`** (the only new field) marks initial focus.
4. **Activation**: Enter/Space (later gamepad A) presses the focused node — same
   press/release semantics as the pointer; Buttons fire their action, Collapse
   headers toggle. Pointer clicks and directional nav share ONE focus.
5. **Hit-testing v1 formally closed: layout rects** (what both targets already do);
   paint-geometry hit-testing waits for the explicit `paint` layer.
**Input plumbing:** engine-specific and input-source agnostic — Unity polls the
legacy input manager in `ZablooDocument.Update` (gamepad d-pad maps to the same
`MoveFocus`/`PressFocused` calls later); web listens to keydown/keyup.
**Deferred (the escape hatch):** explicit per-node neighbor overrides, added only
when a real UI defeats the spatial heuristic.
**Reason:** zero authoring cost and it survives relayout/hot-update/Collapse
(recomputed from live rects — precisely what baked neighbor wiring cannot do).
Fits "small semantic IR + a runtime that does the work".

> With §6 and §7 closed, **all 9 questions of the IR agenda are decided**. The only
> remaining open item is implementation strategy, not IR: text rasterizer ownership
> (core vs per-engine) — currently per-engine behind a common pattern in both
> targets, converging via shared TTF assets when the text strategy lands.
> **✅ Closed 2026-08-11: core-owned rasterization (see that entry).**

## 2026-08-06 — Style set v1 CLOSED: inset border + multiplicative opacity; spike retired
**Decision:** the v1 style property set is complete and implemented in both targets:
`background`, `radius`, `borderWidth`, `borderColor`, `color`, `fontSize`, `opacity`.
Two semantics locked (they are forever-contract, so decided explicitly):
1. **Border = INSET stroke, paint-only** (CSS border-box model). The ring paints
   *inside* the layout rect: outer edge = the rect, inner radius = `radius − width`
   (clamped ≥ 0). Nothing ever paints outside the rect → hit-testing on layout rects
   stays honest and future clipping (ScrollView) can never cut a border. The border
   does **not** consume layout space (paint is implicit from style; padding covers
   content clearance). Degenerate case: `width × 2 ≥ min(w, h)` renders as a fill.
2. **Opacity inherits multiplicatively down the subtree**, applied as a per-vertex
   alpha multiplier at tessellation time (parent 0.5 × child 0.5 = 0.25). Cheap and
   identical across all three engines (it is just the tint alpha). It is **not**
   render-to-texture group opacity — overlapping children blend individually; true
   group opacity can arrive later as a better implementation of the same IR field
   without changing the contract. `opacity: 0` skips painting but keeps layout
   (`visible` remains the single display:none mechanism).

**Implementation notes:** fill and border share one perimeter parametrization (4
corner arcs, same vertex count) in both tessellators — the border is a stitched ring
between the outer and inset perimeters. The Unity SDK caches the inherited product
per node (`LayoutNode.PaintOpacity`) and restyles the subtree when it changes (state
overrides can change opacity at runtime); the web renderer threads the product
through the paint recursion. The examples now use the inset border as a **focus
ring** (`states.focused: { borderWidth: 2, … }`) — replacing the background-swap
focus style in the Button variants.

**Also in this consolidation pass:** the TextAtlas spike
(`examples/unity-playground/Assets/Spikes/`) is **deleted** — its findings are
recorded here (2026-08-02) and its pattern is productized in the SDK's `GlyphAtlas`;
the code lives in git history. The public `ui` README now describes the working
system (two render targets, dev loop, scaffolder, the closed v1 feature set) instead
of the pre-slice state.

**Alternatives considered:** centered/outset stroke (rejected: paints outside the
layout rect → breaks the hit-testing=layout-rects premise and clips badly);
border-box layout participation (rejected for v1: adds layout semantics with no
current need); node-only opacity that does not dim children (rejected: nobody coming
from CSS/Flutter/Unity expects a Button's opacity to leave its label at full alpha).

## 2026-08-10 — Dev loop web-first: el push a Unity pasa a ser opt-in (`--unity`)
**Decision:** `zabloo dev` levanta por defecto SOLO el preview web; el push al dev
mode del editor Unity requiere el flag booleano `--unity` (scripts de proyecto:
`dev` = web, `dev:unity` = web + push). Modelo React Native / Ionic (`run-ios` /
`run-android`): un flag por motor, combinables cuando lleguen Godot/Unreal, cada
uno con su puerto por defecto. `--unity` solo habilita el push al editor que el
usuario ya tiene abierto — nunca lanza Unity. Amends 2026-08-03 (dev loop), donde
el push se intentaba siempre.
**Reason:** trabajando solo en web (el caso común desde que existe el preview),
el push incondicional imprimía un warning por guardado — ruido sin valor. El
default debe ser el target sin fricción (web); los motores son una elección
explícita.
**Alternatives considered:** `--engine <nombre>` (más largo para el caso común,
menos idiomático); targets en `zabloo.config.ts` (esconde comportamiento en
config); auto-detect silencioso (menos explícito, y el silencio oculta un editor
mal configurado cuando SÍ quieres Unity); lanzar el editor vía Unity Hub CLI
(frágil, lento, fuera de alcance).

## 2026-08-11 — Texto DECIDIDO: rasterización core-owned (stb_truetype por target)

**Decision:** el rasterizado de glifos a largo plazo es **del core** (ZAB-15, cierra
el último abierto de la rebanada): un único algoritmo de rasterización —
**stb_truetype** — en la forma de primera clase de cada target, detrás de la interfaz
`GlyphAtlas`/`FontLibrary` que ambos targets ya comparten. El motor deja de
rasterizar; la TTF compartida (ZAB-16) pasa a ser el input de NUESTRO rasterizador:

- **Unity (y Godot C#): StbTrueTypeSharp** (port C# puro, MIT) — compila bajo
  IL2CPP/AOT, sin fricción en consolas.
- **Web: stb_truetype compilado a WASM** (decenas de KB, embebido) — el embrión real
  del "core compilado a WASM" que usará el canvas del editor visual.
- **Unreal / Godot GDExtension / futuro core C++ compartido: `stb_truetype.h`** tal
  cual (C, public domain).

Importante: esto **NO adelanta la extracción del core C++** (decisión que sigue
abierta). "Core-owned" es propiedad del *algoritmo/contrato* — mismo rasterizador en
todos los targets — no un binario compartido hoy.

**Reason (el criterio de siempre — ¿aguanta en Godot/Unreal/consolas?):**
1. **El spike ya lo empujaba** (2026-08-02, hallazgo #2): incluso Unity — el motor de
   referencia — necesita un workaround (snapshot GPU→CPU sobre la API legacy `Font`;
   la moderna `FontEngine` es `internal`). Por-motor es segunda clase en el mejor
   caso; Godot (TextServer) y Unreal (Slate font cache; su FreeType no está expuesto)
   serían un puente a medida por motor, cada uno con sus propias sorpresas.
2. **Consolas:** stb es C/C# puro que compila donde compile el SDK — sin depender del
   camino de fuentes de cada motor en builds de consola ni de readbacks GPU→CPU.
3. **Convergencia:** mismo algoritmo ⇒ mismas métricas ⇒ mismo layout, y mismos
   bitmaps ⇒ texto **pixel-idéntico** — requisito estructural de "el preview es
   pixel-idéntico" (2026-07-09), de la validación de convergencia (ZAB-18) y de los
   golden tests cross-target de F8 (mismo envelope → mismo resultado).
4. **Charsets dinámicos** (texto bindeado, default 2026-08-03): rasterización bajo
   demanda desde la TTF shipeada — determinista e idéntica en todos los targets.
5. **SDF queda como evolución natural** (`stbtt_GetGlyphSDF`) sin cambiar de
   rasterizador.

**Consecuencias:** en Unity se retiran el snapshot GPU→CPU y la dependencia de la API
legacy `Font`; en web, Canvas2D deja de rasterizar (queda solo como fallback si
acaso). Todo lo aguas-abajo (atlas, métricas, quads, medida) ya era nuestro y no
cambia de forma.
**Trade-offs aceptados:** una dependencia vendoreada por target (public domain /
port MIT — asumible); **sin hinting** (a tamaños de UI apenas perceptible; lo valida
ZAB-18); **sin shaping complejo** — árabe/índico (ligaduras, reordenado) requerirán
HarfBuzz o equivalente → v2; v1 cubre latín/CJK sin shaping; el kerning lo leemos
nosotros de las tablas de la fuente.
**Alternatives considered:**
- **(b) Por-motor tras la interfaz común** (estado actual productizado): rechazado —
  texto nunca pixel-idéntico (rompe ZAB-18/goldens), un hack por motor, frágil en
  consolas. La interfaz sobrevive; solo cambia quién rasteriza dentro.
- **Híbrido (métricas del core, raster por-motor):** el core parsea la TTF y posee
  las métricas (layout idéntico) pero cada motor rasteriza. Rechazado — arregla el
  layout pero mantiene la divergencia visual y el hack de Unity; el salto a (a)
  cuesta poco más y lo cierra todo.
**Implementación:** aterriza con **ZAB-16** (TTF compartida como asset) — el swap de
rasterizador y la fuente compartida son el mismo movimiento.

## 2026-08-11 — Assets DECIDIDO: manifest en el envelope + embebido base64 (ZAB-10, F2 B1)

**Decision:** los assets viajan **embebidos en base64 dentro del envelope**, en una
sección nueva `assets` — un manifest plano `id → { hash, mime, size, width?, height?,
data? }`. Los nodos referencian por string **`asset:<id>`** (mismo espíritu que
`{token}` y `{ bind }`); el id lógico es el path relativo a `src/assets/`
(`asset:icons/coin.png`), el `hash` (SHA-256) es la versión del contenido. El manifest
es **genérico por MIME** (F2 implementa imágenes; la TTF de ZAB-16 y futuros entran
sin tocar el formato). Cambio **aditivo dentro de v1** — sin bump: los SDKs viejos
ignoran la clave `assets` y el nodo `Image` desconocido cae en el fallback estándar.

**Reason:**
1. **El camino único de carga no cambia en absoluto** (invariante 2026-08-01): el
   envelope sigue siendo un JSON — import manual, dev push (`POST` existente) y
   hot-update entregan lo mismo que hoy. Cero transporte nuevo.
2. **La inflación base64 (~33 %) es irrelevante a la escala objetivo v1** (UI típica:
   iconos + alguna hero; total < 10 MB decodificado).
3. **La evolución a CDN ya está dibujada en el schema**: `data` es opcional — v1
   siempre lo rellena; la plataforma podrá omitirlo y el SDK resolver bytes por
   `hash` (caching content-addressed) sin cambiar formato ni loader.

**Límites de tamaño** (constantes del export v1): warning por asset > 2 MB y por
total > 15 MB; **error duro** por total > 50 MB (protege el hot-update).

**Empaquetado (`zabloo export`):** pasada de recolección post-emisión — resuelve
paths contra `src/assets/`, SHA-256, dims desde cabecera binaria (parsers propios
PNG/JPEG, sin deps nativas), base64, reescribe la prop al `AssetRef`, dedup por id.
Validación en `parseEnvelope` minimal y forward-tolerant (no decodifica `data`; refs
colgantes tolerados — validación exhaustiva en F8). Helper `decodeAssetData` en
`@zabloo/format` para renderer-web y preview.

**Alternatives considered:**
- **Bundle binario único (`.zabloo` = zip):** sin inflación y un solo artefacto, pero
  lector zip en cada consumidor, el dev push pasa a binario, el preview pierde
  `fetch().json()`, y es una segunda superficie de formato. Correcto si algún día los
  envelopes pesan decenas de MB — hoy coste sin beneficio.
- **Archivos sueltos + manifest + resolver:** el mejor caching (re-push solo de lo que
  cambia), pero rompe "el payload es una cosa", convierte el import en una carpeta, y
  construye hoy la resolución diferida que decidimos posponer (YAGNI).

**Spec completa:** `specs/2026-08-11-assets-envelope-design.md`.

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

## 2026-08-11 — Dev loop con assets: el preview transporta árbol y bytes por separado

**Decisión (ZAB-14, F2 B2):** con los assets embebidos en base64 (2026-08-11,
assets), cada guardado re-transfería MB al preview. En el canal del preview el
envelope pasa a viajar **fino** (sin `data`) y los bytes se sirven aparte,
**direccionados por contenido**: `GET /envelope` da el árbol + el manifest sin
bytes, `GET /asset/<hash>` da los bytes de un asset una sola vez. La página del
preview **rehidrata** el envelope (cachea por `hash` en memoria y vuelve a meter
`data` en el manifest) **antes** de dárselo al renderer.

**Por qué no rompe "un solo camino de carga" (invariante 2026-08-01):** el
loader/renderer sigue recibiendo SIEMPRE un envelope completo. Lo que se parte no
es el formato sino el *transporte* del dev loop, y se parte por la vía que el
propio schema ya dejó abierta (`data` opcional + `hash` como identidad de
contenido, pensada para el CDN de la plataforma). El dev loop es su primer
consumidor: estrenamos la resolución diferida sin inventar formato nuevo.

**Detalles:** los bytes se sirven como el propio campo `data` (base64, `text/plain`)
en vez de binario — la página los pega tal cual en el manifest, sin re-codificar; la
URL es content-addressed, así que va con `cache-control: immutable`. Dos ids con el
mismo hash comparten un blob. Vigilar `src/` ya cubre `src/assets/`: cambiar un PNG
re-exporta y recarga como cualquier guardado.

**Medido** (preview real, 1 asset, 17 recargas): 17 fetches de `/envelope`, **1**
de `/asset/<hash>`, y el renderer recibiendo el envelope completo en cada recarga.

**Fuera de alcance (→ ZAB-11, SDK Unity):** el push al editor de Unity sigue
mandando el envelope entero. Deduplicarlo exige cache hash→bytes y rehidratación
en el lado C# — es decir, el sistema de carga de assets de Unity, que se construye
con las texturas. El protocolo será el mismo de aquí (mandar fino, reenviar los
hashes que el receptor no tenga).

## 2026-08-11 — Texturas en el renderer web: batch por identidad de textura + cache por hash (ZAB-12, F2 B2)

**Decisión:** el renderer web resuelve `asset:<id>` contra el manifest, decodifica
los bytes a `ImageBitmap` y los sube como texturas WebGL2 **cacheadas por hash de
contenido** (no por id). Cuatro piezas:

1. **Identidad de textura en el batch.** `Batch.atlas: GlyphAtlas | null` pasa a
   `Batch.texture: TextureSource | null`, un interfaz **estructural**
   (`version` + `bitmap`) que satisfacen tanto el atlas de glifos como una imagen.
   La capa GL deja de saber qué produjo los píxeles. **Una imagen = un draw call**;
   orden de emisión: sólidos → imágenes → texto.
2. **Aspect-fit `contain`, centrado dentro del rect** de layout. El measure de una
   hoja `Image` usa las dimensiones intrínsecas del manifest (sin decodificar).
3. **Sin tinte.** Color de vértice blanco × la opacidad heredada (2026-08-06). El
   shader ya multiplica textura × color, así que el tinte sería gratis — pero es
   spec del componente `Image`, y esa es de ZAB-13.
4. **Vida:** `reload()` suelta las texturas cuyo hash el nuevo envelope ya no
   referencia; `dispose()` libera todo el GL (hasta ahora no liberaba nada, ni
   siquiera los atlas). Un decode que aterriza tras su evicción se descarta.

**Por qué:**

1. **La invariante "todo el UI en un draw call" nunca cubrió las imágenes.** Valía
   para sólidos + glifos porque comparten el atlas gracias al píxel blanco
   reservado (2026-08-03). Una textura de imagen no puede estar en ese batch, así
   que la elección real era generalizar la identidad de textura o meter un caso
   especial; generalizar deja la capa GL más simple que antes.
2. **`contain` no distorsiona y no pinta fuera del rect** — la misma invariante que
   hizo el borde inset (2026-08-06): nada pinta fuera del rect de layout, así que
   el hit-testing por rects sigue honesto y el clipping nunca corta un borde.
3. **Cachear por hash y no por id** da dedup y hot-update gratis: dos ids con los
   mismos bytes decodifican una vez, y reexportar la misma imagen conserva su
   textura. Es la misma propiedad content-addressed que ya explotan el CDN futuro
   (2026-08-11, assets) y el transporte del dev loop (2026-08-11, ZAB-14).
4. **El decode es async** (el navegador no da camino síncrono de bytes a píxeles):
   nada pinta hasta que aterriza el bitmap, y el layout reserva el sitio desde el
   primer frame con el `width`/`height` del manifest — que es exactamente para lo
   que B1 los guardó.

**Medido** (preview real, un asset en tres nodos): hot-update reexportando la misma
imagen bajo **otro id** → 0 texturas creadas, 0 subidas, 0 borradas; quitar el asset
del envelope → 1 borrada. Ref colgante → un warning, y el nodo pinta solo su fondo.

**Diferidos:** `fit`/`cover` como prop y la spec de `Image` (ZAB-13); atlas de
imágenes (varias en un draw call) y mipmaps, si alguna vez la escala lo pide; tinte.

## 2026-08-11 — Overlays y z-order en la IR: `Overlay` como tipo, declarado in-place (ZAB-19, F4 C1)

**Decisión:** el overlay entra como **tipo de nodo propio** (7º del vocabulario),
**declarado in-place en el árbol** — donde vive la UI que lo abre — pero **fuera del
flujo de su padre**: no se mide, no ocupa espacio, no afecta a sus hermanos. El SDK
recolecta todos los `Overlay` visibles de la vista en **una sola capa** pintada sobre
el árbol completo, ordenada por **`(z, orden de documento)`**.

```ts
interface OverlayNode extends NodeBase {
  type: "Overlay";
  modal?: boolean;      // default true — captura input hacia abajo + focus-trap
  z?: number;           // default 0 — empates por orden de documento
  onDismiss?: string;   // acción nombrada (Escape / B / tap en backdrop)
  children?: ZNode[];
}
```

**El rect del Overlay es el rect de la vista**, y de ahí salen dos no-decisiones que
importan tanto como las decisiones:

- **No hay campo `backdrop`**: el `background` (con alpha) del propio nodo ES el
  backdrop — el paint sigue siendo 100 % implícito desde estilo (2026-08-01 #4). Sin
  background = capa transparente (Toast/Tooltip).
- **No hay campo de posición**: `layout.justify`/`align`/`padding` sobre una capa a
  pantalla completa colocan el contenido (modal centrado, toast abajo a la derecha).
  Cero semántica nueva de layout. `width`/`height` sobre el Overlay se ignoran (una
  capa no se dimensiona, como `clip: false` en `ScrollView`); el tamaño va en el hijo.

**Semántica (spec para ZAB-20).** Input: `modal: true` captura todo lo de debajo
(árbol y overlays inferiores) — un tap dentro del rect que no aterrice en un hijo es
tap en el backdrop (dispara `onDismiss`, nunca se propaga); `modal: false` deja el
rect propio **inerte** y solo sus hijos reciben eventos. Focus: el trap **deriva de
`modal`** (sin campo nuevo) — con un modal visible, la navegación espacial
(2026-08-04) solo considera candidatos del modal más alto, y al cerrarse el SDK
restaura el focus anterior (estado de runtime, como el offset de scroll). Apertura:
**ningún mecanismo nuevo** — `visible` sigue siendo la única ocultación
(`display:none`), bindeable con `SetData`, con el mismo split por capas del Collapse
(default del SDK + API juego→SDK, que define ZAB-21). Un Overlay dentro de un
`ScrollView` no scrollea: pertenece a la capa, no al contenido.

**Reason:**
1. **Es un sistema de comportamiento, no una variación de paint** — capa separada +
   orden + captura de input + ámbito de focus + restauración. Ese es exactamente el
   criterio que en ZAB-5 separó `clip` (paint puro → prop en `NodeBase`) de
   `ScrollView` (estado + input → tipo), y el que fija 2026-08-01 #3 ("behavior lives
   in the SDK, keyed by component type").
2. **In-place preserva el authoring local**: el `<Modal>` se declara junto al botón
   que lo abre, con su estado en el mismo componente React, y el reconciler no
   levanta nodos a otra rama.
3. **Degrada por el fallback normativo** (2026-08-11, scroll): un SDK pre-F4 pinta el
   `Overlay` como `Container` con sus hijos → el modal aparece **inline en el flujo**
   en vez de flotando. Nunca desaparece contenido, y como los modales se declaran
   ocultos por defecto (`visible` bindeado), en la práctica un SDK viejo no muestra
   nada raro. Es la MISMA degradación que habría dado una prop `layer` — otra vez, la
   elección no se decide por degradación sino por dónde vive el comportamiento.

**Alternatives considered:**
- **Prop `layer` en `NodeBase`**: permitiría un `ScrollView` modal sin anidar, pero
  el SDK pasaría a despachar comportamiento por tipo O por prop — dos mecanismos, lo
  ya rechazado con `overflow` en ZAB-5. El caso real se resuelve anidando
  `Overlay > ScrollView`.
- **Slot de overlays en la vista** (`views: { id: { root, overlays: [] } }`): cambia
  la forma del envelope (hoy una vista ES un nodo, y loader/preview/dev push lo
  asumen), rompe el authoring local, y **degrada peor** — un SDK viejo ignora la clave
  desconocida y el overlay desaparece entero en vez de caer en el fallback.
- **Composición manual** (Container a pantalla completa "encima" por orden de
  documento): no existe "encima" fuera del flujo sin inventar posicionamiento
  absoluto (fuera del subset Yoga v1), y aun así no daría captura de input ni trap.

**Diferidos:** `autoCloseMs` del Toast (→ ZAB-21, campo aditivo compatible);
**anclaje a un nodo** para el Tooltip (pide posicionar contra un rect ajeno —
capacidad nueva de layout, se decide con el componente); orden por apertura en
runtime; transiciones de entrada/salida (→ F7); scroll-lock bajo el modal (hoy
innecesario: el modal ya captura la rueda).
**Spec completa:** `specs/2026-08-11-ir-overlays-design.md`.

## 2026-08-11 — Transiciones declarativas de estilo: `transition` en `NodeBase` (ZAB-33, F7 D1)

**Decisión (cierra el diseño de F7 en la IR):** las transiciones simples entran en la
IR v1 como **una prop `transition` en `NodeBase`** — un objeto por nodo, `{ duration:
Dim; easing?: Easing }`, aplicable a todas las props animables del nodo. Keyframes y
timelines siguen en v2. Cuatro piezas:

1. **Dónde vive: `NodeBase`, no `Style`** — mismo criterio que `clip` (2026-08-11,
   scroll): `Style` es el set de **valores** que se interpolan; `transition` es **cómo**
   se interpolan. `duration` es `Dim`, así que el movimiento se tematiza como el color
   (un tema "reduce motion" pone `motion.*` a 0 y la UI deja de animar sin reemitir el
   árbol). Sin cascada y leída solo del nodo base; per-state (entrada/salida
   asimétricas) y filtro/duración por propiedad son extensiones aditivas.

2. **Qué se anima (normativo):** colores (`background`, `borderColor`, `color`, lerp
   por canal en sRGB directo), escalares de paint (`opacity`, `radius`, `borderWidth`)
   y **dimensiones de layout** (`width`, `height`, `gap`, `padding`). **Saltan:**
   `fontSize` (es la clave del atlas de glifos — animarla rasteriza un tamaño nuevo por
   frame), `grow` (factor de reparto, no magnitud), los enums de layout, y todo lo
   estructural (`visible`, `clip`, `text`, `open`, `src`, `axis`, `scrollbar`, `z`).
   Sin transform en v1 (no hay translate/rotate/scale en el set de estilo).

3. **Disparo sin lista de triggers:** *una transición arranca cuando un valor animable
   resuelto cambia, sea cual sea la causa* — entrar/salir de estado, `SetData` sobre un
   input bindeado, cambio de tema. Cubre gratis los valores bindeados el día que el
   estilo sea bindeable (o llegue el `value` de `ProgressBar`). Bordes: los dos extremos
   deben resolver a número/color (extremo `auto`/ausente ⇒ salta); el montaje y las
   recargas de envelope saltan (sin valor previo honesto entre documentos); una
   interrupción **re-apunta desde el valor interpolado actual con la duración completa**
   (modelo CSS — "el tiempo que quedaba" da salidas antinaturalmente rápidas en el caso
   común); `duration <= 0` o `transition` ausente ⇒ instantáneo.

4. **Layout animado SÍ, interpolando inputs declarados, no rects calculados.** El SDK
   interpola los valores resueltos de `Style`/`Layout` y **después** corre su pasada
   normal de medida/arrange. Una sola pasada por frame, sin bucle
   medida→animación→re-medida, determinista ⇒ idéntico en ambos targets; el padre
   reflowea de verdad (lo de abajo se desplaza); el hit-testing usa los rects animados
   ("hit-testing = rects de layout", 2026-08-04, sigue honesto); en un `ScrollView` el
   content size se mueve y el offset ya se re-clampa en cada relayout (2026-08-11,
   scroll). El coste (relayout mientras dura) lo vigila el presupuesto de perf de F8.

**Curvas: polinomios cerrados, no cubic-bézier.** Set cerrado de cuatro: `linear` (t),
`ease-in` (t³), `ease-out` (1 − (1−t)³), `ease-in-out` (t<0.5 ? 4t³ : 1 − (−2t+2)³/2).
Un `cubic-bezier` obliga a **resolver** la bézier por cada `t`, y entonces la paridad
entre targets depende de que dos solvers converjan igual — la clase exacta de
divergencia silenciosa que ya nos llevó a la rasterización core-owned (2026-08-11,
texto). Con forma cerrada la paridad es aritmética. `@zabloo/format` exporta
`easeProgress(easing, t)` como **implementación de referencia normativa** (misma razón
que `decodeAssetData`): la comparten renderer-web y el preview del CLI, y Unity porta
esos polinomios. Clampa fuera de `[0,1]` y **cae a lineal ante una curva desconocida**.

**La frontera con los componentes (y el diferido que cierra):** el camino declarativo
no anima entrada/salida — un nodo que sale del layout tendría que sobrevivir a su
eliminación. Lo que sí queda normativo es que **un comportamiento propiedad del SDK
(indexado por identidad) puede conducir la misma maquinaria con extremos que él
calcula**, y eso es spec del componente, no superficie de la IR. Con eso los tres casos
de F7 tienen camino: el **`Overlay`** cierra el diferido "transiciones de entrada/salida
(→ F7)" de ZAB-19 — y es el caso fácil por una razón estructural: al estar **fuera del
flujo de su padre**, su comportamiento puede mantenerlo vivo mientras hace el fade de
salida **sin desplazar nada** (un nodo en flujo no tiene esa propiedad, y por eso el
caso genérico sigue diferido); el **`Collapse`** anima **su propia altura** (medida del
contenido ↔ header) con `clip`, que es un cambio numérico de un nodo que no desaparece;
y el **loop del `Spinner`** es comportamiento del SDK como el offset del scroll. Por eso
esto no abre la puerta a keyframes: se comparte la maquinaria, no una superficie
declarativa nueva.

**Forward-tolerance:** cambio **aditivo dentro de v1, sin bump**. Un SDK pre-F7 ignora
`transition` y los cambios de estilo saltan — exactamente el comportamiento de hoy. La
degradación es la ausencia del juice, nunca pérdida de contenido ni cambio de layout.

**Alternatives considered:**
- **`transition` dentro de `Style`**: la haría overridable por estado (justo la
  extensión que difiero) y mezcla el "qué" con el "cómo"; `Style` es lo tematizable.
- **Mapa por propiedad** (`{ background: {...}, opacity: {...} }`) desde v1: más
  expresivo, pero es contrato forever ×3 motores para un caso que aún no ha aparecido;
  el objeto único crece a mapa de forma aditiva si aparece.
- **Keywords de CSS con cubic-bézier**: familiaridad web y equivalencia 1:1 con CSS, a
  cambio de que la paridad dependa del solver. Rechazado por el mismo criterio que el
  texto.
- **Solo paint, sin layout animado**: más barato y sin relayout, pero deja el catálogo
  a medias (el open/close del Collapse es justo lo que F7 quiere animar) y empuja el
  problema a un sistema aparte más tarde.
- **Interpolar rects calculados** en vez de inputs declarados: cubriría `auto` sin
  regla extra, pero abre el bucle medida→animación→re-medida y la paridad entre targets
  pasa a depender del orden de las pasadas.

**Diferidos:** animaciones de entrada/salida genéricas, extremos `auto` (interpolar
hacia una altura medida), transición por propiedad y por estado, `delay`, transform
(translate/rotate/scale), curvas con rebote/bézier arbitraria, keyframes y timelines
(v2).
**Spec completa:** `specs/2026-08-11-ir-transitions-design.md`.

## 2026-08-11 — Segundo comportamiento de `group`: `"exclusive-select"` (Tabs, ZAB-22, F4 C1)

**Decisión:** `<Tabs>` es azúcar de autoría, como `<Accordion>` — se aplana a
`Container` + `Button`s y **no añade ningún tipo a la IR**. El comportamiento cruzado
viaja como un segundo valor de `group`, `"exclusive-select"`, con un contrato
**posicional**: `children[0]` es la barra (sus hijos `Button`, en orden, son las
pestañas) y `children[1..n]` los paneles. Seleccionar `i` deja solo `children[i + 1]`
en el layout (el flag `InLayout` de siempre) y da al botón `i` el estado `selected`.
Dos extensiones pequeñas de vocabulario acompañan: `ContainerNode.selected?: number`
(índice inicial, contrapartida de `CollapseNode.open`) y `StateName` += `"selected"`.
Spec completa: `specs/2026-08-11-tabs-design.md`.

**Por qué:**

1. **La atadura tiene que ser posicional porque el cableado explícito ya estaba
   rechazado.** La decisión de `Collapse` (2026-08-03) descartó "un Button que apunta
   al id del nodo que controla" con el argumento de que eso es *lógica en el JSON*.
   Aplicarlo aquí obliga a la convención estructural — y la más barata es **la misma
   que ya tiene `Collapse`**: hijo 0 fijo, el resto contenido. Un nivel menos de
   convención que "barra + wrapper de paneles", y `layout`/`gap` del `<Tabs>` llega a
   los paneles sin capas intermedias.
2. **El estado `selected` es lo que hace que el componente funcione out of the box.**
   Sin él la pestaña activa no se distingue y el juego tendría que cablear estilos —
   justo lo que la regla de composites prohíbe. Es además vocabulario compartido:
   `RadioGroup` (ZAB-23) reusa `group` y necesita el mismo estado.
3. **`selected` como índice inicial mantiene el reparto de siempre**: el estado
   inicial viaja en la IR, el estado en runtime es del SDK. Sin él no se puede
   expresar "esta pantalla abre en Audio" (lo va a querer ZAB-28).
4. **Los botones que no son `Button` en la barra no cuentan como pestañas**, así que
   decorarla (un título, un separador) no desplaza los índices — la convención
   posicional deja de ser frágil por el único sitio donde lo sería.

**Trade-off aceptado:** el vocabulario de `group` crece a dos, más un campo opcional
en `Container` que solo significa algo con ese `group`. Es exactamente el coste que
la decisión de composites anticipó ("una pequeña gramática de comportamientos que hay
que gobernar, y crecer tan despacio como los primitivos"): a cambio, el catálogo
entero de composites de F4/F5 (Tabs hoy, RadioGroup mañana) cabe sin tocar la unión
`ZNode`.

**Alternativas descartadas:** `Tabs` como primitivo (crecimiento del vocabulario ×3
motores + peor degradación, el argumento de 2026-08-03 intacto); barra + wrapper de
paneles (tres niveles de convención posicional a cambio de poder estilar el área de
paneles como un nodo — se puede recuperar cuando haga falta metiendo un Container en
el panel); reusar `exclusive-open` con `Collapse`s (la barra tendría que vivir dentro
de cada sección: no hay forma de sacar los headers a una fila).

**Implementado y validado en web** (renderer-web; Unity degrada hasta que le toque su
tarea de F4/F5): selección por tap y por Enter/gamepad, relayout al cambiar de panel,
`states.selected` en la pestaña activa, foco independiente de la selección (autofocus
se queda donde estaba mientras la selección se mueve), acciones con nombre dentro de
un panel intactas, y `setSelectedTab(id, index)` como canal juego→SDK (contrapartida
de `SetOpen`). Ejemplo: `examples/tabs-settings`.

**Nota de implementación que generaliza:** unificar las dos vías de activación de un
`Button` (puntero y Enter/gamepad) en una sola función eliminó una duplicación que ya
existía — el mismo patrón de "una única vía de mutación" que `Collapse` y el scroll.
La degradación de la tabla se observó de verdad (el preview corriendo con el bundle
anterior pintó la barra y los tres paneles apilados, pantalla usable).

## 2026-08-11 — `Toggle` (8º primitivo), bindings de lectura/escritura y `"exclusive-check"` (ZAB-23, F5 C1)

**Decisión (modelo):** checkbox, switch y radio son **un único primitivo `Toggle`**.
Se diferencian en estilo y en el grupo donde viven, no en comportamiento: el SDK es
dueño del `checked` en runtime, indexado por tipo (como `pressed` de Button y `open`
de Collapse). Entra por la puerta de siempre — *primitivo nuevo solo cuando fuerza una
capacidad nueva* — y la capacidad es **estado booleano propio + valor de vuelta al
juego**. Descartado `checkable` como prop de `Button`: el SDK pasaría a despachar
comportamiento por tipo Y por prop, exactamente lo que hundió `overflow` en ZAB-5.
**Spec completa:** `specs/2026-08-11-toggle-radiogroup-design.md`.

**Decisión (la gorda — los bindings dejan de ser de un solo sentido):** `checked:
{bind: "settings.sfx"}` se lee **y se escribe**. Al cambiar, el SDK escribe el valor
nuevo en su store y avisa al juego con **un callback único** (`onDataChanged(path,
value)`); `onChange` sigue como acción con nombre para quien prefiera eventos. Es la
asimetría que quedaba en la IR v1 — los datos solo bajaban (`SetData`) y las acciones
volvían sin payload — y se cierra aquí porque `Slider` (ZAB-24), `Select` (ZAB-25) y
`TextInput` (ZAB-26) heredan el mismo problema. Se decide una vez, para los cuatro.
Descartadas: acción con payload como mecanismo único (obliga al juego a llevar su
propio estado y devolverlo con `SetData`: el binding YA expresa esa relación) y
`GetChecked(id)` (acopla el juego a los `id` de la IR).

**Decisión (cómo se dibuja el check/knob, sin capa de paint explícita):** el
indicador son **dos slots posicionales** en `children` — `[0]` en layout mientras está
encendido, `[1]` mientras está apagado, `[2..]` siempre (la etiqueta) — con la misma
mecánica `display:none` que el contenido de `Collapse`. Cada slot pinta el indicador
**entero**, no la diferencia: así el aspecto "encendido" es el estilo de su propio
slot y no hay que estilar descendientes por estado (**sin cascada**, la regla
fundacional). El knob del switch se mueve **con layout** (un slot justifica a `end`,
el otro a `start`). `StateName` += `"checked"` para el nodo en sí (merge: base →
checked → focused → pressed). Descartado "solo `states.checked`" (el knob no podría
moverse) y un `kind` pintado por el SDK (paint por componente ×3 motores; adelanta de
facto la capa de paint que sigue diferida).

**Decisión (RadioGroup):** composite aplanado como el Accordion — `Container` +
`group: "exclusive-check"` + `value` (normalmente bindeado). Una opción está marcada
mientras su `value` coincida con el del grupo, y al pulsarla escribe el suyo. **La
selección es UN valor, no N booleanos**: es la semántica real del radio, deja el
terreno hecho a `Select` y evita tres eventos para un cambio. Dentro del grupo el
`checked` es derivado, nunca almacenado; pulsar la opción ya seleccionada no la
desmarca (un grupo exclusivo no se queda vacío).

**Colisión de vocabulario con ZAB-22, resuelta:** Tabs ya había registrado
`"exclusive-select"` con contrato **posicional** (barra + paneles) anticipando que
RadioGroup reusaría ese valor. No encaja — el radio selecciona **por valor**, no por
índice, y no tiene barra — así que se usa `"exclusive-check"` y queda una familia
legible: `exclusive-open` (el `open` de Collapse), `exclusive-select` (el `selected`
de Tabs), `exclusive-check` (el `checked` de Toggle). Un `group` gobierna un estado.
**Fusión ya hecha** (main traía Tabs, Overlay y transiciones): las uniones
`GroupBehavior` y `StateName` quedan unidas — `checked` y `selected` conviven (una
casilla se marca, una pestaña se selecciona) y el merge de estilo es **base →
selected/checked → focused → pressed**, porque ningún nodo lleva los dos estados de
valor. Y la vía única de activación que Tabs había unificado para tap y Enter/gamepad
pasa a cubrir el Toggle: una sola función, no dos caminos. Con `Overlay` dentro,
`Toggle` es el **8º** tipo, no el 7º.

**Trade-off aceptado:** el vocabulario crece por los dos lados a la vez (un tipo y un
comportamiento de `group`), justo lo que la decisión de composites pedía gobernar
despacio. Se acepta porque el tipo trae una capacidad de sistema (estado + canal de
vuelta) y el `group` es el mismo mecanismo genérico de siempre, no uno nuevo.

**Implementado y validado en web** (renderer-web; Unity degrada hasta su tarea):
marcar/desmarcar por tap y por Enter, selección exclusiva por valor, `states.checked`
en la fila, escritura de vuelta visible en el panel del preview, `SetData` del juego
moviendo el control, y `setChecked(id, checked)` como canal juego→SDK (contrapartida
de `SetOpen`, con la misma vía única de mutación: acción incluida, es "un tap dado por
el juego"). Ejemplo: `examples/settings-demo`. La lógica pura (`slotShown`,
`isSelected`, `nextChecked`) vive aislada en `toggle.ts` con tests sin canvas — es la
referencia literal para el SDK de Unity.

**Detalle que casi se cuela:** con la comparación por valor escrita a la ligera, un
grupo **sin** selección marcaba las opciones **sin** `value` (`undefined === undefined`).
Lo cazó el test antes que el navegador: "ausente" y "ausente" nunca coinciden.

## 2026-08-11 — Capa de overlays en el renderer web: dos pasadas, captura y trap (ZAB-44, F4 C2)

**Decisión:** la implementación web de la semántica de `Overlay` (2026-08-11, ZAB-19)
se apoya en tres piezas, más dos decisiones que la spec de ZAB-19 dejaba abiertas.

1. **`inFlow` = `inLayout` + "no es Overlay".** Un único predicado saca al Overlay del
   flujo del padre en measure, arrange, paint y hit-testing del árbol. De ahí salen
   gratis las tres consecuencias que la spec pedía: `layout.width`/`height` del propio
   Overlay se ignoran (el rect se lo da la vista al disponer la capa), un Overlay dentro
   de un `ScrollView` no scrollea (el offset se aplica al arrange del padre, del que ya
   no participa), y no empuja a sus hermanos.
2. **Render en dos pasadas:** el árbol entero, y después la capa — `collectLayer` en
   pre-orden ordenado por `(z, orden de documento)`, cada entrada medida y dispuesta
   contra el rect de la vista. Cada entrada de la capa es **raíz de pintado**: no hereda
   la opacidad del subárbol donde se declaró. Es la lectura consistente de "la capa se
   pinta sobre el árbol completo" — si heredase, el mismo modal se vería distinto según
   dónde lo declares, que es justo lo que el modelo portal evita.
3. **`findUp` se para en el Overlay.** El hit-testing por capas no basta: al subir desde
   el nodo golpeado para encontrar el `ScrollView`/`Collapse` que gobierna el gesto, un
   modal declarado dentro de un `ScrollView` habría scrolleado el fondo. La entrada de
   la capa es el techo de su propio ámbito de input.

**Decisiones nuevas:**

- **El dismiss lo ejecuta el SDK, no solo lo anuncia.** Escape (el "B" del mando en
  web), tap en el backdrop y expiración del timer escriben `false` en el path bindeado
  de `visible` — el mecanismo de bindings de lectura/escritura (2026-08-11, ZAB-23),
  con su aviso al juego — **y** disparan la acción `onDismiss`. Con `visible` estático
  no hay dónde escribir: solo se dispara la acción y cerrar es cosa del juego. Cierra
  el "closing itself is the SDK's default behavior" del contrato sin inventar mecanismo:
  es el mismo canal de vuelta que ya usa el `Toggle`.
- **`autoCloseMs` entra ya en `OverlayNode`** (ZAB-19 lo difería a ZAB-21). Aditivo y
  compatible, y sin él ZAB-44 no tenía qué temporizar. Es un `number` plano, **no un
  `Dim`**: es un timeout de comportamiento, no movimiento — nada en él es tematizable
  como sí lo es `transition.duration`. Un valor <= 0 se ignora (un typo no es "cierra
  ya"). El reloj arranca al entrar en la capa y se cancela al salir.

**Focus.** El trap deriva de `modal` sin campo nuevo: `focusScope` = modal más alto de
la capa, o la vista si no hay ninguno, y la navegación espacial solo recolecta
candidatos dentro. La restauración vive en una **pila de modales** con el nodo que
tenía el focus al abrirse cada uno, reconciliada en cada render — el embudo por el que
ya pasa cualquier cambio de estado, así que también cubre los overlays que abre un
binding, un `reload` o el juego. Al abrir, el focus va al `autofocus` del overlay; si no
lo hay se queda en nada, en vez de dejar focused un nodo tapado por el modal. Al cerrar
toda una pila, restaura lo anterior al **más externo**. Los no modales no atrapan: sus
hijos entran en la navegación normal por estar declarados in situ.

**Reglas en `overlay.ts` con tests sin canvas** (mismo split que `scroll.ts`/`select.ts`/
`toggle.ts`, y por tanto referencia literal para el ticket de Unity): orden de la capa,
overlays anidados aplanados, ocultos que no aportan nada, captura modal (lo de debajo
—incluidos overlays inferiores— no recibe input), backdrop que no se propaga, no modal
transparente al input pero con hijos vivos, ámbito de focus y `autofocus`.

**Diferido:** `Modal`/`Toast`/`Tooltip` como componentes de `@zabloo/react` y la API
juego→SDK de apertura (ZAB-21) — hoy el host de React no tiene `Overlay`, así que la
capa solo se autoriza escribiendo IR a mano. Animaciones de entrada/salida (F7).

## 2026-08-11 — `Modal`/`Toast`/`Tooltip` y el fundido de los overlays por `presence` (ZAB-21, F4 C3)

**Decisión:** la capa de autoría de overlays en `@zabloo/react`, más la única pieza de
runtime que faltaba: las transiciones de entrada y salida.

1. **`Overlay` se exporta crudo**, al contrario que `Toggle`/`Slider`/`ProgressBar`. Lo
   que a esos los esconde son sus **slots posicionales**, y el `Overlay` no tiene
   ninguno: sus hijos son hijos. `Modal`, `Toast` y `Tooltip` son composites aplanados
   encima (2026-08-03 §5), como `Badge` o `Tabs`.
2. **`position`: nueve anclas** (`center`, `top-right`, …) que bajan a
   `layout.justify`/`align`, con la capa emitida **siempre en `direction: "row"`** para
   que `justify` sea el eje X y `align` el Y pase lo que pase con el contenido. El
   `layout` del autor pisa el placement. Sin campo nuevo en la IR: es el flex que ya
   existe, el mismo criterio que dejó fuera un campo `backdrop` en ZAB-19.
3. **El `style` del `<Modal>` ES el backdrop**, y la tarjeta se estiliza con `panel` —
   el reparto de `Slider` (`style` = rail, `fill`/`thumb` = slots). Bandas de `z` por
   convención del componente (modales 0, toasts 10, tooltips 20), no por taxonomía del
   formato. `autoCloseMs` por defecto (3 s) solo en el `Toast`, y `<= 0` es error de
   autoría: el runtime lo ignora, y un typo que significa "no se cierra nunca" es peor
   en silencio.
4. **Apertura: no hay API nueva.** Es `SetData` sobre el `visible` bindeado, cerrado ya
   en ZAB-19/ZAB-44. Lo que aporta esta tarea es que ninguno de los tres tenga prop
   `open`, de modo que la recomendación de authoring esté en el tipo.

**Transiciones de entrada/salida — se interpola `presence`, no `visible`:**

> Un `Overlay` con `transition` funde su entrada y su salida en la capa. Lo animado es su
> **presencia** (0…1), tercer caso del patrón "el comportamiento mueve la maquinaria con
> extremos que calcula él" (2026-08-11 §5), detrás del `progress` del `ProgressBar` y el
> loop del `Spinner`.

- **Cero contrato nuevo**: ni campo, ni `visible` animable, ni `z`/`modal` animables. La
  duración y la curva son las del `transition` del nodo, luego sin `transition` el frame
  es el pre-F7 exacto, y como la duración es un token, un tema "reduce motion" apaga los
  fundidos con todo lo demás.
- **La salida sobrevive a su `visible`**: un overlay cerrado se pinta exactamente una
  duración más. Única excepción a "fuera de layout no se pinta", acotada a la capa.
- **Lo que sale es píxeles y nada más.** Input, focus-trap, pila de modales y timers de
  `autoCloseMs` leen la capa **viva** (`inLayout`), que el overlay ya abandonó — así un
  modal cerrándose no se come los clicks ni bloquea al de debajo.
- **El montaje salta** (primera observación siembra sin animar), así que un modal ya
  abierto al cargar no hace fade-in y un `reload` tampoco.
- **Sin `scale`**: v1 no tiene transform. Interpolar `width`/`height` solo funcionaría
  con tamaños explícitos y no escalaría el texto, así que el fundido es de opacidad y el
  scale espera a la capa de paint explícita.

**Web:** `stepPresence` en `overlay.ts` (puro y testado — referencia literal para Unity)
y una pasada por frame en `view.ts` sobre **todos** los overlays del árbol, ocultos
incluidos: tienen que estar sentados en 0 para que abrirlos sea un cambio del que salir.
Su estado vive **fuera** del `NodeAnim` del nodo, porque la pasada de resolve lo tira al
salir de layout — una salida que borra su propio punto de partida no se anima.

**`Tooltip` en v1 = burbuja colocada en la capa y mostrada por binding.** El **anclaje a
un nodo** (posicionar contra un rect ajeno: layout nuevo, fuera del subset Yoga) y el
**disparo por hover/focus** (la IR no tiene expresiones; `states` solo overridea estilo)
son dos capacidades de la IR, no azúcar, y se difieren a una issue propia en vez de
decidirse dentro de un ticket de autoría. La API del componente no cambia cuando
lleguen: `anchor` será una prop más.

**Spec completa:** `specs/2026-08-11-overlay-components-design.md`. Unity (los tres
componentes y el fundido) queda para el batch final.

## 2026-08-11 — `Image`: primitivo propio, `fit` sin desbordar y tinte/placeholder con estilo (ZAB-13, F2 B3)

**Decisión:** `Image` **se queda como tipo de nodo de la IR** (no `Container` con paint
de textura) y el componente añade **una sola prop nueva** al formato:
`fit?: "contain" | "cover" | "stretch"` (default `contain`). Todo lo demás del enunciado
sale de estilo que ya existe:

| Capacidad | Cómo | Nada nuevo porque… |
|---|---|---|
| Tinte | `style.color` (× opacidad heredada) | `color` = "color del contenido del nodo" — glifos en `Text`, píxeles en `Image`; el shader ya multiplica textura × color de vértice |
| Esquinas | `style.radius` **recorta la imagen** | mismo abanico rounded-rect que el fondo, con UVs derivadas de la posición del vértice |
| Placeholder | `style.background`/`borderWidth` del propio nodo | mientras el decode está en vuelo no pinta textura y el layout ya reservó el hueco con las dims del manifest |

**Por qué primitivo y no `Container` + paint:**

1. **Es una hoja con tamaño intrínseco, como `Text`** — el precedente exacto. Un
   `Container` que a veces se mide como hoja es un `Container` con dos modos.
2. **La referencia de contenido no es estilo.** En `Style` sería token-resoluble y
   sobreescribible por state: la textura cambiaría en `hover` con la maquinaria de los
   colores. `src` es estructura (y el export lo recolecta como tal).
3. **La forward-tolerance ya da el fallback**: tipo desconocido → `Container`
   preservando `layout`/`style`/`children` (2026-08-11, scroll). El SDK viejo pinta el
   fondo redondeado en el hueco correcto — la alternativa descartada, gratis.
4. **No abre la puerta a un tipo por contenido**: la capacidad nueva es *muestrear una
   textura*, que ningún primitivo podía expresar (obligó a generalizar el batch en
   ZAB-12).

**`cover` recorta por UVs, no desborda geometría.** Mantiene la invariante del borde
inset (2026-08-06): *nada pinta fuera del rect de layout* — hit-testing por rects
honesto, sin necesidad de `clip` (que aún no existe en web) y sin que una imagen tape a
sus hermanos según el orden de recorrido. El radius se clampa a la **caja pintada**, no
al rect: con `contain` la caja es menor, y redondear sobre el rect dejaría esquinas
cuadradas visibles.

**Sin estado `loading`.** (a) Cada state nuevo lo paga cada SDK; (b) en Unity la textura
puede estar lista de forma síncrona, así que sería un estado que en un target no se ve
nunca — contenido que diverge por motor, justo lo que la IR evita; (c) el placeholder
autorado es mejor: un fondo `{color.surface}` con el mismo `radius` ES el skeleton. Un
cross-fade al aterrizar, si se pide, lo da `transition` sobre `opacity` (F7).

**Alternativas descartadas:** prop `tint` en el nodo (duplica en el nodo un mecanismo de
`Style`; no tintable por state ni animable sin más maquinaria); `radius` solo sobre el
fondo (la imagen asoma por las esquinas del panel); `cover` desbordando + `clip` (exige
clipping en el renderer y rompe la invariante del rect).

**Verificado** (preview real, PNG 200×100 con marco y cuadrantes): `contain`
letterboxed, `cover` recortando solo el eje que sobra (los bordes laterales del marco
desaparecen, los superiores se mantienen), `stretch` distorsionando, radius recortando
la textura, tinte × opacidad, y tamaño intrínseco desde el manifest.

**Spec completa:** `specs/2026-08-11-image-design.md`. Unity (componente + paridad
visual) queda para el batch final de cross-target.

## 2026-08-11 — Clipping web: scissor + SDF en el shader (no stencil) y el clip como único corte del input

**Decisión (ZAB-7, F1 A2):** el recorte en `@zabloo/renderer-web` se implementa en dos
mitades. El rect lo corta **`gl.scissor`** (exacto y gratis: el borde inset de
2026-08-06 garantiza que nada pinta fuera del rect de layout, así que un scissor
rectangular no puede cortar un borde). Las **esquinas redondeadas** las descarta el
**fragment shader** con la SDF de un rounded box, difuminada sobre un píxel de
dispositivo (`fwidth`) — no con **stencil**, que era la opción "obvia" de la issue.

**Razón:** el stencil obliga a pedir stencil buffer, a pintar la máscara como geometría
extra y a llevar una máquina de estados con ref por nivel de anidamiento (push/pop),
y aun así deja el borde del recorte aliased. La SDF son ~8 líneas de shader, cuesta una
rama por uniform cuando `radius = 0` (la mayoría de clips), y su borde antialiasa igual
que el resto de la geometría. **Paridad:** no ata a Unity, que resuelve `overflow:
hidden` con su propio mecanismo — UI Toolkit tiene ambos (scissor y `ShaderDiscard`).

**Región efectiva = `{rect, radius}`:** el rect es la intersección exacta de todos los
clips ancestros; el radius es el del clip redondeado **más interno**. Exacto en el caso
real (un viewport redondeado con clips planos alrededor); con dos clips redondeados
cuyas esquinas se cruzan, solo se cortan las del interno. Una segunda región redondeada
por draw sería el arreglo si algún día aparece.

**Batching por región:** una región de clip es estado de GL, así que la geometría pasa a
agruparse por clip **en orden de pintado** (dentro de cada grupo se mantiene solids →
images → text). Rompe el invariante "todos los solids en un batch" a cambio de
painter's order por región, que es lo correcto: reentrar en un grupo anterior colaría
geometría por debajo de lo ya pintado encima.

**Hit-testing: el clip pasa a ser el ÚNICO corte del input.** Antes el recorrido
abandonaba si el punto caía fuera del rect de cualquier padre, así que un hijo
desbordado se pintaba pero no era pulsable — el mismo desajuste paint/input que
recortar solo el paint, en el sentido contrario. Ahora se desciende siempre y solo el
clip corta; un nodo se devuelve si su propio rect contiene el punto. **El focus
espacial NO se filtra por clip** (spec de ZAB-5: un focusable fuera de la región visible
sigue alcanzable; el auto-scroll hasta él es de F5).

**`clip` en `@zabloo/react`:** la capacidad no era alcanzable desde autoría (`clip` vivía
solo en el IR), así que entra en `CommonProps` como prop de cualquier componente.

## 2026-08-11 — Array bindings: `Repeat` (9º primitivo), ámbito de item declarado y acciones con contexto (ZAB-29, F6 A4)

**Decisión (modelo):** la repetición dirigida por datos entra como **tipo propio,
`Repeat`** — `items` bindea un array y `children[0]` es el template que se instancia
una vez por elemento. Es el primer nodo cuyos **hijos no salen del documento**: hasta
ahora los datos cambiaban valores de nodos existentes (`text`, `visible`, `checked`) y
ahora cambian **cuántos nodos hay**. Descartado `each` como prop de `Container` (que
habría dejado el vocabulario en 8): el SDK pasaría a despachar comportamiento por tipo
Y por prop, el mismo argumento que hundió `checkable` en ZAB-23 y `overflow` en ZAB-5;
y un `Container` cuyos children no son sus children rompe la lectura del árbol.
Descartado un `List` con eje/columnas: mezcla repetición con disposición y ocupa el
nombre que ZAB-32 quiere para el azúcar. El `Repeat` **es** el contenedor flex de las
instancias (su `layout` las coloca), que es lo que permite que `<List>`/`<Grid>` sean
autoría y no tipos nuevos. **Spec completa:**
`specs/2026-08-11-array-bindings-design.md`.

**Decisión (ámbito de item): el alias se declara, no se reserva.** `as` (default
`"item"`) y dentro del template `{bind: "item.name"}` resuelve contra el elemento;
`"<alias>.$index"` es la única hoja reservada (la posición no está en los datos) y un
path bajo ningún alias conocido sigue siendo absoluto — una fila puede bindear
`player.gold`. Con un `item` reservado, una lista anidada **sombrea** a la de fuera y
el producto no puede alcanzar el id de su categoría; una tienda real lo necesita. El
ámbito más interno gana, con la contrapartida documentada de que un alias sombrea una
raíz absoluta homónima (validarlo es de ZAB-37).

**Decisión (la de fondo): los data paths dejan de ser claves opacas.** `player.gold`
era literalmente la clave del store; ahora un path es una **dirección dentro de los
datos** (`shop.items.3.name`), con separador `.`, segmento numérico = índice de array
(y nada más: `length` no es un campo) y `undefined` para todo lo que falte — la UI
bindeada degrada a "sin valor", nunca rompe el frame. **Vale igual para escribir:** un
`Toggle` con `checked: {bind: "item.enabled"}` dentro de una fila escribe en
`shop.items.3.enabled` y el juego lo recibe por el `onDataChanged(path, value)` de
ZAB-23 — sin canal nuevo ni API por componente.

**Decisión (identidad): `key` como path relativo al item, y dos espacios disjuntos.**
Con `key` (`"id"`, `"meta.sku"`) el estado que el SDK guarda por nodo — foco, `checked`
de la fila, offset de un scroll interno, transición a medias — **viaja con el item** al
reordenar; sin `key` la identidad es posicional y se queda clavada a la posición. Se
separan dos conceptos que parecían uno: `itemKey` (la key **cruda**, la que viaja al
juego) e `itemIdentity` (la clave de **reconciliación** del SDK, `"k:<key>"` o
`"<index>"`). **El prefijo no es decoración:** en una lista donde solo algunos
elementos resuelven su key, `{id: "0"}` y el elemento sin key en la posición 0
compartirían identidad y heredarían el estado del otro. Es también lo que hace posible
la virtualización de ZAB-31 — reciclar exige saber cuál es cuál.

**Decisión (acciones): dejan de volver vacías.** Un `onClick: "buy"` dentro de un item
tiene que decir **cuál**, así que la acción lleva un `ActionContext {path, key, index}`
opcional cuando nace dentro de un `Repeat` (`path` = ruta absoluta del item). Es el
mismo movimiento que ZAB-23 hizo con los datos, ahora del lado de las acciones: los
mecanismos dinámicos siguen siendo **dos**, y el que faltaba deja de volver sin
información. Describe el item **más interno**, y basta para listas anidadas porque
`path` ya lleva dentro los índices de fuera (`shop.cats.2.items.5`) — no hace falta
mandar una pila. Descartadas "solo la key" (obliga al juego a reconstruir el path para
su `SetData` de vuelta) y "sin payload, correlacionando por datos" (pide lógica
declarativa que la IR no tiene).

**Decisión (lista vacía): un slot, no una expresión.** `children[1..]` entra en layout
cuando el array está vacío, ausente o no es un array — convención posicional de la
familia de `Collapse` y `Toggle`, con la semántica `display:none` de siempre. Sin el
slot, "muéstrame *No hay items*" pediría una expresión booleana sobre los datos, y **la
IR no tiene expresiones, por diseño**.

**Forward-tolerance:** `parseEnvelope` no cambia (como en ZAB-19) — la tolerancia a lo
desconocido ES la spec y el recorrido del árbol es de ZAB-37. Lo estructural (`items`
siempre binding, nunca datos literales; `key` como path) se enforcea en tipos. Un SDK
pre-F6 cae en la regla normativa de ZAB-5 (tipo desconocido → `Container` preservando
children): pinta **una copia estática del template con los bindings de item sin
resolver** más el estado vacío. Se pierde la lista, no la pantalla.

**Alcance entregado:** solo `@zabloo/format` — tipos + la lógica pura normativa
(`resolveBinding`, `readPath`, `itemPath`, `itemKey`, `itemIdentity`) con tests, que es
la referencia literal que portan los SDKs, el mismo papel que `easeProgress` en ZAB-33.
Si los tres targets no calculan el mismo path y la misma identidad, el mismo envelope
con los mismos `SetData` deja de dar el mismo resultado — que es exactamente el
criterio de cierre de ZAB-31 (web) y ZAB-30 (Unity). **Huecos señalados, no
resueltos:** el subset Yoga v1 no tiene `wrap`, así que el `<Grid columns>` de ZAB-32
necesitará ampliarlo o anidar `Repeat` por filas; y la virtualización sigue siendo del
renderer, sin hints en la IR.

## 2026-08-11 — `Slider`: 9º primitivo, el nodo es el track y dos hooks (continuo + commit)

**Decisión (ZAB-24, F5 C3):** el slider entra como **primitivo propio**. La capacidad
que fuerza es la que ninguno podía expresar: **un número que el jugador fija
apuntando, cuya geometría es función de ese número** (el layout resuelve tamaños
desde props declaradas, no desde estado de runtime). Tres piezas:

1. **El nodo ES el track** — su `style` pinta el carril con el paint implícito de
   siempre — y tiene **dos slots posicionales que el SDK arregla desde el valor**:
   `children[0]` es el fill (del inicio a la fracción) y `children[1]` el thumb
   (centrado en la posición). Ni comando de dibujo nuevo, ni tercer hijo.
2. **`onChange` continuo + `onCommit` al soltar.** El binding se escribe siempre en
   continuo (es el mecanismo de datos y lo que hace que un `Text` bindeado siga al
   dedo); las acciones se parten porque son dos preguntas: preview en vivo vs.
   aplicar lo caro. `onCommit` solo salta si el valor cambió durante el gesto.
3. **Las flechas del eje ajustan; las cruzadas navegan.** Sin `step`, la flecha
   mueve el 5% del rango. Enter/A no hacen nada sobre un slider.

**Razón:** (1) mantiene el paint implícito intacto y hace que el aspecto del control
sea composición, como el indicador del `Toggle` — el precedente exacto; (2) evita
que cada juego escriba su propio debounce para la mitad de los casos, sin dejar sin
canal el preview en vivo; (3) el criterio de salida de F5 es *"settings completa
100% navegable con gamepad"*, y un control que se traga las cuatro direcciones
rompe justo eso.

**Geometría normativa** (`slider.ts` en web, referencia literal para Unity): el
recorrido del thumb está metido medio thumb por cada extremo, así que el punto bajo
el dedo es su centro durante todo el drag y nada se sale por el eje del carril; el
fill sí llega al final en `max`. A lo ancho cada slot conserva su tamaño y se
centra, así que **el thumb desborda a su padre por el eje cruzado** — ordinario
desde ZAB-7 (el `clip` es el único corte de paint e input): la invariante de
2026-08-06 dice que un nodo no pinta fuera de **su propio** rect, no que un hijo no
pueda salirse del padre. El Slider **se mide como hoja** (los slots no suman a su
tamaño) y el vertical va de abajo arriba, como un fader.

**`max` siempre es un stop válido**, aunque el rango no sea un número entero de
pasos: el jugador ve el final del carril y dejarlo inalcanzable se lee como un
control roto. Los valores cuantizados se limpian del ruido binario (`0.1 * 3`) antes
de viajar al juego.

**Alternativas descartadas:** `Toggle` con rango o `Container` + prop `value` (el SDK
despacharía comportamiento por tipo Y por prop — lo que hundió `overflow` en ZAB-5 y
`checkable` en ZAB-23); tres slots track/fill/thumb (un nodo y un contrato más para
lo que el paint implícito ya da); indicador dibujado por el SDK como el scrollbar
(paint por componente ×3 motores, adelanta la capa de paint explícita); acción solo
continua o solo al soltar; modo edición con Enter (estado modal invisible).

**Además:** `transition` **no** anima el valor a propósito (es estado que el jugador
está arrastrando, no una magnitud visual con retraso) y `ZablooHandle` gana
`setValue(id, value)` — "un gesto dado por el juego", commit incluido, hermano de
`setChecked`/`setScroll`.

**Verificado** (preview real): drag continuo escribiendo el binding con
`volume-preview` en vivo y un solo `volume-apply` al soltar; tap en el track
saltando al valor; flechas cuantizando de 10 en 10 y las cruzadas moviendo el focus
al slider de al lado; `setData` del juego moviendo el control y `setValue`
cuantizando a la rejilla.

**Spec completa:** `specs/2026-08-11-slider-design.md`. Unity queda para el batch
final de cross-target.

## 2026-08-11 — `ProgressBar` y `Spinner`: dos primitivos nuevos, y el `Badge` que no lo necesita (ZAB-35, F7 D3)

**Decisión:** los tres componentes que estrenan F7 se reparten así — **`ProgressBar` y
`Spinner` entran como primitivos** y **`Badge` se queda en azúcar de authoring** —, y el
criterio no es la complejidad visual sino **qué capacidad falta en la IR**:

1. **`ProgressBar`: el nodo ES la pista, `children[0]` ES el fill.** `value?:
   Bindable<number>` (0..1, clampado; lo que no sea número finito lee como 0 — barra
   vacía, nunca llena) y el SDK dimensiona el fill en `contentMain × value` sobre
   `layout.direction`, estirándolo en el eje cruzado; `justify` lo ancla (`end` = una
   barra que se vacía hacia atrás) y el `width`/`grow` propios del fill se ignoran en el
   eje principal. Es primitivo porque la **fracción** es justo lo que no se puede
   expresar: las dims de `Layout` son px y no son bindeables, y `grow` es un factor de
   reparto. Slot posicional como el header del `Collapse`, así que el paint sigue siendo
   implícito y no hace falta capa de dibujo.

2. **El `transition` del ProgressBar tweenea el VALOR, no el rect.** El SDK interpola la
   fracción y **después** corre su pasada normal de layout: es la regla de ZAB-33 §4
   ("interpolar inputs declarados, nunca rects calculados") aplicada a un input que
   calcula el propio componente — una sola pasada por frame, sin realimentación, e
   idéntica en ambos targets. El `transition` del fill no ve nada, porque su tamaño
   principal no es un input suyo.

3. **`Spinner`: no gira, late.** Sin transform en v1 no hay arco rotando; lo que sí es
   expresable y portable al último decimal es modular `opacity`. Con `n` hijos, el hijo
   `i` lleva la fase `frac(elapsed/period − i/n)` y el SDK **multiplica** su opacidad
   resuelta por `min + (1−min)·spinnerPulse(fase, easing)` — multiplicativo como toda
   opacidad desde 2026-08-06. Es primitivo porque un **loop infinito es comportamiento
   indexado por identidad** (2026-08-11 §5), como el offset del scroll: esa identidad
   tiene que estar en la IR. `period` es `Dim`, así que un tema "reduce motion" lo
   **congela** en su primer frame en vez de hacer desaparecer el spinner; salir de layout
   borra su reloj, y al volver la onda arranca desde el suelo (como un montaje).

4. **`spinnerPulse(phase, easing)` en `@zabloo/format`**, junto a `easeProgress` y por la
   misma razón: rampa simétrica construida sobre los mismos polinomios cerrados, para que
   la paridad entre targets sea aritmética y no dependa de que dos implementaciones de un
   seno coincidan. `clampProgress` viaja con él: "qué enseña un binding roto" tiene una
   sola respuesta en los tres motores.

5. **`Badge` = azúcar** (Container píldora + `Text` bindeado): `Text` es bindeable desde
   v1, así que no falta nada. Dos límites que se **documentan en vez de forzarse**: no se
   oculta solo en cero (eso es una expresión, y en la IR no hay lógica — se bindea
   `visible` a un flag del juego) y no se ancla a la esquina de un icono (pide
   posicionamiento superpuesto, que v1 no tiene).

**La maquinaria, compartida y no duplicada:** el motor de ZAB-45 generaliza la clave de
sus tracks a `AnimatableProp | BehaviorKey` y expone `stepValue(...)` para un escalar cuyos
extremos calcula el comportamiento (hoy `"progress"`). El componente decide **qué** se
mueve; `transition.ts` sigue decidiendo **cómo**: una regla de interrupción, un reloj, un
set de curvas. Así §5 de ZAB-33 queda en código en vez de en un segundo motor paralelo.

**Forward-tolerance:** aditivo dentro de v1, sin bump. Un SDK que no conoce los tipos los
renderiza como `Container` (regla normativa de tipos desconocidos): el ProgressBar pierde
la fracción y el Spinner se queda quieto, pero nunca cambia el layout de alrededor ni se
pierde contenido. El Badge es invisible al cambio (ya era Container + Text).

**Alternativas descartadas:** hacer bindeables las dims de `Layout` (capacidad grande que
ZAB-33 dejó para "el día que el estilo sea bindeable", y sin porcentajes obligaría al juego
a mandar píxeles); `fill?: Style` como segundo Style por nodo (rompe el paint implícito y
no reutiliza el slot posicional que ya usan Collapse y Toggle); **spinner como
`ProgressBar indeterminate`** (ahorra un primitivo, pero deja el idioma "cargando" en una
barra que barre y mezcla dos comportamientos en un tipo); modular color en vez de opacidad
(mismo coste, menos legible sobre fondos claros).

**Verificado** (preview real): `SetData` moviendo la barra con deslizamiento y re-apuntando
a mitad de recorrido, la onda del spinner avanzando entre frames, el badge siguiendo su
binding, y el fill respetando las esquinas de la pista (clip por defecto en el azúcar).

**Numeración de primitivos:** ZAB-29 (`Repeat`) y ZAB-24 (`Slider`) reclaman **ambos** el
"9º" en ramas en vuelo, así que estos dos entran **sin ordinal** en los docstrings; quien
consolide el catálogo (ZAB-41, F8) renumera de una vez.

**Diferidos:** barra **indeterminada** (el mismo loop conduciendo un fill que barre),
etiqueta encima de la barra y badge anclado a una esquina (piden posicionamiento
superpuesto), ocultar el badge en cero (pide expresiones), spinner giratorio (entra con la
capa de paint explícita y su transform). Unity va detrás de ZAB-34.
**Spec completa:** `specs/2026-08-11-progressbar-spinner-badge-design.md`.

## 2026-08-11 — `<List>`/`<Grid>`: azúcar sobre `Repeat`, template con alias vivo y `wrap` en el subset (ZAB-32, F6 A6)

**Decisión:** la capa de autoría de listas **no estrena nada en la IR salvo `wrap`**.
`<List>` y `<Grid>` son azúcar de `@zabloo/react` que emite un `Repeat` — lo que ZAB-29
ya previó al hacer que **el `Repeat` sea el contenedor flex de sus instancias** — y el
primitivo **no se exporta**, mismo trato que `Toggle` (ZAB-23) y `Slider` (ZAB-24): con
slots posicionales, la convención se escribe en un solo sitio.

1. **El template admite children planos Y render-prop, y emiten la misma IR.** La
   función se ejecuta una vez, en authoring, como cualquier componente de usuario. Lo
   que aporta no es brevedad sino que **el alias deje de estar duplicado**:
   `{(cat) => <Text bind={cat("name")} />}` mueve todos los bindings al renombrar `as`,
   que es lo que hace legible el caso anidado — el que ZAB-29 se molestó en hacer
   alcanzable declarando el alias en vez de reservarlo. El `ItemRef` es un
   **constructor de strings** (`cat("name")`, `cat()`, `cat.$index`), no un proxy: la
   resolución sigue siendo del SDK vía `resolveBinding`, y authoring no interpreta
   ningún path.

2. **Nombres:** `items` es un **string** (en el `Repeat` siempre es binding, así que
   `{bind}` sería ceremonia — el criterio de `<Text bind>`), el `key` de la IR se llama
   **`keyPath`** (React se queda con `key`, y el nombre además dice que es un *path*, no
   la key ya leída), y el estado vacío es la prop **`empty`**: en JSON el slot es
   posicional porque no hay nombres, en JSX los hay. De ahí la única restricción de
   forma: **el template de `<List>` es un solo nodo**, porque `children[0]` *es* el
   template.

3. **`wrap` entra en el subset de layout** — el hueco que ZAB-29 dejó apuntado aquí. Una
   rejilla **es** una fila que envuelve, así que la capacidad es del layout y sirve a
   cualquier nodo, no solo al `Repeat`. `align-content` **no** entra: las líneas se
   apilan desde el principio. Descartados los `Repeat` anidados por fila (la otra
   salida): obligarían al juego a mandar los datos ya troceados en filas, y la forma de
   los datos no puede depender del ancho de la pantalla.

4. **La geometría del `<Grid>` se resuelve en authoring, y `columns` no viaja.** Sin
   dims fraccionarias (el mismo límite que hizo primitivo al `ProgressBar`), "4 por
   línea" solo puede ser un ancho de celda y uno de línea que cuadren: el componente
   resuelve el que falte y **redondea en la dirección que preserva la rejilla** (línea
   hacia arriba, celda hacia abajo — `n·w` de golpe y celda a celda no caen en el mismo
   float, y un pelo de menos tira la última celda a la línea siguiente). Corolario
   aceptado: `gap`/`padding` **numéricos** en un `<Grid>`, porque un token se resuelve
   dentro del SDK y esta suma ocurre en `zabloo export`. Cada item va en una **celda
   `Container`** que lleva el ancho, para no depender de que la raíz del template sea un
   primitivo con `layout` (podría ser un componente de usuario).

**Forward-tolerance:** aditivo, sin bump. Un SDK que no conoce `wrap` lo ignora como
cualquier prop desconocida y pone los hijos en una línea: la fila se desborda, pero no
se pierde contenido. El `Repeat` degrada como ya decidió ZAB-29.

**Verificado por tests de emisión de IR** (criterio de salida de la tarea): **32 emite,
31 consume** — implementar `Repeat` y `wrap` en el pase de layout es del renderer
(ZAB-31, y ZAB-30 en Unity), así que hasta que mergeen no hay nada que dibuje una lista.
La virtualización y el presupuesto de cientos de items viven allí; las `keyPath` de aquí
son lo que las hace posibles.

**Spec completa:** `specs/2026-08-11-list-grid-design.md`.

## 2026-08-11 — `ScrollView` cerrado como componente: sin estados, sin eventos, offset solo por canal de host (ZAB-9, F1 A3)

**Decisión (ZAB-9):** el componente no gana comportamiento — gana contrato escrito.
Tres puntos que no estaban decididos en ZAB-5 (que fijó la IR) y que ahora son spec:

1. **`states.*` no aplica al nodo ScrollView.** No es focusable, no tiene
   `hover`/`pressed` y no participa en ningún `group`, así que ni `selected` ni
   `checked`. El offset **no es un estado de estilo**: no hay `states.scrolled` ni
   lo habrá — scrollear no cambia cómo se pinta el scroller, cambia dónde está su
   contenido. Los hijos conservan sus estados con normalidad.
2. **No emite eventos.** Sin `onScroll` en v1 (un evento continuo no tiene
   consumidor hoy y abriría acciones a 60 Hz) y sin offset bindeable, a diferencia
   del valor de `Toggle`/`Slider`. El juego lo mueve con `SetScroll(id, x, y)`, que
   es **API de host, no IR** — hermano de `setOpen`/`setChecked`/`setValue` — y
   clampa contra los límites del último relayout.
3. **El viewport lo pone el autor.** Sin tamaño propio (ni `grow`, ni padre que lo
   estire) el scroller abraza su contenido y no scrollea nada; es consecuencia de
   que por fuera sea un nodo flex normal y no se puede distinguir de "aún cabe".

**Razón:** el catálogo se está construyendo con la regla de que cada componente entra
con su spec de props/estados/eventos escrita, y el scroller era el único que tenía
implementación sin tabla de estados. Decir "ninguno" **es** la decisión: evita que
alguien intente estilar un scroller por estado y evita un `onScroll` que
comprometería el modelo de dos mecanismos dinámicos (acciones con nombre + bindings).

**Verificado** (preview real, `examples/inventory-demo`): 14 filas ricas
desbordando un viewport de 340 px con rueda y drag clampados en ambos extremos;
tira horizontal con `axis="horizontal"` y `scrollbar={false}`; cerrar el `Collapse`
de dentro reclampando el offset al final nuevo; clic en el botón de una fila sin que
el drag se lo coma; `setScroll` moviendo la tira desde la consola.

**Dos huecos del input (ZAB-8) que el ejemplo destapa**, anotados aquí porque se leen
como fallos del componente y no lo son: (a) la rueda mapea 1:1 (`deltaX → x`,
`deltaY → y`), así que el `deltaY` de un ratón normal **no mueve** un scroller solo
horizontal; (b) un drag que empieza sobre un `Button`/`Toggle` no scrollea — el
`pointerdown` toma la rama de pulsación y sale. Propuesta para cuando se retome el
input: que `deltaY` caiga al eje horizontal cuando es el único scrolleable, y que la
pulsación registre también el gesto de scroll, cancelándose al superar el umbral (el
`up` ya sabe cancelar el tap si el nodo se movió).

**Diferidos, todos compatibles:** ScrollTo/offset declarado o bindeable y auto-scroll
al nodo enfocado → fase de gamepad (F5); inercia, scrollbar estilable
(booleano → objeto) y snap → después.

**Spec completa:** `specs/2026-08-11-scrollview-design.md`. Paridad Unity en ZAB-6 y
golden cross-target en ZAB-38.

## 2026-08-11 — Juice del catálogo: `hover` en web, y cuatro comportamientos conduciendo el motor (ZAB-36, F7)

**Decisión (ZAB-36):** aplicar las transiciones al catálogo que ya existía no fue "poner
una prop": destapó cuatro decisiones, **ninguna de las cuales añade superficie a la IR**.
Todas se apoyan en la regla §5 de ZAB-33 — *un comportamiento del SDK, indexado por
identidad de componente, puede conducir la misma maquinaria con extremos que él calcula*.

1. **`hover` se implementa en el renderer web** (estaba en `StateName` desde v1 sin
   implementación). **Hoverable = focusable** (Button, Toggle, Slider, header de Collapse):
   la misma regla de identidad que ya decide `pressed` y la navegación, no una tercera
   lista. Solo ratón — un dedo que toca y se va dejaría el control encendido. Y con él, el
   **orden de estados normativo**: `base → selected → checked → hover → focused → pressed`
   (los estados de valor son la base; `hover` bajo `focused` para no tapar el anillo;
   `pressed` gana porque dura lo que el dedo). En `states.ts`, puro, para que Unity porte la
   misma tabla.
2. **`Collapse`: se anima su propia altura** entre la caja del header y la altura natural
   medida con el contenido dentro. El contenido entra en layout al empezar y sale al
   terminar (cerrado sigue costando cero), con **clip forzado** mientras dura. Los extremos
   salen del **measure anterior**, que es lo que evita el bucle medida→animación→re-medida
   de ZAB-33 §4: el precio, aceptado, es **un frame de arranque** en la primera apertura, en
   el que la caja se queda cerrada. Solo la altura (el ancho salta); un `layout.height`
   declarado gana y desactiva el comportamiento.
3. **`Toggle`: los dos slots comparten caja y hacen crossfade.** `children[1]` se arregla
   *encima* de `children[0]`, no después, y la opacidad decide cuál se ve; la caja es la
   mayor de las dos, así que el control no baila al cambiar. Es una generalización del pase
   de layout (`flowItems` devuelve cajas, normalmente una por hijo), no un parche. **El knob
   no se desliza**: sin transform en v1 no hay posición animable (`justify` es un enum), y un
   deslizamiento real pediría semántica de arrange nueva → diferido.
4. **`Slider`: planea lo que viene del juego, salta lo que viene del dedo.** Un `SetData`
   o `setValue` interpola el valor pintado; un gesto en curso (drag o flechas) no —un pulgar
   por detrás del dedo se lee como control roto, no como juice.

**Bug de contrato corregido:** un `borderColor` **no declarado ahora sostiene el último**
resuelto. Al salir de `focused`, `borderWidth` interpolaba 2→0 mientras el color pasaba a
`undefined` y el paint caía a `MISSING_COLOR`: **flash magenta en cada desenfoque**. El
borde solo se pinta si hay `borderWidth`, así que sostenerlo no inventa nada.

**Defaults de `transition` en el theme, keyed por componente** (`theme.transitions`, misma
clave que `variants`, más `VariantDef.transition`). Precedencia: **nodo > variante > theme**,
y gana entero el más específico (`transition` es un objeto por nodo, no se mergea campo a
campo). Se descartó un default global único: metería `transition` en cada nodo del envelope
y animaría lo que nadie pidió; con `duration` tokenizada un tema ya ajusta todo el
movimiento desde `motion.*`. Se resuelve en autoría, como los variants.

**`Tabs`:** se anima el botón (`states.selected`, maquinaria declarativa); **los paneles
siguen saltando** — entrar y salir del layout es entrada/salida, y sigue diferido.

**Verificado en el preview real** (`zabloo dev` con duraciones exageradas para capturar
frames intermedios), porque la vista no tiene tests unitarios: hover encendiendo la fila
bajo el puntero, crossfade del `Switch` con los dos knobs a la vez, `Collapse` a media
apertura con el contenido recortado y lo de abajo desplazándose, `Slider` planeando hacia un
valor empujado por `setData`, y el anillo de foco adelgazando **en blanco** hasta
desaparecer. Los módulos puros nuevos (`states.ts`, `collapse.ts`) y las cajas compartidas
del layout sí llevan tests.

**Spec completa:** `specs/2026-08-11-catalog-transitions-design.md`.

## 2026-08-11 — `TextInput`: el 13º primitivo, y el primero con interior (ZAB-26, F5)

**Decisión (ZAB-26):** el componente más caro del roadmap entra como **tipo propio**
porque estrena la capacidad que ninguno tenía: **el caret**. Todos los controles
anteriores producían su valor *apuntando a geometría* — un booleano, un número, un
índice — y ninguno tenía **interior**: un punto de inserción y una selección dentro de
un contenido que el jugador está escribiendo. Es una **hoja con contenido**, como
`Text` e `Image`: sin hijos, pintando su propio valor por el camino de texto de
siempre. Descartado un `Text` con `editable: true` — despachar por tipo **y** por prop
es lo que ya hundió `overflow` (ZAB-5), `checkable` (ZAB-23) y `Repeat` como prop de
`Container` (ZAB-29) — y además un `Text` mide su contenido, mientras que un campo no
puede crecer con lo que se teclea.

**Una línea en v1**: mide una línea de alto y **ancho cero** (el ancho es suyo, del
`layout`), y el contenido hace **scroll horizontal** para mantener el caret dentro. El
multilínea es una extensión sobre el wrap de ZAB-17 (caret con fila, selección por
rangos, scroll vertical): otro componente de trabajo, no un flag.

**El placeholder es un ESTADO, no un color nuevo:** `placeholder` se pinta con el
estilo de texto del propio campo y **`empty` entra en `StateName`** para vestirlo
(`states.empty.style.color`). `Style` no gana un campo y el placeholder hereda tokens,
`transition` y variantes gratis. Con él, el orden normativo de ZAB-36 se amplía por la
izquierda: **`base → empty → selected → checked → hover → focused → pressed`** —
`empty` abre porque es la afirmación más débil que un control hace sobre su valor.
Descartados el slot posicional (parte en dos sitios el mismo texto y convierte la hoja
en contenedor) y un `placeholderColor` (la cascada por componente que el set cerrado
evita).

**Las flechas mueven el caret y, en el extremo, DEJAN NAVEGAR.** Diferencia deliberada
con el `Slider` (ZAB-24), donde las del eje nunca navegan: un recorrido corto hace
barato saltar de valor, salir de un texto largo pulsando → treinta veces no lo es. La
regla de fondo es la misma — *el control se queda solo las teclas que puede usar* — y
Enter dispara `onSubmit` mientras Espacio y la A del mando no activan nada.

**En web, un `<textarea>` oculto conduce el campo.** Un canvas recibe teclas, no
texto: IME, portapapeles y teclado de móvil pertenecen a un elemento editable real, así
que hay uno fuera de pantalla (no `display:none`: sin foco no hay composición) espejado
en los dos sentidos. Compra IME real, pegar/copiar/cortar, autocorrección y teclado
virtual sin escribir ninguno; cuesta releer el valor entero en cada `input`, así que
`maxLength` y la regla de una línea se aplican pasándolo por el mismo `insert()` del
modelo. **Durante la composición el campo la enseña y el juego no se entera**:
`compositionend` escribe el binding una sola vez. Es el único trozo del target y no del
contrato — Unity tendrá el suyo, y el modelo compartido está en `textinput.ts`.

**`maxLength` acota lo que se teclea, no lo que vale el dato:** un valor más largo
empujado por `SetData` se muestra entero. Recortar el dato del juego sería mentir sobre
lo que contiene. **Caret y selección** los pinta el SDK con el `style.color` del campo
(el mismo "color del contenido" de glifos e imágenes), con el parpadeo como
comportamiento indexado por identidad —como el loop del `Spinner`— y su estilizado
diferido, igual que el scrollbar del `ScrollView`. **Los índices se cuentan en code
points**: un caret que puede caer en medio de un emoji es un caret que lo parte (los
clusters de grafemas piden tabla de segmentación → diferidos, como el shaping).

**Verificado en el preview real** (`zabloo dev`), porque la vista no tiene tests
unitarios: teclear escribe el binding y el `<Text bind>` lo sigue, el placeholder se va
al primer carácter, shift+flechas resalta (y el caret desaparece), un pegado de 38
caracteres se queda en 16 mientras un `setData` de 28 se ve entero, el drag deja una
selección hacia atrás, un valor más largo que la caja se desplaza y se recorta, y Enter
deja `action: name-accept` en el log. El módulo puro (`textinput.ts`) sí lleva tests.

**Spec completa:** `specs/2026-08-11-textinput-design.md`. Paridad Unity en el batch
final; teclado en pantalla de consola en v1.x.

## 2026-08-11 — Anclaje de overlays y disparo por hover/focus (ZAB-46, F4 C3+)

**Decisión:** cerrar las dos capacidades que ZAB-21 §6 dejó fuera del `<Tooltip>` a
propósito, porque eran contrato de la IR y comportamiento de SDK, no azúcar.

**Un campo, porque las dos son la misma relación:**
`anchor?: { id, at?, offset?, trigger? }` en `OverlayNode`. Un `trigger` sin ancla no
tiene de quién leer el hover y una colocación sin el rect contra el que se coloca no
significa nada, así que cuatro campos hermanos habrían sido cuatro formas de escribir
media relación. El placement de capa (`layout.justify`/`align`) **se sigue emitiendo**:
un SDK que ignore `anchor` pinta el tooltip de v1 en la capa, que es una degradación
visible en vez de un hueco.

**Colocación — las mismas nueve anclas, leídas alrededor del ancla.** `at` es lado +
alineación (`top-left` = **encima**, a ras del borde izquierdo del ancla; no una
diagonal), `center` va SOBRE el ancla ignorando el `offset`. El ajuste es determinista y
sin campo propio: **flip** al lado opuesto si el preferido no cabe y el otro sí, y
**clamp** dentro de la vista después — nunca los dos en el mismo eje, porque una burbuja
que no cabe arriba pertenece abajo, mientras que una que se sale por el costado solo
necesita deslizarse (voltearla la alejaría de aquello a lo que apunta). El `padding` del
overlay anclado es ese margen con los bordes. **El rect del overlay sigue siendo el de
la vista**: lo que se coloca son sus hijos, y por eso un popover anclado y `modal`
mantiene backdrop y captura sobre toda la pantalla. Es la única colocación de v1
relativa a un rect que el nodo no contiene.

**Disparo — `trigger: "hover"` es hover O focus.** Un solo valor porque son la misma
pregunta desde dos dispositivos, y porque el equivalente de mando **es** el foco: la
pista llega al gamepad sin mecanismo nuevo y sin esperar a la fase de gamepad. `visible`
sigue siendo la puerta de la capa (un binding a `false` apaga las pistas) y el SDK no
escribe nunca por el disparo; `autoCloseMs` se ignora ahí. Un overlay así es **inerte al
input**: si se comiera el puntero apagaría el hover que lo sostiene. Y su ancla tiene
que ser algo que tome input, porque el hover ilumina exactamente el conjunto focusable
(2026-08-11, ZAB-36) — se avisa por consola en vez de quedarse a oscuras. **El disparo
no se deriva de `anchor`**: el popover anclado que abre el juego (el dropdown del
`Select` de F5) tiene que seguir siendo expresable.

**Un tooltip nunca apunta a nada:** ancla fuera de layout o recortada del todo (scroll)
⇒ el overlay sale de la capa con su fundido de salida; `id` que no resuelve ⇒ error de
autoría, warn una vez y colocación de capa.

**Autoría:** `anchor` es una prop más, como se prometió — `<Tooltip anchor="jump-btn">`,
con `position` pasando a ser el lado del ancla y `trigger="hover"` asumido solo en el
`<Tooltip>` (un menú se abre, no se roza).

**Web:** `anchorBox` en `overlay.ts` (puro y testado — referencia literal para Unity,
como `stepPresence`), y el predicado de la capa pasa a ser `inLayout && anchorAllows`,
de modo que input, foco, timers y la presencia recogen las dos capacidades sin cableado
propio en ningún otro sitio. Verificado en el preview real: hover, foco por teclado con
el ratón fuera, flip al estrechar la ventana y salida al soltar el ancla.

**Spec completa:** `specs/2026-08-11-tooltip-anchor-design.md`. Unity, en el batch final.

## 2026-08-12 — Gamepad en el preview web (ZAB-47, F5 C2)

**Decisión:** el mando es **una fuente de input más sobre la maquinaria que ya existe**,
no un segundo modelo. Todo lo que produce se resuelve a las intenciones que el teclado
ya produce — dirección unitaria, pulsación, dismiss, scroll — y entra por los mismos
handlers: d-pad/stick izquierdo → la cascada del `keydown` (caret del `TextInput` → eje
del `Slider` → `moveFocus`), A → `pressFocused` por flancos, B → `requestDismiss` del
modal superior (el Escape de la web), stick derecho → el `ScrollView` que contiene el
foco. El d-pad gana al stick y una diagonal colapsa a su componente horizontal: la
navegación se mueve en un eje, y un desempate estable vale más que alternar entre dos.
Para reusar la cascada, `editKey` pasa a recibir una **intención** en vez de un
`KeyboardEvent` — que un evento real satisface tal cual, así que el teclado no cambia.

**Bucle propio, vivo solo mientras hay mando.** La Gamepad API se consulta, no empuja, y
el renderer pinta bajo demanda: `scheduleFrame` se apaga cuando nada anima, así que el
polling necesita su propio rAF, arrancado por `gamepadconnected` y parado con el último
`gamepaddisconnected`. Sin mando conectado no se programa ni un frame. Zona muerta con
histéresis (0.5 entra, 0.35 suelta, y el umbral de salida solo vale para la dirección ya
mantenida), repeat de 400 ms + 90 ms que dispara al pulsar y **como mucho un movimiento
por frame** tras un parón, y stick derecho como VELOCIDAD (px/s por la duración del
frame, respuesta cuadrática). Un mando desenchufado a media pulsación **cancela**; un
slider en movimiento cuando desaparece **sí asienta** (`onCommit`).

**Sobre un `TextInput`, el d-pad es el teclado:** ←/→ mueven el caret y en el extremo
devuelven la dirección a la navegación, ↑/↓ navegan siempre — la decisión 4 de ZAB-26,
reusando `editKey` en vez de reescribirla. Descartado que el d-pad navegue siempre con
un campo enfocado: dejaba el caret inalcanzable desde el mando y separaba teclado y
mando justo donde el usuario los espera idénticos.

**El foco arrastra el scroll**, cerrando el diferido de ZAB-9 ("auto-scroll hasta el
nodo enfocado → fase de gamepad"): comportamiento del SDK, sin IR nueva. El movimiento
mínimo y ninguno si ya cabe, burbujeando como `scrollIntoView` (cada scroller revela al
hijo suyo que contiene el foco, así los anidados convergen en una pasada), alineando el
borde de entrada de un objetivo mayor que el viewport y sin mover el que ya lo cubre.
Solo lo llama la navegación — el puntero enfoca lo que ya se está mirando — y lo hereda
el teclado, que es como debe ser: el foco es uno solo.

**Sin superficie de API nueva:** ni opción en `mount` ni callback. El indicador
`🎮 gamepad` de la página del `zabloo dev` escucha los mismos eventos del navegador por
su cuenta. Nota de la API que conviene tener escrita: **no hay mando hasta la primera
pulsación** (anti-fingerprinting), así que hasta entonces no hay ni indicador ni
polling; y una pestaña oculta suspende el rAF, que es el comportamiento correcto — un
mando no debe mover una UI que nadie mira.

**Web:** `gamepad.ts` puro y testado (mapeo, zonas muertas, reloj de repeat) como
referencia literal para Unity, `revealDelta` en `scroll.ts` con los suyos, y el cableado
en `view.ts`. Verificado en el preview real con un mando sintético sobre
`inventory-demo`, `settings-demo` y `overlays-demo`: una pulsación = un paso, un segundo
mantenido = 8 pasos (1 + 6 repeticiones), A activa y deja su acción en el log, B cierra
el modal y escribe su binding, el stick derecho scrollea, el foco arrastra la lista de
20 filas, el caret se mueve con el d-pad y ↓ abandona el campo, y las direcciones del
eje de un slider mueven el valor y sueltan `onCommit` al liberar.

**Spec completa:** `specs/2026-08-12-gamepad-web-design.md`. Unity es ZAB-27.

## 2026-08-12 — Validación robusta del envelope: política de carga compartida (ZAB-37, F8 E1)

**Decision:** la política de qué se ignora, qué avisa y qué aborta vive en
`@zabloo/format` (`readEnvelope`), y la frontera es una sola pregunta — **¿queda árbol
que renderizar?**. Es `fatal` solo lo que no deja ninguno: JSON inválido o truncado, no
es objeto, `v` ausente o no numérica, major incompatible, `views` ausente, y cero vistas
utilizables tras reparar. Todo lo demás **avisa y degrada**: vista o nodo malformados se
descartan, una prop de tipo erróneo cae a su default, una entrada de asset inválida se
descarta (antes era error duro), y las refs colgantes (token, asset, anchor), los ids
duplicados y los paths de binding malformados avisan sin tocar nada. Las props y los
tipos de nodo desconocidos siguen pasando **en silencio**.

Tres piezas más, que son las que hacen que esto se escriba una sola vez:

1. **Formas, nunca vocabularios.** Un set cerrado (`Easing`, `ImageFit`, `AnchorAt`,
   `GroupBehavior`…) se comprueba que sea string y hasta ahí — validar el valor
   convertiría el contenido de mañana en el error de hoy.
2. **El envelope vuelve REPARADO**, no solo reportado: una copia sin las partes rotas,
   con las props desconocidas intactas y sin mutar el objeto del llamante. Un slot
   posicional descartado (`Collapse`, `Toggle`, `Slider`, `ProgressBar`, `Repeat`,
   `exclusive-select`) se sustituye por un `Container` inerte, porque quitarlo
   renumeraría los siguientes y cambiaría en silencio lo que significan.
3. **Diagnósticos legibles** con `path` (`views["hud"].children[2].text`), campo y
   motivo, y un `code` estable que ES el contrato: es lo que el loader de Unity tendrá
   que emitir ante el mismo input. Más un tope de profundidad (256): todo lo que viene
   detrás es recursivo, así que un árbol capaz de desbordar la pila deja de ser un árbol
   en la puerta.

**Reason:** hasta aquí la validación era mínima a propósito (2026-08-11, ZAB-10) y el
payload roto llegaba al frame, con lo que cada consumidor tenía que defenderse solo en
cada nodo — dos implementaciones de la misma defensa, divergiendo. Con la reparación en
el formato, la robustez se hereda; y la política, al ser una sola, es portable literal a
Unity.

**Consecuencias en los consumidores:** `mount()` lanza el error legible (no hay nada en
pantalla que proteger todavía) y **`reload()` nunca lanza**: conserva el envelope en
pantalla, así que un hot-update corrupto cuesta la actualización y no la sesión. El
warning de token desconocido sale del bucle de frames al pase de carga (repetía frame
tras frame). `zabloo export` valida antes de escribir — fatal aborta, los warns entran
en el resumen — pero escribe el árbol del autor, **nunca el reparado**: descartar en
silencio un nodo del artefacto escondería el bug que el warning acaba de nombrar. La
preview enseña el error en su log en vez de morir en una promesa rechazada.

**Alternatives considered:** *solo reportar sin tocar el árbol* (más barato y máxima
tolerancia, pero obliga a reimplementar la robustez en cada SDK); *mantener los assets
inválidos como error duro* (un icono corrupto tirando toda la UI); *que nada sea fatal
salvo la versión* (un `views` ausente devolvería un lienzo negro sin explicación);
*cambiar la firma de `parseEnvelope`* para devolver diagnósticos (rompía a todos los
llamantes, incluido el futuro port de Unity).

**Spec completa:** `specs/2026-08-12-envelope-validation-design.md`. Paridad Unity: batch
final. Forward-compat es ZAB-39; goldens, ZAB-38.

## 2026-08-12 — El popover (`trigger: "press"`) y `<Select>` como composite (ZAB-25, F5 C4)

**Decisión:** el desplegable NO es un primitivo. `OverlayTrigger` gana un tercer valor,
`"press"`, y `<Select>` queda como composite aplanado sobre piezas que ya existían: un
`Button` con `id`, un `Overlay` `modal` anclado a él (ZAB-46) y un `ScrollView` alrededor
del grupo `"exclusive-check"` que ya usa el `<RadioGroup>` (ZAB-23).

**Reason:** de los cinco requisitos de un desplegable, cuatro ya eran expresables —
colocarse pegado al botón con volteo (`anchor`), bloquear y cerrarse con Escape o clic
fuera (`modal` + dismiss, ZAB-44), scrollear una lista larga (`ScrollView`) y escribir el
valor elegido (binding de lectura/escritura, ZAB-23). El único que faltaba era **que
elegir cierre la lista**: un `Overlay` solo se abría y cerraba por su `visible` bindeado,
y nada en la IR podía escribir ese booleano en respuesta a algo hecho DENTRO. Y "abierto"
no es dato del juego: es estado de runtime, como el `open` del `Collapse`. La capacidad
que falta, entonces, no es "un control que elige de una lista" —eso ya es el grupo— sino
**un overlay cuyo estado de apertura es del SDK**, que pertenece a la relación de ancla y
no a un tipo de nodo. Regla del vocabulario respetada: *primitivo nuevo solo cuando fuerza
una capacidad nueva*.

**Las cuatro reglas normativas del popover:** (1) pulsar el ancla lo abre y lo cierra, sin
tragarse su `onClick`; (2) un dismiss —Escape, B, backdrop— lo cierra; (3) una selección
en un `"exclusive-check"` de dentro lo cierra, **también al reelegir la ya marcada**; (4)
al abrir, el foco va a la opción marcada, si no al `autofocus`, y si no a la **primera
opción** — un menú abierto sin foco no se recorre con las flechas. `visible` sigue siendo
la puerta, el SDK **nunca lo escribe** por un popover (el estado es suyo, no del dato) y
`autoCloseMs` se ignora, como con `hover`. Degradación: un trigger desconocido se lee
`manual`, así que la lista se queda abierta e inerte en su sitio, nunca invisible.

**El botón cerrado enseña el VALOR**, vía `<Text bind>` al mismo path: la IR no tiene
expresiones, así que no hay con qué buscar `"Alta"` a partir de `"high"`. Corolario
honesto: **no hay `placeholder`** —un valor vacío deja el botón en blanco— y quien quiera
texto legible autora los strings de display como `value`. Espejar el subárbol de la opción
marcada (una relación nueva "un nodo pinta el contenido de otro", a portar ×3 motores) y
un slot por opción en el trigger (tocaría la semántica de `value` dentro de un grupo) se
descartan hoy; el split value/label es extensión compatible.

**El popover revela la opción sobre la que abre.** El auto-scroll al foco lo aterrizó
ZAB-47 en main mientras esto estaba en review, así que se reusa su `revealDelta`/
`revealFocused` en vez de duplicarlos. Lo que se añade es el caso que aquella regla excluye
a propósito —solo la navegación la llama, porque un foco restaurado "llegaría un frame
tarde"—: un popover abre SOBRE su selección, y esa opción se acaba de disponer en el frame
en que aparece, así que sin revelarla una lista de veinte idiomas abre por arriba con el
foco invisible. Se resuelve no en el frame siguiente sino en el **pase siguiente**:
`revealOpenedPopover` corre tras el arrange y solo escribe offsets, que es lo único que el
arrange lee de vuelta.

**Bug de pintado anterior, encontrado en el preview y arreglado:** el `GeometryBuilder`
solo abría grupo de batches al cambiar el clip, y dentro de un grupo van todos los sólidos
antes que todos los glifos — así que una entrada de la capa sin clip propio seguía llenando
el grupo del árbol y **el texto del árbol salía por encima del panel opaco que flotaba
sobre él**. Cada entrada de la capa es un paint root y ahora abre grupo sí o sí
(`startRoot()`), que es lo que `setClip` no podía expresar: dos roots pueden compartir
región de recorte y aun así tener que ordenarse uno detrás del otro. Con `<Modal>` pasaba
desapercibido porque su backdrop es translúcido.

**Alternatives considered:** *`Select` como 14º primitivo* (dueño de `open` y del valor,
con slots posicionales) — duplicaba la semántica de grupo y añadía superficie a los tres
SDKs sin ganar nada, y no habría servido para un menú contextual ni un selector de color;
*composite puro con `visible` bindeado a un path de UI* (`ui.langOpen`) — cero cambios en
la IR, pero no cierra al elegir y filtra estado de UI al store del juego; *lo mismo sobre
`Collapse`*, que sí es dueño de su `open` — mismo agujero en el cierre, y ni el dismiss ni
la selección llegan a él.

**Spec completa:** `specs/2026-08-12-select-design.md`. Unity y gamepad (ZAB-47/ZAB-27),
en sus propios tickets.

## 2026-08-13 — Congelación del API: `TextInput` sin `onCommit` y los tipos base exportados a propósito (ZAB-56, F8 E1)

Dos decisiones pequeñas que había que fijar ANTES de congelar el catálogo y escribir la
spec pública (ZAB-41). Ninguna toca la IR: las dos son contrato de la capa de autoría.

**Decisión 1 — la asimetría `onSubmit`/`onCommit` es deliberada: `TextInput` no gana
`onCommit`.** `Slider` parte sus acciones en `onChange` (vivo) + `onCommit` (al soltar)
porque un arrastre es un gesto continuo **sin otro final observable**: si el SDK no marca
el fin del gesto, nadie puede. Un campo de texto ya tiene su gesto de confirmación —
Enter, `onSubmit` — así que la pareja vivo/asentado existe igual; solo cambia el nombre
del segundo hook, y cambia porque el gesto es distinto: *submit* es algo que el jugador
HACE, el *commit* del slider es algo que deja de hacer. El "commit al perder el foco" de
los formularios web no traduce a un juego: con navegación por flechas/gamepad (ZAB-47)
el foco abandona el campo cada vez que el jugador lo cruza camino de otro control, así
que un commit-al-blur dispararía "valores asentados" espurios en cada travesía — y un
campo bindeado ya escribe cada edición en el dato, con lo que nada se pierde al salir.

Nota para no releerlo mal: el parámetro `commit` interno de `applyEdit`
(`renderer-web/view.ts`) **no es este evento a medio exponer** — marca el final de una
composición IME, donde el texto asentado debe notificarse aunque los frames silenciosos
ya lo hubieran dejado en el buffer.

**Alternativas descartadas (1):** *añadir `onCommit` (Enter + blur)* — simetría de
nombre con semántica rota por el blur espurio del gamepad; *renombrar `onSubmit` →
`onCommit`* — unificaba vocabulario barato antes del freeze, pero borra una diferencia
real y "submit" es exactamente lo que un autor espera de un campo de texto.

**Decisión 2 — `RepeatProps` y `ToggleControlProps` siguen en el export público, como
tipos base documentados.** No existen `<Repeat>` ni `<Toggle>` en la autoría (la autoría
es `List`/`Grid` sobre el primitivo `Repeat`, y `Checkbox`/`Switch`/`Radio` sobre
`Toggle`), pero estas interfaces son la mitad compartida de esas familias, ya visibles
en la cadena de `extends` de los `.d.ts`; con nombre público se puede tipar un wrapper
propio (`function MyToggle(p: ToggleControlProps)`) sin copiar la lista de props.
Quitarlas encogía la superficie congelada en dos nombres a cambio de dejar padres
innombrables en las declaraciones. **Regla que queda escrita para el freeze:** todo
tipo exportado o corresponde a un componente o está documentado como tipo base — no hay
exports accidentales.

**Alternativas descartadas (2):** *quitarlos del export* (los campos seguían accesibles
vía `ListProps`/`CheckboxProps`, pero los wrappers pierden el nombre); *añadir los
componentes que les faltan* (`<Repeat>`/`<Toggle>` genéricos) — superficie nueva sin
capacidad nueva, justo lo que el vocabulario prohíbe.

Ambas quedan también en los docstrings de `packages/react/src/components.ts`, que es lo
que un autor lee desde el editor.

## 2026-08-13 — Performance pass web: frame barato, atlas acotado y presupuestos (ZAB-55, F8 E1)

Los tres focos de la auditoría 2026-08-12, medidos primero y atacados después. Todo se
midió con el bench nuevo (`packages/renderer-web`, `pnpm bench`): monta escenas reales
sobre el harness golden, cronometra con `process.hrtime` (el harness FALSEA
`performance.now` — es el reloj de frames) y cuenta alocaciones con el sampling heap
profiler de V8 **con los flags de incluir objetos recolectados** — los deltas de
`process.memoryUsage().heapUsed` medían crecimiento de arena, no basura, y desviaban por
órdenes de magnitud en ambos sentidos.

**Foco 1 — el frame de animación reconstruía el mundo.** Un caret marcaba `animating` y
cada frame recorría el pipeline completo alocando por nodo (objeto `targets` + objeto
`values` + un wrapper por prop en `stepTrack`) y reconstruyendo TODA la geometría en un
`GeometryBuilder` nuevo con `Array.push` que `gl.draw` reconvertía a typed arrays por
batch. Se mantuvo el modelo pipeline-completo-por-frame (repaint parcial descartado: otro
proyecto, otro riesgo) pero en régimen estacionario ya no aloca: `resolve()` rellena un
scratch único de targets y `stepNode` escribe en el `resolved` persistente del nodo
(asignando TODAS las props, `undefined` incluido, para que no sobreviva un valor rancio);
el builder vive con la vista y `reset()` rebobina cursores sobre `Float32Array`/
`Uint16Array` que crecen una vez (los batches que consume GL son subarray-views de un
frame de vida); el perímetro redondeado escribe en un scratch de módulo y `parseColor`
memoiza por literal (nadie muta un `Color` — ya eran identidades compartidas).

Antes → después (M1 Pro, mín. de 3 tandas de 1.000 frames): relayout completo settings
0,27→0,19 ms y 352→54 KB/frame; frame de caret 0,29→0,17 ms y 370→46 KB; spinner
0,27→0,14 ms y 398→53 KB; scroll con 1.000 filas 0,81→0,60 ms y 1.307→182 KB. El corpus
golden salió byte-idéntico — el cambio es invisible salvo en coste. Los ~50 KB/frame que
quedan viven repartidos en el pase de layout (`measure`/`arrange`/`flowItems`) y en
iteradores; recortarlos es refactor de `layout.ts` con retorno modesto — se deja fuera.

**Foco 2 — atlas sin evicción ni crecimiento.** Un atlas lleno cacheaba el glifo como
blank PARA SIEMPRE; el `FontLibrary` creaba un canvas 1024² + textura GPU por cada
fontSize distinto, sin tope. Ahora el atlas crece a la siguiente potencia de dos hasta
4096 px de lado re-rasterizando lo cacheado en la superficie nueva — la mecánica de
`adopt()`, en el sitio: misma identidad, el GL re-sube con el bump de `version`, y los
blanks por falta de hueco vuelven a ser glifos. Solo en el máximo se rinde (blank +
un aviso por atlas). El `FontLibrary` pasa a LRU con cota de **8 tamaños vivos**; la
evicción entrega el atlas a un callback y la vista libera su textura con `gl.evict`.
Ocho cubre la escala tipográfica de una UI real; un `fontSize` animado ciclará con
thrash elegante (evict + re-rasterizar) en vez de agotar memoria.

**Foco 3 — la ventana del Repeat: medido, y NO se arregla.** Con 1.000 filas desiguales:
el coste CPU de `planWindow`/`windowDrifted` es una fracción de un frame de scroll de
0,60 ms — sin presión de presupuesto. El artefacto de "la instancia más grande vista
gana" es real: tras recorrer la lista, `reserved` pasa de 36.392 px a 91.588 px y no
se recupera; la ventana en el tope realiza 6 filas donde antes 11. El coste es
cosmético y acotado (proporción del thumb del scrollbar, deriva de offsets sobre
estimaciones — sin huecos visibles con esta distribución), y la alternativa (extent con
decay) reabre la oscilación ventana↔medida que la regla max-wins existe para impedir
("looser than it should be, never busy"). **Revisitar solo si** el preview del editor
muestra huecos con contenido real: una distribución adversa (viewport entero de filas
pequeñas tras haber visto una grande) puede infra-realizar.

**Presupuestos web** (los consolida ZAB-40 junto a Unity):

| Presupuesto | Valor | Observado hoy | Se impone en |
|---|---|---|---|
| Draw calls por escena golden | ≤ 24 | 1–17 (el máx. es `anchors`: cada overlay anclado es un paint root) | `budgets.test.ts` (CI) |
| Vértices por escena golden | ≤ 2.000 | 49–940 | `budgets.test.ts` (CI) |
| Atlases vivos por escena | ≤ 3 (cota dura de la librería: 8) | 1–2 | `budgets.test.ts` (CI) |
| Memoria de atlas por escena (dpr 1) | ≤ 12 MiB CPU (+espejo GPU) | 4–8 MiB | `budgets.test.ts` (CI) |
| Frame de animación (escena settings, M1 Pro) | ≤ 0,5 ms / ≤ 100 KB alocados | 0,17 ms / 46 KB | `pnpm bench` (manual) |
| Frame de scroll, 1.000 filas desiguales | ≤ 1,5 ms | 0,60 ms | `pnpm bench` (manual) |

La mitad determinista (draw calls, geometría, memoria de atlas) la vigila CI vía el hook
`stats()` del handle — telemetría web-only, deliberadamente FUERA de `snapshot()` (que es
contrato cross-target). La mitad wall-clock es del bench manual: en CI flaquearía, y su
valor es comparar un antes y un después en la misma máquina.

**Alternatives considered:** *repaint parcial / dirty-tracking* — cambio de arquitectura
con su propio diseño; el 80 % del coste era alocación y reconstrucción, que caían sin
tocar el modelo; *multi-página de atlas* — draw call extra por página y más superficie
GL, cuando crecer a 4096 cubre el caso real; *evicción LRU por glifo* — repacking y
contabilidad por glifo, sobredimensionado para v1; *decay del extent del Repeat* —
descartado con datos (arriba).

## 2026-08-13 — Política de versionado del formato: `v` es el major y no hay minor (ZAB-41, F8 E1)

**Decision:** el `v` del envelope **es el major y el único número de versión del formato**.
Los cambios **aditivos** no lo tocan — la forward-tolerance ya define qué hace un SDK viejo
con ellos: tipo de nodo desconocido → `Container` preservando `layout`/`style`/`visible`/
`children`, prop desconocida → ignorada en silencio, valor desconocido de un set cerrado →
default de esa prop, `group` desconocido → hijos como hermanos normales. Los que **rompen**
suben `v`, y ahí el SDK **rehúsa** (`unsupported-version`, fatal), en ambas direcciones:
`supportsVersion(v)` es igualdad exacta con `IR_VERSION`, porque un SDK de v1 no lleva
semántica de v2 ni un SDK de v2 conserva la de v1.

Rompen, y por tanto suben major: quitar o renombrar un tipo/prop/valor; **cambiar el
significado o el default de una prop existente** (un SDK viejo sigue aplicando el viejo, en
silencio); **cambiar un contrato de slot posicional** (se leen por índice: la renumeración
es invisible y total); cambiar la salida de un algoritmo normativo (orden de merge, wrap,
curvas de easing, score de navegación espacial, resolución de paths dentro de un ámbito de
item); volver requerida una prop opcional; cambiar la forma del envelope; y convertir una
degradación silenciosa en un rechazo o al revés. Arreglar un bug donde la implementación
contradecía la spec **no** es breaking: la spec es el contrato.

**Regla de diseño que esto fija:** una capacidad nueva es aditiva **solo si su ausencia es
un dibujo razonable de la UI**. No sale gratis con la forma del tipo — es una restricción
sobre cada primitivo nuevo, y es la que ya cumplen `Repeat` (una copia estática de su
template), `ProgressBar` (la pista con el fill sin dimensionar) y `Spinner` (las cuentas
quietas). Un tipo que degradara a algo *engañoso* (un control que parece operable, un
diálogo como caja opaca sobre la pantalla) no es aditivo aunque su forma lo parezca.

**Reason:** con hot-update las dos partes se mueven por separado, así que "SDK más viejo que
el contenido" es el caso normal, no el borde. La única pregunta que un loader necesita
responder es binaria — *¿puedo renderizar esto?* — y es exactamente lo que contesta el
major. Un minor solo podría decir "este contenido usa cosas que quizá no conoces", que es
justo lo que el formato ya tiene escrito y testeado como reglas normativas; a cambio metería
una segunda regla de compatibilidad que mantener idéntica en cada target.

**Coste aceptado:** un SDK de v1 no puede avisar "esto se construyó para un v1 posterior".
Renderiza lo que entiende y calla sobre el resto — lo mismo que hace ante una prop que
simplemente no venía.

**Alternatives considered:** *añadir minor al envelope* (`{v: 1, minor: 3}`) — permitía el
warning "contenido más nuevo", a cambio de un cambio de formato y de una regla de
compatibilidad extra por loader, para una información que no cambia ninguna decisión de
carga; *rango de compatibilidad* (`minVersion`/`maxVersion` por envelope) — mueve la
política al contenido, que es justo donde no puede estar si tiene que ser portable literal a
cada SDK; *aceptar majors viejos* (un SDK de v2 leyendo v1) — obliga a cada SDK a conservar
la semántica anterior entera, que es el coste que el rechazo compra.

**Dónde vive:** la spec pública `docs/format/versioning.md` del repo `ui` (ZAB-41). El TEST
de la promesa —envelope con superficie nueva contra un lector viejo— sigue en ZAB-39.

## 2026-08-17 — Estado `disabled`: prop en `NodeBase`, heredada, y salida del modelo de interacción (ZAB-63, F5)

**Decision:** `disabled` es una prop **bindeable de `NodeBase`** (`disabled?: Bindable<boolean>`),
no un estado que el runtime derive de otra cosa. `states` solo lleva `style` y esto cambia
**comportamiento**, así que necesitaba prop propia; y va en `NodeBase`, no en los tipos
interactivos, porque **hereda**: el valor efectivo de un nodo es el suyo **OR** el de
cualquier ancestro, como el `clip` se intersecta hacia abajo. Con eso, deshabilitar media
pantalla de un formulario es una prop en la sección, que es el caso de uso real. Un
`Overlay` **reinicia** la cadena: una entrada de la capa es la cima de su propio ámbito de
input (el mismo límite que dibujan `effectiveClip` y el `findUp` del puntero), así que un
modal declarado dentro de un panel deshabilitado sigue operable y descartable.

**Un nodo deshabilitado sale del modelo de interacción**, y todo lo demás se deriva de eso:
`isFocusable` responde `false`, y como el set de hover **es** el de foco, deja de recibir
puntero, foco y navegación de una sola vez. Lo elegido frente a "focusable pero inerte":
con navegación puramente espacial (sin orden de tabulación) saltárselo es gratis y nunca
deja al jugador atrapado, mientras que aparcar el foco en un control muerto en mando no
tiene forma de explicarse. Consecuencias que quedan fijadas:

* Una pulsación sobre él **cae a través**: un `Button` muerto dentro de un scroller no se
  come el arrastre que mueve la lista.
* Lo que tuviera cogido lo **suelta** (foco, hover, press). El foco pasa a **nada**, no a un
  vecino — el jugador no pidió moverse — y un gesto de `Slider` en vuelo se **cancela**, no
  se commitea: el valor nunca se asentó.
* Una sección deshabilitada **sigue siendo legible**: el `ScrollView` de dentro scrollea. El
  scroll no es una interacción que el control posea, y un panel que no puedes usar todavía
  tienes que poder leerlo.
* El **canal de host no está bloqueado** (`SetValue`/`SetScroll` llegan igual): es fuera de
  banda, como un `SetData` sobre una ruta bindeada. `disabled` describe lo que puede hacer el
  **jugador**.

**Orden de merge:** `disabled` cierra la cadena —
`base → empty → selected → checked → hover → focused → pressed → disabled`. Su sitio ahí solo
importa frente a los estados de **valor**: un nodo deshabilitado no toma input, así que
`hover`/`focused`/`pressed` no pueden estar activos a la vez, mientras que un `Toggle`
deshabilitado sigue `checked` y un campo sigue `empty`. Ir último es lo que permite que un
único override hable por todo el control sea cual sea el valor que sostiene.

**`disabled` es el único estado que puede llevar un nodo NO focusable**, y es consecuencia
directa de que herede: las etiquetas de una sección deshabilitada tienen que poder apagarse
con ella o "deshabilitar la sección" solo alcanzaría a la mitad de lo que el jugador ve. Eso
reescribe los `**States:** none` de `docs/components/` (13 páginas).

**Sin aspecto por defecto.** El runtime activa el estado y nada más: lo que se ve es
`states.disabled.style`, como en todos los demás. Meter una opacidad por defecto habría sido
la primera decisión estética dentro del runtime, y un default que los temas tendrían que
pelear.

**Reason (encaje con el versionado):** esto **no** es una extensión aditiva documentada con su
degradación, es **parte normativa de v1**. Nada está publicado (paquetes en 0.1.0, sin tags),
así que no hay SDK viejo al que engañar, y la regla del 2026-08-13 lo prohibiría si lo
hubiera: una capacidad cuya ausencia deja *un control que parece operable* no es aditiva. Un
SDK v1 que ignore `disabled` es **no conforme**, no un SDK degradando; el hueco de Unity hasta
ZAB-50 es eso, un hueco conocido. Por lo mismo `disabled` entra en la lista de props que el
fallback de tipo desconocido **preserva** (`layout`/`style`/`visible`/`disabled`/`children`):
tirarla resucitaría un control que el autor apagó.

**Coste aceptado:** el flag efectivo se asienta en el pase de resolve (heredar exige recorrido
top-down y no se paga un segundo recorrido por frame, ZAB-55), así que soltar foco/hover/press
ocurre justo después — un frame de flags viejos. Es invisible: `disabled` mergea último, así
que su override ya está pintando encima del anillo de foco ese mismo frame.

**Alternatives considered:** *solo en los tipos interactivos, sin herencia* — superficie más
pequeña y ninguna regla de cascada nueva, a cambio de repetir la prop control a control (o
bindear la misma ruta en cada uno) justo en el caso que motiva la feature; *focusable pero
inerte* — descartado arriba; *heredar también a través de `Overlay`* — dejaba un modal muerto
dentro de un panel apagado, es decir un diálogo que no se puede cerrar; *opacidad por defecto
en el runtime* — garantiza la señal visual metiendo estética en el core; *derivarlo de
`states.disabled` declarado* — confundía "cómo se ve" con "qué puede hacer el jugador", y
habría hecho imposible un control apagado que se ve igual.

**Dónde vive:** `docs/format/input.md#disabled-normative` (la sección normativa),
`docs/format/style.md` (orden de merge y tabla de estados), `docs/format/envelope.md` (la prop
en el node base), `docs/format/bindings.md`, y las 13 páginas de `docs/components/`.
Implementación web: `states.ts` (`STATE_ORDER`), `view.ts` (resolve heredado, `isFocusable`,
`activate`, `pruneDisabled`), `input/pointer.ts` (guardas de las cuatro rutas de presión) y
`snapshot.ts` (el estado entra en el contrato cross-target). Corpus: caso `disabled` en
`golden/`. El port a Unity va con ZAB-50.

## 2026-08-17 — `onChange` del grupo `"exclusive-check"`: el hook es del que tiene el valor (ZAB-64, F8)

**El bug:** `<Select onChange>` estaba **tipado, documentado y enseñado en cinco sitios**, y no
llegaba nunca a la IR — `Select()` lo destructuraba y no lo volvía a mirar. El otro extremo
tampoco existía: `ContainerNode` no tenía dónde declararlo y el renderer disparaba `onChange`
desde el nodo **opción**, nunca desde el grupo. No había NINGUNA forma tipada de sacar una
acción con nombre de un `<Select>`: solo hablaba el canal de datos.

**Decision:** `onChange?: string` entra en `ContainerNode`, con significado **solo** bajo
`group: "exclusive-check"` — exactamente como `value` (solo ese grupo) y `selected` (solo
`exclusive-select`). El grupo es el nodo que **posee la selección**, así que es el único que
puede decir *la selección se ha movido*; el `onChange` de un `Toggle` solo sabe decir *me han
tocado a mí*, que es otra pregunta y no la que hace un desplegable. Ambos pueden declararse y
entonces disparan los dos, primero el de la opción — de dentro afuera, el orden que ya lee una
pulsación.

**Sin payload.** Se dispara como cualquier acción de v1: nombre + el `ActionContext` de ZAB-29,
y nada más. Meter el valor elegido habría significado tocar `ActionContext`, que es un tipo
**compartido por todas las acciones** — y entonces habría que responder qué valor lleva un
`Slider.onChange` (hoy ninguno) o un `Button.onClick` (no tiene). El valor ya vuelve por el
canal de datos, que es la pata que existe justo para eso desde ZAB-23: `onDataChanged` con la
ruta bindeada. La acción dice *qué ha pasado*, los datos dicen *cuánto vale*.

El contexto que lleva es el de la **opción** elegida, no el del grupo. Cuando las opciones
salen de un `Repeat`, es estrictamente más información (dice en qué item se eligió); cuando el
grupo está dentro del item y las opciones no, `contextOf` sube y encuentra el mismo ámbito. No
hay caso en que el del grupo diga más.

**El flanco de disparo es el de la escritura**, justo después de que el valor nuevo llegue a la
ruta bindeada, y **nunca** al reelegir la opción ya seleccionada: no se ha movido nada, así que
no se reporta nada (el menú sí se cierra — eso es la regla del popover de ZAB-25, no del hook).
Un `SetData` del juego sobre la ruta tampoco lo dispara, igual que en `Slider`/`Toggle`: la
escritura del juego es fuera de banda.

**Aditivo de verdad**, a diferencia de `disabled` (2026-08-17, ZAB-63): un SDK que ignore este
campo **selecciona exactamente igual** y el juego se entera del cambio por el canal de datos.
La ausencia no deja un control que engañe, que es la prueba que fija la política de versionado
del 2026-08-13.

**Alternatives considered:** *valor en `ActionContext`* — la acción se explicaría sola sin leer
datos, a cambio de ensanchar un tipo compartido y volverlo asimétrico con los otros tres
controles con valor; *dejarlo solo en las opciones* (`<Radio onChange>`, que ya funcionaba) —
obliga a repetir el mismo nombre de acción en cada opción y no sirve para `<Select>`, donde las
`<Option>` las genera el composite; *ampliarlo también a `exclusive-select`* (cambio de
pestaña) — es un hueco simétrico real y sigue siendo aditivo mañana, pero pedía decidir qué
contexto lleva un cambio de índice y no era lo que rompía; *hook en el `<Select>` bajado al
`Button`* — el botón solo abre la lista, no ve la elección.

**Dónde vive:** `docs/components/container.md` (la sección normativa de `"exclusive-check"`, y
el `**Actions:** none` que dejó de ser cierto) y `docs/components/toggle.md` (`<RadioGroup>` y
`<Select>`; de paso se corrige la línea que decía que la opción que *pierde* la selección
dispara su `onChange` — un radio nunca se apaga solo, así que no dispara). Formato:
`ContainerNode` + `validate.ts`. Autoría: `ContainerProps`/`RadioGroupProps` y el reenvío de
`Select()` al Container del grupo. Web: `setToggleChecked` en `view.ts`. Corpus: `onChange` en
los grupos de `golden/envelopes/settings.json` y `controls.json` — las métricas no registran
acciones, así que los ficheros de `metrics/` no se mueven y el invariante se asegura a mano en
`view.test.ts`. El port a Unity va con ZAB-50.

## 2026-08-17 — El string vacío es contenido: un `Text` con `text: ""` carga, uno sin `text` no (ZAB-65, F8)

**El bug:** los dos paquetes afirmaban contratos opuestos y cada uno tenía su test verde.
`@zabloo/react` emite `text: ""` de forma **rutinaria** — el label de un `<Select>` cuyo value
no es un binding, un `<Badge>` sin `count`, un `<Text></Text>` — y `readEnvelope` exigía
`isNonEmptyString`, así que descartaba esos nodos con `invalid-node`. El test de format que
"cubría" el caso solo ejercitaba el campo **ausente**, de modo que el rechazo del `""` era un
accidente heredado del guard, no una decisión.

**Decision:** `Text.text` se valida con `isString`. **El string vacío es contenido válido**; lo
que hunde el nodo es que el campo **falte**. Son dos cosas distintas y ahora lo dicen: `""` es
una etiqueta que hoy no tiene nada que decir (un desplegable sin elegir, un contador a cero,
una ruta bindeada que el juego aún no ha rellenado), y un `Text` sin `text` es un árbol que
nadie quiso escribir.

**Un `Text` vacío mide una línea** (`0 × lineHeight`), y eso pasa a ser normativo. No es un caso
especial del algoritmo: el pase de texto ya da línea propia al párrafo vacío, así que `""` sale
como una línea sin glifos. Es además lo único que sirve a un layout — una fila con `gap` alrededor
de un `<Text>` cuyo binding se vacía **conserva su slot y sus dos huecos** en vez de colapsar y
correr a los hermanos un gap a la izquierda, y una etiqueta que se vacía y se rellena no hace
saltar el bloque. El ancho **sí** es cero: una línea vacía no pinta nada, así que no reserva
horizontal. Lo que debe desaparecer del todo se apaga con `visible`, que es la prop para eso y
sí saca el nodo del layout, gap incluido.

**Reason:** es contrato de la IR — forever-contract ×3 motores — y estaba decidido por omisión
en una línea de guard. El coste de la asimetría era invisible y por eso peor: un `<Row gap={8}>`
perdía un slot **en silencio** y se re-espaciaba, un `<Text>{estado}</Text>` desaparecía el frame
en que el string quedaba vacío, y la promesa del `<Select>` de que "un value vacío deja el botón
en blanco" era falsa porque el nodo ni siquiera llegaba a existir. Con el arreglo esa frase pasa
a ser cierta sin tocar el `<Select>`.

**Aditivo por definición**: el conjunto de envelopes que cargan solo **crece**. Ningún árbol que
cargaba antes deja de cargar, y el `invalid-node` del campo ausente sigue exactamente igual. No
hay nada publicado que engañar (paquetes en 0.1.0), y aun habiéndolo, la política del 2026-08-13
lo permitiría: un SDK viejo que descartara el `""` deja un hueco visible, no un control que
miente.

**Alternatives considered:** *dejar el rechazo y arreglar el otro lado*, que `@zabloo/react` no
emita el nodo cuando no hay nada que decir — mueve el problema al peor sitio: el árbol cambiaría
de FORMA según el valor del dato, así que el mismo componente daría 3 hijos o 4 según el frame, y
un binding vacío no puede reconstruir el árbol (los datos no rehacen la estructura, ese es el
contrato de ZAB-23); *colapsar el `Text` vacío a `0 × 0`* — el nodo cargaría pero la fila seguiría
saltando, que es el síntoma que motiva la tarea, y rompería la regla del párrafo vacío del pase de
texto; *tratarlo como `visible: false`* — mete una política de presentación dentro del validador y
le quita al autor la única prop que decide eso.

**Dónde vive:** `docs/components/text.md` (la regla normativa de la prop, la sección
"The empty `Text`" del pase de layout, y la nota de autoría de `<Text></Text>`). Formato:
`validate.ts` (el guard) y `validate.test.ts` (los dos lados: `""` carga, ausente se descarta).
La regresión cross-paquete vive en `packages/react/src/index.test.ts` — el `renderToIR` de
`<Select>` estático + `<Badge>` + `<Text></Text>` pasado por `readEnvelope`, que es lo que la
contradicción original no tenía a nadie mirando —, y la de layout en `view.test.ts` (un bound
`Text` que se vacía no mueve más que su propio ancho). El renderer web no cambia: ya medía así.
El port a Unity va con ZAB-50.

## 2026-08-17 — El settle de una instancia reciclada es por IDENTIDAD, y suelta el tween de todo su subárbol (ZAB-66, F8)

**El bug:** `applyBindings(node, settle=true)` afirmaba en su comentario que una instancia
reusada "no debe deslizar el estado de la fila que mostraba hacia la que muestra ahora", y el
mecanismo no lo cumplía. Asentaba los valores de comportamiento (`checkedProgress`,
`sliderDisplay`) pero dejaba intacto `node.anim`, de donde `stepTrack` lee el valor en pantalla:
el resolve pass siguiente veía otro target, retargeteaba desde el valor de la fila anterior y
**deshacía el settle**. Y `refreshBindings` solo asentaba los nodos de `this.bound`, así que
cualquier nodo cuyo aspecto depende del item sin leer dato propio no asentaba en absoluto.

**Decision:** el rescope de una instancia pasa por `resettle`, que recorre **el subárbol
entero** y por cada nodo re-deriva sus bindings (si es de los que leen dato) **y suelta su
estado de tween** — `clearNodeAnim`, la fase del Spinner, y un tween de Collapse en vuelo que
aterriza en su estado lógico. Las dos mitades son necesarias: el clear solo dejaría los estados
derivados del elemento anterior, y el settle solo lo deshace el frame siguiente.

Recorre el subárbol y no `this.bound` porque en v1 **ningún valor de `style` es bindeable**
(`ColorValue` es token o literal): la variación por item llega SOLO por los flags de estado, y
el caso que pesa es `disabled` **heredado** — el label de una fila cuyo `disabled` vino del
elemento no lee dato ninguno, así que no está en `bound` y no tenía forma de asentar.

**El settle es para el cambio de identidad, no para el cambio de dato.** Un `SetData` sobre el
dato propio del item — misma identidad, sin reorder — no pasa por `rescope` y **sigue
animando**: es el modelo CSS de F7 (un valor que se mueve tweenea, sin lista de disparadores).
Cuando una fila con `key` se mueve de índice Y su dato cambió, asienta: la fila se está moviendo
de sitio, y un frame mixto (flags nuevos con colores viejos) no describe ni una cosa ni la otra.

**Reason:** era una promesa escrita en un comentario que el código no cumplía, y de las que no
se ven en un test unitario: hay que cruzar transiciones con reciclado y mirar el PRIMER frame.
No había ningún test que cruzara ambas cosas.

**Lo que la auditoría afirmaba y NO reproduce:** que al scrollear rápido las filas cross-fadean
contenido de otras filas. La virtualización **no poolea** instancias: `reconcileWindow` reutiliza
una instancia solo para su propia identidad (su `key`, o su posición si no hay `key`), y las que
salen de la ventana se liberan y se reconstruyen — una fila que aparece al scrollear es un nodo
nuevo con `anim` vacío, que snapea por construcción. De ahí un hallazgo que conviene recordar: el
disparador del settle (`rescope`, que salta cuando cambia el path/índice del scope) y el único
evento en que una instancia muestra otro elemento (identidad **posicional** más una mutación del
array) son **disjuntos**.

**Queda decidido que no:** en una lista **sin `key`** la identidad es la posición, así que un
insert/remove que mete otro elemento bajo esa posición sigue animando desde los valores del
anterior. Sin `key` el autor dijo que la fila *es* la posición, y ahí un valor que cambia
tweenea como cualquier otro; hacerlo asentar exigiría detectar el cambio de elemento por
instancia y cambiaría la semántica de las listas sin `key`.

**Dónde vive:** `packages/renderer-web/src/view.ts` — `resettle` (el recorrido) y `forgetTweens`
(el cuerpo por nodo, extraído de `forgetAnim` y compartido con "el subárbol sale del layout").
Los invariantes, en `view.test.ts`, `describe("repeat recycling × transitions")`: el settle del
reciclado (el primer frame es ya el asentado), el dato propio que sigue animando, y el scroll
como red de regresión de la premisa. `examples/inventory-demo` gana transiciones por tema
(Button/Toggle) para que su verificación visual signifique algo. El port a Unity va con ZAB-50.

## 2026-08-17 — El foco de una fila virtualizada es LÓGICO, y el teclado tiene un dueño (ZAB-70, F8)

Tres agujeros de input que la auditoría del 2026-08-17 encontró juntos y que resultaron ser
tres preguntas distintas. Las tres quedan normativas en `docs/format/input.md`.

**1 — Un gesto cancelado termina y no concluye; el `Slider` es la excepción y asienta.** El
renderer no escuchaba `pointercancel`, así que un puntero que acaba sin soltarse —un toque
interrumpido por el sistema, un gesto del navegador que se lleva el puntero— dejaba el gesto
**en vuelo para siempre**: botón congelado en `pressed`, slider siguiendo el próximo `move`
que llegase al canvas. La regla es la del press soltado fuera de su control: nada dispara,
ningún backdrop se descarta, ningún `Collapse` conmuta. El `Slider` va al revés y **commitea**
porque su valor **ya está en pantalla y ya se escribió en su path bindeado en cada move**:
negarle el `onCommit` dejaría al juego sin el evento de "aplica lo caro" para un valor que el
jugador sí dejó ahí. Es el mismo criterio del mando desenchufado a media pulsación
(2026-08-12, ZAB-47), y el contrario al de `disabled` (2026-08-17, ZAB-63) por un motivo
concreto: allí el control se muere, así que el valor nunca se asentó; aquí el control sigue
vivo enseñando el valor.

**2 — El foco de una fila virtualizada pasa a ser LÓGICO, recordado como el ITEM.** Una
`Repeat` solo realiza las filas que su viewport puede enseñar, así que scrollear **destruye**
la fila que tiene el foco: `release` lo perdía y el frame siguiente `syncModalFocus`, al no
ver ninguno, se lo regalaba al `autofocus` de la vista — un salto a la otra punta de la
pantalla, disparado por la rueda, un drag o el stick derecho (que además leía el scroller del
foco NUEVO y cortaba el gesto a medias). La distinción que faltaba: **scrollear no es el
jugador soltando el foco, es el renderer reciclando un nodo**. Así que el foco sobrevive como
`{repeat, identidad del item, ruta de índices dentro de la fila}`, y mientras la fila no está
realizada: nada lo lleva puesto, **`syncModalFocus` no lo regala** (la regla dura: nunca al
`autofocus` de la vista), y el stick **sigue scrolleando la lista** en la que estaba. La fila
lo recupera al re-realizarse, por identidad — así que con `key` viaja con el item, que es
exactamente para lo que ZAB-29 hizo la identidad. Lo terminan dos cosas: una **dirección**
(el jugador pidió moverse y no hay rect del que salir ⇒ se descarta y la caminata arranca del
`autofocus`, la regla ya documentada para "sin foco") y cualquier **decisión real de foco**
—un tap, un modal que abre, el juego—. Descartado **fijar la fila enfocada en la ventana**
(el foco no muere nunca y no hace falta estado nuevo, pero obliga a una ventana no contigua
en `planWindow` y a mantener realizada una fila que nadie ve) y **mover el foco al focusable
visible más cercano** (nunca hay foco invisible, pero el foco se mueve solo mientras el
jugador únicamente scrollea, que es justo lo que esta tarea viene a impedir).

**3 — Un solo dueño del teclado y del mando: la primera vista montada, y la que el jugador
toca.** El puntero estaba scoped al canvas por construcción y el teclado no: `keydown` es de
la página y `navigator.getGamepads()` también, así que **dos vistas montadas movían CADA UNA
su foco con la misma flecha** y ambas consumían el mismo pad. La asimetría era el bug. Dueño
= la primera montada (una página con una sola vista se comporta EXACTAMENTE igual que antes),
y **tocar una vista se lo lleva** —un press en su superficie, aterrice donde aterrice: pulsar
nada en particular sigue siendo usar esa vista—; al disponer al dueño pasa a la más antigua
que quede. Lo demás sigue siendo por vista: cada una conserva su foco, su hover y sus
offsets — la propiedad decide quién **oye** las teclas y poolea el pad, no dónde vive el foco.
**Deliberadamente NO se deriva del foco del DOM**: el `<textarea>` oculto que un `TextInput`
enfocado necesita (un canvas no compone IME) vive FUERA del canvas, así que las teclas llegan
legítimamente con otra cosa enfocada — un teclado scoped por `tabindex` habría dejado sin
teclas justo al campo de texto, además de exigir un clic antes de que las flechas hicieran
nada. Descartado también un **opt-in en `mount()`**: determinista, pero deja el caso de dos
vistas sin configurar exactamente igual de roto.

**Alcance:** solo el renderer web; el port a Unity va con ZAB-50. `input/ownership.ts` es
módulo puro y testado, como `gamepad.ts` o `overlay.ts` — referencia literal para el SDK.
Verificado además con dos canvas sobre el MISMO navegador de mentira del harness (opción
`share`), que es lo que la suite no podía expresar hasta ahora.

## 2026-08-18 — Perf pass 2: el caret deja de repintar el mundo, y los presupuestos miden escenas reales (ZAB-73, F8)

Lo que ZAB-55 dejó fuera (auditoría 2026-08-17), más el agujero de sus propios presupuestos.
Todo en `renderer-web`; el port a Unity va con ZAB-50. El corpus golden salió **byte-idéntico**:
el cambio es invisible salvo en coste.

**1 — El caret ya no es una animación: es un reloj con dos frames por periodo.** Un `TextInput`
enfocado marcaba `animating`, así que la vista ENTERA corría el pipeline completo a 60fps para
parpadear un rectángulo de 2px. Pero `caretVisible` es una **forma cerrada** del tiempo desde
la última edición (como `spinnerPulse`), así que ni el árbol, ni sus valores, ni sus cajas
dependen de él: los únicos frames que un parpadeo necesita son los dos por periodo en los que
la respuesta cambia. Ahora el frame de caret (a) **se pide en el flip** (`setTimeout` a los
~530 ms, no `requestAnimationFrame` — rAF es la herramienta equivocada para "dentro de medio
segundo", y que una pestaña en segundo plano lo throttlee es el resultado correcto) y (b) es
un **repaint**: salta sync→layer→resolve→measure→arrange y solo tesela y dibuja. Se sostiene
porque **toda mutación del renderer termina en `render()`**, así que un repaint nunca mira
valores que un frame completo debería haber refrescado; si el foco se ha ido o la fila salió
del layout cuando llega el flip, se hace frame completo. Sigue **descartada la invalidación
parcial / dirty-tracking** (ZAB-55: "otro proyecto, otro riesgo"): teselar+dibujar es el suelo
de un repaint, y bajar de ahí es ese otro proyecto.

**2 — Estilo resuelto una vez por nodo y frame.** `effectiveStyle` se recomputaba 3× por nodo
(resolve, measure, paint), alocando `{...style, ...override}` por estado activo en cada pase —
seis objetos por frame en un botón hovered+focused para una sola respuesta. Se cachea en el
nodo con el **sello del contador de frames** en vez de invalidarse a mano: "mismo frame" y
"nada se ha movido" son la misma afirmación, porque todo cambio de estado acaba en `render()`.
Un frame de repaint **no** sube el sello, a propósito. Además el `FontLibrary` deja de hacer
el round-trip delete/set del LRU cuando el tamaño pedido ya es el más reciente, que es casi
siempre (una escena entera a un cuerpo).

**3 — De cinco recorridos completos del árbol por frame a uno.** `syncRepeats`, `collectLayer`,
`syncPresence`, `syncExtents` y `eachTextInput` buscaban sus nodos recorriendo todo; en una
lista de 1.000 filas eso son cinco mil visitas para encontrar tres overlays, un campo y una
`Repeat`. Los tres conjuntos (overlays, TextInputs, Repeats) **se mantienen en `build`/
`buildNode`/`release`**, como el índice `byId` de siempre. Dos consecuencias con nombre: el
orden de inserción es top-down por construcción y un `Set` visita lo que se le añade mientras
se itera, así que **las listas anidadas siguen expandiéndose en la misma pasada** que crea sus
instancias (test nuevo); y `collectLayer`, que ya no puede podar al bajar, pregunta por la
**cadena de ancestros** y recupera el orden de documento del árbol (camino de índices), porque
el registro no lo conoce. Queda `resolve` como único recorrido completo. De paso, el comentario
de `eachTextInput` afirmaba justo lo contrario de lo que hacía la función.

**4 — Lo barato que quedaba.** `eventPoint` llamaba a `getBoundingClientRect()` hasta 2× por
`pointermove` (fuerza layout del navegador): se cachea e invalida con `scroll` capturado,
`resize` y el resize propio de la vista. `popoversOf` recorría el árbol entero en CADA
`activate()`: ahora es el registro. `DataStore.set` iteraba TODAS las keys por escritura para
dropear descendientes: ahora hay un índice `prefijo → keys` (cada key se registra bajo sus
ancestros, que son un puñado). Y el modelo de texto dejó de partir `Array.from(text)` 6-8×
por frame entre `paintField` y `syncTextScroll`: el split es función del buffer, así que vive
en el nodo y muere con la edición.

**Presupuestos: el corpus medía lo fácil.** `budgets.test.ts` asertaba 24 draw calls contra
17 observados sobre 15 escenas diminutas (`repeat.json` = 1,5 KB, todas en 480×320) y **solo
el primer frame tras el mount** — justo lo que no vigila las regresiones para las que existían
la reutilización de buffers (ZAB-55) y la caché de wrap (ZAB-69). Se añaden 5 escenas realistas
a 960×600 (`perf/scenes.ts`): lista de 1.000 filas desiguales virtualizada, muro de prosa con
wrap a tres cuerpos, panel medido A MEDIA transición, y una pantalla poblada en dos versiones
(con Spinner = frame estacionario; sin él = el caret manda solo). **No** son casos del corpus
golden a propósito: sus métricas son `stats()`, telemetría web-only y deliberadamente fuera de
`snapshot()` (contrato cross-target), y mil filas de rects grabados serían un mega de golden
que nadie lee. Las mismas escenas las cronometra `pnpm bench`, así que el frame que CI acota
y el que se compara antes/después son el mismo frame.

**Aserciones de frame estable, deterministas.** `stats()` gana cuatro contadores de trabajo:
`resolved` (nodos que visitó el resolve), `textLayouts` (textos re-rotos en líneas),
`bufferGrowths` (buffers de geometría que tuvieron que crecer) y `repaintOnly`. Un frame
estacionario debe dar **0 y 0** en los dos del medio — es la reutilización de ZAB-55/ZAB-69
convertida en número, y CI no la veía porque draw calls y vértices son idénticos mientras el
allocator hace todo el trabajo. El frame de caret se aserta con `repaintOnly: true` y
`resolved: 0`. Descartado asertar **alocaciones** (depende del sampling profiler y de la
versión de Node) y **tiempo** (ZAB-55 ya lo dejó fuera de CI por flaky).

**Antes → después** (misma máquina, mín. de tandas de 1.000 frames, escenas de ZAB-55 para que
sean comparables): relayout completo settings 0,173→0,159 ms y 55,0→50,9 KB; spinner
0,121→0,119 ms; scroll con 1.000 filas 0,425→0,374 ms y 144,8→140,9 KB; **campo enfocado
0,157 ms y 46,4 KB por tick de 16 ms → 0,003 ms y 1,2 KB**. En las escenas nuevas (más grandes,
sin comparable anterior): pantalla poblada 0,51 ms/frame completo, prosa 0,57, scroll de 1.000
filas 0,73, y el **frame de flip del caret 0,346 ms = 67,5 % de un frame completo de la misma
escena** — el pipeline previo al teselado es ~1/3 del coste, y el otro tercio no se recorta sin
la invalidación parcial. La cifra que importa es la amortizada: dejar un campo enfocado pasó de
costar un frame completo cada 16 ms a **0,018 ms por tick**, ~3,5 %.

**Presupuestos web vigentes** (los consolida ZAB-40 junto a Unity):

| Presupuesto | Valor | Observado hoy | Se impone en |
|---|---|---|---|
| Draw calls por escena golden | ≤ 24 | 1–17 | `budgets.test.ts` (CI) |
| Vértices por escena golden | ≤ 2.000 | 49–940 | `budgets.test.ts` (CI) |
| Draw calls por escena realista | ≤ 12 | 2–5 | `budgets.test.ts` (CI) |
| Vértices por escena realista | ≤ 3.000–13.000 según escena | 90–8.947 | `budgets.test.ts` (CI) |
| Nodos resueltos por frame, lista de 1.000 filas | ≤ 120 | 49–58 | `budgets.test.ts` (CI) |
| Atlases vivos por escena | ≤ 3 golden / ≤ 4 realista (cota dura: 8) | 1–3 | `budgets.test.ts` (CI) |
| Memoria de atlas por escena (dpr 1) | ≤ 12 MiB golden / ≤ 16 MiB realista | 4–12 MiB | `budgets.test.ts` (CI) |
| Frame estacionario: re-wraps y crecimiento de buffers | **0 y 0** | 0 y 0 | `budgets.test.ts` (CI) |
| Frame de caret | repaint, 0 nodos resueltos | ídem | `budgets.test.ts` (CI) |
| Frame de animación (settings, esta máquina) | ≤ 0,5 ms / ≤ 100 KB | 0,16 ms / 51 KB | `pnpm bench` (manual) |
| Frame de scroll, 1.000 filas (escena nueva) | ≤ 1,5 ms | 0,73 ms | `pnpm bench` (manual) |

## 2026-08-20 — El chrome del preview: stack, capa de tokens y las tres cosas que no eran obvias (F10, ZAB-82…86)

El preview de `zabloo dev` deja de ser una página pelada servida por la CLI y pasa a ser una
app propia: `packages/preview`, React + Vite + Tailwind v4 + shadcn/ui + zustand. Va en el
monorepo pero **es privada y no se publica**: la CLI servirá su `dist/` como estático (V18,
ZAB-99), así que no hay un paquete npm nuevo ni una dependencia de React en la superficie
pública. El renderer sigue siendo el mismo `@zabloo/renderer-web` sobre el mismo canvas —
esto cambia el CHROME alrededor del canvas, no lo que se dibuja dentro.

**El motivo, en una frase:** la página había dejado de ser una página. Empezó siendo un
canvas con un `<select>` encima y acabó con viewport, DPR, tema, consola, panel de bindings
y estado persistido — una herramienta con estado real, escrita en TS vanilla contra `id`s de
DOM en un fichero de 600 líneas (`preview-client.ts`) que había que mantener con su propio
`tsconfig.browser.json` y su propio `tsup`. shadcn/ui porque el diseño llega escrito contra
sus specs componente a componente, así que la alternativa era reimplementarlas; zustand
porque hace falta UN store observable y todo lo demás en ese hueco trae ceremonia que aquí
no compra nada.

**Alternativas descartadas.** *(a)* **Dentro de `packages/cli`**, que es donde estaba: obliga
a dos toolchains en un paquete —el bundle de Node y el del navegador, dos `tsconfig` y dos
`tsup`— y mete React en el `package.json` de una CLI que presume de no ser una librería. Con
un paquete privado aparte, la CLI copia un `dist/` y no se entera de nada. *(b)* **Google
Fonts por CDN**: `zabloo dev` es una herramienta local, se usa en un avión y detrás de un
firewall corporativo, y una tipografía que no carga cambia todas las medidas de la página.
Se paga en tarball (ver más abajo). *(c)* **WebSocket para la recarga**, que es lo que pedía
el handoff: ver el punto 1. *(d)* **Declarar los tipos de los bindings en el envelope**, que
habría sido lo cómodo para el panel: el formato no tiene tipos de datos y añadírselos por la
comodidad de UNA herramienta habría metido en el contrato cross-target algo que solo el
preview necesita. Se infieren por sitio (punto 5).

**1 — El canal de recarga es SSE, y no fue una elección de F10.** El handoff de diseño decía
"websocket to the dev server", y el servidor de preview lleva hablando `text/event-stream`
desde el primer preview web (2026-08-03). Se confirma en vez de corregirse: el tráfico es de
un solo sentido —el servidor avisa "he exportado" o "he fallado"— y para eso un WebSocket es
un handshake, una librería y un heartbeat de más, mientras `EventSource` reconecta solo. Lo
que F10 añade es que el **proxy de Vite no puede tocarlo**: `ws: false` y quitarle el
`accept-encoding` al request, porque un stream comprimido se queda en un buffer en vez de
llegar evento a evento. Y una trama que no se sabe parsear se trata como "algo ha cambiado, ve
a mirar": recargar es la respuesta inofensiva, y una página que ignora lo que no entiende deja
de actualizarse en silencio.

**2 — Las fuentes van empaquetadas (`@fontsource-variable`), no de un CDN.** Geist y Geist
Mono viajan en el bundle, por el motivo del punto (b) de arriba. El coste NO era el que se
anotó aquí el 2026-08-20: el artefacto sí se publica —viaja dentro del tarball de
`@zabloo/cli`— y `@import "@fontsource-variable/geist"` trae los cinco subsets, con lo que
Vite emitía **11 woff2 = 143,3 KB**, cirílico, cirílico-ext y vietnamita incluidos, para un
chrome cuyo vocabulario entero es inglés. ZAB-100 lo recorta a latin + latin-ext de ambas
familias más `symbols2` en la mono (el rango de box-drawing): **5 ficheros, 87,4 KB, ~56 KB
menos en cada instalación**. Los paquetes *variable* de fontsource no publican entry point
por subset —solo los estáticos—, así que las declaraciones se escriben a mano contra
`./files/*` con sus `unicode-range` tal cual; y van **después** de todos los `@import`,
porque un `@import` precedido de otra at-rule es CSS inválido y el navegador se salta el
fichero entero.

**3 — Ningún componente escribe un color, y `cn` tiene que conocer el tema.** El diseño llega
en alta fidelidad y con todo inline (no tiene variables propias), así que la traducción se
hace UNA vez en `styles/`: `tokens.css` es la paleta en custom properties planas —legible por
un navegador, por jsdom y por su test— y `globals.css` la mapea a utilidades, incluidas las de
shadcn (`--color-*`), los radios sobre los nombres de shadcn (`rounded-md` = los 6px dibujados,
no la cadena `calc(var(--radius) ± 4px)`) y una escala de tipos **con nombre** (`text-ui`,
`text-log`, `text-tag`), porque los tamaños son de medio píxel y `text-[11.5px]` repartido por
veinte ficheros deja de ser una escala.

Esa escala con nombre tiene una trampa que costó encontrar: **tailwind-merge clasifica `text-*`
por el nombre** —una talla o una longitud es tamaño, lo demás es color—, así que `text-ui` le
parece un color y cualquier `text-<color>` posterior lo borraba. `cn("text-tag",
"text-muted-foreground")` devolvía solo lo segundo, y media docena de primitivos se quedaba sin
tamaño de fuente sin que fallara nada. `cn` declara ahora sus grupos (`extendTailwindMerge`),
y la regla que hay que recordar es: **toda utilidad del tema con nombre no estándar hay que
declararla ahí** —las siete sombras están en el mismo saco— o vuelve a desaparecer en silencio.

También hay dos tokens que no son un copy del diseño y que se llaman distinto a propósito:
`--ring` es el **borde** índigo del foco (la semántica que shadcn le da) y el halo pálido vive
en `--ring-halo`; y `--text-secondary`/`--text-faint` salen como `subtle`/`faint` porque sus
nombres chocan con el namespace de tamaños de Tailwind.

**4 — `components/ui/**` es código vendored, y se trata como tal.** Los primitivos se generan
con la CLI de shadcn y se compactan a las medidas del diseño (triggers de 28px, base de 12,
Switch 36×20) **por variantes**, nunca retocando llamadas. Tres convenciones que lo hacen
sostenible: los ficheros conservan el kebab-case de shadcn aunque el resto del repo use
PascalCase, el output crudo de la CLI entra en su propio commit antes de tocarlo, y las
variantes que el diseño no usa se borran. Las tres apuntan a lo mismo: que un `shadcn add`
futuro sea un diff legible y no una reconciliación a mano. Lo que Biome diga sobre ese código
**se arregla, no se excluye**.

**5 — El tipo de un binding lo dice el SITIO donde está, no el envelope.** El formato no
declara tipos de datos: un `bind` es un string y ya. Pero el panel de bindings tiene que
ofrecer un Switch para `settings.sfx` y un stepper para `player.gold`, y preguntarle el tipo
al valor no sirve —el primer envelope llega antes de que el juego haya empujado nada—. Así que
el tipo se deduce de **dónde** se ata el path, en dos niveles: por nodo cuando el mismo prop
significa cosas distintas (`value` de un `Slider` es number, el de un `TextInput` es string) y
por prop cuando significa lo mismo en todas partes (`checked`/`visible`/`disabled`/`open` →
boolean, `items` → array, `text`/`src` → string).

Tres consecuencias que se decidieron a la vez. Un prop **desconocido cae a `string`**, no a un
tipo adivinado: el formato es forward-tolerant, así que un prop de una versión posterior tiene
que degradar al editor que puede expresar cualquier cosa. Cuando **el mismo path está atado en
dos sitios con tipos distintos**, gana el que se compromete —`string` es el fallback y pierde—,
y el desempate se dice por consola, porque la diferencia entre un bug y una decisión es que la
decisión se anuncia. Y un path que llega **con valor pero sin sitio declarado** sí se tipa por
el valor (`inferType`, en el slice): ahí ya hay evidencia y no hace falta adivinar.

**6 — El store: slices planos, una sola clave, y qué NO se recuerda.** Once slices que se componen en
un `create` de zustand, y el estado es **plano** (`set({ theme })`, no `set({ theme: { theme } })`)
porque es el patrón de slices de zustand y lo que hace que un selector cueste lo que leer un
campo. El precio es que dos slices no pueden llamar igual a un campo, y se paga con nombres
(`appendAction`, `replaceProblems`) en vez de con namespaces. `state.ts` nombra las interfaces
de todos los slices y cada slice le pide a él `Setter`/`Getter`: es un ciclo **solo de tipos**,
ambas direcciones son `import type` y se borran al compilar, y la alternativa —dar a cada slice
una vista estrecha escrita a mano— no compra nada salvo deriva. El tipo público del store es
`ReturnType<typeof createPreviewStore>`, inferido y no declarado, para que no haya dos fuentes
de verdad de lo que el store expone.

`createPreviewStore` existe al lado del singleton `useStore` porque un singleton de módulo es
intestable justo en lo que más importa aquí: qué llega de verdad a `localStorage` y qué pasa
cuando el storage se niega (modo privado, iframe sandboxed) — donde el contrato es que **nada
lanza nunca**. Se persiste bajo **una** clave (`zabloo.preview`) en vez de las tres sueltas de
la página vieja, que se siguen leyendo en un solo sentido para no perderle la configuración a
quien ya tenía el preview montado.

Y una decisión de producto que vive en el store: **el modo zen no se persiste**, aunque el
panel, la consola y su pestaña sí. Abrir la herramienta una mañana y encontrarse una ventana
sin controles y sin salida obvia es peor que re-entrar en zen; una consola que hay que volver
a plegar en cada save es la fricción pequeña que hace que una herramienta parezca rota.

**7 — Lo que cuesta (ampliado 2026-08-21 ZAB-100; corregido 2026-08-22 ZAB-107, medido con
`npm pack --dry-run`).** La consecuencia visible es el tamaño de `@zabloo/cli`, porque el
chrome viaja dentro de SU tarball:

| | antes de F10 | hoy |
|---|---|---|
| `@zabloo/cli` empaquetado | ~0,1 MB | **566,6 KB** |
| desempaquetado / ficheros | ídem | **1,31 MB / 26** |
| de eso, `dist/preview` | — | **1,18 MB / 9 ficheros** |
| `index.js` (chunk principal) | — | 1.084,5 KB (433,8 KB gz) |
| `Kit.js` (diferido, ZAB-107) | — | 20,4 KB (6,0 KB gz) |
| CSS / fuentes | — | 41,5 KB / 87,4 KB |
| dist no-preview | ~0,1 MB | 120,0 KB |

Es un orden de magnitud, y se acepta a ojos abiertos: es lo que cuesta servir una app en vez
de un string de HTML, y el usuario ya se está bajando `jiti` y React en el proyecto. Lo que
NO se acepta callado es de dónde sale — y **de dónde sale no era lo que se escribió aquí el
2026-08-21**.

ZAB-107 midió el bundle por sourcemap antes de partirlo, que es lo que esta entrada tendría
que haber hecho el primer día:

| | crudo | % del chunk |
|---|---|---|
| `renderer-web/src/generated/font.ts` | **534,9 KB** | **49,8%** |
| `react-dom` | 174,1 KB | 16,2% |
| resto de `@zabloo/renderer-web` (`stbtt-wasm.ts`: 23,7 KB) | 115,3 KB | 10,7% |
| `components/` + `components/ui/` | 41,9 KB | 3,9% |
| `tailwind-merge` | 27,4 KB | 2,6% |
| **`kit/` + sus 20 celdas** | **19,6 KB** | **1,8%** |

**La mitad del chunk es un fichero:** Liberation Sans, 410 KB de TTF embebidos como base64
para que `@zabloo/renderer-web` publique un IIFE autocontenido que rasteriza texto sin red.
`/kit` es el 1,8%. La frase de arriba —«`/kit` con sus fixtures viaja a todos los usuarios»—
era cierta y era irrelevante para el tamaño.

Lo que ZAB-107 hizo, y lo que no:

- **`/kit` sale a su propio chunk** (`main.tsx` lo pide con `import()`). Se hace porque una
  página de revisión de diseño no tiene por qué estar en el bundle que parsea cada preview,
  no porque pese: el chunk principal baja de 1.102,9 a 1.084,5 KB.
- **El tarball no se mueve, y nunca iba a moverse**: 565,8 → 566,6 KB, +0,8 KB de overhead de
  chunk. El code splitting cambia lo que el NAVEGADOR pide, no lo que npm instala — los dos
  chunks viajan igual dentro de `dist/preview/`. Quien lea «code splitting» esperando un
  tarball más pequeño está leyendo la herramienta equivocada para ese problema.
- **El aviso de Vite de >500 KB se sube a 1200**, con la medida de arriba escrita al lado en
  `packages/preview/vite.config.ts`. No se puede apagar honestamente de otra forma: aunque se
  difiriera también el renderer, su chunk seguiría en ~660 KB. Un aviso que salta en cada
  build y que nadie puede arreglar desde aquí deja de leerse, y entonces tampoco avisa del
  siguiente.
- **Lo único que bajaría el tarball de verdad es la fuente**: sacarla a asset con hash (que se
  cachea y no se re-parsea) o servirla en woff2 son ~400 KB en cada instalación. Vive en
  `packages/renderer-web`, es una decisión suya —el IIFE global se publica autocontenido a
  propósito— y no tiene ticket. Queda escrito aquí para que el siguiente que abra «el preview
  pesa mucho» empiece por el sitio correcto.
- **~56 KB eran subsets de fuentes que nadie puede renderizar** (punto 2). Ya no viajan.

Dos consecuencias que no son de tamaño: `@zabloo/preview` es privado y **la superficie npm
no cambia** —no hay paquete nuevo ni React en las dependencias publicadas—, y el canvas es
inmune al tema del chrome: el `.dark` vive en el `<html>` de la herramienta y lo que se
dibuja dentro del canvas lo decide el envelope del usuario.

**El diseño, archivado.** Los artboards (1a main light, 1b error, 1c zen, 1d dark, 1e kit) y
las notas de handoff estaban en `wip/` en la raíz del repo público, que es donde nunca
debieron estar. Viven ahora en
[`ui/specs/2026-08-20-dev-preview-chrome-design/`](specs/2026-08-20-dev-preview-chrome-design/),
con el `.dc.html` tal cual — ábrelo en un navegador, los cinco artboards van de arriba abajo.

## 2026-08-21 — Convención de tests del chrome: el comportamiento es de la suite del componente; el padre afirma composición (ZAB-105, F10)

**Decisión:** la suite de un componente es la dueña de su comportamiento — ramas, estados,
aria, interacción. La suite de la región que lo contiene (Topbar, Console, Statusbar,
BindingsPanel…) afirma solo **composición**: qué controles existen y en qué orden, nunca qué
hacen por dentro.

**Motivo (el caso que la forzó):** la rama real del `ConnectionPill` (`span` vs `button` con
tooltip, gateada en stale-con-error) se afirmaba desde `Topbar.test.tsx`. Desde el padre
parecía cubierta; en realidad media rama (stale SIN error) no tenía nada encima, y no había
forma de verlo sin leer las dos suites a la vez. Un assert de comportamiento en el padre es
cobertura fantasma: señala verde sobre un hueco. Con la regla, la ausencia de suite propia ES
la señal — un componente sin fichero de test al lado está descubierto a simple vista.

Es la regla que sigue todo el primer commit de ZAB-105; queda escrita para que los próximos
tickets del chrome (y de cualquier UI de la casa) no la re-litiguen PR a PR.

## 2026-08-21 — Política de testTimeout: se sube el global, no se esquiva por test (ZAB-105)

**Decisión:** el `testTimeout` de vitest es presupuesto para el trabajo del test MÁS todos los
demás workers de la máquina compitiendo por CPU — es función del **tamaño de la suite**, no de
ningún test concreto. Cuando una suite crece y los tests con `userEvent` se ponen ámbar, se
sube el global (hoy: subido en los tres configs — `vitest.shared.ts`,
`packages/preview/vite.config.ts`, `scripts/vitest.config.ts`); nunca timeouts por-test ni
workarounds en el test.

**Motivo:** un timeout existe para cazar un test COLGADO, y estos no lo estaban — estaban
compartiendo máquina con 1.700 tests hermanos. Un timeout por-test esconde la causa (la suite
creció) tras un síntoma local, y el siguiente que vea un test ámbar se pasa media hora cazando
una regresión que no existe. Si algún día un test se cuelga de verdad, el global alto sigue
cazándolo — solo tarda unos segundos más en decirlo.

## 2026-08-22 — Convenciones de release: para quién se escribe el changelog, cuándo se publica y por qué no hay rama develop (F9)

**Decisión (cuatro piezas, tomadas juntas al ver el primer Version Packages PR):**

1. **El changeset se escribe para quien hace `npm update`.** Qué cambió, qué significa para su
   código, cómo migrar — una a tres frases en presente, empezando por la cosa que cambió. El
   *porqué* va al PR y a este log, nunca al CHANGELOG. Un changeset por cambio que un usuario
   nota (no por ticket); cuando varios paquetes se ven afectados de forma distinta, un
   changeset por paquete. Breaking = línea que abre con `**Breaking:**` + qué hacer; en 0.x un
   breaking es `minor`. Sin hashes ni ids de ticket: el enlace al PR y el autor los pone el
   generador (`@changesets/changelog-github`). Tarjeta de estilo en `.changeset/README.md`;
   regla completa en `CONTRIBUTING.md` › *Writing a changeset*; tabla "Docs are part of done"
   con lo que carga cada tipo de cambio.
2. **Grupo `fixed` para `@zabloo/format`, `@zabloo/react`, `@zabloo/renderer-web` y
   `@zabloo/cli`**: una sola versión para los cuatro. `create-zabloo-app` va por libre.
3. **Una release es una decisión, no una consecuencia de mergear.** Mergear a `main` solo
   actualiza el Version Packages PR, que es el área de staging entre "hecho" y "publicado" y
   puede acumular semanas. Se publica en fronteras de milestone (fin de batch, fin de fase),
   tras un checklist editorial (leer cada CHANGELOG como usuario; corregir editando el
   changeset, nunca el PR generado; comprobar bumps; `verify:pack` + smoke). Hotfix a una
   versión publicada = rama `release/x.y` cortada en el tag, bajo demanda.
4. **Una GitHub Release por tag al publicar**, con la sección del CHANGELOG del paquete
   (`scripts/github-releases.mjs`, idempotente).

**Motivo.** El PR #95 enseñó el síntoma: 20 changesets, 358 líneas, escritos con la voz de la
casa — que es perfecta para commits y para este log, y pesada para un changelog. Y tres de
ellos metían tres paquetes bajo un mismo texto de 45 líneas que cada CHANGELOG recibía
entero. Sin regla escrita, la voz de commits se cuela donde no toca; la regla la fija la
audiencia. El grupo `fixed` elimina la única pregunta de compatibilidad que un usuario de
cuatro paquetes acoplados puede hacerse, al precio asumible (solo maintainer, 0.x) de que un
fix en `cli` bumpee los cuatro.

**Alternativa descartada: rama `develop`.** Se propuso por miedo a "una release por PR". La
premisa no se cumple —con changesets, mergear no publica; publicar son dos actos manuales
(merge del Version PR + `publish` aprobado)— y el Version Packages PR ya ES la `develop`:
acumula el WIP y lo enseña redactado como changelog antes de decidir. Una `develop` costaría
dos ramas en sync, PRs apuntando a una rama que los externos no esperan, CI doble, y una
integración big-bang en cada `develop → main` — el patrón que rompió `main` en Batch-11 (12
merges paralelos) a escala de batches enteros — y `main` dejaría de ser "siempre publicable",
que es la propiedad que compran `verify:pack` y el smoke externo en cada PR. El caso real
que una rama resuelve (hotfix a lo publicado mientras `main` lleva cambios sin publicar) se
cubre con una rama de release cortada en el tag, bajo demanda.

**Consecuencias.** Los 20 changesets pendientes se reescribieron al estilo nuevo (quedan 27,
partidos por paquete) para que el primer CHANGELOG público salga presentable; `changeset
version` ya no se corre en local (el generador pide token — lo corre solo el job `version`).
**Dónde vive:** `CONTRIBUTING.md`, `docs/releasing.md` (*When to release*, *Before you merge
Version Packages*, *A hotfix to a published version*), `.changeset/README.md`,
`.changeset/config.json`, `.github/workflows/release.yml`.

## 2026-08-22 — F9 arranca: la parte web se publica en npm antes de que Unity esté (0.2.0)

**Decisión:** publicar hoy `@zabloo/format`, `@zabloo/react`, `@zabloo/renderer-web` y
`@zabloo/cli` en **0.2.0**, y `create-zabloo-app` en **0.1.1**, desde el portátil del
maintainer con OTP (el bootstrap manual que `releasing.md` describía), con Unity aún en
4/13 tipos. Es una **enmienda consciente** a la regla del 2026-08-10 ("SDK feature-complete
ANTES de publicar nada").

**Motivo:** la parte web estaba cerrada de verdad — catálogo completo, endurecido, medido,
documentado con exactitud verificada, preview nuevo, pipeline ensayado contra un registry
real local y en dry-run contra npm — y publicarla no compromete a nada con Unity: es una
0.x, el README y `releasing.md` dicen pre-release, y el SDK de Unity irá por UPM, no por
npm. Esperar a Unity habría retenido meses un funnel (`npx create-zabloo-app`) que ya
funciona. La regla original protegía de publicar algo a medias; lo que se publica no lo
está.

**Lo que enseñó hacerlo de verdad:** el Version Packages PR se mergeó antes de la pasada
editorial de los changesets, así que el primer CHANGELOG tuvo que corregirse *después*
(sustituyendo los ficheros generados, ZAB en PR #97) — exactamente la situación que el
checklist nuevo de `releasing.md` ("Before you merge Version Packages") existe para evitar
la próxima vez. Y un test del scaffolder hardcodeaba `^0.1.0`: el primer bump real lo
rompió, la clase de bug que ZAB-78 había sacado del código y se dejó en el test.

**Consecuencias:** F9 pasa de "fuera de alcance" a "en curso". Quedan: Trusted Publishers en
los 5 paquetes (→ el job `publish` de CI queda operativo; hasta entonces una release es
manual), y la pasada editorial ANTES de mergear cada Version PR. Los nombres `@zabloo/*`
están reclamados y la 0.2.0 es pública para siempre.

## 2026-08-23 — Cada repo es self-contained: el contexto entra en el repo (se retira `ai-docs`)

**Decisión:** se retira el repo privado **`ai-docs`**, que desde 2026-06-24 centralizaba
todo el contexto de Claude de la organización, y **cada repo pasa a llevar su propio
contexto committeado dentro**. En `ui` eso significa: `CLAUDE.md` **versionado** en la
raíz (ya no generado ni gitignorado) y el contexto de producto en **`docs/internal/`**
(`project.md`, `ir-context.md`, `decisions-architecture.md`, `roadmap.md`, `specs/`,
`plans/`) — todo **público**, como corresponde a este repo.

**Motivo:** el contexto centralizado no estaba aportando. Costaba fricción real (un
`setup.sh` que generaba `CLAUDE.md` por repo, un "paraguas" fuera de los repos, imports
que cruzaban carpetas, worktrees que no lo veían y había que parchear en
`.superset/setup.sh`) y a cambio ningún repo se explicaba solo: clonar `ui` no bastaba
para entenderlo. Con el contexto dentro, el repo viaja completo — a otro ordenador, a un
worktree, a un contribuidor externo — sin depender de nada al lado.

**Qué NO se publica aquí:** el contexto de **negocio, marca y organización**
(monetización, decisiones cross-repo) se traslada al repo **privado `landing`**
(`docs/monetization.md`, `docs/decisions-brand-org.md`), junto con los planes históricos
que iban sobre la gobernanza del contexto y no sobre el producto. Este log sigue siendo
**solo arquitectura**, como decía su cabecera desde el principio.

**Consecuencias:** desaparecen `ai-docs/setup.sh`, el `CLAUDE.md` paraguas de
`zabloo-hub/` y la regla "el contexto de Claude vive SOLO en `ai-docs`" (2026-06-24) con
sus tres excepciones acumuladas (`web`, las skills de `ui`, el `CLAUDE.md` de `landing`)
— que la regla necesitara una excepción por repo era la señal. `.superset/setup.sh` deja
de generar `CLAUDE.md`: el del repo ya viaja con el worktree. Los `plans/` y `specs/`
anteriores a esta fecha mencionan `ai-docs` como parte de su historia; se conservan tal
cual salvo las rutas, que apuntan a su nueva ubicación.

**Supersedes:** 2026-06-24 "Estrategia de contexto de IA (centralizado en `ai-docs`)".

## 2026-08-24 — El SDK de Godot es una GDExtension en C++, y ese C++ ES el core compartido (ZAB-134, F11 G1)

**Decisión:** el primer motor que renderiza pasa a ser **Godot**, y su SDK es una
**GDExtension en C++** (`godot-cpp`). Ese C++ no es "el lenguaje del adaptador de
Godot": es **el core compartido** — layout, texto, teselado, runtime de estados,
bindings y transiciones, y el `ViewSnapshot` — con `sdk/godot` como adaptador fino
que sube triángulos por `canvas_item_add_triangle_array` y traduce input.

**Esto cierra el abierto de 2026-07-06** ("cuándo extraer el teselador a un core C++
compartido vs. empezarlo dentro del SDK de Unity"), y lo cierra por el único motivo
que lo hacía honesto: **es la primera vez que la extracción paga por sí sola**. No se
extrae por anticipación — se extrae porque el primer motor que renderiza ya lo
necesita, y escribirlo dentro del adaptador sería escribirlo dos veces.

**Motivo (el criterio de siempre — ¿aguanta en Godot/Unreal/consolas?):**

1. **Corre en todo lo que corre Godot, consolas incluidas.** Los ports de consola de
   Godot son C++ y los hacen porting houses aprobadas; un binario nuestro compilado
   con su toolchain es trabajo que ya saben hacer. Una GDExtension añade complejidad a
   un port —hay que decirlo—, pero es complejidad que se cobra y se resuelve, no un
   "no soportado".
2. **`stb_truetype.h` entra tal cual.** El rasterizador core-owned (2026-08-11) se
   eligió precisamente porque es C de dominio público. En C++ es un `#include`; en C#
   es un port en el que hay que confiar que produzca **los mismos bitmaps**, que es la
   divergencia silenciosa contra la que se decidió core-owned.
3. **Unreal reutiliza el core en vez de reescribirlo.** Es la única opción que
   convierte el segundo motor en un adaptador y no en un tercer port de ~12.600 líneas.
4. **El canvas del editor visual puede ser el mismo core en WASM** — ya lo es a
   medias: `stb_truetype` corre hoy en el renderer web compilado a WASM.

**La frontera core/adaptador se define por una propiedad testeable, no por gusto:**
*el core tiene que poder producir un `ViewSnapshot` completo sin motor alguno*. De ahí
sale el reparto entero sin discutirlo caso por caso, y de ahí sale **lo que hace
posible G3**: el corpus `golden/` (18 casos) se corre contra un binario nativo en CI,
en una CPU pelada, sin descargar Godot y sin GPU. Cualquier lógica que se cuele en el
adaptador se cae de esa red automáticamente — la frontera se defiende sola.

**Lo demás que este ticket cierra:**

* **Mínimo Godot 4.4** (`compatibility_minimum`), compilando `godot-cpp` contra esa
  API. No necesitamos nada posterior, y por la compatibilidad hacia adelante de
  GDExtension eso significa que carga también en 4.5, 4.6 y el 4.7.2 de hoy.
* **Plataformas v1:** desktop (linux/macos/windows) y móvil (android/ios)
  **soportados**; **web experimental** — compila a wasm y carga en un export `dlink`,
  y **no es criterio de salida de F11**, porque atarlo a la cadena `dlink` +
  Emscripten es atarlo a algo que no controlamos (consecuencia para G15: en web el
  criterio es *carga*, no *soportado*); **consolas "compila, no validado"**.
* **Layout del repo:** `core/` en la **raíz**, hermano de `sdk/`, `packages/` y
  `golden/` — no en `packages/` (ahí `packages/*` significa paquete del workspace
  pnpm, y todos salvo `preview` se publican en npm) ni en `sdk/` (difuminaría justo la
  frontera que la regla de oro protege). Más `sdk/godot/addons/zabloo/` (addon
  instalable) y `examples/godot-playground/`.
* **Toolchain y CI:** SCons; job `core-tests` en linux que compila el core **solo** y
  corre el corpus (es el que falla en cada PR, y el que tiene que ser rápido), más
  builds por plataforma que compilan sin ejecutar. El de web puede fallar sin bloquear
  hasta que la cadena `dlink` sea estable.
* **Unity:** `sdk/unity` **se borra en G17**, junto al barrido de docs públicas — un
  PR que lo borre antes dejaría `README.md` y `getting-started.md` citando un
  directorio inexistente. Vuelve algún día como **adaptador fino del core C++** vía
  plugin nativo, **no** como el port a C# del batch cancelado; las ~1.700 líneas de C#
  actuales (4 de 13 tipos) no se rescatan. **`zabloo dev --unity` se queda hasta que
  exista `--godot`** (G14) y se va con él.
* **Distribución del addon:** **zip por release** adjunto a la GitHub Release (el
  pipeline existe desde F9); **Asset Library después**, cuando haya catálogo que
  enseñar. No es un paquete npm ni entra en el grupo `fixed` de 2026-08-22 — es un
  artefacto de otra plataforma, con su propio ciclo y su propia audiencia.

**Tres datos del planteamiento que estaban mal, y se corrigen porque cambian el
argumento:**

1. **GDExtension no se recompila por versión menor.** Desde **4.1** la compatibilidad
   binaria es hacia adelante dentro del 4.x: compilada contra 4.4, carga en 4.7. Lo
   que rompe es al revés, y el salto de major. El contra que el ticket apuntaba a (a)
   es mucho más pequeño de lo que parecía — y es lo que hace barata la Decisión del
   mínimo.
2. **El estable de hoy es 4.7.2** (18 ago 2026), no 4.4. El mínimo propuesto sigue
   siendo el correcto, pero por decisión y no por inercia.
3. **Las dos opciones vivas tienen agujero de plataforma, y no es el mismo.** El
   ticket cargaba contra (b) por consolas — cierto — sin decir que (a) paga en web.
   Escribirlo entero es lo que hace la tabla de plataformas honesta.

**Alternativas descartadas:**

- **(b) C# (.NET) en Godot** — el camino cómodo (lenguaje cercano, buen tooling, y
  rescataba el C# de `sdk/unity`). Cae por producto antes que por arquitectura: el
  modelo self-render existe, entre otras cosas, **porque las consolas no tienen
  Chromium** (2026-07-06), y elegir el runtime cuyo soporte de consola es *beta, de un
  solo proveedor y de pago* convierte ese argumento en una nota al pie. Además la
  documentación oficial del estable de hoy dice literal que un proyecto en C# **no**
  puede exportarse a web, y marca Android e iOS como experimentales. Y no adelanta
  nada: Unreal empezaría de cero, el core compartido seguiría abierto, y el
  rasterizador dependería de que un port de C# dé los mismos bitmaps que el C original.
- **(c) GDScript** — un intérprete corriendo el bucle caliente (layout, teselado y
  resolve son **por frame**, y ZAB-55/ZAB-73 dejaron los presupuestos del renderer web
  en fracciones de milisegundo sobre un JIT tras dos pasadas de optimización); sin FFI
  no hay stb, y sin stb no hay texto pixel-idéntico entre targets; y no le sirve a
  ningún otro motor. Sí es el lenguaje razonable para los **scripts de conveniencia
  del addon** (panel del editor, dev mode), donde no hay bucle caliente.

**Coste aceptado:** toolchain nativa (SCons, binarios por plataforma en CI, un
`.gdextension` que mantener), C++ para un founder que viene de JS, depuración más dura,
el peaje de web, y sobre todo **el port**: ~12.600 líneas de lógica portable
(`renderer-web` sin su capa GL ni su andamiaje, más `@zabloo/format`) desde un lenguaje
con GC a uno sin él. La red es el corpus golden, y por eso G3 va inmediatamente
después del chasis y antes que cualquier capacidad.

**Spec completa:** `specs/2026-08-24-godot-sdk-language-design.md`.

## 2026-08-24 — El core C++ por dentro: cero dependencias, IR tipada y el nodo de Godot como handle (ZAB-135, F11 G2)

**Decisión:** el chasis del primer motor que renderiza, y con él los dos abiertos
que G1 dejó explícitamente para "cuando se compile": **cómo se organiza el core**
y **el estándar de C++ y sus dependencias**. C++17 (lo que pide `godot-cpp` 4.4) y
**cero dependencias de terceros** — parser JSON propio y harness de tests propio.

**Por qué cero deps, que es lo que va contra el instinto.** Lo cómodo era
vendorear `nlohmann/json` y `doctest`: dos headers MIT, un día menos de trabajo.
Se descarta por dos motivos que apuntan al mismo sitio:

1. **El parser es nuestro porque la política de carga es nuestra.** ZAB-37 no pide
   "parsear JSON": pide rutas de diagnóstico exactas, un tope de profundidad que
   responde en vez de desbordar la pila, y **ninguna excepción** (un payload roto
   es una respuesta ordinaria). Con una librería, cada una de esas tres cosas es un
   mapeo desde su modelo de errores al nuestro — y el mapeo es justo donde la
   paridad con `@zabloo/format` se pierde en silencio.
2. **El harness es nuestro porque `core-tests` es el job que falla en cada PR.** Es
   el bucle de feedback más rápido del milestone; un header de 10k líneas en cada
   TU es un impuesto sobre él. Lo que un test necesita cabe en 120 líneas.

**Dos hallazgos de la máquina que cambian el código y no solo el build**, y que
son la razón por la que la conversión de números se escribe a mano:
`std::from_chars` para `double` está marcado *unavailable* por debajo de **macOS
26** en la libc++ de Apple (usarlo ataría el deployment target de todos los builds
de macOS a un detalle del parseo), y **`strtod` lee el separador decimal del
locale** — un juego con locale español parsearía `"0.5"` como `0`, en silencio, y
todas las métricas aguas abajo saldrían mal sin que ningún test lo notara. La
gramática de JSON es fija y sin locale; la conversión también. **Corolario:** un
número con cero a la izquierda se **rechaza** — ser indulgente ahí sería aceptar un
payload que el renderer web rechaza, y que los dos targets difieran en qué carga es
exactamente lo que el corpus existe para impedir.

**La IR se modela TIPADA**, no como un DOM reparado: `validate.cpp` construye
structs y el runtime trabaja sobre ellos, sin lookups por string por frame. Dos
consecuencias que hay que decir en voz alta: las props desconocidas **se
descartan** (nadie las lee — el core no reserializa — y la tolerancia que importa,
pasar en silencio y sin diagnóstico, se conserva), y un miembro desconocido de un
set cerrado se mapea al default **al leerlo**, que es la lectura tipada de "formas,
nunca vocabularios". `Node` es un struct plano con las props de los 13 tipos
encima: la referencia lee un objeto JS igual de plano, layout y paint hacen
`switch` sobre `type` y no sobre una clase, y un `variant` compraría seguridad de
tipos que el JSON nunca tuvo a cambio de un cast en cada uso.

**Contenido y runtime son dos árboles** (`Node` inmutable, `LayoutNode` con rects,
estados y scratch), que es lo que hace de un hot-update **cambiar uno y no los
dos**. De ahí una regla de vida que costó un bug encontrado por los tests: `View`
no se puede mover (guarda punteros `parent` dentro de sus propios vectores) y el
`Envelope` vive detrás de un puntero en el `Document`, para que su dirección
sobreviva a mover el documento.

**En Godot el nodo ES el handle estable.** En Unity `ZablooDocument` era un objeto
aparte porque las vistas eran desechables; aquí el `Control` vive en el árbol de
escena, así que `ZablooView` posee el `Document` y la caché de `set_data` vive en
él — los datos que el juego empujó sobreviven a un cambio de contenido sin API
nueva. La superficie que ve el juego es la de v1 entera y no más: **acciones con
nombre hacia fuera** (señal `action(name, context)`) y **datos hacia dentro**. El
layout de Godot no se usa: anchors y Containers serían un segundo sistema de
layout discrepando con el que corre en todos los demás targets.

**Lo que se comprueba, y cómo.** La paridad no se afirma de memoria: un envelope
hostil pasado por `@zabloo/format` da 28 diagnósticos y el test afirma los mismos
códigos, las mismas rutas y el mismo orden; `flex-layout` —el único caso del corpus
sin `Text`, así que no espera al motor de texto— se compara **rect a rect** contra
`golden/metrics/`, sus 20 nodos; y `states-tokens` se compara contra los `style`
grabados, que no dependen de las métricas de texto. Lo que necesita motor de verdad
se verifica a mano en `examples/godot-playground` y lo formaliza G15.

**Alcance, dicho en positivo:** el chasis renderiza `Container`, `Button` y el
paint implícito; el resto **degrada** en vez de desaparecer, que es la misma
forward-tolerance que un juego recibe de un SDK más viejo que su contenido —
`Text` sin glifos (mide una línea de alto y cero de ancho, que es literalmente la
regla del `Text` vacío de ZAB-65, no un placeholder inventado), `ScrollView` sin
recorte, `transition` ignorado, controles como contenedores. La tabla completa, con
el ticket que cierra cada fila, está en la spec.

**CI:** `core-tests` (linux, `werror`, compila el core SOLO y corre sus tests) y
`godot-extension` × {linux, macos, windows}. **Móvil y web no entran hoy**: piden
NDK/SDK en el runner y la cadena `dlink` que G1 dejó fuera del criterio de salida,
y los añade G15, que es quien puede verificar que además de compilar arranca —
escribir hoy YAML que nadie ha visto pasar no es cobertura.

**Spec completa:** `specs/2026-08-24-core-cpp-foundation-design.md`.

## 2026-08-25 — El corpus como criterio de salida: skip-list con guardia, y el byte como unidad (ZAB-136, F11 G3)

**Decisión:** el harness golden se construye **antes** que ninguna capacidad, y a
partir de él la regla de F11 es que **un caso del corpus está comparado byte a byte
o está nombrado en la skip-list, con un motivo y un ticket**. No hay tercera
opción: nada afloja una comparación, ni una tolerancia por campo, ni un modo
parcial. `core/tests/golden-skip.json` arranca con dieciséis de los diecisiete
casos de métricas y **cada ticket G# vacía los suyos como parte de su criterio de
salida**.

**Lo que hace que la lista no se pudra:** un caso saltado **se ejecuta igual**, y si
empieza a coincidir con su registro el test **falla** pidiendo que se le quite. Sin
eso, una skip-list es un fichero que se llena y no se vacía — y el motivo por el que
esto está escrito aquí y no solo en el README es que es lo que convierte trece
criterios de salida en algo mecánico en vez de en algo que alguien tiene que
acordarse de comprobar. Corolario del mismo espíritu: un caso **fuera** de la lista
que pida algo que el runner no puede reproducir todavía (reloj, pad, un dato de
tipo array) **falla en voz alta** en lugar de medir un frame que no es el que el
corpus grabó, que es la forma en que un harness pasa por el motivo equivocado.

**Corrección al criterio de salida de G1/G2:** los "cuatro casos de G2" **no**
pueden comparar byte-idénticos hoy. `states-tokens` y `unknown-type` llevan nodos
`Text`, y lo grabado son anchos y baselines reales (`62.234`, `18.398`) que solo
produce el rasterizador de G4; y como el alto de un `Text` desplaza el `y` de sus
hermanos, tampoco vale comparar "todo menos el texto". `future-major` no tiene
fichero de métricas — es una refusal, y se asierta desde el propio `refuses` del
corpus. Queda `flex-layout`, el único caso sin texto, y compara **el
`ViewSnapshot` entero**, no solo los rects. Comprobado, no supuesto: des-saltando
`states-tokens` las diez diferencias cuelgan **todas** de un `Text`, mientras
botones, estilos, estados y foco cuadran — que es exactamente lo que la línea de la
skip-list afirma.

**Dos detalles del port que son contrato y no estilo:**

1. **Los números se imprimen desde el entero cuantizado** (`llround(v * 1000)` y
   los decimales recortados a mano), no con `to_chars` —no disponible para
   `double` en la libc++ de las Command Line Tools, el mismo hallazgo que G2
   documentó para su mitad lectora— y **jamás con `printf`**, que lee el separador
   decimal del **locale**: un juego corriendo en español escribiría `0,5` y todas
   las métricas aguas abajo dejarían de comparar **en silencio**. Es la misma clase
   de divergencia callada que llevó a la rasterización core-owned en 2026-08-11.
   `snapshot_number` es público por eso: quien COMPARA dos snapshots tiene que
   escribir un número igual que el fichero lo deletrea, o el diff manda a leer al
   sitio equivocado.
2. **La forma del `ViewSnapshot` se escribe entera desde el primer día**, con los
   campos que el runtime aún no puede llenar (`text`, `clip`, `scroll`, `value`,
   `field`, `window`, `layer`) **ausentes** y con el ticket que los llena anotado en
   su sitio. Ausente ya significa "este nodo no tiene ninguno" en todo el documento,
   así que llenarlos más tarde es aditivo; inventar un `false` que nadie calculó
   sería una mentira distinta de un silencio honesto.

**Diff legible como entregable, no como adorno:** una diferencia se reporta por path
dentro del snapshot, con el `ref` del nodo que el autor escribió y ambos valores
(`tree.children[0].rect.width (ref "primary-label"): expected 62.234, actual 0`) —
el mismo formato en los dos targets. Y cuando el paseo no encuentra ninguna
diferencia pero los bytes difieren (orden de claves, formato de un número), **lo
dice**: la comparación es de bytes, así que callar ahí sería el único sitio donde el
harness pasaría sin poder explicar por qué.

**Imágenes golden:** siguen fuera de CI y sin automatizar — piden GPU. Son la
captura side-by-side del mismo envelope en ambos targets con su tolerancia escrita
al lado, y aterrizan con el motor de texto (G4), que es para lo que existen.

**Consecuencias menores, dichas para que no sorprendan:** dos tests de G2 se retiran
por quedar subsumidos (el paseo de rects de `flex-layout` y la carga limpia de tres
envelopes, ahora comprobada sobre los diecisiete) — afirmar el mismo hecho dos veces
con dos mensajes distintos es cómo se pierde de vista cuál es el que manda; y
`scons test <filtro>` pasa a funcionar, porque el comando que los README ya
documentaban corría todos los casos y después moría intentando construir un fichero
con el nombre del filtro.

**Dónde vive:** `core/src/snapshot.{h,cpp}` (el port), `core/tests/test_golden.cpp`
(el runner), `core/tests/test_snapshot.cpp` (las reglas que ningún caso grabado
fija), `core/tests/golden-skip.json` (la lista) y
`golden/README.md` › *Running the corpus against the C++ core*.

## 2026-08-25 — El motor de texto del core: stb dentro, la fuente empotrada, y el tipo de letra que destapó un default equivocado (ZAB-137, F11 G4)

**Decisión:** el texto del core es un **port literal** de `ttf.ts` + `glyphs.ts` +
`text.ts`, con `stb_truetype.h` compilado dentro y la Liberation Sans **empotrada
en el binario**. El `TextServer` de Godot no se usa para nada —ni medir ni
rasterizar—, que es la condición para que el corpus compare: `text-wrap` y
`states-tokens` salen de la skip-list comparando **byte a byte**, y con ellos
entra en el `ViewSnapshot` el campo `text` (líneas, anchos, x y baselines).

**Cero dependencias, y por tanto dos copias de stb.** `core/src/vendor/` es
verbatim la misma v1.26 que ya vendorea `packages/renderer-web/native/vendor/`.
Dos copias y no un directorio compartido porque cada mitad tiene que construirse
sola: el core con SCons y un compilador y nada más, y `renderer-web` publicándose
en npm sin el repo alrededor. Se mueven juntas, y si algún día no lo hacen el
corpus lo dice como un muro de métricas de texto que dejan de cuadrar. La
implementación vive en **un TU propio** compilado con los warnings apagados
(`-Werror` sobre código ajeno es una regla que solo se puede cumplir editándolo) y
con **`-fvisibility=hidden`**: la extensión se carga en un proceso que puede
llevar su propia copia de stb, y dos `stbtt_InitFont` resolviéndose el uno al otro
son exactamente la divergencia silenciosa contra la que se decidió el rasterizador
core-owned.

**La fuente va empotrada como base64 troceado, no como array de bytes.** 410 KB en
`0x00,` son 2 MB de fuente que cada compilador reparsea; en base64 son 550 KB que
se decodifican una vez al arrancar. Los trozos existen porque **MSVC rechaza un
literal de string de más de 65535 bytes**. Va empotrada y no leída de disco porque
el core tiene que medir texto sin motor, sin sistema de ficheros y sin pipeline de
assets —es la frontera de ZAB-134— y porque una fuente que llega asíncrona
significa un primer frame medido contra otra cosa. El fichero generado está
committeado, así que compilar el core nunca necesita Python; el script
(`core/scripts/embed_font.py`) es Python y no Node justamente para no meter una
segunda toolchain en un directorio que presume de no tener ninguna.

**La trampa de paridad, escrita donde se paga:** todo producto de un entero de
unidades de diseño por una escala se hace **en `double`, ensanchando el `float`
explícitamente**. La referencia lo hace por construcción (JavaScript tiene un solo
tipo numérico); hacer la multiplicación en `float` aquí redondea distinto y un
párrafo largo se separa de su registro en el tercer decimal. El mismo cuidado en
el snap del glifo: `Math.round` redondea el medio **hacia arriba** y `std::round`
lo redondea **alejándose del cero**, así que el core usa `floor(v + 0.5)`. Solo se
nota en una coordenada negativa —un glifo scrolleado fuera— y es medio píxel, pero
la referencia es contra quien se comparan los dos targets.

**El atlas es LA8 y los sólidos NO se suben a él.** Los comentarios que G2 dejó
escritos prometían que en G4 los sólidos se unirían al atlas por el píxel blanco
reservado y toda la pantalla sería un draw call. **La referencia no hace eso**: su
capa GL ata una textura blanca de 1×1 para la geometría sólida, así que un core
que fusionara los dos batches respondería al mismo envelope con otro número de
draw calls. Se corrige la promesa en vez de inventar la divergencia: sólidos
primero (sin textura), después un batch por atlas. El píxel blanco se queda
reservado porque es lo que necesitará un motor sin camino sin-textura. LA8 —blanco
con la cobertura como alfa— es la mitad de memoria que RGBA y lo que un
`ImageTexture` quiere; el tinte sale de multiplicar por el color del vértice, que
es como un `Text` recibe su `style.color` y su opacidad heredada de una vez.

**El adaptador barre, no escucha.** La `FontLibrary` no tiene callback de
evicción, a diferencia de la referencia: `sdk/godot` reconcilia sus texturas
contra la lista de atlas vivos en cada `_draw`. Ocho entradas como mucho, y un
solo mecanismo contesta a la vez «¿ha crecido?» (la `version()` se movió) y «¿ya
no está?» (no aparece en la lista), sin ventana en la que una textura sobreviva al
atlas que la nombra. Un atlas que se llena **dobla su lado**, así que la subida
distingue `update()` (mismo tamaño) de `set_image()` (creció).

**La colocación se calcula una vez, tras el arrange, y no perezosamente.** La
referencia coloca las líneas dentro de `placeText()`, que llaman el paint y el
snapshot por separado. Aquí una pasada corta después del arrange deja las
posiciones en el nodo, y de ahí las leen los dos. Compra dos cosas: el baseline
que un fichero golden registra es literalmente el que usó el teselador —no una
segunda cuenta que podría derivar— y `snapshot_view` sigue siendo **const**, que
es la promesa de que medir un frame no puede moverlo.

**Lo que el texto destapó: el `direction` por defecto del core estaba mal.**
`states-tokens` dejó de cuadrar en el label de un `Button` con `justify: center`,
y no por el texto: el core tenía `Direction::Row` como default y el contrato
—`docs/format/layout.md`, y la referencia, que lee `direction === "row"`— dice
**`"column"`**. Estaba invisible desde G2 porque ningún caso comparable tenía un
hijo cuya colocación en el eje principal dependiera del default, y solo se ve
cuando el hijo mide algo. Es el caso de libro de por qué el corpus se construyó
antes que las capacidades.

**`unknown-type` NO sale de la skip-list, y su motivo estaba mal escrito.** Decía
que solo le faltaban las métricas de texto; con G4 dentro, lo que queda de su diff
es un `Toggle` con `states: ["checked"]` y `value: 1` — G10 (ZAB-143). Se reapunta
en vez de borrarse. `bindings` pierde su coletilla de G4 y se queda esperando a G7.

**Convergencia visual: procedimiento y tolerancia ahora, captura en G15.** Las
imágenes golden piden GPU, así que no están en CI y no se automatizan. Lo que sí
queda escrito en `golden/README.md` es qué se captura, con qué viewport, y **qué
es tolerancia y qué es bug**: la *colocación* de un glifo tiene que coincidir
exactamente —mismos cortes, mismos bordes izquierdos, mismo baseline al píxel,
porque las dos mitades snapean al mismo grid y leen los mismos números que el
corpus ya compara—, mientras que su *cobertura* puede diferir hasta ~2/255 por
canal **solo en los bordes antialiaseados** (un paso de redondeo en un alfa de 8
bits, que los dos targets se comen en sitios distintos: la web sube RGBA y Godot
LA8, y los samplers filtran en espacios de color distintos). Una línea que rompe
en otro sitio, un run que deriva lateralmente, un baseline a un píxel o un
interior sólido distinto **no son tolerancia**. Las capturas **no se committean**:
son evidencia fechada de una GPU concreta, y un PNG que nadie puede re-derivar es
peor que el procedimiento que lo produce.

**Alcance que se queda fuera, con su motivo:** shaping complejo (árabe, índico) →
v2 con HarfBuzz, como decidió 2026-08-11; hinting, que a tamaños de UI apenas se
percibe; SDF (`stbtt_GetGlyphSDF`), evolución natural sin cambiar de rasterizador;
y la escala de dispositivo, que el atlas ya acepta como parámetro pero nadie
conecta todavía —el corpus mide a 1 y un HiDPI real es el adaptador contándole al
core su escala, que es de G15 (ZAB-148).

## 2026-08-31 — Estados, foco espacial y bindings r/w en el core; el teclado de Godot es lo que NADIE ha manejado (ZAB-140, F11 G7)

**Decisión:** el runtime de estado entra en el core — el `DataStore`, los helpers
normativos de bindings, el merge de estados, la navegación espacial, `Collapse` y los
tres `group` — y el adaptador de Godot estrena la mitad del canal de host que ya tiene
sujeto. Con ello **`bindings`, `collapse-tabs` y `unknown-type` salen de la skip-list**
comparando byte a byte, y el corpus queda en 11 casos pendientes.

**El dato del canal deja de ser un escalar.** `DataValue` pasa a llevar lo que lleva
JSON, arrays y objetos incluidos, porque desde ZAB-29 un path **no es una clave sino una
dirección**: `shop.items.1.name` es un `set_data` de `"shop.items"` y dos segmentos de
recorrido. Un canal de solo escalares no podía ni expresar el corpus. En Godot eso son
`Array` y `Dictionary` recorridos recursivamente; el `DataStore` conserva el índice
prefijo→keys de ZAB-73 y la regla de que **una escritura tira lo que hubiera debajo**.

**Nada convierte números con la librería estándar.** `number_to_text` implementa el
`String(number)` de ECMA-262 —el decimal más corto que vuelve a leerse como el mismo
double— a mano, y `text_to_number` la gramática numérica, por el motivo que este repo ya
tiene escrito dos veces (`json.cpp`, `snapshot.cpp`): `printf`/`strtod` leen el separador
decimal del **locale**, así que un juego en español pintaría `0,5` donde el corpus grabó
`0.5`, en silencio, y toda métrica aguas abajo de un `Text` bindeado dejaría de comparar.

**El `autofocus` se asienta en el primer frame, no al construir la vista.** Es estado
inicial como el `open` de un `Collapse`, pero **si el nodo que nombra puede tomar el foco
depende del `disabled` heredado**, y eso solo lo resuelve la pasada de resolve. El orden
por frame queda como el de la referencia: `sync_focus` → `resolve` → `prune_disabled` →
measure/arrange. Cuesta un frame de flags viejos y es invisible —`disabled` mergea el
último, así que su override ya está pintando sobre el anillo de foco ese mismo frame—, y
es lo que hace que `examples/disabled` enfoque el botón vivo y no el apagado.

**Un `visible: false` estático no se construye.** Nada puede volver a encenderlo, así que
no tiene runtime que guardar; y el snapshot de la referencia **no lo lista**, mientras que
un `visible` bindeado sí aparece con `out: "visible"`. Sin esa poda, `bindings` no compara.

**El press y el hover no son el mismo conjunto.** `hover` es el conjunto focusable
(ZAB-36), pero lo que **toma la pulsación** son solo `Button` y `Toggle`: un header de
`Collapse` conmuta en el release sin llegar a vestir `pressed`, y `Slider`/`TextInput`
corren gestos propios. De ahí sale una consecuencia que conviene tener escrita porque
parece un bug y es el contrato: **un header autorado COMO `Button` dispara su acción y no
abre la sección** — el control gana, y el toggle de `<details>` es lo que hace un header
que no toma pulsación propia.

**El teclado en Godot: `_unhandled_key_input`, y la vista NO toma el foco del motor.** La
traducción fiel de la regla web (`focusYieldsKeys`, ZAB-109: las teclas son del renderer
solo mientras el foco de la página está en la vista o en nada) es exactamente
"**unhandled**": si un `Control` enfocado del juego reclamó la tecla, nunca llega. Y hay
que decidirlo al revés de lo que parece: con `focus_mode = ALL` **la navegación de foco
propia de Godot se come las flechas antes** de que la vista las vea —observado, no
supuesto—, así que la vista se queda en `FOCUS_NONE` y lo que tiene el foco *dentro* es
del core mientras lo que lo tiene *en la escena* es del motor. Un `set_process_unhandled_key_input(true)`
explícito es necesario: la autodetección que hace Godot con un override de GDScript no lee
las virtuales de una GDExtension.

**Un solo dueño del teclado por proceso** (`sdk/godot/src/input_owner.{h,cpp}`, port de
`input/ownership.ts`): el input sin manejar recorre TODO el árbol, así que dos
`ZablooView` en una escena moverían cada uno su foco con la misma flecha. Dueño = la
primera vista que entra al árbol, y tocar una se lo lleva. Vive en el adaptador y no en el
core a propósito: es enrutado de input de un **proceso**, justo lo que un `ViewSnapshot`
no puede describir y por tanto lo que el corpus no puede arbitrar.

**Lo que este ticket NO trae, y por qué:** `set_value`, `set_text` y `set_scroll` **no**
se exponen todavía. Sus sujetos (`Slider`, `TextInput`, `ScrollView`) no tienen runtime
hasta G10/G11/G6, y una operación que devolviera `false` para un control que **sí existe**
convertiría el valor de retorno en una mentira — es lo único que el contrato dice que ese
`bool` no puede significar. `reveal_delta` (el auto-scroll del foco, ZAB-47) queda portado
y testeado pero **sin cablear**: no hay offsets de scroll que mover hasta G6.

**`disabled` suelta también la pulsación de teclado.** La referencia solo lo hace para el
gesto del puntero, y una tecla mantenida sobre un control que el juego apaga se queda
pegada en `pressed` porque el release ya no encuentra el nodo. Aquí se suelta, que es lo
que la decisión de ZAB-63 dice ("suelta lo que tuviera cogido: foco, hover, press"); ningún
caso del corpus lo puede observar, porque no hay guion de teclas.

**Verificado en un proceso Godot real** (4.6.2, playground con el envelope de
`examples/hello-button`): carga sin diagnósticos, las ops por id responden `true`/`false`
con su aviso, las flechas navegan y Enter activa (`action: buy`, luego `action: quit`), un
`reload` a otro envelope conserva el camino de carga, `set_checked` sobre un `Toggle`
bindeado emite `data_changed("settings.sound", true)`, y en captura: `set_data` mueve el
oro de 1200 a 1100 y revela la fila bindeada empujando el resto de la pantalla.

**Spec:** `docs/format/host-channel.md` (sección *Godot spelling*). Los módulos nuevos del
core son `data`, `bindings`, `focus` y `groups`, todos con tests sin motor — la referencia
literal que G10, G11 y G12 van a seguir usando.
## 2026-08-31 — Assets e `Image` en el core: el codec es del motor, la textura va por hash y el orden de pintado es el de la referencia (ZAB-138, F11 G5)

**Decisión:** el pipeline de assets entra en el core **sin decodificador**. El core
resuelve `asset:<id>` contra el manifest, cachea por **hash de contenido** y emite el
quad con sus UVs; los píxeles los produce el motor del adaptador
(`Image.load_png_from_buffer` en Godot), que es lo único de todo esto que un motor
ya sabe hacer. Con ello `assets-image` sale de la skip-list comparando **byte a byte**.

**Por qué el core no decodifica** — es lo que va contra el instinto, porque vendorear
`stb_image.h` habría sido un `#include` como el de `stb_truetype.h` de G4:

1. **La regla de cero dependencias no es la razón principal; la asimetría con el texto
   sí.** El rasterizado se hizo core-owned (2026-08-11) porque las **métricas** de la
   fuente entran en el layout, así que dos implementaciones que difieran mueven los
   rects y el corpus deja de comparar. Un PNG no tiene esa propiedad: de una imagen el
   layout solo lee `width`/`height`, **y esos vienen en el manifest** — el export los
   sacó de la cabecera en tiempo de autoría (2026-08-11, ZAB-10). Los píxeles no entran
   en ninguna métrica y el corpus no compara ni uno.
2. **Nadie carece de codec.** Godot trae tres, Unreal los suyos, el navegador
   `createImageBitmap`. El caso que justificó traer stb —"el camino de fuentes de cada
   motor es un puente a medida"— aquí no existe: cargar un PNG es una llamada.
3. **La frontera de ZAB-134 se respeta igual**: el core produce el `ViewSnapshot`
   completo de `assets-image` sin motor, porque medir una imagen nunca necesitó
   decodificarla.

**La textura se cachea por HASH, y el core no tiene callback de evicción.** El
adaptador barre `view->images().all()` en cada `_draw`, exactamente como ya barría
`fonts().all()` (G4): lo que sobra tras el barrido es lo que el envelope nuevo dejó de
referenciar, y soltar la `Ref` ahí es lo que lo libera. Que la clave sea el hash y no
el puntero del core es lo que hace barato un hot-update: `load_envelope` reconstruye el
documento entero, así que **todas** las direcciones cambian, y sin embargo una imagen
cuyos bytes no cambiaron conserva su textura. Es la misma propiedad content-addressed
sobre la que ya se apoyan el CDN futuro y el transporte del dev loop (2026-08-11,
ZAB-12 y ZAB-14). Dos ids con los mismos bytes son **un** asset, así que comparten
draw call sin que el tesselador se entere.

**El `Batch` gana un `TextureKind`, y con él el orden de pintado se vuelve normativo.**
Sin discriminador, el `const void *` de un batch no se puede castear de vuelta: un
atlas es LA8 que el core posee, una imagen son bytes que el motor tiene que decodificar.
Y al añadirlo se destapó que el orden de batches del core era **el de primer pintado**,
mientras que la referencia emite siempre `sólidos → imágenes → texto`: una imagen
declarada después de una etiqueta dibujaría **encima** de ella en Godot y debajo en web.
El orden de pintado es visible, así que el core pasa a mantener el vector como
`[sólidos, imágenes…, atlas…]`, insertando en la frontera. Solo ocurre la primera vez
que se ve una textura, así que ningún frame lo paga.

**Back-channel `adopt_size`, deliberadamente estrecho.** La referencia mide el bitmap
que acaba de decodificar cuando el manifest no trae dimensiones; el core no puede, así
que un asset sin dims mediría 0 para siempre — una divergencia de **layout** que el
corpus no puede cazar (ninguno de sus casos tiene un asset sin dimensiones). El
adaptador devuelve lo que decodificó y el core relayoutea, **solo si el manifest dejó el
hueco**: el manifest siempre gana, porque es lo que el layout ya reservó. Es lo único
que fluye del adaptador hacia el core, y el motivo de que `View::images()` no sea const.

**Un decode que falla se recuerda, y su batch se salta.** Reintentarlo es gastar el
presupuesto de un frame en volver a producir el mismo error, y dibujarlo sin textura
sería peor que no dibujarlo: Godot ataría su blanco de 1×1 y el nodo saldría como un
rectángulo sólido teñido donde debía haber una foto. Saltando el batch queda a la vista
el `background` que el nodo ya pintó debajo — que es el placeholder, autorado y no un
estado (ZAB-13).

**Bug del validador encontrado por el camino, y arreglado:** `is_base64` rechazaba el
padding de **dos** caracteres (`"TQ=="`), porque su comprobación de posición
(`i + padding < text.size()`) es falsa para el segundo `=` — y era además redundante,
ya que el guard de "un carácter que no es `=` después de un `=`" ya obliga a que el
padding esté al final. Consecuencia: **todo asset cuya longitud en bytes es 1 mod 3 se
descartaba entero**, en silencio y perdiendo su textura, mientras el mismo envelope
cargaba perfectamente en web (cuya regla es `={0,2}$`). El corpus no podía verlo: sus
dos PNGs dan de casualidad longitudes sin padding doble. La regresión vive en
`test_validate.cpp`, con los tres casos que fijan la regla.

**Alcance que se queda fuera, con su motivo:** el atlas de imágenes (varias en un draw
call) y los mipmaps, que ZAB-12 ya difirió y que ni la escala ni el contenido piden;
`nine-slice`, que es paint nuevo y no un `fit`; y la recarga **al guardar**, que es el
dev loop de G14 (ZAB-147) — hoy el playground la hace a mano con `R`, que pasa por el
mismo `load_file` que un push de plataforma y sirve justo para ver la retención de
texturas por hash a través de un reload.

**Dónde vive:** `core/src/assets.{h,cpp}` (el manifest resuelto y `decode_asset_data`,
port de `decodeAssetData`), `core/src/tessellator.{h,cpp}` (`TextureKind`, `fit_image`
y `GeometryBuilder::image`), `core/src/view.cpp` (medida intrínseca y paint),
`sdk/godot/src/zabloo_view.cpp` (`sync_images` y el decode por MIME). Tests:
`core/tests/test_assets.cpp`, más los de imagen en `test_tessellator.cpp` y
`test_view.cpp`. Corpus: `assets-image` fuera de `core/tests/golden-skip.json`.

## 2026-09-01 — El motor de transiciones en el core: reloj inyectado, tracks en array y frames bajo demanda (ZAB-141, F11 G8)

**Decisión:** el motor de interpolación de F7 entra en el core como port literal de
`transition.ts`, `collapse.ts`, `spinner.ts` y `progress.ts`, y el adaptador de Godot
estrena **frames bajo demanda**. Con ello **`transitions` sale de la skip-list**
comparando byte a byte, y el corpus queda en 9 casos pendientes.

**El reloj se inyecta, y esa es la mitad interesante.** `View::set_now(ms)` en vez de
preguntarle la hora al motor: el core nunca sabe qué hora es, así que el harness golden
puede plantarlo en un instante concreto y grabar el frame de ahí. En Godot el reloj son
los ticks monótonos y el `delta` de `_process` **se ignora a propósito** — un frame
perdido aterriza el tween donde dice el reloj de pared, no donde llegó la suma de deltas.

**Los tracks son un array indexado por `TrackKey`, no dos `Map`.** El juego de claves es
cerrado y diminuto (10 props animables + 5 de comportamiento), así que un array es más
pequeño y sin hashing por frame, que es lo que mantiene cierto aquí el "un frame
estacionario no aloca" de ZAB-55. Y el bloque entero es **lazy**: un nodo sin
`transition` usable se pasa con `NodeAnim` nulo y todos sus valores saltan, que es el
comportamiento pre-F7 a la letra — así que la UI corriente, que es casi toda, paga un
puntero y nada más.

**El `ProgressBar` entero aterriza aquí, no en G10.** Los comentarios de `snapshot.cpp` y
`layout.cpp` lo atribuían a G10 (ZAB-143), pero las métricas de `transitions` graban su
`value` y su fill a 200×0.25 = 50 px: el criterio de salida de G8 no se puede cumplir sin
ellos, y la zona del ticket ya nombraba `core/progress*`. G10 se queda con el `Slider`,
que es lo único que `controls` sigue esperando — los slots del `Toggle`, la barra
bindeada y la onda del `Spinner` ya comparan.

**Dos divergencias del port encontradas y corregidas**, ninguna visible en el corpus
porque ningún caso grabado las alcanza:

1. **El `easing` por defecto era `linear` y la spec dice `ease-out`**
   (`docs/format/motion.md`). Es la forma de casi toda transición que un autor escribe
   sin decirlo, así que el mismo envelope habría corrido con otra curva en cada target.
   Un easing DESCONOCIDO sigue cayendo a lineal, que es otro caso: una curva ilegible
   tiene que moverse igual, y la recta es la única forma que no necesita acuerdo.
2. **El color de los batches se mezcla en `double` y se guarda en `float`.** La
   referencia tiene un solo tipo numérico; hacer el lerp en `float` redondea distinto.

**Lo que el corpus NO prueba, dicho en voz alta.** El caso `transitions` corre el reloj
hasta el final de la duración más larga, así que graba **dónde se asienta** el
movimiento; y como su `data` se siembra ANTES del montaje y no tiene guion de puntero,
**no arranca ni un solo tween** — un montaje salta. Es decir: fija que el motor no
perturba un frame estático, y la aritmética de las curvas la fijan los tests unitarios
portados (`test_transition.cpp`), que es donde se vería que dos targets discrepan en
t=25 ms. Regrabar el caso a media transición pedía superficie nueva en el corpus (hoy
solo hay `advanceMs` y `pad`, ninguno capaz de mover un valor DESPUÉS del montaje) y
tocar `golden/`, que comparten varios tickets en vuelo; queda como mejora futura del
corpus, no como deuda del motor.

**El `forced_clip` se marca y no se consume.** El `Collapse` anima su propia altura y
tiene que recortar mientras dura; el recorte es de G6 (ZAB-139), en vuelo en paralelo,
así que aquí se escribe la bandera y allí se lee. Mientras tanto el contenido rebosa la
caja durante la apertura — verificado y aceptado, no un fallo del motor.

**Verificado en un proceso Godot real** (4.6.2, escena desechable, capturas a 960×600):
la barra desliza hasta su valor bindeado, el `Collapse` anima su altura con lo de abajo
desplazándose, la onda del `Spinner` avanza entre frames, y el **anillo de foco adelgaza
6 → 4 → 3 → 0 px manteniéndose blanco puro (1,1,1,1) todo el camino** — nunca magenta,
que es el bug de contrato que ZAB-36 encontró en la referencia. Y `is_processing()` cae a
`false` al asentarse: una UI quieta no cuesta frames. Un `Spinner` con `period: 0` (el
tema "reduce motion") congela la onda y **tampoco pide frames**, en vez de desaparecer.

**Un arreglo de fuera de zona, porque no había forma de estar verde sin él:** el merge de
las PR #103 y #104 dejó `main` en rojo. G5 y G7 habían quitado sus propias líneas de
`golden-skip.json` cada uno en su rama, y la fusión conservó la unión de las **entradas**
en vez de la unión de las **eliminaciones**, así que cuatro casos (`assets-image`,
`bindings`, `collapse-tabs`, `unknown-type`) pasaban estando saltados. Lo cazó el guardia
que ZAB-136 puso justo para esto — un caso saltado que empieza a pasar hace fallar la
suite pidiendo que lo quiten.

## 2026-09-01 — Clip y scroll en el core: la región es una identidad, y en Godot un canvas item hijo (ZAB-139, F11 G6)

**Decisión:** el recorte, el `ScrollView` y la capa de puntero entran en el core como
port literal de `clip.ts`, `hit.ts`, `scroll.ts` e `input/pointer.ts`, y el adaptador de
Godot estrena el recorte real. Con ello **`scroll-clip` sale de la skip-list comparando
byte a byte** y `disabled` estrecha su motivo a lo que le queda: `Slider` (G10) y
`TextInput` (G11).

**Lo único de `clip.ts` que NO se porta es `scissorBox`**, y merece decirse porque marca
la frontera: traduce una región a píxeles de dispositivo con el origen abajo a la
izquierda, que es de GL y no del contrato. Godot toma la región tal cual. Todo lo demás
del fichero —la intersección, el radio del clip redondeado más interno, el test del
punto contra la esquina— es contrato, y el corpus lo compara nodo a nodo.

**La identidad de una región es contrato de pintado, no pulcritud.** El tessellator
agrupa la geometría por región y decide «¿la misma?» comparando **punteros**, igual que
la referencia compara identidad de objeto. Dos scrollers hermanos que coincidan en rect
siguen siendo dos regiones, y por tanto dos grupos que se pintan uno tras otro;
fusionarlos por valor —lo que habría salido de comparar `{x,y,w,h,radius}`— reordenaría
en silencio qué dibuja encima de qué, que es exactamente el fallo que G5 arregló al
poner el orden de batches por delante del orden de pintado. De ahí el `ClipArena`: da
dirección estable a cada región y reusa sus huecos entre frames.

**Agrupar por región cuesta un invariante, a sabiendas.** Hasta aquí todos los sólidos
de la pantalla compartían un batch; ahora una región es **estado del motor**, así que
geometría recortada distinto no puede compartir draw call. Dentro de cada grupo se
conserva el orden `sólidos → imágenes → texto` de G5, y entre grupos manda el orden de
entrada — por eso un grupo **nunca se re-entra**: volver a uno anterior colaría geometría
por debajo de lo ya pintado encima. `start_root()` entra ya aunque nadie lo llame hasta
G9: es lo único que `set_clip` no puede expresar, porque dos raíces de pintado pueden
compartir región y aun así tener que ordenarse una detrás de otra. Y precisamente por eso
el `Batch` lleva **ordinal de grupo** además de región: un adaptador que separase los
grupos comparando la región fusionaría en silencio dos raíces sin recortar, que es
exactamente el caso para el que `start_root` existe.

**En Godot, un canvas item hijo por grupo — no `Control.clip_contents`, no stencil.** El
ticket pedía evaluar cuál da un scissor exacto sin un `Control` por nodo, y la respuesta
es llegar directamente al mecanismo que `clip_contents` usa por dentro:
`canvas_item_set_clip` + `canvas_item_set_custom_rect` sobre items hijos creados con
`canvas_item_create` y colgados del item del propio `Control`. Los rects del core ya están
en el espacio local de ese Control y un item hijo sin transform propio lo comparte, así
que no hay nada que convertir; `canvas_item_set_draw_index` conserva el orden de los
grupos. Los items se **poolean y se vacían** cada frame en vez de recrearse, y se liberan
en `NOTIFICATION_PREDELETE`: son del servidor, no del árbol de escena, así que nadie más
los recoge.

**Las esquinas, por SDF en el fragment shader** — la misma elección que ZAB-7 tomó en web,
y por los mismos motivos: el stencil pide buffer, geometría de máscara y una máquina de
estados con ref por nivel de anidamiento, y aun así deja el corte aliaseado. El shader son
ocho líneas y su borde antialiasea como el resto. `VERTEX` en el `vertex()` de un
canvas_item es la posición **local** del item, que es el espacio de los rects del core, así
que la región se compara contra el fragmento sin convertir nada. Un `ShaderMaterial`
pooleado por grupo **redondeado** (los cuadrados no llevan material: el scissor ya los
corta entero), en vez de uniforms de instancia sobre un material compartido — que también
existe en 4.4, pero ata el recorte a una capacidad que no se puede comprobar sin arrancar
el motor.

**La constante de rueda es la única cifra que la referencia no puede entregar.** Un
navegador reporta la rueda en **píxeles** (`deltaY`) y el core se los come tal cual;
Godot reporta un `WHEEL_UP`/`WHEEL_DOWN` discreto con un factor. Algo tiene que traducir,
el corpus no puede arbitrarlo —ningún caso graba una rueda— y se fija en **50 px por
muesca × `factor`**, con el `InputEventPanGesture` del trackpad leyendo su delta en las
mismas unidades que la propia `ScrollContainer` de Godot. Lo que **no** se toca son los
ejes: siguen 1:1 con la referencia (`deltaY → y`, `deltaX → x`), así que un scroller solo
horizontal sigue sin moverse con la rueda de un ratón normal. Es el hueco (a) que ZAB-9
dejó anotado, y arreglarlo en un target y no en el otro convertiría una molestia conocida
en una divergencia; el hueco (b) —que un drag empezado sobre un `Button` no scrollee—
queda igual, y por lo mismo.

**El release pasa a preguntar `reachable_at`, no `pressable_at(x, y) == released`.** Es lo
que hace la referencia, y la diferencia no es cosmética: `reachable_at` mira el rect
**propio** del nodo pulsado más las regiones de sus ancestros, así que cancela el tap de
un botón que el scroll se llevó de debajo del dedo — y no solo el de uno del que el dedo
se fue. Sin eso, el clip recortaría el input al bajar por el árbol pero no al comprobar la
pulsación que ya estaba en vuelo.

**Dos cosas pequeñas que el port destapa y quedan fijadas:** `pointer_move`/`down`/`up`
ganan un `mouse` con default `true`, porque **el hover es estado de ratón** y un dedo que
toca y se va no puede dejar un control encendido (en Godot, `InputEventScreenTouch` y
`ScreenDrag` entran con `false`); y `pointer_cancel()` termina un gesto **sin
concluirlo** —ninguna acción, ningún `Collapse`, ningún backdrop—, con la excepción del
`Slider`, que asienta, anotada para G10 en el sitio donde tendrá que implementarse.

**`reveal_delta` deja de estar sin cablear:** la navegación arrastra el scroll con el foco
(2026-08-12, ZAB-47), cerrando el diferido que ZAB-9 había dejado apuntado a la fase de
gamepad. Solo la navegación lo llama — una pulsación enfoca lo que el jugador ya está
mirando.

**Un fallo preexistente que el port destapa, anotado y NO cambiado:** el scrollbar se
pinta después de los hijos y **vuelve a entrar en su misma región**, así que su
`set_clip` es un no-op y su geometría cae en el batch de sólidos de ese grupo — que se
dibuja *antes* del texto del grupo. Resultado: en una lista de filas con etiquetas, el
texto puede pasar por encima de la barra. Es exactamente lo que hace la referencia, no lo
graba ningún caso del corpus (un snapshot no lleva geometría), y arreglarlo es un
`start_root()` para la barra en los dos targets. Se deja igual a propósito: durante el
port, el comportamiento del renderer web no se reinterpreta — si es un fallo, se arregla
**allí** y se vuelve a grabar, en su propio ticket, en vez de dejar que los dos targets
deriven.

**Dónde vive:** `core/src/clip.{h,cpp}` (la región y su arena), `core/src/hit.{h,cpp}` (el
recorrido, `clips_children`, `child_clip`, `effective_clip`), `core/src/scroll.{h,cpp}` (el
alcance, el thumb y las constantes del scrollbar), `core/src/layout.cpp` (el alcance y el
reclampado en el arrange), `core/src/tessellator.{h,cpp}` (los grupos), `core/src/view.cpp`
(pintado, gestos, `set_scroll`, auto-scroll del foco) y `core/src/snapshot.cpp` (`clip` y
`scroll`). En Godot, `sdk/godot/src/zabloo_view.{h,cpp}`. Docs:
`docs/format/host-channel.md` (el `set_scroll` de la tabla de Godot). Corpus: `scroll-clip`
fuera de `core/tests/golden-skip.json`.
