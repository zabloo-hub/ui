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

**Web is experimental** (2026-08-24, Decision 4) and needs more than a flag: the
export has to use Godot's `dlink` templates (Web preset → *Extensions Support*),
and the extension has to be built with an Emscripten whose libc++ matches the one
those templates were built with. A newer one links fine and then aborts at load
on a symbol the main module does not export.
[`docs/performance.md`](../../docs/performance.md) records what that check found.

## Use it in a game

Drop `addons/zabloo/` into your project, then:

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

## Status

**Every node type of the catalog renders**, and every case of the golden corpus
reproduces its recorded metrics byte for byte. Glyphs come from our own rasterizer
over the TTF the core embeds, never from Godot's `TextServer`, which is what makes
a line break in the same place here and in the web renderer.
See [the playground's README](../../examples/godot-playground/README.md) for what
is left and which ticket closes it, and
[`docs/performance.md`](../../docs/performance.md) for what a frame costs.
