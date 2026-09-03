extends Node

## Receives `zabloo dev --godot` pushes and hot-swaps the running views (G14).
##
## In Unity the dev server lived in the EDITOR because the game runs inside it.
## Godot's `Run` launches a separate process, so the receiver has to live in the
## RUNTIME — which is why this is an autoload the plugin registers, and not part
## of `zabloo_plugin.gd`.
##
## GDScript, like the plugin and for the same reason: there is no hot loop here.
## One `TCPServer` polled per frame and a JSON rewrite per save is not the kind of
## work the C++ core exists for, and the two things this needs — `JSON` and
## `HTTPRequest` — are Godot's, not the core's (which has a JSON reader with no
## writer, on purpose).
##
## Debug builds only. An exported release still ships the script, and it does
## nothing at all: `_ready` returns before anything binds.
##
## The push carries the envelope WITHOUT its asset bytes plus the address they
## can be fetched from, so a save that changed one `.tsx` moves a few KB even in
## a project with megabytes of PNGs. What is missing is fetched by content hash
## and kept, so the same image is transferred once no matter how many reloads
## follow (ZAB-14). The rehydrated envelope is what reaches `reload()` — the
## loader ALWAYS receives a complete envelope, which is the one loading path
## every SDK shares.

## Where the CLI pushes. `zabloo dev --godot-port` moves the other end; this end
## follows a project setting so a game can run two instances without a collision.
const DEFAULT_PORT := 5079
const PORT_SETTING := "zabloo/dev_mode/port"

## A request bigger than this is refused rather than buffered. An envelope is a
## tree plus a manifest with no bytes in it, so the ceiling is generous by orders
## of magnitude — it is here so a wrong client cannot make the game eat memory.
const MAX_BODY := 64 * 1024 * 1024

## How long a half-finished request may sit before its connection is dropped.
const REQUEST_TIMEOUT_MS := 15_000

var _server: TCPServer = null
var _peers: Array[Dictionary] = []
var _http: HTTPRequest = null
## Asset bytes by content hash, base64 exactly as the manifest spells them.
var _blobs: Dictionary = {}
## True while a push is being applied. Applying is a coroutine — it may await a
## fetch — so a save landing mid-flight parks in `_pending` instead of starting a
## second rehydration over the same cache and the same `HTTPRequest`.
var _applying := false
## The newest push that arrived while one was being applied, as
## `[envelope, assets_base]`, or empty. One slot, because what is queued is always
## "the current envelope": the same collapse the CLI does with saves that land
## during an export.
var _pending: Array = []


func _ready() -> void:
	set_process(false)
	# Not a feature to be disabled: a dev channel that a shipped game could open
	# is a dev channel a player's machine could be talked to through.
	if not OS.is_debug_build():
		return
	var port := int(ProjectSettings.get_setting(PORT_SETTING, DEFAULT_PORT))
	_server = TCPServer.new()
	# Loopback, never `*`: this listens for the CLI on the same machine, and
	# binding wider would put the running game on the network it is developed on.
	var error := _server.listen(port, "127.0.0.1")
	if error != OK:
		printerr("[zabloo] dev mode: port %d is taken — another instance running? (%s)" % [
			port, error_string(error)])
		_server = null
		return
	_http = HTTPRequest.new()
	# Assets are base64 text, and a 4 MB PNG is ~5.5 MB of it. The default cap is
	# smaller than that, and the failure would look like a corrupt image.
	_http.body_size_limit = MAX_BODY
	add_child(_http)
	set_process(true)
	print("[zabloo] dev mode listening on 127.0.0.1:%d — run `zabloo dev --godot`" % port)


func _exit_tree() -> void:
	if _server != null:
		_server.stop()
		_server = null
	for peer in _peers:
		(peer["stream"] as StreamPeerTCP).disconnect_from_host()
	_peers.clear()


func _process(_delta: float) -> void:
	if _server == null:
		return
	while _server.is_connection_available():
		var stream := _server.take_connection()
		stream.set_no_delay(true)
		_peers.append({"stream": stream, "buffer": PackedByteArray(), "since": Time.get_ticks_msec()})
	var still_open: Array[Dictionary] = []
	for peer in _peers:
		if _pump(peer):
			still_open.append(peer)
	_peers = still_open


