# zabloo/ui

> **Build your game's UI once — render it identically in any engine.**
> Author in React, ship a compact IR, and a lightweight SDK draws it inside Godot,
> Unity or Unreal. Learn one framework, target every engine.

`zabloo/ui` is the open-source core of the zabloo platform: an engine-agnostic UI
system for videogames that **draws its own pixels** (the Flutter model) instead of
mapping to each engine's native widgets or embedding a browser.

```
authoring (React/JSX + tokens) → IR (tree + styles + events) → per-engine SDK
                                            → tessellates to GPU geometry → pixels
```

- **You author in React** (`@zabloo/react`): your components and props run at authoring
  time and emit the **IR** — a small, versioned, engine-agnostic JSON.
- **The SDK renders the IR itself**: it computes layout (Flexbox), tessellates every
  rounded rect and glyph into GPU meshes, and handles states, events and hit-testing.
  The engine only provides draw calls — a GPU canvas.
- **Pixel-identical across engines**: because nothing is translated to native widgets,
  the same UI looks and behaves exactly the same everywhere — consoles included (no
  Chromium required).
- **Golden rule:** the shared core never knows about any specific engine. Each SDK is a
  thin adapter (mesh submission, input, idiomatic events: Godot signals / C# events /
  Blueprints).

## Why not native widgets or a webview?

- **Native widgets** (React Native model): Unity's UI Toolkit, Godot's Control nodes and
  Unreal's Slate are not equivalent — mapping to them yields inconsistent UIs limited to
  the lowest common denominator.
- **Embedded browser**: 100+ MB of Chromium, heavy runtime, and unsupported on consoles.
- **Drawing ourselves**: light SDK, native performance, custom components impossible with
  native widgets (radial selectors, gauges), and one rendering result everywhere — the
  same architecture as Flutter.

## Status

