# unity-playground

The smallest Unity project that hosts a zabloo view, used to check the Unity
adapter (`sdk/unity`) against a real engine — the half of the work the golden
corpus deliberately does not cover (the corpus runs the core on a bare CPU, with
no engine and no GPU). It is the Unity counterpart of
[`godot-playground`](../godot-playground/README.md).

**Status: host channel in (F12, UN7); nothing renders yet.** The scene opens
and compiles, the envelopes load into the core and the game-facing API works —
`SetData`, the id operations, `OnAction`/`OnDataChanged`/`OnDiagnostic` — but
the adapter's rendering (UN4) and input (UN5, UN6) are still to land, each one
adding what it can be checked for here.

## Run it

```sh
# 1. Build the native core and put it into the package (once UN2 has landed).
cd ../../core && scons capi

# 2. Copy it into sdk/unity, and the examples' envelopes into this project.
cd ../sdk/unity && scons install

# 3. Open this folder in Unity 2022.3 LTS or newer (Unity 6 works too — accept
#    the upgrade it proposes) and press Play.
```

`Packages/manifest.json` references the SDK **by path** (`file:../../../sdk/unity`),
so the editor compiles the package straight from the checkout: a change to a
`.cs` in `sdk/unity` recompiles here.

The scene is one `Canvas` (Screen Space – Overlay, scaled from a 960×600
reference) with a **Zabloo** object stretched over it that carries the
`ZablooView` component, plus a `Playground` object that stands in for the game.
There is no `EventSystem` on purpose: the adapter reads the Input System devices
directly, the way the Godot adapter reads `InputEvent`, so UGUI's event pipeline
has nothing to do here.

`Playground.cs` loads an example's envelope from `Assets/StreamingAssets/`, where
`scons install` copies the current export of each one (they are gitignored, so
what you see is never a stale build). **E** swaps between them —
`settings-screen`, the showcase's `motion` and `overlays` views, `inventory-demo`
and `hello-button` — and **R** reloads the current one, which is the hot-update
path. The log line says whether the load took.

## Checking UN7 by hand