## Reads what has arrived on one connection and answers it once it is whole.
## Returns whether the connection stays open for another poll.
func _pump(peer: Dictionary) -> bool:
	var stream: StreamPeerTCP = peer["stream"]
	stream.poll()
	var status := stream.get_status()
	# CONNECTING is kept, not dropped: an accepted socket can report it for a poll
	# or two, and treating that as "gone" would lose a push now and then — the
	# worst kind of bug to have in the thing you reach for when something is odd.
	if status != StreamPeerTCP.STATUS_CONNECTED and status != StreamPeerTCP.STATUS_CONNECTING:
		return false
	if status == StreamPeerTCP.STATUS_CONNECTING:
		return true
	var available := stream.get_available_bytes()
	if available > 0:
		var chunk: Array = stream.get_data(available)
		if chunk[0] == OK:
			var buffer: PackedByteArray = peer["buffer"]
			buffer.append_array(chunk[1])
			peer["buffer"] = buffer
			if buffer.size() > MAX_BODY:
				_respond(stream, 413, '{"error":"request too large"}')
				return false
	# A request that never completes must not hold a slot forever: a client that
	# died mid-body leaves a connection that is open and will never say more.
	if Time.get_ticks_msec() - int(peer["since"]) > REQUEST_TIMEOUT_MS and not _complete(peer["buffer"]):
		stream.disconnect_from_host()
		return false
	if not _complete(peer["buffer"]):
		return true
	_serve(stream, peer["buffer"] as PackedByteArray)
	return false


## Whether the bytes read so far are a whole request: headers, then as many body
## bytes as `Content-Length` promised.
func _complete(buffer: PackedByteArray) -> bool:
	var head := _head_end(buffer)
	if head < 0:
		return false
	var text := buffer.slice(0, head).get_string_from_utf8()
	return buffer.size() - (head + 4) >= _content_length(text)


func _head_end(buffer: PackedByteArray) -> int:
	for i in range(buffer.size() - 3):
		if buffer[i] == 13 and buffer[i + 1] == 10 and buffer[i + 2] == 13 and buffer[i + 3] == 10:
			return i
	return -1


func _content_length(head: String) -> int:
	for line in head.split("\r\n"):
		var colon := line.find(":")
		if colon > 0 and line.substr(0, colon).strip_edges().to_lower() == "content-length":
			return int(line.substr(colon + 1).strip_edges())
	return 0


## The whole HTTP surface: one route, one method. Everything else is answered
## rather than ignored, so a wrong URL says so instead of hanging.
func _serve(stream: StreamPeerTCP, buffer: PackedByteArray) -> void:
	var head_end := _head_end(buffer)
	var head := buffer.slice(0, head_end).get_string_from_utf8()
	var lines := head.split("\r\n")
	var request := lines[0].split(" ")
	var method := request[0] if request.size() > 0 else ""
	var path := request[1] if request.size() > 1 else ""
	if path != "/zabloo/envelope":
		_respond(stream, 404, '{"error":"unknown route"}')
		return
	if method != "POST":
		_respond(stream, 405, '{"error":"POST an envelope here"}')
		return
	var body := buffer.slice(head_end + 4).get_string_from_utf8()
	var envelope: Variant = JSON.parse_string(body)
	if typeof(envelope) != TYPE_DICTIONARY:
		_respond(stream, 400, '{"error":"not a JSON envelope"}')
		printerr("[zabloo] dev mode: the push was not a JSON object — ignored")
		return
	var assets_base := _header(lines, "x-zabloo-assets")
	# Answered before applying, not after: the reply says the push was TAKEN and
	# by how many views, and fetching the assets it left out can take a moment the
	# CLI has no reason to sit through.
	_respond(stream, 200, JSON.stringify({"views": _views().size()}))
	if _applying:
		# Two saves inside one fetch. The last one wins, because it is the only
		# one that describes the project as it is now.
		_pending = [envelope, assets_base]
		return
	_apply(envelope, assets_base)


func _header(lines: PackedStringArray, name: String) -> String:
	for i in range(1, lines.size()):
		var colon := lines[i].find(":")
		if colon > 0 and lines[i].substr(0, colon).strip_edges().to_lower() == name:
			return lines[i].substr(colon + 1).strip_edges()
	return ""


