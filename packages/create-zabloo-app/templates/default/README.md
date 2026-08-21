# __PROJECT_NAME__

Game UI authored in React, exported as a versioned [zabloo](https://github.com/zabloo-hub/ui) IR envelope and rendered **inside your engine** by the zabloo SDK (no webview — the SDK tessellates the UI to GPU geometry).

## Commands

```bash
pnpm dev        # watch + live web preview at http://localhost:5078
pnpm dev:unity  # same, plus push each save to the Unity editor's dev mode
pnpm build      # export the envelope to dist/zabloo.ir.json
```

## Dev loop

- **Web preview (no engine needed):** `pnpm dev` and open http://localhost:5078 — it live-reloads on save, gives you a typed field per bound path in its bindings panel, logs every action in its console, and drives the UI with the keyboard *or* a gamepad: arrows and the d-pad/left stick move the focus, Enter, Space and A activate, Escape and B dismiss the top overlay, and the right stick scrolls.
- **Unity:** install the zabloo SDK package, enable **Zabloo → Dev Mode** in the editor, and run `pnpm dev:unity` — every save hot-swaps the running view (even in Play mode). For a manual import, copy `dist/zabloo.ir.json` into your project and assign it to a `ZablooDocument`.

## Project layout

- `src/views/` — every `.tsx` here is one view of the envelope (filename = view ID). Two come with the project: `main-menu` and `settings` (tabs, a switch, a slider, a dropdown and a text field, all bound). The preview's view selector switches between them; in Unity, the one a document loads is its **View** field.
- `src/components/` — your React components; they run at export time and emit zabloo primitives (they never reach the IR).
- `src/assets/` — images (`.png`, `.jpg`); `<Image src="logo.png">` references them by path relative to this folder, and the export inlines them in the envelope.
- `src/theme.ts` — design tokens (flat dictionary, hot-updatable) and component variants (resolved at export time).
- `zabloo.config.ts` — project config (`outDir`).

## Learn more

- [Getting started](https://github.com/zabloo-hub/ui/blob/main/docs/getting-started.md) — the same project built from an empty folder, step by step, through to loading the envelope in Unity.
- [Project structure & CLI](https://github.com/zabloo-hub/ui/blob/main/docs/project-structure.md) — what each folder here is for, and what `zabloo dev` / `zabloo export` do.
- [Component catalog](https://github.com/zabloo-hub/ui/blob/main/docs/components/README.md) — one page per node type, with the `@zabloo/react` components that emit it.
- [Format reference](https://github.com/zabloo-hub/ui/blob/main/docs/format/envelope.md) — the envelope, layout, style, bindings, motion, and the rules a loader follows.
- [Examples](https://github.com/zabloo-hub/ui/blob/main/examples/README.md) — runnable projects, from a one-button screen to the whole catalog.
- [Troubleshooting](https://github.com/zabloo-hub/ui/blob/main/docs/troubleshooting.md) — export errors, loader warnings, and "it rendered but not like that".

## Wiring the game (Unity)

```csharp
var ui = GetComponent<Zabloo.ZablooDocument>();
ui.OnAction += action => { if (action == "play") StartGame(); };
ui.SetData("player.gold", 1250); // bound Text/visible react live
```