The host channel is the half of the adapter the golden corpus cannot arbitrate
(a snapshot is a frame; an event reaching a C# handler is not), so it is checked
here, from the editor. Every step below is a line typed into a script or the
console with `Playground`'s `view` in hand — a `[ContextMenu]` on a throwaway
`MonoBehaviour` does — and the line to expect in the Console (`Playground.cs`
already logs every action, data change and diagnostic). Nothing renders until
UN4, so the evidence is `Snapshot()` and the log, not pixels; and two of the
steps need a press, which is UN5's — they are marked.

1. **`hello-button`: data down.** Press **E** until the log says
   `hello-button / main-menu → loaded`, then `view.SetData("player.gold", 1200)`:
   the next frame's `Snapshot()` shows the bound `Text`'s `text` lines reading
   `1200`. *(UN5)* Enter on the autofocused `buy-btn` logs `action: buy` with
   `HasContext == false`.
2. **`settings-screen`: an action and a value back, through the host channel.**
   `view.SetChecked("sfx", true)` is the player's tap given by the game, hooks
   included: the Console shows `action: sfx-changed` (empty context — the toggle
   is not inside a `Repeat`) and then `settings.sfx = True` (`OnDataChanged`).
   `view.SetValue("volume", 40)` logs `action: volume-preview`,
   `action: volume-apply` and `settings.volume = 40`, in that order.
3. **`SetData` never echoes.** `view.SetData("settings.sfx", false)` moves the
   toggle in `Snapshot()` (its `states` lose `checked`) and **no**
   `settings.sfx = …` line appears.
4. **`inventory-demo`: a list from data, and a row's context.**
   `view.SetData("shop.items", items)` with `items` a
   `List<Dictionary<string, object>>` of four or more rows (`id`, `tag`,
   `name`, `detail`, `price`, `fav`) → `Snapshot()` shows the `Repeat`'s
   `window` and one realized instance per row. *(UN5)* A press on row 3's
   **Buy** logs `action: buy  (item shop.items.3, key <its id>, index 3)`.
5. **A refused reload keeps the screen.** `view.Reload("{\"v\": 1, \"views\"")`
   (truncated JSON) → the Console shows `[zabloo] invalid-json: …` as an
   error, `OnDiagnostic` fired with `Fatal == true`, `Reload` returned `false`,
   `IsLoaded` is still `true` and `Snapshot()` is unchanged.
6. **The JSON round trip under a Spanish locale** is not a playground check:
   it is `Tests/Editor/JsonTests.cs`, in the Test Runner's EditMode tab, which
   sets the thread's culture to `es-ES` before every case.

### Checking UN4 by hand

The render layer (`sdk/unity/Runtime/ZablooView.Render.cs`, `Runtime/Render/`,
`Runtime/Shaders/`) was written on a machine without Unity, type-checked against
a shim and nothing more. What follows is its exit criterion as a procedure; the
first four steps are also the first things to look at if nothing draws.

1. **Something draws.** With UN7's host channel in place, press Play: each of the
   four examples paints (**E** cycles them). If the screen stays black, open the
   `Zabloo` object in the hierarchy: a `Zabloo Surface` child with one
   `clip group N` per clip group should exist, each with a `CanvasRenderer`
   holding a mesh. If the console names the vertex layout, or the meshes are
   there and empty, add `ZABLOO_STANDARD_VERTICES` to *Player Settings › Scripting
   Define Symbols* — the Canvas batcher did not take a two-component position —
   and say so in the PR: `VertexLayout.cs` explains what changes.
2. **Both Canvas modes.** The scene's Canvas is Screen Space – Overlay. Switch it
   to Screen Space – Camera (drag `Main Camera` into *Render Camera*) and cycle the
   examples again: identical picture, same place, clip corners still round.
3. **A long list with a rounded clip.** Load `golden/perf/list.envelope.json`
   (copy it into `StreamingAssets/`, add it to `Playground.Sources` with view
   `main`) and push `golden/perf/list.data.json` through `SetData("shop.items",
   …)`: a thousand unequal rows inside a scroller with `radius: 6`. Scroll it; the
   rows are cut by the panel's rounded corners, antialiased, not by its bounding
   box — and never bleed outside it.
4. **Draw calls.** *Window › Analysis › Frame Debugger*, Enable, and count the
   `Canvas.RenderOverlays` (or `Render.Mesh` under the camera) draws while the
   view is still. `GetStats().DrawCalls` is what the core emitted; the Frame
   Debugger shows **that many plus the Canvas's own** (one per other UI element in
   the scene, none here), and not one more. The Canvas may merge two adjacent
   draws that share a material — that would be *fewer*, which is fine.
5. **A reload keeps its textures.** Show `inventory-demo`, then press **R**: the
   console does not print a `[zabloo] could not decode` line and, in the
   Profiler's Memory module, the texture count does not move. Then edit the
   example so the same PNG ships under a second id and rebuild: still no new
   texture — images are cached by content hash, not by id.
6. **A still frame allocates nothing.** *Window › Analysis › Profiler*, CPU
   module, *GC Alloc* column, with the view showing `settings-screen` and nothing
   moving: `ZablooView.Update` reports **0 B**. Hover a button so the frame
   repaints and check again — still 0 B. (A frame that grows a mesh or decodes an
   image allocates once; that is not steady state.)
7. **The text is the same text.** Point a view at
   `golden/envelopes/text-wrap.json` sized **480×320** (a second `ZablooView` in
   a 480×320 `RectTransform`, DPR 1 — set the Canvas Scaler to *Constant Pixel
   Size* for this) and capture the Game view at 1:1; capture the same envelope in
   the Godot playground the same way. Compare them under the tolerance in
   `golden/README.md` › *Golden images*: same line breaks, same left edges, same
   baselines to the pixel; only antialiased edges may differ, by ≤ 2/255. The
   captures are evidence for the PR, not files for the repo.

`Window › General › Test Runner › EditMode › RenderTests` runs without the native
plugin and settles the two things the shim could not: that the shader compiles on
this GPU and that a mesh accepts the core's vertex layout.

## Two Unity versions

The project is written for **2022.3 LTS** (`ProjectSettings/ProjectVersion.txt`)
and has to open in **Unity 6** unchanged — that is the "2022.3 minimum, tested
on 6" rule of the [decision](../../docs/internal/decisions-architecture.md).
Unity 6 will offer to upgrade the project on open; that is expected. What must
not happen in either is a compile error.

`ProjectSettings/` is deliberately minimal — only what has to be set (the
product name, the Input System as the active input handler, the 960×600 default
window). Unity fills in the rest with its defaults and rewrites the files on
first open; commit what it writes.
