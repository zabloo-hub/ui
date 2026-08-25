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
scons install                             # copy the addon into the playground
```

The first build compiles `godot-cpp` and takes a few minutes; the ones after it
do not.

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

This is the chassis (G2). `Container`, `Button` and implicit paint render; the
rest of the catalog arrives capability by capability and degrades until it does —
see [the playground's README](../../examples/godot-playground/README.md) for what
is missing and which ticket closes it.
