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
| `Runtime/ZablooView.Render.cs`, `Runtime/Render/`, `Runtime/Shaders/` | UN4 | `Paint()` — one `CanvasRenderer` per clip group with a submesh per batch, the core's arrays uploaded as `NativeArray` views, glyph atlases and images as textures, and the `Zabloo/Canvas` shader that clips by SDF |
| `Runtime/ZablooView.Pointer.cs`, `.Keyboard.cs` | UN5 | `PollPointer()`, `PollKeyboard()` |
| `Runtime/ZablooView.Pad.cs` | UN6 | `PollPad()` |

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

## The playground

[`examples/unity-playground`](../../examples/unity-playground) references this
package by path and opens on a `Canvas` with one view. It is where the adapter
is checked against a real engine, which is the half of the work the golden
corpus deliberately does not cover.
