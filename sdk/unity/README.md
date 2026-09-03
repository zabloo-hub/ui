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
| `Runtime/ZablooView.Host.cs` | UN7 | `Flush()`, the public API, the native handles — **stubs today**: every call warns and does nothing |
| `Runtime/Interop/NativeMethods.cs` | UN2 | The `DllImport` transcription of `core/capi/zabloo.h` |
| `Runtime/ZablooView.Render.cs` | UN4 | `Paint()` — one `CanvasRenderer` per clip group, our own shader |
| `Runtime/ZablooView.Pointer.cs`, `.Keyboard.cs` | UN5 | `PollPointer()`, `PollKeyboard()` — the Input System as the core's intentions; IME, on-screen keyboard, caret blink |
| `Runtime/Input/Keys.cs`, `Wheel.cs` | UN5 | The keyboard's vocabulary (slots, shortcut, hold-to-repeat, the text sink) and the wheel's 50 px per notch |
| `Runtime/ZablooView.Pad.cs` | UN6 | `PollPad()` |

**Unity 2022.3 LTS or newer**, with the Input System package (a dependency of
this one). It has to open in Unity 6 unchanged as well — that is the rule the
playground checks.

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

## Install it in a game

Until it is released (UN11 — a `.tgz` on the GitHub Release, versioned with the
`@zabloo/*` packages), reference it by path from `Packages/manifest.json`:

```json
"com.zabloo.sdk": "file:../../path/to/ui/sdk/unity"
```

Then add a **Zabloo View** component to a `RectTransform` under a `Canvas`.
The component's inspector takes the envelope (a `TextAsset`) and the view id;
the game talks to it through `LoadEnvelope`, `SetData`, `OnAction` and
`OnDataChanged`, which are declared and documented in `ZablooView.Host.cs` —
and, today, do nothing but say so.

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

## The playground

[`examples/unity-playground`](../../examples/unity-playground) references this
package by path and opens on a `Canvas` with one view. It is where the adapter
is checked against a real engine, which is the half of the work the golden
corpus deliberately does not cover.
