# create-zabloo-app

> Scaffold a [zabloo/ui](https://github.com/zabloo-hub/ui) project: author your game's UI
> in React, export a versioned IR envelope, render it **inside your engine**.

```bash
npx create-zabloo-app my-game-ui
cd my-game-ui
pnpm install
pnpm dev          # live web preview at http://localhost:5078
```

No engine needed to start: the preview renders your UI with the same self-render pipeline
the in-engine SDK runs — its own layout pass, its own tessellator, its own glyph atlas —
so what you see is what the game will draw.

## What zabloo is

You write the UI once, in React. It doesn't render to the DOM and it isn't mapped to each
engine's native widgets: your components run at **authoring time** and emit a compact,
versioned, engine-agnostic **IR**. The SDK on the other side draws its own pixels (the
Flutter model), so the same UI looks and behaves identically on every target — consoles
included, no Chromium.

```
authoring (React/JSX + tokens) → IR envelope (JSON) → per-engine SDK
                                          → tessellates to GPU geometry → pixels
```

## What you get

```
my-game-ui/
├── src/
│   ├── views/        one .tsx per view (filename = the view ID the SDK loads)
│   │   ├── main-menu.tsx
│   │   └── settings.tsx    tabs, a switch, a slider, a dropdown, a text field — all bound
│   ├── components/   your React components (they never reach the IR)
│   ├── assets/       images; the export inlines them in the envelope
│   └── theme.ts      design tokens, variants and motion
├── zabloo.config.ts
└── package.json
```

```bash
pnpm dev        # watch + live web preview
pnpm dev:godot  # …plus hot-swap each save in the running Godot game
pnpm dev:unity  # …plus hot-push each save to the Unity editor (menu Zabloo → Dev Mode)
pnpm build      # export → dist/zabloo.ir.json
```

## Wiring the game

Two things cross from the UI into your game, and only these two — named **actions** and
data-path **bindings**. In Godot, both are signals on the `ZablooView` node the addon
registers:

```gdscript
@onready var ui: ZablooView = $ZablooView

func _ready() -> void:
    ui.action.connect(func(name: String, _context: Dictionary):
        if name == "play": start_game())
    ui.set_data("player.gold", 1250)   # bound Text/visible react live and re-lay out
```

In Unity, the same two through the document:

```csharp
var ui = GetComponent<Zabloo.ZablooDocument>();
ui.OnAction += action => { if (action == "play") StartGame(); };
ui.SetData("player.gold", 1250); // bound Text/visible react live and re-lay out
```

Godot renders the whole catalog today; Unreal comes later, as a thin adapter over the same
core. The envelope can also be delivered and **hot-updated** from the zabloo platform
without recompiling or re-shipping through stores — the dev loop uses that exact path.

## Usage

```
create-zabloo-app <project-directory> [--workspace]

  <project-directory>  where to scaffold (also the package name)
  --workspace          use workspace:* versions (for the zabloo monorepo itself)
```

## Documentation

- [zabloo/ui](https://github.com/zabloo-hub/ui) — what it is and why it draws its own pixels.
- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md) — every component and the IR node it emits.
- [Full documentation](https://github.com/zabloo-hub/ui/blob/main/docs/README.md) — the IR format, layout, style, bindings, motion, versioning.

## License

MIT