**On npm since 0.2.0, pre-1.0.** `@zabloo/format`, `@zabloo/react`, `@zabloo/renderer-web`,
`@zabloo/cli` and `create-zabloo-app` are published; the engine SDKs ship on the
[Releases](https://github.com/zabloo-hub/ui/releases) page — the Godot addon as a zip, the
Unity SDK as a UPM `.tgz` — because an engine SDK is not an npm package. The IR v1 is
validated in code across **three render targets** — a WebGL2 renderer, the Godot SDK and the
Unity SDK — running the same self-render pipeline: own Flexbox layout pass, own tessellator,
own glyph atlases.

**One core, three engines and the web.** The core is **C++** — layout, text, tessellation
and the state/binding/transition runtime all live in [`core/`](core) — and every engine is a
thin adapter over it: [`sdk/godot`](sdk/godot) is a GDExtension whose C++ *is* the core;
[`sdk/unity`](sdk/unity) is a UPM package whose C# reaches the same core through its C ABI,
as a native plugin; Unreal (F13) takes it as a C++ module. Each adapter uploads triangles
and translates input, and nothing else. Because the core can produce a full view snapshot
with no engine at all, the [golden corpus](golden/README.md) runs against it on a bare CPU
in CI — and again through the C ABI, and again from inside Unity — which is why "the same
envelope renders the same" is a test here and not a promise.

### Where each target stands

The IR vocabulary is a closed set of **13 node types**, and `@zabloo/react` exports **28
authoring components** on top of it (composites like `<Tabs>` or `<Select>` are flattened
at authoring time and never reach the IR). The targets are **not** at the same point, and
it matters if you are picking this up today:

| Target | Node types | Where it is |
|---|---|---|
| **Web renderer** (`@zabloo/renderer-web`) | **13 / 13** | Runs the whole catalog: this is where every capability lands first, and what the `zabloo dev` preview and the future visual editor render with. |
| **Godot SDK** (`sdk/godot` + `core/`) | **13 / 13** | Renders the whole catalog, and every case of the golden corpus reproduces its recorded metrics **byte for byte** against the web renderer. Godot 4.4+. Desktop is measured; Android and iOS build in CI but have not been run on a device; web is experimental; consoles compile and are not validated. [What a frame costs](docs/performance.md). |
| **Unity SDK** (`sdk/unity` + `core/`) | **13 / 13** | A **thin adapter over the same core** — a UPM package (`com.zabloo.sdk`) whose C# uploads the core's triangles through UGUI and translates the Input System, reaching the core as a native plugin through its C ABI. The whole golden corpus reproduces its metrics **byte for byte** through that ABI in CI and through a real `ZablooView` in the editor's test runner. Unity 2022.3 LTS+, IL2CPP. Desktop plugins build in CI; the editor-side checks (a clean install, the IL2CPP players, the frame-rate table) are written as procedures and **not yet run on a machine with Unity** — see [where it stands](sdk/unity/README.md#status). |

Unreal renders nothing yet — it is *designed* in parallel (every IR decision is validated
against all three engines) rather than implemented, and lands as a thin adapter over the
same core rather than another port (F13).

What the system does today — all of it in the web renderer, the Godot SDK and the Unity SDK:

- **The full node vocabulary** — `Container`, `Text`, `Button`, `Collapse`, `ScrollView`,
  `Image`, `Overlay`, `Toggle`, `Slider`, `TextInput`, `Repeat`, `ProgressBar`, `Spinner`
  — and the authoring components that compose it: `Row`/`Column`, `Accordion`, `Tabs`,
  `Checkbox`/`Switch`/`Radio`/`RadioGroup`, `Select`, `List`/`Grid`, `Badge`,
  `Modal`/`Toast`/`Tooltip`. One page each in the
  [component catalog](docs/components/README.md).
- **Data-driven structure**: a `Repeat` instantiates its template once per element of a
  bound array, so data decides *how many nodes there are*, not just what they say —
  `<List>` and `<Grid>` are sugar over it, and the web renderer virtualizes long lists.
  Paths address into the data (`shop.items.3.name`), so an action fired inside a row
  carries which row it was.
- **Overlays**: an `Overlay` is declared where the UI that opens it lives but paints in
  one layer above the whole view — backdrop from its own style, input captured, focus
  trapped and given back on close. `visible` is the only way to open or close one, so a
  dismiss (Escape, gamepad B, a tap on the backdrop, a toast's timer) is just the SDK
  writing `false` back through the binding. An overlay may also be **anchored** to
  another node — placed against its rect, flipping and sliding to stay on screen — and
  ride that node's hover/focus, which is what makes a `<Tooltip anchor="jump-btn">`
  show itself for a mouse and for a gamepad without a line of game code.
- **Motion**: a per-node `transition` (duration + easing from a closed, closed-form
  curve set) tweens whatever animatable value changes — no trigger list, no keyframes —
  and component behavior drives the same engine where the endpoints are its own: the
  `ProgressBar`'s fraction, the `Spinner`'s loop, an `Overlay` fading in and out of the
  layer, the `Collapse` animating its own height open and shut, the `Toggle` crossfading
  its two indicators, the `Slider` gliding to a value the game pushed (never to the one
  under the finger). Motion is themeable per component and durations are tokens, so a
  "reduce motion" theme stops the UI dead without re-emitting the tree.
- **Styling**: design tokens (flat dictionary, theme hot-update without re-emitting the
  tree), per-state overrides (the seven states — `empty`, `selected`, `checked`, `hover`,
  `focused`, `pressed`, `disabled` — merged in that fixed order), variants resolved at export time,
  and the v1 style set: `background`, `radius`, `borderWidth`, `borderColor` (inset
  border), `color`, `fontSize`, `opacity` (inherits multiplicatively), plus the text
  set — `wrap`, `textAlign`, `textAlignY`, `lineHeight`, `overflow`, `maxLines`.
- **Multiline text**: word wrap to the width the layout pass offers, hard breaks,
  alignment on both axes, and `clip`/`ellipsis` truncation, with every width kerned like
  the painted run. One normative algorithm over one rasterizer we own (`stb_truetype`,
  the same TTF on every target), so a line breaks in the same place in the browser, in
  Godot and in Unity — never through an engine's own text server.
- **Scrolling and clipping**: a `ScrollView` measures its children unconstrained on the
  scrolled axis and clips to its own rect (wheel, drag, and a scroll call from the game);
  `clip` is a paint prop any node can carry, and it cuts paint and hit-testing alike.
- **Assets**: images travel *inside* the envelope (a content-addressed manifest, base64
  by default), so one JSON is still the whole payload — the dev loop already ships the
  tree and the bytes separately, which is the same path a CDN will use.
- **Forms and input**: `Toggle` (checkbox/switch/radio), `Slider`, `Select` and
  `TextInput` — with **two-way bindings**: the SDK writes the player's value back into
  the bound path and tells the game through one callback, instead of every control
  inventing its own event.
- **Interactivity**: SDK-owned behavior keyed by component type, named actions surfaced
  idiomatically (a Godot signal, a C# event), data-path bindings (`set_data("player.gold", …)`
  re-lays out live), and automatic spatial focus/navigation computed from the live layout
  rects. On every target that navigation is driven by **keyboard and
  gamepad alike** — d-pad/stick move the focus, A activates, B dismisses the top modal,
  the right stick scrolls, and moving the focus drags the scroll along to reveal it.
- **Dev loop**: save a `.tsx` → `zabloo dev` re-exports into a live browser preview;
  add `--godot` to also hot-push each save to the running Godot game, or `--unity` to the
  Unity editor — through the same loading path as production hot-update.

## How it works

```bash
npx create-zabloo-app my-game-ui   # scaffold a React authoring project
pnpm dev                            # watch → live web preview
pnpm dev:godot                      # …plus hot-push each save to the running Godot game
pnpm dev:unity                      # …plus hot-push each save to the Unity editor
pnpm build                          # = zabloo export → versioned IR envelope in dist/
```

Then load the envelope with the engine SDK and it renders in-game — in Godot, drop
[`addons/zabloo/`](sdk/godot) into the project, add a `ZablooView` to a scene and point it
at the file; in Unity, add the [`com.zabloo.sdk`](sdk/unity) package, put a `ZablooView`
under a `Canvas` and assign the imported envelope. Content can also be delivered and **hot-updated** from the zabloo platform
without recompiling or re-shipping through stores — the dev loop uses that exact path.

## Documentation

The reference for the IR and the component catalog lives in [`docs/`](docs/README.md):

- [Getting started](docs/getting-started.md) — scaffold a project and build a real screen,
  from an empty folder to an envelope the SDK loads. Start here.
- [The envelope](docs/format/envelope.md) — version, tokens, views, assets.
- [Layout](docs/format/layout.md) · [Style](docs/format/style.md) · [Input & focus](docs/format/input.md) ·
  [Bindings & actions](docs/format/bindings.md) · [Motion](docs/format/motion.md)
- [Loading](docs/format/loading.md) and [Versioning](docs/format/versioning.md) — how content
  older or newer than the SDK degrades, and what an SDK refuses.
- [Component catalog](docs/components/README.md) — one page per node type, with the
  `@zabloo/react` components that emit it.

To see it running rather than written down, [`examples/`](examples/README.md) has the
`showcase` project: nine views, one per capability, live in the web preview
(`pnpm --filter showcase-example dev`), and
[`godot-playground`](examples/godot-playground/README.md) and
[`unity-playground`](examples/unity-playground/README.md), the engine projects that load
those same envelopes in-engine.

## Repository layout

```
ui/
├── core/                  the shared C++ core: layout · text · tessellation · runtime
├── packages/
│   ├── format/            @zabloo/format — IR types + envelope validation
│   ├── react/             @zabloo/react — React bindings (custom reconciler → IR)
│   ├── cli/               @zabloo/cli — `zabloo` / `zb` (export, dev)
│   ├── renderer-web/      @zabloo/renderer-web — WebGL2 self-renderer (preview/editor)
│   └── create-zabloo-app/ project scaffolder
├── sdk/
│   ├── godot/             the GDExtension adapter + the installable addons/zabloo/
│   └── unity/             com.zabloo.sdk — UPM package, a thin adapter over core/ (native plugin + C ABI)
├── docs/                  the format spec + the component catalog
├── golden/                golden envelopes: the same input must render the same on every target
└── examples/              see examples/README.md for which one to open
    ├── showcase/          the whole catalog, one view per capability, nine views
    ├── hello-button/      the vertical slice: one pressable Button, React → IR → engine
    ├── inventory-demo/    a shop with real overflow — list, category strip, nested Collapse
    ├── settings-screen/   the whole form catalog composed as one real screen
    ├── godot-playground/  the Godot project that loads them, capability by capability
    └── unity-playground/  the Unity project that loads them, and runs the corpus in-engine
```

`core/` sits at the root, a sibling of `sdk/` and `packages/`, on purpose: `packages/*`
means *pnpm workspace package*, and putting the core under `sdk/` would blur the very line
the golden rule protects — the `sdk/*` know about their engine, the core knows about none.

Every authoring example is a runnable project: `pnpm --filter <name>-example dev` opens it
in the web preview.

Planned next: the Unreal adapter over the same core, the Godot addon on the Asset Library
and the Unity SDK on OpenUPM, and the visual editor rendering the same IR on the same core compiled to WASM.

Tooling: pnpm workspaces · TypeScript (ESM) · tsup · Vitest · Biome · Changesets.

## Working in this repo

Node ≥ 22 and pnpm (the repo pins its version through `packageManager`).

```bash
pnpm install
pnpm build                                 # packages → dist/, then the examples' envelopes
pnpm typecheck && pnpm test && pnpm lint   # the three checks CI runs
pnpm verify:pack                           # the publish dry run: pack, install outside
                                           # the workspace, import and typecheck it
```

**CI runs them in that order** — install, build, typecheck, test, lint, `verify:pack`.
Locally the build is usually optional for the checks: `typecheck` and `test` resolve
workspace dependencies to their **sources**, so a fresh clone needs no build first.
`packages/cli` is the exception, because two of its tests run the real thing rather than a
stand-in: the dev server serves the preview page's own bundle, and the export tests run a
project's code through jiti, which resolves `@zabloo/react` from that project. Both want
`pnpm build` first — which is why CI builds up front rather than sorting it out per package.

**Run `pnpm build` once before using the examples**, though, whatever you do with the
checks. `zabloo` is a bin of `@zabloo/cli`, and pnpm can only link a bin whose target
already exists — on a fresh clone `dist/cli.js` does not, so the shim is skipped with a
warning and `pnpm --filter showcase-example dev` would fail with `zabloo: not found`. The
build closes that gap itself: it bundles the packages, re-links the workspace, and only
then exports the examples.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the whole loop: setting up, running the preview,
the golden corpus, when a change needs a changeset, and what a pull request should say.
Bugs and requests go through the [issue templates](.github/ISSUE_TEMPLATE); a security
problem goes through [private reporting](SECURITY.md) rather than a public issue. The
project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). Open source and free: the core (tessellator + IR runtime), the IR/format
spec, every engine SDK and the base component library.
