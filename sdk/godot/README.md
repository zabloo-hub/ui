# sdk/godot

The Godot adapter: a **GDExtension in C++** whose C++ *is* the shared core
(decision 2026-08-24). Everything in `src/` is translation — upload the core's
triangles through `canvas_item_add_triangle_array`, turn `InputEvent` into the
core's intentions, expose the results as Godot signals. Layout, text,
tessellation and the loader are all in [`core/`](../../core).

**Godot 4.4 or newer.** The extension is compiled against the 4.4 API and
GDExtension is binary-compatible forward inside 4.x, so the same build loads in
4.5, 4.6 and 4.7.

## Build

```sh
git submodule update --init --recursive   # godot-cpp, pinned to the 4.4 branch
scons                                     # debug build for this platform
scons target=template_release
scons target=template_release platform=web   # experimental — see below
scons install                             # copy the addon into the playground
```

The first build compiles `godot-cpp` and takes a few minutes; the ones after it
do not. Objects land under `obj/`, including the core's: SCons would otherwise
leave them next to their sources in `core/src/`, where that build keeps its own.

`node ../../scripts/pack-addon.mjs --allow-partial` zips what is in
`addons/zabloo/` the way a release does, so a local build can be installed as
an addon rather than only run from the playground. Without the flag it refuses
to pack a zip missing any platform the `.gdextension` names — which is what a
real release wants and a local build never has. How one is published:
[`docs/releasing.md`](../../docs/releasing.md#the-godot-addon).

**Web is experimental** (2026-08-24, Decision 4) and needs more than a flag: the
export has to use Godot's `dlink` templates (Web preset → *Extensions Support*),
and the extension has to be built with an Emscripten whose libc++ matches the one
those templates were built with. A newer one links fine and then aborts at load
on a symbol the main module does not export.
[`docs/performance.md`](../../docs/performance.md) records what that check found.

## Install it in a game

Download **`zabloo-godot-addon-<version>.zip`** from the
[latest release](https://github.com/zabloo-hub/ui/releases) and unzip it at
the root of the project, so that `addons/zabloo/` sits next to
`project.godot`. Then enable **Zabloo UI** in **Project → Project Settings →
Plugins**: that is what loads the extension, registers the `ZablooView` node
and installs the `ZablooDevMode` autoload. The game wires nothing else.

The zip carries a binary for every supported platform and **both** build
targets — the editor is a debug build, so a release-only install has no
`ZablooView` in the Add Node dialog. A `scons` build of your own carries only
the one you asked for, which is why a source install can show the node in one
configuration and not in another.

## Use it in a game

```gdscript
@onready var ui: ZablooView = $ZablooView

func _ready() -> void:
    ui.load_file("res://ui/zabloo.ir.json")   # what `zabloo export` wrote
    ui.action.connect(_on_action)
    ui.set_data("player.gold", 1200)

func _on_action(name: String, context: Dictionary) -> void:
    if name == "buy":
        buy_something()
```

That is the whole game↔UI coupling surface of v1: **named actions out, data in**.

`load_file` never fails loudly — a payload the core refuses leaves whatever is on
screen exactly where it was, and says why in `get_diagnostics()`. That is what
makes a corrupt hot-update cost the update and not the session.

## The dev loop

Enabling the addon registered the `ZablooDevMode` autoload, and that is the
whole installation — the game wires nothing, exactly as it wires nothing for
the gamepad. Then, in the authoring project:

```sh
zabloo dev --godot     # or `pnpm dev:godot`
```

Press Play. Every save re-exports and hot-swaps every `ZablooView` in the running
scene, through `reload` — the same one loading path a platform hot-update takes,
so the data the game pushed survives it (the store lives on the document).

The receiver listens on `127.0.0.1:5079` in **debug builds only**: a dev channel a
shipped game could open is a dev channel a player's machine could be talked to
through. `zabloo/dev_mode/port` in the project settings moves it, and
`zabloo dev --godot-port` moves the other end.

The push carries the envelope **without its asset bytes**, plus the address they
can be fetched from. The game asks for the content hashes it does not already
hold and keeps them, so a project with megabytes of PNGs still moves a few KB per
save and an image is transferred exactly once — the transport ZAB-14 built for the
web preview, with the engine as its second consumer. What reaches the loader is
always a complete envelope.

Not the editor, on purpose: Godot's `Run` launches a separate process, so the
thing with a live view to swap is the game. A project that is not running needs no
syncing either — `load_file` reads the exported JSON off disk when it starts, so
it already opens on the last export. (That is what Unity had to simulate with
`AssetDatabase.ImportAsset`.)

## Status

Every node type of the catalog renders, and every case of the golden corpus
reproduces its recorded metrics byte for byte — glyphs come from our own
rasterizer over the TTF the core embeds, never from Godot's `TextServer`, which is
what makes a line break in the same place here and in the web renderer. See
[the playground's README](../../examples/godot-playground/README.md) for how to
check each capability by hand.
[`docs/performance.md`](../../docs/performance.md) has what a frame costs, on this
target and on the web renderer beside it.
