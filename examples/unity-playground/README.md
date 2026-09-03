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
