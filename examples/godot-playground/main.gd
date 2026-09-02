extends Control

## Stands in for the game.
##
## Everything a real integration does is here, and it is the whole game↔UI
## coupling surface of v1: named actions out, data in, plus the by-id operations
## that ARE the player's gesture. The same surface on every engine — only the
## spelling follows Godot's conventions (snake_case, and the callbacks are
## signals).

## The envelope `examples/showcase` exports. Read from OUTSIDE the project on
## purpose: copying it in would leave the playground rendering a stale build of
## the example it exists to show.
const ENVELOPE := "../showcase/dist/zabloo.ir.json"
## The view that exercises what G8 landed: the four curves side by side, a bar
## that tweens its VALUE, the Spinner's wave, a Collapse animating its own height
## and buttons whose states cross-fade.
const VIEW := "motion"

@onready var _view: ZablooView = $Zabloo
@onready var _log: Label = $Log

var _gold := 1200
var _progress := 0.1
var _collapsed := false


func _ready() -> void:
	_view.action.connect(_on_action)
	_load()


func _load() -> void:
	var here := ProjectSettings.globalize_path("res://")
	var path := here.path_join(ENVELOPE).simplify_path()
	if not _view.load_file(path):
		_log.text = "could not load %s\n%s" % [path, "\n".join(_view.get_diagnostics())]
		return
	# Said out loud, because the envelope is multi-view and loading it only shows
	# the first one: without this the constant above would be a comment.
	_view.show_view(VIEW)
	_view.action.connect(_on_action)
	# The return leg of the data channel: a control writing its own value tells
	# the game through this, whether the player moved it or `set_checked` did.
	_view.data_changed.connect(_on_data_changed)
	# The game's state, pushed whenever it has it. Bound props read it: the gold
	# label shows it, and `shop.thanked` decides whether its row is in the layout
	# at all.
	_view.set_data("player.gold", _gold)
	_view.set_data("player.hp", 0.7)
	_view.set_data("shop.thanked", false)
	_view.set_data("demo.progress", 0.1)
	_view.set_data("inbox.unread", 3)
	# The two text fields of the `controls` view (key 1). Pushed like any other
	# state: a field's `value` is a read/write binding, so this seeds it and
	# typing into it comes back on `data_changed`.
	_view.set_data("profile.name", "Sergi")
	_view.set_data("ui.search", "")
	_log.text = "loaded %s — arrows navigate, Enter presses, SPACE races the bars" % path.get_file()


## Reload and view switching, by hand.
##
## `_load` is the production hot-update path (`load_file` → `load_envelope` →
## the core's one loader), so pressing R after re-exporting the example is the
## same swap a platform push performs — which is what makes it worth having
## here: it is how you watch an image survive a reload by its content hash, and
## a removed one release its texture. Doing it ON SAVE is `zabloo dev --godot`,
## which is G14 (ZAB-147).
func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.is_pressed() and not event.is_echo()):
		return
	if event.keycode == KEY_R:
		_load()
		return
	# The motion view's two hosts of a tween. SPACE races the four curves against
	# each other from one `set_data`, which is the whole "no trigger list" rule in
	# one keypress: nothing here mentions animation, the value simply moved. C
	# drives the Collapse through the host channel instead of through a tap, so
	# the same height tween runs whoever asked for it.
	if event.keycode == KEY_SPACE:
		_progress = 0.9 if _progress < 0.5 else 0.1
		_view.set_data("demo.progress", _progress)
		_view.set_data("player.hp", _progress)
		_log.text = "demo.progress = %.1f" % _progress
		return
	if event.keycode == KEY_C:
		_collapsed = not _collapsed
		_view.set_open("animated-collapse", _collapsed)
		_log.text = "collapse %s" % ("open" if _collapsed else "closed")
		return
	var views := ["controls", "layout", "lists", "media", "motion", "navigation",
		"overlays", "theming", "typography"]
	var index: int = event.keycode - KEY_1
	if index >= 0 and index < views.size():
		_view.show_view(views[index])
		_log.text = "view: %s" % views[index]


func _on_action(name: String, context: Dictionary) -> void:
	print("[zabloo] action: ", name, context)
	match name:
		"buy":
			# Buying costs gold and earns a thank-you: two data writes, and the
			# UI re-lays itself out around both.
			_gold -= 100
			_view.set_data("player.gold", _gold)
			_view.set_data("shop.thanked", true)
			_log.text = "bought — gold is now %d" % _gold
		"quit":
			_log.text = "quit"
		_:
			_log.text = "action: %s" % name


func _on_data_changed(path: String, value: Variant) -> void:
	print("[zabloo] data_changed: ", path, " = ", value)
	_log.text = "%s = %s" % [path, value]
