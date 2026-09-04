# unity-playground

The smallest Unity project that hosts a zabloo view, used to check the Unity
adapter (`sdk/unity`) against a real engine — the half of the work the golden
corpus deliberately does not cover (the corpus runs the core on a bare CPU, with
no engine and no GPU). It is the Unity counterpart of
[`godot-playground`](../godot-playground/README.md).

**Status: host channel (UN7), rendering (UN4), pointer/keyboard (UN5), the
gamepad (UN6), the dev loop (UN8) and the golden corpus (UN10) in.** The scene
opens and compiles, the envelopes load into the core, the game-facing API works
— `SetData`, the id operations, `OnAction`/`OnDataChanged`/`OnDiagnostic` — the
view can be used with a mouse, a finger, a keyboard and a controller, and the
corpus replays byte for byte through a real `ZablooView` (§ *Running the corpus
inside Unity*). Each ticket adds what it can be checked for here; the throwaway
scenes for checking each capability are built from the **Zabloo › Verify** menu
(§ *Checking UN10 by hand*).

## Run it

```sh
# 1. Build the native core (its C ABI is what the package loads).
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
path. The log line says whether the load took. **B** toggles the bench HUD
(`Assets/Bench/`): the engine's frame next to the core's counters.

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

## Checking UN5 by hand

Pointer and keyboard (ZAB-198) cannot be arbitrated by the golden corpus — a
snapshot has no script of keys — and the machine that wrote them had no
editor, so this is the procedure. It needs UN4 (something on screen), UN6 (an
input owner) and UN7 (`LoadEnvelope`) merged; until then the view has nothing
to read into.

On `settings-screen` (the one it opens on), with a mouse and a keyboard:

- **Hover and click**: a button lights on hover and fires on the release
  (`action: …` in the Console). Press on a button, drag off it, release:
  nothing fires. Alt-tab away mid-drag and back: nothing stuck in `pressed`.
- **Arrows** walk the focus ring; **Enter** and **Space** activate on the
  release. Hold an arrow: nothing for 400 ms, then a step every 90 — the pad's
  feel, because the Input System repeats nothing but text.
- **On a slider**, ← and → move the VALUE and ↑/↓ leave it; `…-apply` fires
  when the arrow comes UP, not on every step. Release it: exactly one commit.
- **The language dropdown**: Enter opens it, **Escape** closes it — and with
  nothing open, Escape does nothing at all (`EscapeConsumedThisFrame` stays
  false: the game's pause menu still gets it).
- **The name field**: type, and the bound label follows; the placeholder goes
  on the first character; the caret blinks at two frames per period and the
  Stats tab shows the flip as a repaint (`repaintOnly`); Shift+arrows select
  and the caret disappears; Cmd/Ctrl+C/X/V copy, cut and paste through the
  system clipboard, and a paste of 38 characters stops at `maxLength`; ←/→ at
  the ends of the text hand the direction back and leave the field; Enter
  submits (`name-accept`) and presses nothing.
- **The wheel** over the settings list scrolls it 50 px per notch, in the
  direction the wheel rolls; over a horizontal-only strip it does nothing,
  which is deliberate (gap (a) of ZAB-9, kept in every target).

Touch, on `inventory-demo`: enable *Input System › Simulate Touch Input From
Mouse Or Pen* (Input Debugger › Options) and drag the list — it scrolls with
the finger, nothing lights on the way, and a tap on a row's button fires
without the drag stealing it.

IME, on macOS with the Japanese input source: type `ko` in the name field —
`こ` shows in the field as a composition and the bound label does NOT change;
press Enter to settle and the label updates once, with the settled text. Cancel
a composition with Escape: the field is back to what it held, and no dropdown
closed (the composition ate the key).

The PlayMode suite (`sdk/unity/Tests/PlayMode/KeyboardInputTests.cs`) drives
the same cascade with a synthetic keyboard — Enter's press and release, two
taps, typed text, a clipped paste, Escape with and without a modal. Run it from
Window › General › Test Runner › PlayMode; every case is inconclusive rather
than red until UN7 lands.

## Checking UN6 by hand

The half of the gamepad that the corpus cannot see (it runs the core with no
device), and that `Tests/PlayMode/PadTests.cs` covers with a synthetic pad:
which device, which button, when to look, and who owns the input. Plug a
controller in — nothing has to be wired: the adapter reads `Gamepad.current`
through the Input System's standard layout, and everything it produces goes
through the handlers the keyboard already uses.

On `settings-screen`:

- **D-pad or left stick**: one push is one step of focus, the same spatial step
  the arrows take. **Hold one**: nothing for 400 ms, then a step every 90 ms — a
  second held is 8 steps, not a slide. Up is up: the Input System reports a stick
  pushed up as +1 and the core reads down as positive, and the adapter flips it
  once, on the way in.
- **A** (south) presses the focused control and activates it when you LET GO,
  exactly where Enter does; the action lands in the log. Unplug the pad mid-press
  and it cancels instead: pulling a cable is not how a player buys something.
- **On a slider**, the directions along its axis move the VALUE and the cross ones
  move the focus off it; `brightness-apply` (its `onCommit`) lands when you
  release the direction, not on every step — and when you unplug mid-hold, since
  the value you left there is the one on screen.
- **On the name field**, ←/→ walk the caret and hand the direction back at the end
  of the text, so you leave the field with the d-pad instead of being trapped in
  it. ↑/↓ always navigate.
- **B** (east) closes the language dropdown — the popover writes its binding — and
  the modal on the showcase's `overlays` view: it is the Escape key. With nothing
  up it does nothing at all, so a game's own pause menu still gets its B.
- **Right stick** scrolls the `ScrollView` the focus is in, at a speed that
  depends on how far you push it. On `inventory-demo`, scroll the focused row OUT
  of the window with the stick and keep pushing: the list keeps scrolling, because
  the focus is remembered as the item, not as the row that was recycled (ZAB-70,
  G12). Walking the focus down the list with the d-pad drags the list along, so
  the focus ring is never off screen.

Two views in one scene (add a second `ZablooView` to the canvas and give it an
envelope): only the first one enabled moves with the d-pad; click or tap the
other and the pad follows the touch, and the keyboard with it (a press on a
view's surface is `InputOwner.Claim`, wherever it lands). The
one that lost the pad drops whatever it was holding: a press cancels, a nudged
slider commits.

Remapping, from the game side (`Playground.cs` does none of this — the defaults
are meant to need nothing):

```csharp
view.SetPadButton("a", GamepadButton.East);      // swap A and B
view.SetPadAction("a", acceptActionReference);   // or follow an Input System action the game rebound
view.SetPadAxis("scroll_y", PadMapping.AxisLeftY);
view.SetPadAxis("scroll_x", PadMapping.AxisOff);
```

Slots are `a`, `b`, `dpad_up/down/left/right`, `nav_x/y`, `scroll_x/y`; an
unknown one answers `false` with a warning. An action has to be enabled by the
game — the adapter only asks it whether it is pressed.

## Checking UN8 by hand — the dev loop

Doing the reload ON SAVE is `zabloo dev --unity`. The receiver
(`sdk/unity/Editor/ZablooDevServer.cs`) was written on a machine without
Unity — its pure half runs in `Tests/Editor/DevPushTests.cs`, the listener
does not — so this is its exit criterion as a procedure. Turn on **Zabloo →
Dev Mode** in the menu: the Console says `dev mode listening on
127.0.0.1:5077`.

`Playground.cs` loads its envelopes from `StreamingAssets/` by path, which is
not a `TextAsset`, so for the reimport half give the view an asset to keep in
sync: copy `examples/settings-screen/dist/zabloo.ir.json` into `Assets/`,
drag it onto the `Zabloo` object's **Envelope** field and set **View Id** to
`settings` (the `Playground` component's own `Load()` would replace it on
Play; disable that component for this check). Then:

```sh
cd ../settings-screen && pnpm dev --unity   # then press Play here
```

- **Edit a `.tsx`** — change a label in `src/views/settings.tsx` — and the view
  swaps in Play without touching the editor. What the game pushed with `SetData`
  does **not** reset: the store lives on the document, so it outlives the content
  it was feeding. `Assets/zabloo.ir.json` now holds the new label too (open it),
  and stopping and pressing Play again opens on it — no reimport by hand.
- **Stop Play and keep saving.** The Console says `1 view(s) in the scene, not
  playing, no new assets` and the asset keeps updating: edit mode is in sync too.
- **Watch both logs.** The CLI prints `pushed to Unity … ✔ (1 view)` and the
  Console `reloaded 1 view(s), no new assets`. Save again: still `no new
  assets`, however many times — the tree travels, the bytes do not.
- **Replace an image** — do the same in `examples/showcase` with
  `src/assets/banner.png` and its `media` view. The Console prints
  `1 asset(s) fetched`, exactly once, and the saves after it are back to `no new
  assets`. N reloads, one transfer: the point of the transport, and the number
  the exit criterion is measured with.
- **Unfocused editor.** Push with Unity behind your code editor: the swap is
  painted before you alt-tab back (`runInBackground` was turned on when Play
  started with dev mode on; the Console said so).
- **Dev mode off, keep saving.** The CLI says the Unity dev mode is not reachable
  **once** and then goes quiet; turn it back on and the next save says `— back`.
- **Both engines.** With the Godot playground playing too, `pnpm dev --godot
  --unity` prints one `pushed to` line per engine per save.
- **Port taken.** Turn dev mode on in a second editor: it says `port 5077 is
  taken — another editor listening?` instead of silently listening to nothing.

## Checking UN9 by hand

Builds, IL2CPP and the bench (ZAB-202) are the half of the milestone the golden
corpus cannot see at all — it runs the core with no engine, no player and no
GPU — and the machine that wrote them had no Unity, so all of it is a
procedure. The five native binaries are CI's (`unity-plugin`); what follows
needs the editor **with the IL2CPP module** for macOS and Windows.

1. **The IL2CPP players.** `scons capi arch=universal target=release` in
   `core/`, `scons install` here, then *File › Build Settings › Build* for
   macOS and for Windows: the project already selects IL2CPP and *High*
   stripping for Standalone. The checklist each player has to pass — starts on
   `settings-screen`, cycles the examples, logs actions and values, takes a
   controller — is the table in `sdk/unity/README.md` › *IL2CPP*. A
   `MissingMethodException` in the player's log names a member stripping took;
   `Runtime/link.xml` is where it is kept.
2. **The bench.** Launch the macOS player from a terminal with
   `-zabloo-bench -logFile -`: it walks the five entries of `Playground.Sources`,
   warms each one up for 1,5 s, measures 4 s, prints a header and one line per
   screen, and quits. Copy the four example rows into `docs/performance.md` ›
   *In a real engine* › *Unity*, with the header's GPU and Unity version.
   (Windows: `-zabloo-bench -logFile bench.log`.)
3. **The HUD.** Without the flag, **B** shows the same numbers live, in the
   player and in the editor — but read them in the player: the editor's
   numbers include its own windows.
4. **A steady frame allocates nothing.** *Window › General › Test Runner ›
   PlayMode › AllocationTests*: two cases, an idle frame and a frame that runs
   the whole pipeline, both must report 0 bytes. It needs the plugin installed
   (inconclusive otherwise). A failure names which of the two, and the *GC
   Alloc* column of the Profiler's CPU module, filtered to
   `ZablooView.Update`, says where.

## Running the corpus inside Unity

The golden corpus already passes in the core (`scons test golden`) and through
the C ABI alone (`scons test capi`). `sdk/unity/Tests/Golden/GoldenTests.cs`
runs it a third time, **from inside Unity**, through this project: every case
of `golden/cases.json` is staged on a real `ZablooView` on a `Canvas` — the
case's viewport, its `data` pushed through the public `SetData` (so the JSON
writer of UN7 is on trial too), the clock planted, the `pad` script replayed on
an `InputTestFixture` gamepad by standard-mapping index (so the translation
table and the Y flip of UN6 are on trial too) — and its `Snapshot()` is
compared **byte for byte** with `golden/metrics/<case>.json`. `future-major`
has to be refused with `unsupported-version`. Nothing softens the comparison;
a case that does not reproduce prints the path inside the snapshot, the `ref`
of the node and both values, the same report as `core/tests/test_golden.cpp`.

```sh
cd ../../core && scons capi && cd ../sdk/unity && scons install   # the plugin, once
```

Then either **Window › General › Test Runner › PlayMode › Zabloo.Sdk.Tests ›
GoldenTests** (the package is in `manifest.json`'s `testables`, so its suites
show up here), or from the command line, which is what a CI with a licence
would run — and what to run before opening a PR that touches `sdk/unity`:

```sh
Unity -batchmode -projectPath . -runTests -testPlatform PlayMode -testResults results.xml
```

`AbiSizeTests` (`zb_abi_sizes` against `Marshal.SizeOf` of every struct of
`NativeMethods.cs`) is in the same assembly and runs in either tab; it is the
first thing to run against a freshly built plugin, because a field that
drifted on one side of the C ABI changes a struct's size before it changes
any metric. Suites that need the plugin are **ignored, with the command to
install it**, when it is missing. None of this runs in CI — there is no Unity
licence on the runners — and the SDK's README says so instead of pretending.

## Checking UN10 by hand

What the corpus cannot see is pixels, a real pointer, a real pad, an event
reaching a handler and a push arriving from the CLI. That is checked from
throwaway scenes built by the **Zabloo › Verify** menu
(`Assets/Verify/Editor/VerifyMenu.cs`): each item saves whatever is open,
creates a new scene with the playground's shape — a Screen Space – Overlay
`Canvas`, a `ZablooView` stretched over it, no `EventSystem` — and a
`VerifyRig` (`Assets/Verify/VerifyRig.cs`) standing in for the game, then
leaves it open for Play. The scenes are built rather than stored: a `.unity`
authored by hand is a YAML document Unity may reject on open, and one authored
by Unity is a diff nobody can review; ten lines of C# are both.

On Play the rig loads the envelope, logs every action, data change and
diagnostic, and prints its checklist to the Console — the short form of the
sections above (§ UN4, UN5, UN6, UN7), which stay the reference for *why*:

| Menu item | Envelope | What it runs |
|---|---|---|
| Render (UN4) | `settings-screen` | the seven steps of § *Checking UN4 by hand*; **R** reloads for the texture-retention step |
| Pointer & keyboard (UN5) | `settings-screen` | § *Checking UN5 by hand* |
| Gamepad (UN6) | `settings-screen` | § *Checking UN6 by hand* — and the milestone's exit criterion below |
| Host channel (UN7) | `settings-screen` (set `source` for the others) | § *Checking UN7 by hand* as **`[ContextMenu]` items** on the rig: right-click the component (Inspector › ⋮) for *Host 1 … Host 6*; each logs what to expect |
| Dev loop (UN8) | `showcase` / `media` | § *Checking UN8 by hand*: Zabloo › Dev Mode on, `pnpm dev --unity`, the log lines to expect |
| Golden capture (UN10) | `golden/envelopes/text-wrap.json` | the 480×320 capture below |

`Stats · what the last paint cost` on the same context menu prints
`GetStats()` for the draw-call step.

### The milestone's exit criterion: `settings-screen` on a pad, in a player

F12 closes on one sentence: *`examples/settings-screen` is 100 % navigable with
a gamepad in a real player, IL2CPP*. The player is UN9's (`docs/performance.md`
says how it is built); the run is this list — the gestures of G13/UN6, in this
order, on that player, with a controller plugged in and nothing configured:

1. **D-pad down, four times**: the focus walks the settings column one control
   per push, the ring never leaves the screen (the list scrolls to keep it).
   Hold down for a second: exactly 8 steps, not a slide.
2. **Left stick** does the same walk; up is up.
3. **A on the `sfx` toggle**: `sfx-changed` then `settings.sfx = …` in the log,
   and the switch crossfades. Press A, unplug, plug back in: nothing fired.
4. **On the brightness slider**: ← and → move the value in steps; the label
   follows; `brightness-apply` lands when the direction is RELEASED, once.
   ↑/↓ leave the slider.
5. **On the language dropdown**: A opens it, the focus lands on the selected
   option, d-pad walks the options, A picks one — the popover closes and the
   binding is written; open it again and **B** closes it without changing
   anything. With nothing open, B does nothing.
6. **On the name field**: ←/→ walk the caret and hand the direction back at the
   ends, so ↓ leaves the field; ↑/↓ always navigate.
7. **Right stick** scrolls the settings list at a speed that follows the push;
   walking the focus with the d-pad drags the list along.
8. **Tabs**: d-pad across the tab bar, A selects — the panel swaps, the other
   tab's controls leave the layout (the log stays quiet: a tab change has no
   hook).

**Evidence** goes in the PR, not in the repo: a short screen recording (or a
capture per step) of that run on the IL2CPP player, with the player's log next
to it. Nothing is committed — the run is dated evidence of one build on one
machine, the rule the corpus lives by.

### The golden capture: `text-wrap` at 480×320, three targets

**Zabloo › Verify › Golden capture** builds a `ZablooView` of exactly 480×320
on a **constant-pixel-size** canvas (factor 1: one canvas unit is one device
pixel, whatever the Game view's size) reading `golden/envelopes/text-wrap.json`
straight from the repository. Set the Game view's **Scale** slider to 1, press
Play, then **C**: the rig reads back the view's rect at the end of the frame
(`Texture2D.ReadPixels` — the canvas alone, no post-processing, no camera in
between) and writes `Captures/text-wrap-unity.png` next to the project,
gitignored. Do not use a supersized `ScreenCapture`: any scale but 1 resamples
the glyphs you are about to compare.

Capture the same envelope in the web preview (`pnpm zabloo preview
golden/envelopes/text-wrap.json`, viewport 480×320, DPR 1) and in the Godot
playground, and compare the three at 1:1 under the tolerance of
[`golden/README.md`](../../golden/README.md#golden-images): a glyph's
*placement* must match exactly — same line breaks, same left edges, same
baselines to the pixel — and only antialiased edges may differ, by ≤ 2/255 per
channel. A line breaking elsewhere, a run drifting sideways, a baseline off by
a pixel or a solid interior that differs is a bug, not tolerance.

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
