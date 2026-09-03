# unity-playground

The smallest Unity project that hosts a zabloo view, used to check the Unity
adapter (`sdk/unity`) against a real engine — the half of the work the golden
corpus deliberately does not cover (the corpus runs the core on a bare CPU, with
no engine and no GPU). It is the Unity counterpart of
[`godot-playground`](../godot-playground/README.md).

**Status: scaffold (F12, UN3), with the gamepad wired (UN6).** The scene opens
and compiles; nothing renders yet. The adapter's rendering, pointer/keyboard and
host channel land in UN4, UN5 and UN7, each one adding what it can be checked
for here.

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

## Checking UN6 by hand

The half of the gamepad that the corpus cannot see (it runs the core with no
device), and that `Tests/PlayMode/PadTests.cs` covers with a synthetic pad:
which device, which button, when to look, and who owns the input. Plug a
controller in — nothing has to be wired: the adapter reads `Gamepad.current`
through the Input System's standard layout, and everything it produces goes
through the handlers the keyboard already uses. Needs UN7 (the host channel)
merged, or `LoadEnvelope` is still a stub and there is nothing to navigate.

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
other and the pad follows the touch — the keyboard with it, once UN5 lands. The
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