## Rehydrates the pushed envelope and hot-swaps every view with it.
func _apply(envelope: Dictionary, assets_base: String) -> void:
	_applying = true
	var fetched: int = await _rehydrate(envelope, assets_base)
	_applying = false
	var json := JSON.stringify(envelope)
	var views := _views()
	for view in views:
		# `reload` is `load_envelope`: the same one loading path a manual import
		# and a platform hot-update take. Data the game pushed lives on the
		# document, so it survives the swap without anyone replaying it.
		view.call("reload", json)
	var assets: String = "%d asset(s) fetched" % fetched if fetched > 0 else "no new assets"
	print("[zabloo] dev mode: reloaded %d view(s), %s" % [views.size(), assets])
	if not _pending.is_empty():
		var next: Array = _pending
		_pending = []
		_apply(next[0], next[1])


## Puts back the bytes the push left out, fetching only the hashes not held yet.
## Returns how many were actually transferred — the number the exit criterion of
## G14 is measured with.
func _rehydrate(envelope: Dictionary, assets_base: String) -> int:
	var assets: Variant = envelope.get("assets")
	if typeof(assets) != TYPE_DICTIONARY:
		return 0
	var referenced := {}
	var fetched := 0
	for id: String in assets.keys():
		var entry: Variant = assets[id]
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		var hash_value: Variant = entry.get("hash")
		if typeof(hash_value) != TYPE_STRING:
			continue
		referenced[hash_value] = true
		if typeof(entry.get("data")) == TYPE_STRING:
			# A push that carried its bytes anyway (a manual POST, an older CLI):
			# keep them, so the next thin push about the same hash needs nothing.
			_blobs[hash_value] = entry["data"]
			continue
		if not _blobs.has(hash_value):
			if assets_base.is_empty():
				printerr("[zabloo] dev mode: asset %s has no bytes and the push named no source" % hash_value)
				continue
			var bytes: String = await _fetch(assets_base + hash_value)
			if bytes.is_empty():
				continue
			_blobs[hash_value] = bytes
			fetched += 1
		entry["data"] = _blobs[hash_value]
	# What this envelope stopped referencing is released, exactly as the adapter
	# drops the texture behind it (2026-08-11, ZAB-12) — the cache tracks the
	# content on screen, not everything ever seen.
	for cached: String in _blobs.keys():
		if not referenced.has(cached):
			_blobs.erase(cached)
	return fetched


## One asset's base64, from the preview server's content-addressed route. Empty
## on any failure: an image that does not arrive costs its own pixels, never the
## reload — the node then paints the background that IS its placeholder.
func _fetch(url: String) -> String:
	if _http == null:
		return ""
	var error := _http.request(url)
	if error != OK:
		printerr("[zabloo] dev mode: could not ask for %s (%s)" % [url, error_string(error)])
		return ""
	var result: Array = await _http.request_completed
	if result[0] != HTTPRequest.RESULT_SUCCESS or result[1] != 200:
		printerr("[zabloo] dev mode: %s answered %d" % [url, result[1]])
		return ""
	return (result[3] as PackedByteArray).get_string_from_utf8()


## Every `ZablooView` in the running scene, however deep and however many.
##
## By class name rather than `is ZablooView` so this script still parses when the
## extension did not load — the one moment its warning is the thing you need to
## read.
func _views() -> Array[Node]:
	var found: Array[Node] = []
	_collect(get_tree().root, found)
	return found


func _collect(node: Node, into: Array[Node]) -> void:
	if node.get_class() == "ZablooView":
		into.append(node)
	for child in node.get_children():
		_collect(child, into)


func _respond(stream: StreamPeerTCP, status: int, body: String) -> void:
	var payload := body.to_utf8_buffer()
	var head := "HTTP/1.1 %d %s\r\n" % [status, _reason(status)]
	head += "content-type: application/json\r\n"
	head += "content-length: %d\r\n" % payload.size()
	head += "connection: close\r\n\r\n"
	stream.put_data(head.to_utf8_buffer())
	stream.put_data(payload)
	# Flushed before the socket goes: the CLI reads this reply, and a close that
	# races the write turns a successful push into "not reachable".
	stream.poll()
	stream.disconnect_from_host()


func _reason(status: int) -> String:
	match status:
		200: return "OK"
		404: return "Not Found"
		405: return "Method Not Allowed"
		413: return "Payload Too Large"
		_: return "Bad Request"
