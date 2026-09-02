extends Control

## Stands in for the game.
##
## Everything a real integration does is here, and it is the whole game↔UI
## coupling surface of v1: named actions out, data in, plus the by-id operations
## that ARE the player's gesture. The same surface on every engine — only the
## spelling follows Godot's conventions (snake_case, and the callbacks are
## signals).

## The examples this playground can show, and the view each one opens on.
##
## Read from OUTSIDE the project on purpose: copying them in would leave the
## playground rendering a stale build of the very examples it exists to show.
##
## Two rather than one because each G# ticket needs its own thing on screen, and
## rotating a single constant per ticket kept destroying the last one's way of
## checking itself. `settings-screen` is the F5 catalog — tabs, checkboxes,
## switches, radios and sliders — and `showcase`'s `motion` view is what G8 left
## here: four curves racing, a bar that tweens its VALUE, the Spinner's wave.
const SOURCES := [
	{"path": "../settings-screen/dist/zabloo.ir.json", "view": "settings"},
	{"path": "../showcase/dist/zabloo.ir.json", "view": "motion"},
]

@onready var _view: ZablooView = $Zabloo
@onready var _log: Label = $Log

var _source := 0
var _gold := 1200
var _progress := 0.1
var _volume := 60.0
var _collapsed := false


func _ready() -> void:
	# Connected ONCE. `_load` is also what R re-runs, and Godot errors on a signal
	# connected twice — so a reload used to cost an error and a doubled callback.
	_view.action.connect(_on_action)
	# The return leg of the data channel: a control writing its own value tells
	# the game through this, whether the player moved it or `set_value` did.
	_view.data_changed.connect(_on_data_changed)
	_load()


func _load() -> void:
	var source: Dictionary = SOURCES[_source]
	var here := ProjectSettings.globalize_path("res://")
	var path := here.path_join(source["path"]).simplify_path()
	if not _view.load_file(path):
		_log.text = "could not load %s\n%s" % [path, "\n".join(_view.get_diagnostics())]
		return
	# Said out loud, because an envelope is multi-view and loading it only shows
	# the first one: without this the table above would be a comment.
	_view.show_view(source["view"])
	# The game's state, pushed whenever it has it. Bound props read it — and the
	# controls WRITE back into these same paths, which is what `_on_data_changed`
	# below is listening to.
	_view.set_data("player.gold", _gold)
	_view.set_data("player.hp", 0.7)
	_view.set_data("shop.thanked", false)
	_view.set_data("demo.progress", 0.1)
	_view.set_data("inbox.unread", 3)
	_view.set_data("settings.volume", _volume)
	_view.set_data("settings.music", 30)
	_view.set_data("settings.brightness", 0.5)
	_view.set_data("settings.sfx", true)
	_view.set_data("settings.subtitles", false)
	_view.set_data("settings.hints", true)
	_view.set_data("settings.fullscreen", true)
	_view.set_data("settings.quality", "high")
	_view.set_data("settings.language", "en")
	_view.set_data("profile.name", "Nova")
	_log.text = "%s — arrows navigate, Enter presses, E swaps example" % path.get_file()


## Reload, example swapping and view switching, by hand.
##
## `_load` is the production hot-update path (`load_file` → `load_envelope` →
## the core's one loader), so pressing R after re-exporting an example is the
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
	if event.keycode == KEY_E:
		_source = (_source + 1) % SOURCES.size()
		_load()
		return
	# Two ways of moving a control WITHOUT touching it, so the by-id operations
	# can be seen doing exactly what the player's gesture does. V drives the
	# volume slider — the value glides to where it was pushed while a drag would
	# have snapped, and `onCommit` fires either way — and C drives the Collapse.
	if event.keycode == KEY_V:
		_volume = 0.0 if _volume > 50.0 else 100.0
		_view.set_value("volume", _volume)
		_log.text = "set_value volume = %.0f" % _volume
		return
	if event.keycode == KEY_C:
		_collapsed = not _collapsed
		_view.set_open("animated-collapse", _collapsed)
		_log.text = "collapse %s" % ("open" if _collapsed else "closed")
		return
	# The motion view's other host of a tween: SPACE races the four curves against
	# each other from one `set_data`, which is the whole "no trigger list" rule in
	# one keypress — nothing here mentions animation, the value simply moved.
	if event.keycode == KEY_SPACE:
		_progress = 0.9 if _progress < 0.5 else 0.1
		_view.set_data("demo.progress", _progress)
		_view.set_data("player.hp", _progress)
		_log.text = "demo.progress = %.1f" % _progress
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
