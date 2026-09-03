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
## Several rather than one because each G# ticket needs its own thing on screen,
## and rotating a single constant per ticket kept destroying the last one's way of
## checking itself. `settings-screen` is the F5 catalog — tabs, checkboxes,
## switches, radios and sliders — `showcase`'s `motion` view is what G8 left here
## (four curves racing, a bar that tweens its VALUE, the Spinner's wave) and its
## `overlays` view is G9's: a modal that dims, captures and traps the focus, a
## toast that closes itself, tooltips that ride their anchor's hover OR focus with
## flip and clamp, and a popover whose open state is the SDK's. `inventory-demo`
## is G12's: one template over an array the GAME pushes, virtualized inside the
## scroller, with per-row state that travels with its `key` when the array moves.
const SOURCES := [
	{"path": "../settings-screen/dist/zabloo.ir.json", "view": "settings"},
	{"path": "../showcase/dist/zabloo.ir.json", "view": "motion"},
	{"path": "../showcase/dist/zabloo.ir.json", "view": "overlays"},
	{"path": "../inventory-demo/dist/zabloo.ir.json", "view": "inventory"},
]

## How many rows the inventory pushes. Well past what the viewport can show, on
## purpose: the point of the example is that only the visible ones are realized.
const INVENTORY_ROWS := 400

@onready var _view: ZablooView = $Zabloo
@onready var _log: Label = $Log

## The bench HUD (G15), built from code so the scene file stays about the view.
var _bench: Label = null
var _bench_at := 0.0

## Unattended bench: `--zabloo-bench` on the command line of an EXPORT.
##
## It exists because the numbers this milestone needs — frames per second, draw
## calls actually submitted, video memory — only exist in a running engine, and
## reading them off a HUD by eye is neither reproducible nor something CI could
## ever inherit. With the flag the playground walks every example, dwells on each
## one, prints a line per example and quits.
var _auto := false
var _auto_frames := 0
var _auto_started := 0.0
var _auto_warm := false
var _auto_lines: Array[String] = []

var _source := 0
var _gold := 1200
var _progress := 0.1
var _volume := 60.0
var _collapsed := false
var _inventory_offset := 0


func _ready() -> void:
	# Connected ONCE. `_load` is also what R re-runs, and Godot errors on a signal
	# connected twice — so a reload used to cost an error and a doubled callback.
	_view.action.connect(_on_action)
	# The return leg of the data channel: a control writing its own value tells
	# the game through this, whether the player moved it or `set_value` did.
	_view.data_changed.connect(_on_data_changed)
	# Only so the playground can SAY that a pad arrived. The view starts and stops
	# its own poll loop off this very signal — a game wires nothing for the pad.
	Input.joy_connection_changed.connect(_on_joy_connection_changed)
	_build_bench_hud()
	_auto = "--zabloo-bench" in OS.get_cmdline_user_args()
	_load()
	if _auto:
		# Uncapped, or every line would read "60" and say nothing: what a budget
		# wants to know is the headroom, not that the display refreshes.
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		Engine.max_fps = 0
		_auto_restart()


## Starts the warmup on the current example, discarding the frames so far.
func _auto_restart() -> void:
	_auto_frames = 0
	_auto_warm = false
	_auto_started = Time.get_ticks_usec() / 1000000.0


## Seconds discarded before each example is measured, and seconds measured after.
##
## The warmup is not politeness: the first frames of an example are window
## creation, Vulkan pipelines and every glyph it uses being rasterized into an
## atlas for the first time. Folded into the average they made the FIRST example
## look half as fast as the rest, which says something about starting up and
## nothing about the frame.
const AUTO_WARMUP := 1.5
const AUTO_DWELL := 4.0


