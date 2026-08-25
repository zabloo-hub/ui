extends Control

## Stands in for the game.
##
## Everything a real integration does is here and it is three lines long: point
## the view at an exported envelope, listen for named actions, push data back.
## That is the whole game↔UI coupling surface of v1 — named actions out, data in
## — and it is the same surface on every engine.

## The envelope `examples/hello-button` exports. Read from OUTSIDE the project on
## purpose: copying it in would leave the playground rendering a stale build of
## the example it exists to show.
const ENVELOPE := "../hello-button/dist/zabloo.ir.json"

@onready var _view: ZablooView = $Zabloo
@onready var _log: Label = $Log


func _ready() -> void:
	var here := ProjectSettings.globalize_path("res://")
	var path := here.path_join(ENVELOPE).simplify_path()
	if not _view.load_file(path):
		_log.text = "could not load %s\n%s" % [path, "\n".join(_view.get_diagnostics())]
		return
	_view.action.connect(_on_action)
	# The data channel. The bound `Text` nodes start reading it in G7 (ZAB-140);
	# until then this proves the cache survives a reload, which is what makes a
	# hot-update keep the state the game already pushed.
	_view.set_data("player.gold", 1200)
	_view.set_data("player.hp", 0.7)
	_log.text = "loaded %s — press Buy" % path.get_file()


func _on_action(name: String, context: Dictionary) -> void:
	print("[zabloo] action: ", name, context)
	_log.text = "action: %s" % name
