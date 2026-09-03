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
## the editor integration — today, the dev mode that receives `zabloo dev --godot`
## pushes (G14, ZAB-147).
##
## The dev mode itself does NOT run in the editor: Godot's `Run` launches a
## separate process, so the thing that has a live view to hot-swap is the game.
## What the plugin does is register the receiver as an autoload, which is why
## enabling the addon is the whole installation — a game wires nothing, exactly
## as it wires nothing for the gamepad.

const AUTOLOAD_NAME := "ZablooDevMode"
const AUTOLOAD_PATH := "res://addons/zabloo/zabloo_dev_mode.gd"


func _enter_tree() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)
	print("[zabloo] addon enabled — add a ZablooView node and point it at an exported envelope")
	print("[zabloo] dev mode installed: run `zabloo dev --godot` and press Play")


func _exit_tree() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)
