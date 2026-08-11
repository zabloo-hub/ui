# zabloo/ui

> **Build your game's UI once — render it identically in any engine.**
> Author in React, ship a compact IR, and a lightweight SDK draws it inside Unity,
> Godot or Unreal. Learn one framework, target every engine.

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
  thin adapter (mesh submission, input, idiomatic events: C# events / signals /
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

🚧 **Working end-to-end, pre-release.** The IR v1 is validated in code across **two
render targets** — the Unity SDK (UI Toolkit custom geometry:
`generateVisualContent` / Mesh API) and a WebGL2 renderer — both running the same
self-render pipeline: own Flexbox layout pass, own tessellator, own glyph atlases.

What works today:

- **4 primitives on both targets** — `Container`, `Text`, `Button`, `Collapse` — plus
  `ScrollView`, `Toggle`, `Image` (assets travel inside the envelope), `ProgressBar` and
  `Spinner` in the web renderer while the engine SDKs catch up, and authoring-time
  composites (`Row`/`Column`, `Accordion`, `Tabs`, `Checkbox`/`Switch`/`RadioGroup`,
  `Badge`) that flatten to primitives.
- **Motion**: a per-node `transition` (duration + easing from a closed, closed-form
  curve set) tweens whatever animatable value changes — no trigger list, no keyframes —
  and component behavior drives the same engine where the endpoints are its own (the
  `ProgressBar`'s fraction, the `Spinner`'s loop). Durations are tokens, so a
  "reduce motion" theme stops the UI dead without re-emitting the tree.
- **Styling**: design tokens (flat dictionary, theme hot-update without re-emitting the
  tree), per-state overrides (`pressed` / `focused` / `selected`), variants resolved at export time,
  and the v1 style set: `background`, `radius`, `borderWidth`, `borderColor` (inset
  border), `color`, `fontSize`, `opacity` (inherits multiplicatively).
- **Interactivity**: SDK-owned behavior keyed by component type, named actions surfaced
  as C# events, data-path bindings (`SetData("player.gold", …)` re-lays out live),
  automatic spatial focus/navigation (arrows/Enter today, gamepad-ready).
- **Dev loop**: save a `.tsx` → `zabloo dev` re-exports into a live browser preview;
  add `--unity` to also hot-push each save to the Unity editor — through the same
  loading path as production hot-update.

**Unity is the reference SDK for v1**; Godot and Unreal are designed in parallel (every
IR decision is validated against all three) and come later. Packages are not yet
published to npm.

## How it works

```bash
npx create-zabloo-app my-game-ui   # scaffold a React authoring project
pnpm dev                            # watch → live web preview
pnpm dev:unity                      # …plus hot-push each save to the Unity editor
pnpm build                          # = zabloo export → versioned IR envelope in dist/
```

Then import the envelope with the engine SDK (Unity first) and it renders in-game.
Content can also be delivered and **hot-updated** from the zabloo platform without
recompiling or re-shipping through stores — the dev loop uses that exact path.

## Repository layout

```
ui/
├── packages/
│   ├── format/            @zabloo/format — IR types + envelope validation
│   ├── react/             @zabloo/react — React bindings (custom reconciler → IR)
│   ├── cli/               @zabloo/cli — `zabloo` / `zb` (export, dev)
│   ├── renderer-web/      @zabloo/renderer-web — WebGL2 self-renderer (preview/editor)
│   └── create-zabloo-app/ project scaffolder
├── sdk/
│   └── unity/             com.zabloo.sdk — UPM package (UI Toolkit custom geometry)
└── examples/
    ├── hello-button/      the vertical-slice project (React → IR)
    └── unity-playground/  Unity project consuming the SDK locally
```

Planned next: npm publication, the base component library (`components/`), more style
and component capabilities (images, scrolling/clipping), extraction of the shared core
(tessellator + IR runtime), and the Godot/Unreal adapters.

Tooling: pnpm workspaces · TypeScript (ESM) · tsup · Vitest · Biome · Changesets.

## License

Open source and free: the core (tessellator + IR runtime), the IR/format spec, every
engine SDK and the base component library.
