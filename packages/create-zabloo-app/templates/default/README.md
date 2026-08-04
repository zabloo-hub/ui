# __PROJECT_NAME__

Game UI authored in React, exported as a versioned [zabloo](https://github.com/zabloo-hub/ui) IR envelope and rendered **inside your engine** by the zabloo SDK (no webview — the SDK tessellates the UI to GPU geometry).

## Commands

```bash
pnpm dev     # watch + live preview at http://localhost:5078 + push to the engine editor
pnpm build   # export the envelope to dist/zabloo.ir.json
```

## Dev loop

- **Web preview (no engine needed):** `pnpm dev` and open http://localhost:5078 — it live-reloads on save, shows a data panel for bound paths, logs actions, and supports arrow-key/Enter navigation.
- **Unity:** install the zabloo SDK package, enable **Zabloo → Dev Mode** in the editor, and every save hot-swaps the running view (even in Play mode). For a manual import, copy `dist/zabloo.ir.json` into your project and assign it to a `ZablooDocument`.

## Project layout

- `src/views/` — every `.tsx` here is one view of the envelope (filename = view ID).
- `src/components/` — your React components; they run at export time and emit zabloo primitives (they never reach the IR).
- `src/theme.ts` — design tokens (flat dictionary, hot-updatable) and component variants (resolved at export time).
- `zabloo.config.ts` — project config (`outDir`).

## Wiring the game (Unity)

```csharp
var ui = GetComponent<Zabloo.ZablooDocument>();
ui.OnAction += action => { if (action == "play") StartGame(); };
ui.SetData("player.gold", 1250); // bound Text/visible react live
```