## The HUD B toggles: what the engine says a frame cost, next to what the core says.
##
## It exists because the two halves of a performance budget can only be read
## against each other HERE. The core counts the geometry it produced and can do it
## on a bare CPU — that is what `core/tests/test_budgets.cpp` holds a ceiling on —
## while frames per second, draw calls actually submitted and video memory are
## answers only a running engine has. Put side by side, they also say whether the
## adapter is adding calls of its own: one canvas item per clip group and one call
## per batch is the arrangement, and a scene where the two columns diverge is the
## interesting one.
##
## Meant to be read in an EXPORT and not in the editor: the editor draws its own
## viewport around this one, so its numbers include work that no player pays for.
func _build_bench_hud() -> void:
	_bench = Label.new()
	_bench.name = "Bench"
	_bench.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_bench.anchor_left = 1.0
	_bench.anchor_right = 1.0
	_bench.offset_left = -320.0
	_bench.offset_top = 12.0
	_bench.offset_right = -12.0
	_bench.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_bench.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	# It must never take the pointer: a HUD that swallowed a click would change
	# the very frame it is measuring.
	_bench.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bench.visible = false
	add_child(_bench)


func _process(_delta: float) -> void:
	if _auto:
		_auto_tick()
	if _bench == null or not _bench.visible:
		return
	# Twice a second: a label rebuilt every frame is itself work, and an fps
	# readout that flickers at 60 Hz cannot be read anyway.
	var now := Time.get_ticks_msec() / 1000.0
	if now - _bench_at < 0.5:
		return
	_bench_at = now
	_bench.text = _bench_report()


## One dwell of the unattended bench, then on to the next example.
func _auto_tick() -> void:
	var elapsed := Time.get_ticks_usec() / 1000000.0 - _auto_started
	if not _auto_warm:
		if elapsed < AUTO_WARMUP:
			return
		_auto_warm = true
		_auto_frames = 0
		_auto_started = Time.get_ticks_usec() / 1000000.0
		return
	_auto_frames += 1
	if elapsed < AUTO_DWELL:
		return
	var stats: Dictionary = _view.get_stats()
	var source: Dictionary = SOURCES[_source]
	# No CPU-time column, deliberately. Godot's `TIME_PROCESS` counts the whole
	# frame — vsync wait included — so under a display cap it reads ~16 ms for
	# every example and says nothing about the renderer. What a frame costs on the
	# CPU is measured where no engine can blur it: `scons bench` in `core/`.
	_auto_lines.append("%-28s %6.1f fps   %3d draw calls (engine %d)   %5d vertices   %2d atlases   %.1f MiB textures" % [
		"%s/%s" % [_example_of(source["path"]), source["view"]],
		_auto_frames / elapsed,
		stats.get("draw_calls", -1),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		stats.get("vertices", -1),
		stats.get("atlases", -1),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED) / 1048576.0,
	])
	if _source + 1 < SOURCES.size():
		_source += 1
		_load()
		_auto_restart()
		return
	# The vsync mode belongs in the header: with it on, an fps figure is a property
	# of the display and not of the renderer, and a reader has to know which of the
	# two they are looking at.
	var vsync := "vsync off" if DisplayServer.window_get_vsync_mode() == DisplayServer.VSYNC_DISABLED else "VSYNC ON — fps is capped by the display"
	print("[zabloo-bench] %s, %dx%d, %s, %s" % [
		OS.get_name(), get_viewport_rect().size.x, get_viewport_rect().size.y,
		RenderingServer.get_video_adapter_name(), vsync])
	for line in _auto_lines:
		print("[zabloo-bench] ", line)
	get_tree().quit()


func _bench_report() -> String:
	var lines := ["fps %d" % Engine.get_frames_per_second()]
	var info := {
		"draw calls": RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME,
		"primitives": RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME,
		"objects": RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME,
	}
	for label in info:
		lines.append("%s %d" % [label, RenderingServer.get_rendering_info(info[label])])
	var texture_bytes := RenderingServer.get_rendering_info(
		RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED)
	var video_bytes := RenderingServer.get_rendering_info(
		RenderingServer.RENDERING_INFO_VIDEO_MEM_USED)
	lines.append("texture mem %.1f MiB" % (texture_bytes / 1048576.0))
	lines.append("video mem %.1f MiB" % (video_bytes / 1048576.0))
	lines.append("")
	var stats: Dictionary = _view.get_stats()
	for key in stats:
		lines.append("%s %s" % [key, stats[key]])
	return "\n".join(lines)


