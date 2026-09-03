# unity-playground

The smallest Unity project that hosts a zabloo view, used to check the Unity
adapter (`sdk/unity`) against a real engine — the half of the work the golden
corpus deliberately does not cover (the corpus runs the core on a bare CPU, with
no engine and no GPU). It is the Unity counterpart of
[`godot-playground`](../godot-playground/README.md).

**Status: scaffold (F12, UN3).** The scene opens and compiles; nothing renders
yet. The adapter's rendering, input and host channel land in UN4–UN7, each one
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
path. Until UN7 lands, `LoadEnvelope` warns and returns `false`; the log line
says so.

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
