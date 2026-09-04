# sdk/unity

The Unity adapter — **under construction (F12)**. It is a UPM package,
`com.zabloo.sdk`, whose C# does only what an adapter does: hand the shared
native core a rect, a clock and the player's input, upload the triangles it
returns, and expose actions and data the way a C# game expects them. Layout,
text, tessellation and the whole runtime live in [`core/`](../../core), reached
through its C ABI (`core/capi/`) — the same core, verbatim, that Godot runs.

This is **not** the C# port that was cancelled at 4 of 13 node types
(2026-08-24); that one is in the history (`git log -- sdk/unity`, before
ZAB-196) and does not come back. What is here today is the scaffold: the
package, the component's lifecycle, and stubs for the host channel. The
[decision](../../docs/internal/decisions-architecture.md) and the plan explain
the shape; the tickets below fill it in.

| File | Ticket | What it contains |
|---|---|---|
| `Runtime/ZablooView.cs` | UN3 (here) | Lifecycle, size, clock, the frame, and the `partial void` hooks the rest implement |
| `Runtime/ZablooView.Host.cs` | UN7 | `Flush()`, the public API (loading, `SetData`, the id operations, the three events, `Snapshot()`/`Stats`) and the native handles — everything goes through `NativeMethods` |
| `Runtime/ActionContext.cs`, `Runtime/Diagnostic.cs` | UN7 | The two structs the events carry |
| `Runtime/Json/` | UN7 | The small JSON writer and reader the data channel speaks (`InvariantCulture`, always); `Tests/Editor/JsonTests.cs` runs them under `es-ES` |
| `Runtime/Interop/NativeMethods.cs` | UN2 | The `DllImport` transcription of `core/capi/zabloo.h` |
| `Runtime/ZablooView.Render.cs`, `Runtime/Render/`, `Runtime/Shaders/` | UN4 | `Paint()` — one `CanvasRenderer` per clip group with a submesh per batch, the core's arrays uploaded as `NativeArray` views, glyph atlases and images as textures, and the `Zabloo/Canvas` shader that clips by SDF |
| `Runtime/ZablooView.Pointer.cs`, `.Keyboard.cs` | UN5 | `PollPointer()`, `PollKeyboard()` — the Input System as the core's intentions; IME, on-screen keyboard, caret blink |
| `Runtime/Input/Keys.cs`, `Wheel.cs` | UN5 | The keyboard's vocabulary (slots, shortcut, hold-to-repeat, the text sink) and the wheel's 50 px per notch |
| `Runtime/ZablooView.Pad.cs` | UN6 | `PollPad()` |
| `Runtime/link.xml` | UN9 | What IL2CPP's stripping must keep: the interop namespace, whole |
| `Tests/PlayMode/AllocationTests.cs` | UN9 | A steady frame allocates nothing — the C# reading of the core's `buffer_growths == 0` |

**Unity 2022.3 LTS or newer**, with the Input System package (a dependency of
this one). It has to open in Unity 6 unchanged as well — that is the rule the
playground checks.

