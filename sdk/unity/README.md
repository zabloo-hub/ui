# sdk/unity

The Unity adapter. It is a UPM package, `com.zabloo.sdk`, whose C# does only
what an adapter does: hand the shared native core a rect, a clock and the
player's input, upload the triangles it returns, and expose actions and data
the way a C# game expects them. Layout, text, tessellation and the whole
runtime live in [`core/`](../../core), reached through its C ABI
(`core/capi/`) as a native plugin — the same core, verbatim, that Godot runs.
Every node type of the catalog renders, and the golden corpus reproduces its
metrics byte for byte through the ABI and through a real `ZablooView` (see
[Status](#status) for what has and has not been checked on a machine with
Unity).

This is **not** the C# port that was cancelled at 4 of 13 node types
(2026-08-24); that one is in the history (`git log -- sdk/unity`, before
ZAB-196) and does not come back. The
[decision](../../docs/internal/decisions-architecture.md) and the plan explain
the shape; the table says which ticket wrote what.

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
| `Tests/Golden/` | UN10 | The golden corpus replayed from inside Unity: `GoldenTests` (PlayMode), the case reader and the diff |
| `Tests/AbiSizeTests.cs` | UN10 | `zb_abi_sizes` against `Marshal.SizeOf` of every struct in `NativeMethods.cs` |

**Unity 2022.3 LTS or newer**, with the Input System package (a dependency of
this one). It has to open in Unity 6 unchanged as well — that is the rule the
playground checks.

## Tests

`Tests/` is one test assembly (`Zabloo.Sdk.Tests`, both tabs of
`Window › General › Test Runner`) plus an EditMode-only one for the JSON
round trip. What runs where, and what each needs:

| Suite | Tab | Needs the plugin | What it settles |
|---|---|---|---|
| `RenderTests` | EditMode | no | The shader compiles on this GPU; a mesh takes the core's vertex layout |
| `Tests/Editor/JsonTests` | EditMode | no | The data channel's JSON under `es-ES` |
| `Tests/Editor/DevPushTests` | EditMode | no | The pure half of the dev-mode receiver (UN8): what a push carries and which assets are missing |
| `GoldenDiffTests`, `PadMappingTests`, `InputOwnerTests` | either | no | Pure rules: the diff's format, the pad's translation table, who owns input |
| `AbiSizeTests` | either | **yes** | `zb_abi_sizes` against `Marshal.SizeOf` of every struct in `NativeMethods.cs` — the first thing to run against a freshly built plugin: a field missing, mistyped or misaligned on either side of the C ABI changes a struct's size before it changes any corpus metric |
| `GoldenTests` | PlayMode | **yes** | The **golden corpus from inside Unity** (UN10): every case of `golden/cases.json` staged through a real `ZablooView` on a `Canvas` — the viewport, `SetData` through the public API, the clock planted, the pad script replayed on an `InputTestFixture` gamepad — and its `Snapshot()` compared **byte for byte** with `golden/metrics/`; `future-major` refused with its code |
| `KeyboardInputTests`, `PadTests` | PlayMode | **yes** | Sequences a snapshot cannot record: a press and its release, a clipped paste, a held direction, an unplugged pad |
| `AllocationTests` | PlayMode | **yes** | A steady frame allocates nothing (UN9) — the managed side of the core's `buffer_growths == 0` |

The corpus already passes in the core (`scons test golden`) and through the C
ABI alone (`scons test capi`); `GoldenTests` is the third run of the same
contract, and the only one that sees the adapter's plumbing — the size it hands
the core, the clock, how a value is marshalled, how the pad snapshot is filled.
A case that reproduces there means the boundary did not change the answer; one
that does not names the path inside the snapshot, the `ref` of the node and both
values, the same report the core's runner prints:

```
flex-layout does not reproduce golden/metrics/flex-layout.json
    tree.children[1].rect.width (ref "row-gap"): expected 128, actual 132
```

A suite that needs the plugin is **ignored**, with the command to install it,
when it is missing — never red for a `DllImport` that could not resolve. From
the command line, against the playground:

```sh
cd core && scons capi && cd ../sdk/unity && scons install
Unity -batchmode -projectPath examples/unity-playground \
      -runTests -testPlatform PlayMode -testResults results.xml
```

**Not in CI.** Running tests inside Unity needs a licensed editor on the runner;
CI compiles the plugin per platform and runs the corpus through the C ABI
instead. These suites run in the editor and locally, and this table says so
rather than pretending coverage that is not there.

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

**From a release.** Download `com.zabloo.sdk-<version>.tgz` from the
[Releases](https://github.com/zabloo-hub/ui/releases) page (the tag is
`unity-sdk@<version>`; the version is the one the `@zabloo/*` packages carry)
into the project — `Packages/` is the usual place — and add it to
`Packages/manifest.json` by path, or use **Window → Package Manager → + → Add
package from tarball…**, which writes the same line:

```json
"com.zabloo.sdk": "file:com.zabloo.sdk-0.2.0.tgz"
```

The tarball is the package as checked in here plus a native core in every
slot of `Runtime/Plugins/` — macOS universal, Windows x64, Linux x64, Android
arm64-v8a and iOS — each beside the `.meta` that restricts it to its
platform. The Input System package is a dependency and comes with it.
**Unity 2022.3 LTS or newer**, and it has to open in Unity 6 unchanged — that
is the rule the playground checks. Two settings the editor asks for once:
**Active Input Handling** must be *Input System Package* or *Both*, and a
player build wants **Scripting Backend = IL2CPP** (§ *IL2CPP*).

**From this checkout** — to work on the adapter, or before a release exists —
reference the directory by path instead, after putting a native core in it
(§ *Build locally*):

```json
"com.zabloo.sdk": "file:../../path/to/ui/sdk/unity"
```

Either way, then add a **Zabloo View** component to a `RectTransform` under a
`Canvas`. The component's inspector takes the envelope (`dist/zabloo.ir.json`
imported as a `TextAsset`) and the view id; the game talks to it through
`Load`/`LoadEnvelope`, `SetData`, `OnAction` and `OnDataChanged` — the host
channel, spelled for C# in
[`docs/format/host-channel.md`](../../docs/format/host-channel.md#unity-spelling)
and documented member by member in `ZablooView.Host.cs`. A game can load, push
data, drive controls by id, hear the actions and values that produces, and the
player can use the view with a mouse, a finger, a keyboard and a gamepad.
[Getting started §6](../../docs/getting-started.md#unity) is the walk-through;
[Troubleshooting › In Unity](../../docs/troubleshooting.md#in-unity) the sharp
edges.

A change to the native binary needs an **editor restart**: Unity never unloads
a native plugin once a `DllImport` has resolved.

### How it is packed

`scripts/pack-upm.mjs` at the repo root builds the tarball the release carries
(the **Unity SDK** workflow runs it after compiling the core for every
platform): it stages this directory without `SConstruct` and the dotfiles,
stamps `package.json` with the `@zabloo/*` version, drops each platform's
binary and `.meta` into its slot, and runs `npm pack`. Which slots exist is
read from the `PLATFORMS` table of the `SConstruct` here — the same table
`scons install` writes the `.meta` files from — and a slot that was not built
fails the pack rather than shipping a platform that silently has no SDK. The
ritual around it is in [`docs/releasing.md`](../../docs/releasing.md#the-unity-package).

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

## Status

Every node type of the catalog renders, and every case of the golden corpus
reproduces its recorded metrics byte for byte — twice over: through the C ABI
alone on every PR (`scons test capi`, on Linux, macOS and Windows), and through
a real `ZablooView` on a `Canvas` in `GoldenTests` (§ *Tests*). Glyphs come
from our own rasterizer over the TTF the core embeds, never from TextMeshPro
or the engine's text, which is what makes a line break in the same place here
and in the web renderer.

What has been checked **where**, honestly, because the machine that wrote most
of this adapter had no Unity on it and the corpus cannot see an engine:

| | Checked | How |
|---|---|---|
| The core, the C ABI, the JSON channel, the pad translation, the dev-push rules | **in CI, every PR** | `core-tests`, `capi-tests`, and the pure NUnit suites |
| The adapter's plumbing end to end (size → core → `SetData` → clock → pad → `Snapshot`) | **yes, without Unity** | the PlayMode suites driven against the real plugin through a shim of `UnityEngine` |
| The plugin builds for the five platforms | **in CI, every PR** | `unity-plugin` in `ci.yml` |
| The editor: install from a `.tgz` in a clean project, Play, the verification scenes, the PlayMode suites in the Test Runner | **not yet run** | the procedures in [`examples/unity-playground/README.md`](../../examples/unity-playground/README.md) |
| IL2CPP players (macOS, Windows), `settings-screen` on a pad, the frame-rate table | **not yet run** | § *IL2CPP* and § *The bench*; the table's shape in [`docs/performance.md`](../../docs/performance.md) |
| Android and iOS on a device | **no** | the same basket as the Godot addon's (ZAB-193) |

The first three rows are what CI holds; the next two are one afternoon with
the editor, written down step by step so that afternoon is a checklist and not
an investigation.
