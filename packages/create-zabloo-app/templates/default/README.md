# __PROJECT_NAME__

Game UI authored in React, exported as a versioned [zabloo](https://github.com/zabloo-hub/ui) IR envelope and rendered **inside your engine** by the zabloo SDK (no webview — the SDK tessellates the UI to GPU geometry).

## Commands

```bash
pnpm dev        # watch + live web preview at http://localhost:5078
pnpm dev:godot  # same, plus hot-swap each save in the running Godot game
pnpm dev:unity  # same, plus hot-swap each save in the Unity editor
pnpm build      # export the envelope to dist/zabloo.ir.json
```

## Dev loop

- **Web preview (no engine needed):** `pnpm dev` and open http://localhost:5078 — it live-reloads on save, gives you a typed field per bound path in its bindings panel, logs every action in its console, and drives the UI with the keyboard *or* a gamepad: arrows and the d-pad/left stick move the focus, Enter, Space and A activate, Escape and B dismiss the top overlay, and the right stick scrolls.
- **Godot:** drop the `addons/zabloo/` addon into your project, enable it in **Project → Project Settings → Plugins**, add a `ZablooView` node, and run `pnpm dev:godot` — press Play and every save hot-swaps the running view, keeping whatever the game has pushed with `set_data`. For a manual load, point the node at `dist/zabloo.ir.json`.
- **Unity:** add the `com.zabloo.sdk` package from its `.tgz` (`"com.zabloo.sdk": "file:com.zabloo.sdk-<version>.tgz"` in `Packages/manifest.json`), add a `ZablooView` under a `Canvas` with `dist/zabloo.ir.json` imported as its envelope, turn on **Zabloo → Dev Mode** in the editor menu, and run `pnpm dev:unity` — every save rewrites the imported envelope and, in Play, hot-swaps the running view, keeping whatever the game has pushed with `SetData`.

## Project layout

- `src/views/` — every `.tsx` here is one view of the envelope (filename = view ID). Two come with the project: `main-menu` and `settings` (tabs, a switch, a slider, a dropdown and a text field, all bound). The preview's view selector switches between them; in Godot and in Unity the one a `ZablooView` shows is its **View Id** property.
- `src/components/` — your React components; they run at export time and emit zabloo primitives (they never reach the IR).
- `src/assets/` — images (`.png`, `.jpg`); `<Image src="logo.png">` references them by path relative to this folder, and the export inlines them in the envelope.
- `src/theme.ts` — design tokens (flat dictionary, hot-updatable) and component variants (resolved at export time).
- `zabloo.config.ts` — project config (`outDir`).

## Learn more

- [Getting started](https://github.com/zabloo-hub/ui/blob/main/docs/getting-started.md) — the same project built from an empty folder, step by step, through to loading the envelope in Godot or Unity.
- [Project structure & CLI](https://github.com/zabloo-hub/ui/blob/main/docs/project-structure.md) — what each folder here is for, and what `zabloo dev` / `zabloo export` do.
- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md) — one page per node type, with the `@zabloo/react` components that emit it.
- [Format reference](https://github.com/zabloo-hub/ui/blob/main/docs/format/envelope.md) — the envelope, layout, style, bindings, motion, and the rules a loader follows.
- [Examples](https://github.com/zabloo-hub/ui/blob/main/examples/README.md) — runnable projects, from a one-button screen to the whole catalog.
- [Troubleshooting](https://github.com/zabloo-hub/ui/blob/main/docs/troubleshooting.md) — export errors, loader warnings, and "it rendered but not like that".

## Wiring the game (Godot)

Named actions out, data in — that is the whole coupling surface.

```gdscript
@onready var ui: ZablooView = $ZablooView

func _ready() -> void:
    ui.action.connect(func(name: String, _context: Dictionary):
        if name == "play": start_game())
    ui.data_changed.connect(func(path: String, value: Variant):
        print("%s = %s" % [path, value]))   # a control wrote its own value back
    ui.set_data("player.gold", 1250)        # bound Text/visible react live
```

## Wiring the game (Unity)

The same two things, as C# events on the `ZablooView` component:

```csharp
using UnityEngine;
using Zabloo;

public class Menu : MonoBehaviour
{
    [SerializeField] ZablooView ui;

    void OnEnable()
    {
        ui.OnAction += (name, context) => { if (name == "play") StartGame(); };
        ui.OnDataChanged += (path, value) => Debug.Log($"{path} = {value}");  // a control wrote its own value back
        ui.SetData("player.gold", 1250);                                       // bound Text/visible react live
    }
}
```