func _load() -> void:
	var source: Dictionary = SOURCES[_source]
	var here := ProjectSettings.globalize_path("res://")
	var path := here.path_join(source["path"]).simplify_path()
	# An EXPORT has no repo around it — `res://` globalizes to inside the bundle,
	# so the path above resolves to nothing. A shipped game carries its envelope,
	# and so does this one when it has been packed for one: `envelopes/` is filled
	# before an export (see this project's README) and gitignored, for the same
	# reason `addons/` is — it is a copy of something built elsewhere.
	if not FileAccess.file_exists(path):
		path = "res://envelopes/%s.ir.json" % _example_of(source["path"])
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
	_view.set_data("shop.items", _inventory())
	var pads := Input.get_connected_joypads()
	var pad: String = Input.get_joy_name(pads[0]) if not pads.is_empty() else "no gamepad"
	# The pad is one more source of input (ZAB-47): the d-pad and the left stick
	# navigate, A presses, B dismisses the modal that owns the input, and the right
	# stick scrolls the ScrollView the focus is in.
	_log.text = "%s — arrows/d-pad navigate, Enter/A press, Escape (pad B) dismiss, E swaps example, B benches — %s" % [
		path.get_file(), pad]


## `../settings-screen/dist/zabloo.ir.json` → `settings-screen`.
func _example_of(source_path: String) -> String:
	return source_path.get_base_dir().get_base_dir().get_file()


## The array behind the inventory's list — the game's data, not the UI's.
##
## Every row carries the `id` the template names as its `keyPath`, which is what
## makes a row's state (its focus, its favourite checkbox, a transition in flight)
## travel with the ITEM when the array is reordered instead of staying pinned to
## the position it used to sit at.
func _inventory(offset: int = 0) -> Array:
	var tags := ["⚔", "🛡", "🏹", "🧪", "💍", "🪖"]
	var rows := []
	for i in INVENTORY_ROWS:
		var n := i + offset
		rows.append({
			"id": "item-%d" % n,
			"tag": tags[n % tags.size()],
			"name": "Item %d" % n,
			"detail": "Row %d of %d" % [n + 1, INVENTORY_ROWS],
			"price": str(10 + (n % 90)),
			"fav": n % 7 == 0,
		})
	return rows


## Reload, example swapping and view switching, by hand.
##
## `_load` is the production hot-update path (`load_file` → `load_envelope` →
## the core's one loader), so pressing R after re-exporting an example is the
## same swap a platform push performs — which is what makes it worth having
## here: it is how you watch an image survive a reload by its content hash, and
## a removed one release its texture. `zabloo dev --godot` does the same thing on
## every save, through the addon's autoload — which is why nothing about the dev
## loop appears in this file.
func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.is_pressed() and not event.is_echo()):
		return
	if event.keycode == KEY_R:
		_load()
		return
	if event.keycode == KEY_B:
		_bench.visible = not _bench.visible
		_bench_at = 0.0
		_log.text = "bench HUD %s" % ("on" if _bench.visible else "off")
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
	# The list, driven the way a game drives one: the array is pushed WHOLE and the
	# renderer reconciles it. I reverses it (every row keeps its own state and
	# moves with it), and O renumbers the ids (every row is a new item, so state
	# stays where it is). Two keys, and the difference between them is exactly
	# what declaring a `keyPath` buys.
	if event.keycode == KEY_I:
		var rows := _inventory()
		rows.reverse()
		_view.set_data("shop.items", rows)
		_log.text = "shop.items reversed — %d rows" % rows.size()
		return
	if event.keycode == KEY_O:
		_inventory_offset += INVENTORY_ROWS
		_view.set_data("shop.items", _inventory(_inventory_offset))
		_log.text = "shop.items replaced — ids from item-%d" % _inventory_offset
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
		"favourite":
			# An action from inside a row arrives with the item it fired from
			# (2026-08-11, ZAB-29): its absolute path, its raw key and its
			# position. The path is an address, so it is also what a write back
			# would go through.
			_log.text = "favourite %s (index %s)" % [context.get("key", "?"), context.get("index", "?")]
		_:
			_log.text = "action: %s" % name


func _on_joy_connection_changed(device: int, connected: bool) -> void:
	_log.text = "gamepad %d %s" % [device, "connected" if connected else "disconnected"]


func _on_data_changed(path: String, value: Variant) -> void:
	print("[zabloo] data_changed: ", path, " = ", value)
	_log.text = "%s = %s" % [path, value]
