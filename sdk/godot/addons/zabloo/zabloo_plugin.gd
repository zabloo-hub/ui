@tool
extends EditorPlugin

## Editor-side conveniences for the Zabloo addon.
##
## GDScript on purpose, and only here: it is the right language for a panel with
## no hot loop in it, and the wrong one for layout, text and tessellation, which
## run per frame over every node and live in the C++ core (2026-08-24).
##
## `ZablooView` itself is registered by the GDExtension, not by this plugin, so
## the node exists whether or not the plugin is enabled. What the plugin adds is
## the editor integration — today a line in the log, from G14 (ZAB-147) the dev
## mode that receives `zabloo dev --godot` pushes.


func _enter_tree() -> void:
	print("[zabloo] addon enabled — add a ZablooView node and point it at an exported envelope")


func _exit_tree() -> void:
	pass
