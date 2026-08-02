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

🚧 **Early foundations.** The minimal IR v1 is defined and we are validating it with a
vertical slice: `JSX → IR JSON → Unity SDK` rendering an interactive Button via UI
Toolkit custom geometry (`generateVisualContent` / Mesh API). **Unity is the reference
SDK for v1**; Godot and Unreal are designed in parallel and come later.

## How it will work

```bash
# in your zabloo project (React)
zabloo export        # emits your views/scenes as versioned IR JSON
```

Then import the JSON with the engine SDK (Unity first) and it renders in-game. Content
can also be delivered and **hot-updated** from the zabloo platform without recompiling
or re-shipping through stores.

## Repository layout

```
ui/
├── packages/
│   ├── format/          @zabloo/format — IR types + envelope validation
│   ├── react/           @zabloo/react — React bindings (custom reconciler → IR)
│   └── cli/             @zabloo/cli — `zabloo` / `zb` (export; dev later)
├── sdk/
│   └── unity/           com.zabloo.sdk — UPM package (UI Toolkit custom geometry)
└── examples/
    ├── hello-button/    the vertical-slice project (React → IR)
    └── unity-playground/  Unity project consuming the SDK locally
```

Planned next: the shared core (tessellator + IR runtime), the base component library
(`components/`), `create-zabloo-app`, and the Godot/Unreal adapters.

Tooling: pnpm workspaces · TypeScript (ESM) · tsup · Vitest · Biome · Changesets.

## License

Open source and free: the core (tessellator + IR runtime), the IR/format spec, every
engine SDK and the base component library.