`Tests/` holds the EditMode tests (`Window › General › Test Runner`). The
ones that need no native plugin — `RenderTests` — are the first thing to run
on a machine with Unity: the adapter is written and type-checked on one
without it, and those tests settle what a shim cannot (the shader compiles,
a mesh takes the core's vertex layout).

## Build locally

```sh
cd core && scons capi           # the native core → core/bin/libzabloo.*   (UN2)
cd ../sdk/unity && scons install   # → Runtime/Plugins/<host>/, plus the playground's envelopes
```

`scons install` copies the host's binary into `Runtime/Plugins/<platform>/`
and writes its `.meta` next to it (both gitignored — see the `SConstruct` for
why the import settings are generated rather than committed), then copies the
four examples' `dist/zabloo.ir.json` into
`examples/unity-playground/Assets/StreamingAssets/`. Run it before opening the
playground: without the binary, every `DllImport` fails at the first call.

### Every platform

The package ships one binary per platform, and CI builds all five on every
pull request (the `unity-plugin` job of `.github/workflows/ci.yml`) — each in
its slot under `Runtime/Plugins/`, `.meta` included, uploaded as
`zabloo-unity-plugin-<platform>`:

| Platform | Built with | Slot | Status |
|---|---|---|---|
| macOS, universal (x86_64 + arm64) | `scons capi arch=universal` on macOS | `macOS/libzabloo.dylib` | supported |
| Windows x64 | `scons capi` on Windows (MSVC) | `Windows/x86_64/zabloo.dll` | supported |
| Linux x64 | `scons capi` on Linux | `Linux/x86_64/libzabloo.so` | supported |
| Android arm64-v8a | `scons capi platform=android` (the NDK) | `Android/arm64-v8a/libzabloo.so` | **compiles; not run on a device** |
| iOS arm64 | `scons capi platform=ios` (Xcode) | `iOS/libzabloo.a`, linked in (`__Internal`) | **compiles; not run on a device** |

A cross-compile builds the `capi` target and nothing else, and leaves its
library under `core/bin/<platform>/` so the host's `libzabloo.a` can never be
mistaken for iOS's; `scons install platform=<name>` in this directory puts it
in its slot. Android needs `ANDROID_NDK_ROOT` (or `ANDROID_HOME` with an
`ndk/` inside — the newest is used); iOS needs Xcode, not just the Command
Line Tools. Android and iOS are in the same basket as the Godot addon's
(ZAB-193): the toolchains are exercised on every PR so they cannot rot, and a
device is where the milestone's final review of the four targets validates
them. Consoles compile — the core is C++17 and nothing else — and are not
validated.

The universal dylib carries a `-mmacosx-version-min=10.15` for its x86_64
slice; the arm64 slice starts at 11.0, as every arm64 Mac does. The Android
library statically links libc++ (Unity ships no `libc++_shared.so` next to a
plugin) and is built for 16 KB pages, which Android 15 requires.

## IL2CPP

**IL2CPP is a requirement, not an option.** An interop that works under Mono
in the editor and falls over under AOT is the failure that otherwise waits for
the console build, so the check is a real player — macOS and Windows, Scripting
Backend IL2CPP, Managed Stripping Level *High* — built from the playground,
whose `ProjectSettings` already say so for Standalone. What makes the interop
AOT-safe, and where each point is held:

- **No callbacks.** The C ABI hands nothing back into managed code: actions,
  data changes and diagnostics are *drained* after the frame (`Flush()`), so
  there is no `Marshal.GetDelegateForFunctionPointer`, no
  `[MonoPInvokeCallback]`, and no static-delegate rule to forget. This is by
  design of the ABI (UN2), not a discipline of the adapter.
- **Blittable structs.** Every ABI struct in `NativeMethods.cs` is
  `[StructLayout(Sequential)]` with blittable fields; `zb_abi_sizes()` reports
  the native `sizeof` of each and the golden suite in Unity (UN10) asserts them
  against `Marshal.SizeOf`, so a drifted field fails before any envelope does.
- **No exceptions cross.** The core never throws (a refused payload is a return
  value and a diagnostic); the C# never throws into it.
- **Stripping.** `Runtime/link.xml` preserves the interop namespace whole.
  Reached only through `DllImport` stubs, a struct the linker cannot prove
  reachable is fair game at *High*, and losing one is a
  `MissingMethodException` in the player and nothing in the editor. A few
  kilobytes buys the one way a build could differ from Play mode.
- **The iOS archive does not break a desktop build.** Its `.meta` restricts
  `libzabloo.a` to iOS; the desktop players never see it.

### Building the players

Unity does not run in CI (see `docs/releasing.md` › *Unity in CI*), so this is
done by hand on a machine with the editor and the IL2CPP module installed:

```sh
# 1. Both halves of the package, then the playground.
cd core && scons capi arch=universal target=release   # or plain `scons capi` on Windows
cd ../sdk/unity && scons install
# 2. Open examples/unity-playground; File › Build Settings › Build to build/<platform>/.
#    The project already selects IL2CPP + High stripping for Standalone.
```

What the player has to do, and what it means if it does not:

| Check | It passes when | If not |
|---|---|---|
| It starts on `settings-screen` | The screen paints; the log has no `DllNotFoundException`, `EntryPointNotFoundException` or `MissingMethodException` | The plugin is not in its slot, or its `.meta` excludes this platform; a `Missing…` names a stripped member — `link.xml` |
| **E** cycles the examples, **R** reloads | All five load; the log says `loaded` | A refused envelope is a diagnostic, not a crash |
| Actions and values reach the log | Enter on the autofocused button logs `action: …`; a toggle logs `settings.sfx = …` | The drain is broken: `Flush()` |
| A controller drives it | D-pad walks the focus, A activates, B closes the dropdown | UN6's PlayMode suite, in the editor |
| Nothing differs from Play mode | The same screen, the same log lines | An IL2CPP-only failure: file it with the player's log |

Both platforms are in the criterion because their loaders differ — the
Windows player resolves `zabloo.dll` by name where macOS loads the dylib by
path — and a plugin `.meta` wrong for one of them looks fine on the other.

## The bench

`examples/unity-playground` has the same two instruments as the Godot
playground (G15): **B** toggles a HUD with the engine's frame next to the
core's counters, and a player launched with `-zabloo-bench` walks the
examples, warms each one up, measures it and prints one line per screen:

```sh
# macOS: the log on stdout. Windows: `-logFile bench.log`.
build/macos/unity-playground.app/Contents/MacOS/unity-playground -zabloo-bench -logFile -
```

The numbers, and what they mean, are in
[`docs/performance.md`](../../docs/performance.md) › *In a real engine*. The
same document holds the budgets CI asserts on the core, which are the Unity
adapter's too: what the core counts does not change by crossing the C ABI.

`Tests/PlayMode/AllocationTests.cs` is the managed side of the same promise: a
steady frame — one that runs the whole pipeline, and one that skips it —
leaves the heap where it was. It is what catches a `new` per batch slipping
into the render layer months from now.

## Install it in a game

Until it is released (UN11 — a `.tgz` on the GitHub Release, versioned with the
`@zabloo/*` packages), reference it by path from `Packages/manifest.json`:

```json
"com.zabloo.sdk": "file:../../path/to/ui/sdk/unity"
```

Then add a **Zabloo View** component to a `RectTransform` under a `Canvas`.
The component's inspector takes the envelope (a `TextAsset`) and the view id;
the game talks to it through `LoadEnvelope`, `SetData`, `OnAction` and
`OnDataChanged` — the host channel, spelled for C# in
[`docs/format/host-channel.md`](../../docs/format/host-channel.md#unity-spelling)
and documented member by member in `ZablooView.Host.cs`. A game can load,
push data, drive controls by id, hear the actions and values that produces,
and the player can use the view with a mouse, a finger and a keyboard; the
gamepad is UN6.

## Input

The view reads the **Input System** devices directly — `Pointer.current`,
`Mouse.current`, `Keyboard.current` — and never UGUI's `EventSystem`: it is not
a `Selectable`, raycasts nothing, and needs no `EventSystem` in the scene at
all (the playground has none). Two things follow for a project that has one:

- **Active Input Handling** in *Player Settings* has to be *Input System
  Package* or *Both*. With only the legacy Input Manager active, the devices
  are null and the view sees no input.
- If the project navigates its own UI with the `EventSystem`, it must not
  send navigation events while a view owns the keyboard, or the arrows are
  eaten before the view sees them:

  ```csharp
  EventSystem.current.sendNavigationEvents = false;
  ```

Keyboard and gamepad belong to the **process** and have one owner among the
views alive — the first one, until the player touches another; the pointer is
per view by construction. Everything a key or a finger does inside the view
(focus, caret, selection, a drag that becomes a scroll) is decided by the
native core; the C# only reads the device and hands it intentions.

**Escape** asks the top modal to close. Unity has no event to accept or let
through, so whether that Escape was the view's is a property,
`view.EscapeConsumedThisFrame` — read it in `LateUpdate`, after the view's
`Update`, before opening the game's own pause menu on the same key.

The **mouse wheel** scrolls 50 view pixels per notch (the Godot adapter's
constant), whatever units the platform reports; a vertical wheel does not move
a horizontal-only scroller, in every target alike. Text enters through
`onTextInput` (dead keys and modifiers already applied), the clipboard through
`GUIUtility.systemCopyBuffer` (a paste is clipped to `maxLength` like anything
typed), IME composition through `onIMECompositionChange`, and a phone's
on-screen keyboard through `TouchScreenKeyboard` while a text field has the
focus.

## Dev mode

**Zabloo → Dev Mode** in the editor's menu makes the editor listen on
`127.0.0.1:5077` for what `zabloo dev --unity` (or `pnpm dev:unity` in a
scaffolded project) pushes on every save. The setting is remembered across
sessions; the listener is not — a domain reload or quitting stops it, and the
next load starts it again if the box is checked.

It lives in the editor, the opposite of the Godot addon, and for the mirror
reason: Godot's Run launches another process, so its receiver had to be in the
game; here the game runs inside the editor, and the envelope is an imported
asset besides. So a push brings two things up to date — the `.json` asset each
`ZablooView` in the scene references (rewritten and reimported, so edit mode
and the next Play open on the last export) and, while playing, every live view
(`Reload`, the hot-update path: data the game pushed with `SetData` survives).
Entering Play with dev mode on turns `Application.runInBackground` on, or the
push would wait for the editor to regain focus before painting.

The push is thin — the tree without its asset bytes — and the editor fetches
only the content hashes it does not already hold from the CLI's preview
server, so an image is transferred once however many saves follow. A second
editor with dev mode on finds the port taken and says so; the
`Zabloo.DevMode.Port` editor pref moves it, together with `--unity-port` on
the CLI side. The rules that decide what is fetched and what is kept
(`Editor/DevPush.cs`) run in `Tests/Editor/DevPushTests.cs` without the
listener around them.

## The playground

[`examples/unity-playground`](../../examples/unity-playground) references this
package by path and opens on a `Canvas` with one view. It is where the adapter
is checked against a real engine, which is the half of the work the golden
corpus deliberately does not cover.
