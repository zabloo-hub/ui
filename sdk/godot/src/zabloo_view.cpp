#include "zabloo_view.h"

#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/global_constants.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/input_event_key.hpp>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_pan_gesture.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/classes/time.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

#include <cstring>

#include "input_owner.h"

using namespace godot;

namespace {

/**
 * How far one wheel notch scrolls.
 *
 * The one number in this file that the reference cannot hand over: a browser
 * reports a wheel in PIXELS (`deltaY`) and the core takes those pixels straight,
 * while Godot reports a discrete `WHEEL_UP`/`WHEEL_DOWN` with a factor. Something
 * has to turn one into the other, and the corpus cannot arbitrate it — no case
 * records a wheel. The axes stay 1:1 with the reference either way: a scroller
 * that does not enable an axis has a zero bound there, so the clamp drops it.
 */
constexpr double WHEEL_NOTCH_PX = 50.0;

/**
 * The rounded half of clipping, in the engine's own shading language.
 *
 * `VERTEX` in a canvas_item `vertex()` is the item's LOCAL position, which is
 * this Control's space, which is the space the core's rects are in — so the
 * region needs no conversion to be compared against a fragment. Everything
 * outside the rect is already gone (the scissor), so this only discards corners.
 */
const char *CLIP_SHADER = R"(shader_type canvas_item;

uniform vec4 clip_rect = vec4(0.0);
uniform float clip_radius = 0.0;

varying vec2 local_position;

void vertex() {
  local_position = VERTEX;
}

void fragment() {
  // COLOR arrives already sampled — the vertex colour times TEXTURE — so the only
  // thing left to do is take the corners out of its alpha.
  vec2 half_size = clip_rect.zw * 0.5;
  vec2 q = abs(local_position - (clip_rect.xy + half_size)) - (half_size - vec2(clip_radius));
  float d = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - clip_radius;
  float aa = max(fwidth(d), 0.0001);
  COLOR.a *= 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
})";

/**
 * A `Variant` as the data channel carries it — arrays and dictionaries
 * included, because a bound path addresses INTO what the game pushed.
 *
 * A dictionary key is read as a string whatever it was: paths are dotted
 * strings, so a key that is not one could never be addressed anyway.
 */
zabloo::DataValue to_data_value(const Variant &value) {
  switch (value.get_type()) {
    case Variant::NIL:
      return zabloo::DataValue();
    case Variant::BOOL:
      return zabloo::DataValue::of_bool(value);
    case Variant::INT:
    case Variant::FLOAT:
      return zabloo::DataValue::of_number(value);
    case Variant::ARRAY: {
      const Array items = value;
      zabloo::DataValue out = zabloo::DataValue::array();
      for (int64_t i = 0; i < items.size(); i++) out.push(to_data_value(items[i]));
      return out;
    }
    case Variant::DICTIONARY: {
      const Dictionary members = value;
      const Array keys = members.keys();
      zabloo::DataValue out = zabloo::DataValue::object();
      for (int64_t i = 0; i < keys.size(); i++) {
        out.insert(String(keys[i]).utf8().get_data(), to_data_value(members[keys[i]]));
      }
      return out;
    }
    default:
      // Everything else — a Vector2, a Color, a node path — is stringified, the
      // way the reference stringifies whatever it is handed.
      return zabloo::DataValue::of_text(String(value).utf8().get_data());
  }
}

/** A value coming BACK from a control, for the `data_changed` signal. */
Variant to_variant(const zabloo::DataValue &value) {
  switch (value.kind) {
    case zabloo::DataValue::Kind::Bool: return value.boolean;
    case zabloo::DataValue::Kind::Number: return value.number;
    case zabloo::DataValue::Kind::Text: return String::utf8(value.text.c_str());
    case zabloo::DataValue::Kind::Array: {
      Array out;
      for (const zabloo::DataValue &item : value.items) out.push_back(to_variant(item));
      return out;
    }
    case zabloo::DataValue::Kind::Object: {
      Dictionary out;
      for (size_t i = 0; i < value.keys.size() && i < value.items.size(); i++) {
        out[String::utf8(value.keys[i].c_str())] = to_variant(value.items[i]);
      }
      return out;
    }
    case zabloo::DataValue::Kind::Null: break;
  }
  return Variant();
}

std::string_view utf8_of(const CharString &text) {
  return std::string_view(text.get_data(), text.length());
}

}  // namespace

ZablooView::ZablooView() {
  set_mouse_filter(Control::MOUSE_FILTER_STOP);
  // Asked for explicitly: Godot only routes unhandled input to a node that has
  // opted in, and the auto-detection that does it for a GDScript override does
  // not read a GDExtension's virtuals.
  set_process_unhandled_key_input(true);
}

void ZablooView::_bind_methods() {
  ClassDB::bind_method(D_METHOD("load_envelope", "json"), &ZablooView::load_envelope);
  ClassDB::bind_method(D_METHOD("load_file", "path"), &ZablooView::load_file);
  ClassDB::bind_method(D_METHOD("show_view", "id"), &ZablooView::show_view);
  ClassDB::bind_method(D_METHOD("get_diagnostics"), &ZablooView::get_diagnostics);
  ClassDB::bind_method(D_METHOD("is_loaded"), &ZablooView::is_loaded);
  ClassDB::bind_method(D_METHOD("set_data", "path", "value"), &ZablooView::set_data);
  ClassDB::bind_method(D_METHOD("set_open", "id", "open"), &ZablooView::set_open);
  ClassDB::bind_method(D_METHOD("set_selected_tab", "id", "index"),
                       &ZablooView::set_selected_tab);
  ClassDB::bind_method(D_METHOD("set_checked", "id", "checked"), &ZablooView::set_checked);
  ClassDB::bind_method(D_METHOD("set_scroll", "id", "x", "y"), &ZablooView::set_scroll);
  ClassDB::bind_method(D_METHOD("reload", "json"), &ZablooView::reload);

  ClassDB::bind_method(D_METHOD("set_envelope_path", "path"), &ZablooView::set_envelope_path);
  ClassDB::bind_method(D_METHOD("get_envelope_path"), &ZablooView::get_envelope_path);
  ClassDB::bind_method(D_METHOD("set_view_id", "id"), &ZablooView::set_view_id);
  ClassDB::bind_method(D_METHOD("get_view_id"), &ZablooView::get_view_id);
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "envelope_path", PROPERTY_HINT_FILE, "*.json"),
               "set_envelope_path", "get_envelope_path");
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "view_id"), "set_view_id", "get_view_id");

  // The callbacks, exposed the way the engine expects rather than the way the IR
  // spells it — the whole point of a per-engine adapter. All three are ordinary
  // signals, so GDScript, C# and C++ consume them the same way.
  //
  // `context` is empty until G12 (ZAB-145) gives an action fired inside a
  // `Repeat` item the path, key and index of the item it came from.
  ADD_SIGNAL(MethodInfo("action", PropertyInfo(Variant::STRING, "name"),
                        PropertyInfo(Variant::DICTIONARY, "context")));
  // A control wrote its own value into a bound path — the return leg of the data
  // channel (2026-08-11, ZAB-23). The game hears the same thing whether the
  // player moved the control or `set_checked` did.
  ADD_SIGNAL(MethodInfo("data_changed", PropertyInfo(Variant::STRING, "path"),
                        PropertyInfo(Variant::NIL, "value", PROPERTY_HINT_NONE, "",
                                     PROPERTY_USAGE_NIL_IS_VARIANT)));
  // What the loading contract found, on an import and on a hot-update alike.
  ADD_SIGNAL(MethodInfo("diagnostic", PropertyInfo(Variant::STRING, "code"),
                        PropertyInfo(Variant::STRING, "message"),
                        PropertyInfo(Variant::BOOL, "fatal")));
}

void ZablooView::_ready() {
  if (!envelope_path_.is_empty()) load_file(envelope_path_);
}

void ZablooView::_notification(int what) {
  if (what == NOTIFICATION_RESIZED) relayout();
  // The canvas items are the server's, not the scene tree's: nothing frees them
  // when this node goes, so it has to.
  else if (what == NOTIFICATION_PREDELETE) free_clip_items();
  // Entering the tree is what makes a view eligible for the keyboard; leaving it
  // hands ownership back to whichever view was there first.
  else if (what == NOTIFICATION_ENTER_TREE) register_input_view(this);
  else if (what == NOTIFICATION_EXIT_TREE) unregister_input_view(this);
}

// --- loading --------------------------------------------------------------

bool ZablooView::load_envelope(const String &json) {
  const CharString utf8 = json.utf8();
  const bool ok = document_.load(std::string_view(utf8.get_data(), utf8.length()));
  if (!ok) {
    report_diagnostics();
    return false;
  }
  if (!view_id_.is_empty()) show_view(view_id_);
  relayout();
  // After the first frame, not before it: some of what the view finds about the
  // payload only turns up once it has been laid out — an anchor whose trigger can
  // never fire needs the focusability the resolve pass settles.
  report_diagnostics();
  return true;
}

bool ZablooView::load_file(const String &path) {
  if (!FileAccess::file_exists(path)) {
    UtilityFunctions::push_error("[zabloo] no envelope at ", path);
    return false;
  }
  return load_envelope(FileAccess::get_file_as_string(path));
}

bool ZablooView::show_view(const String &id) {
  const CharString utf8 = id.utf8();
  if (!document_.show(std::string_view(utf8.get_data(), utf8.length()))) return false;
  view_id_ = id;
  relayout();
  return true;
}

/**
 * The diagnostics go to the log ONCE PER LOAD, never per frame — an unknown
 * token is a property of the payload, and repeating it sixty times a second
 * would bury the one line that matters (2026-08-12).
 */
void ZablooView::report_diagnostics() const {
  const auto report = [this](const zabloo::Diagnostic &diagnostic) {
    const bool fatal = diagnostic.level == zabloo::DiagnosticLevel::Fatal;
    const String line = String("[zabloo] ") + zabloo::diagnostic_code_name(diagnostic.code) + ": " +
                        String::utf8(diagnostic.message.c_str());
    if (fatal) {
      UtilityFunctions::push_error(line);
    } else {
      UtilityFunctions::push_warning(line);
    }
    const_cast<ZablooView *>(this)->emit_signal(
        "diagnostic", String(zabloo::diagnostic_code_name(diagnostic.code)),
        String::utf8(diagnostic.message.c_str()), fatal);
  };
  for (const zabloo::Diagnostic &diagnostic : document_.diagnostics()) report(diagnostic);
  // What building the view's RUNTIME found — a malformed tab group, so far. It
  // belongs with the load's own: both are properties of the payload.
  const zabloo::View *view = document_.view();
  if (view == nullptr) return;
  for (const zabloo::Diagnostic &diagnostic : view->warnings()) report(diagnostic);
}

PackedStringArray ZablooView::get_diagnostics() const {
  PackedStringArray out;
  for (const zabloo::Diagnostic &diagnostic : document_.diagnostics()) {
    out.push_back(String::utf8(diagnostic.message.c_str()));
  }
  return out;
}

bool ZablooView::is_loaded() const { return document_.loaded(); }

void ZablooView::set_data(const String &path, const Variant &value) {
  const CharString utf8 = path.utf8();
  document_.set_data(utf8_of(utf8), to_data_value(value));
  // A push before the view exists is not a special case: the store is the
  // document's, so whatever loads next simply reads it.
  if (document_.view() == nullptr) return;
  flush_events();
  relayout();
}

bool ZablooView::set_open(const String &id, bool open) {
  zabloo::View *view = document_.view();
  const CharString utf8 = id.utf8();
  if (view == nullptr || !view->set_open(utf8_of(utf8), open)) {
    UtilityFunctions::push_warning("[zabloo] set_open: no Collapse with id \"", id, "\"");
    return false;
  }
  flush_events();
  relayout();
  return true;
}

bool ZablooView::set_selected_tab(const String &id, int index) {
  zabloo::View *view = document_.view();
  const CharString utf8 = id.utf8();
  if (view == nullptr || !view->set_selected_tab(utf8_of(utf8), index)) {
    UtilityFunctions::push_warning("[zabloo] set_selected_tab: no exclusive-select group with id \"",
                                   id, "\"");
    return false;
  }
  flush_events();
  relayout();
  return true;
}

bool ZablooView::set_scroll(const String &id, double x, double y) {
  zabloo::View *view = document_.view();
  const CharString utf8 = id.utf8();
  if (view == nullptr || !view->set_scroll(utf8_of(utf8), x, y)) {
    UtilityFunctions::push_warning("[zabloo] set_scroll: no ScrollView with id \"", id, "\"");
    return false;
  }
  // No hooks to drain — a scroller emits nothing (2026-08-11, ZAB-9) — but the
  // content did move, so the frame has to be laid out again.
  relayout();
  return true;
}

bool ZablooView::set_checked(const String &id, bool checked) {
  zabloo::View *view = document_.view();
  const CharString utf8 = id.utf8();
  if (view == nullptr || !view->set_checked(utf8_of(utf8), checked)) {
    UtilityFunctions::push_warning("[zabloo] set_checked: no Toggle with id \"", id, "\"");
    return false;
  }
  flush_events();
  relayout();
  return true;
}

/**
 * A hot-update. The same call as an import and as a dev push (2026-08-01), and
 * the same guarantee: a payload the core refuses leaves what is on screen
 * exactly where it was.
 */
bool ZablooView::reload(const String &json) { return load_envelope(json); }

void ZablooView::set_envelope_path(const String &path) {
  envelope_path_ = path;
  if (is_node_ready() && !path.is_empty()) load_file(path);
}

String ZablooView::get_envelope_path() const { return envelope_path_; }

void ZablooView::set_view_id(const String &id) {
  view_id_ = id;
  if (is_node_ready() && document_.loaded()) show_view(id);
}

String ZablooView::get_view_id() const { return view_id_; }

// --- frame ----------------------------------------------------------------

void ZablooView::relayout() {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;
  const Vector2 size = get_size();
  view->set_size(size.x, size.y);
  view->set_now(clock_ms());
  view->layout_frame();
  queue_redraw();
  // Frames on demand: every mutation ends up here, so this is the one place that
  // has to notice a motion has begun. `_process` keeps them coming and stops the
  // moment nothing is moving — an idle UI costs no frames at all, which is what a
  // game gives up its budget for.
  set_process(view->animating());
}

/**
 * One frame of motion.
 *
 * `delta` is deliberately unread: the core is driven by an ABSOLUTE clock, not by
 * accumulated deltas, so a dropped frame lands a tween exactly where the wall clock
 * says instead of wherever the sum of the deltas drifted to. That is also what lets
 * the golden harness state an instant and get the frame recorded at it.
 */
void ZablooView::_process(double) {
  zabloo::View *view = document_.view();
  if (view == nullptr) {
    set_process(false);
    return;
  }
  view->set_now(clock_ms());
  view->layout_frame();
  queue_redraw();
  // A frame of pure motion used to produce nothing a game could hear, so nothing
  // drained it. An `autoCloseMs` timeout does (G9): it fires from INSIDE the
  // layout pass, with its `onDismiss` and the `false` it writes into the bound
  // `visible`. Draining here is what makes those reach the game on the frame they
  // happened, instead of waiting for whatever the player did next.
  flush_events();
  if (!view->animating()) set_process(false);
}

/**
 * The engine's monotonic clock in milliseconds, taken from the ticks rather than
 * from a time of day: it never jumps backwards, and nothing here has to care what
 * the origin is — a tween only ever reads differences.
 */
double ZablooView::clock_ms() const {
  return static_cast<double>(Time::get_singleton()->get_ticks_usec()) / 1000.0;
}

/**
 * The glyph atlases as Godot textures.
 *
 * The pixels are LA8 — white with the coverage as alpha — so the vertex color a
 * batch carries tints them by a plain multiply, which is how a `Text` gets its
 * `style.color` and its inherited opacity in one go.
 *
 * `update()` only takes an image of the same size, and an atlas that filled up
 * DOUBLES its side (ZAB-55), so a grown one is set rather than updated.
 */
void ZablooView::sync_atlases() {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;

  std::unordered_map<const void *, AtlasTexture> live;
  live.reserve(view->fonts().all().size());
  for (const auto &atlas : view->fonts().all()) {
    const void *key = atlas.get();
    const auto found = atlases_.find(key);
    AtlasTexture entry = found != atlases_.end() ? found->second : AtlasTexture{};
    if (entry.texture.is_null() || entry.version != atlas->version()) {
      const std::vector<uint8_t> &pixels = atlas->pixels();
      PackedByteArray bytes;
      bytes.resize(static_cast<int64_t>(pixels.size()));
      memcpy(bytes.ptrw(), pixels.data(), pixels.size());
      const Ref<Image> image = Image::create_from_data(atlas->size(), atlas->size(), false,
                                                       Image::FORMAT_LA8, bytes);
      if (entry.texture.is_null()) {
        entry.texture = ImageTexture::create_from_image(image);
      } else if (entry.size == atlas->size()) {
        entry.texture->update(image);
      } else {
        entry.texture->set_image(image);
      }
      entry.version = atlas->version();
      entry.size = atlas->size();
    }
    live.emplace(key, entry);
  }
  // What is left behind is what the LRU evicted: dropping the reference here is
  // what frees its texture, and it happens before anything can draw with it.
  atlases_.swap(live);
}

/**
 * The manifest images as Godot textures, decoded here because the core will not
 * own a codec and this engine already ships three.
 *
 * Keyed by content hash: a hot-update rebuilds every core-side address, so an
 * image whose bytes did not change would otherwise be decoded again on every
 * reload. What is left over after the sweep is what the new envelope stopped
 * referencing, and dropping the reference here is what frees it.
 */
void ZablooView::sync_images() {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;
  zabloo::ImageLibrary &images = view->images();
  if (images.all().empty() && images_.empty()) return;

  bool resized = false;
  std::unordered_map<std::string, AssetTexture> live;
  live.reserve(images.all().size());
  for (const std::unique_ptr<zabloo::ImageAsset> &asset : images.all()) {
    const auto found = images_.find(asset->hash);
    AssetTexture entry = found != images_.end() ? found->second : AssetTexture{};
    if (entry.texture.is_null() && !entry.failed) entry = decode(*asset);
    // What the manifest did not say and the decode knows: the one thing that
    // flows back into the core, and only ever to fill a gap.
    if (entry.texture.is_valid() &&
        images.adopt_size(*asset, entry.texture->get_width(), entry.texture->get_height())) {
      resized = true;
    }
    live.emplace(asset->hash, entry);
  }
  images_.swap(live);
  // A box that was zero wide until this frame changes what the whole tree
  // measures, so the geometry about to be drawn has to be laid out again first.
  // Through `relayout`, so a motion that this second pass starts — a bar whose
  // fill finally has a track to sit in — arms the frame loop like any other.
  if (resized) relayout();
}

/**
 * Bytes → a texture, by MIME. Godot decodes into an `Image` with straight alpha,
 * which is what the canvas blends and what the tint multiplies into.
 */
ZablooView::AssetTexture ZablooView::decode(const zabloo::ImageAsset &asset) {
  AssetTexture entry;
  const std::vector<uint8_t> bytes = zabloo::decode_asset_data(*asset.entry);
  if (bytes.empty()) {
    entry.failed = true;
    UtilityFunctions::push_warning("[zabloo] asset ", String::utf8(asset.hash.c_str()),
                                   " carries no bytes to decode");
    return entry;
  }
  PackedByteArray buffer;
  buffer.resize(static_cast<int64_t>(bytes.size()));
  memcpy(buffer.ptrw(), bytes.data(), bytes.size());

  Ref<Image> image;
  image.instantiate();
  const String mime = String::utf8(asset.mime.c_str());
  Error status = ERR_FILE_UNRECOGNIZED;
  if (mime == "image/png") {
    status = image->load_png_from_buffer(buffer);
  } else if (mime == "image/jpeg") {
    status = image->load_jpg_from_buffer(buffer);
  } else if (mime == "image/webp") {
    status = image->load_webp_from_buffer(buffer);
  }
  if (status != OK) {
    // Remembered as failed, so the node paints its authored background from here
    // on and this warning is said once rather than sixty times a second.
    entry.failed = true;
    UtilityFunctions::push_warning("[zabloo] could not decode asset ",
                                   String::utf8(asset.hash.c_str()), " (", mime, ")");
    return entry;
  }
  entry.texture = ImageTexture::create_from_image(image);
  return entry;
}

/**
 * Claims the canvas item one clip group draws into, arming its region.
 *
 * The items are pooled and cleared rather than recreated: a frame that paints
 * the same regions asks the server for nothing new. `draw_index` is what keeps
 * painter's order across them — the groups come out of the core in the order
 * they were entered, and that is the order they have to draw in.
 */
RID ZablooView::clip_item(size_t index, const zabloo::Clip *clip, int draw_index) {
  RenderingServer *server = RenderingServer::get_singleton();
  if (index >= clip_items_.size()) {
    ClipItem entry;
    entry.item = server->canvas_item_create();
    server->canvas_item_set_parent(entry.item, get_canvas_item());
    clip_items_.push_back(entry);
  }
  ClipItem &entry = clip_items_[index];
  server->canvas_item_clear(entry.item);
  server->canvas_item_set_draw_index(entry.item, draw_index);

  const bool rounded = clip != nullptr && clip->radius > 0.0;
  if (clip != nullptr) {
    // A region an intersection collapsed has a non-positive extent. It is not a
    // special case — nothing is visible through it either way — but Godot should
    // be handed an empty rect rather than a backwards one.
    const Rect2 rect(static_cast<real_t>(clip->x), static_cast<real_t>(clip->y),
                     static_cast<real_t>(clip->width > 0.0 ? clip->width : 0.0),
                     static_cast<real_t>(clip->height > 0.0 ? clip->height : 0.0));
    server->canvas_item_set_custom_rect(entry.item, true, rect);
    server->canvas_item_set_clip(entry.item, true);
  } else {
    server->canvas_item_set_clip(entry.item, false);
    server->canvas_item_set_custom_rect(entry.item, false, Rect2());
  }

  // A square region is the scissor and nothing else, so it carries no material —
  // and dropping the one it may have had last frame is what stops a rounded group
  // from leaving its corners cut into whatever reuses its slot.
  if (!rounded) {
    if (entry.material.is_valid()) {
      entry.material.unref();
      server->canvas_item_set_material(entry.item, RID());
    }
    return entry.item;
  }

  if (clip_shader_.is_null()) {
    clip_shader_.instantiate();
    clip_shader_->set_code(String(CLIP_SHADER));
  }
  if (entry.material.is_null()) {
    entry.material.instantiate();
    entry.material->set_shader(clip_shader_);
    server->canvas_item_set_material(entry.item, entry.material->get_rid());
  }
  entry.material->set_shader_parameter(
      "clip_rect", Vector4(static_cast<real_t>(clip->x), static_cast<real_t>(clip->y),
                           static_cast<real_t>(clip->width), static_cast<real_t>(clip->height)));
  entry.material->set_shader_parameter("clip_radius", clip->radius);
  return entry.item;
}

void ZablooView::free_clip_items() {
  // At shutdown the server may already be gone; the RIDs go with it either way.
  RenderingServer *server = RenderingServer::get_singleton();
  if (server != nullptr) {
    for (ClipItem &entry : clip_items_) {
      if (entry.item.is_valid()) server->free_rid(entry.item);
    }
  }
  clip_items_.clear();
}

/**
 * Upload: one `canvas_item_add_triangle_array` per batch, which is one draw call
 * per batch — the solids of each clip group, and then one per texture in play.
 * Solids carry no texture, exactly as the reference renderer draws them.
 *
 * Nothing goes into this Control's own canvas item: every batch draws into the
 * child item of its region, so a group is clipped as a whole and the groups draw
 * in the order the core entered them.
 */
void ZablooView::_draw() {
  RenderingServer *server = RenderingServer::get_singleton();
  zabloo::View *view = document_.view();
  if (view == nullptr) {
    // Emptied and not freed: the engine clears this Control's own canvas item
    // before `_draw`, but the children are ours, so last frame's triangles would
    // otherwise stay on screen with nothing behind them.
    for (ClipItem &entry : clip_items_) server->canvas_item_clear(entry.item);
    return;
  }

  sync_atlases();
  sync_images();

  // One canvas item per group that actually painted something. The count is not
  // the core's group ordinal — a group whose batches all came out empty claims no
  // item — but the ORDER is, which is the part that has to survive.
  size_t items = 0;
  uint32_t open_group = 0;
  RID canvas;
  bool opened = false;
  for (const zabloo::Batch *batch : view->paint().batches()) {
    if (batch->empty()) continue;
    // Batches of one group are contiguous, and the ordinal is what separates them:
    // two adjacent groups may share a region and still have to draw in order.
    if (!opened || batch->group != open_group) {
      open_group = batch->group;
      canvas = clip_item(items, batch->clip, static_cast<int>(items));
      items++;
      opened = true;
    }
    const int64_t vertices = static_cast<int64_t>(batch->vertex_count());
    indices_.resize(static_cast<int64_t>(batch->indices.size()));
    points_.resize(vertices);
    colors_.resize(vertices);
    uvs_.resize(vertices);

    int32_t *index_out = indices_.ptrw();
    for (size_t i = 0; i < batch->indices.size(); i++) {
      index_out[i] = static_cast<int32_t>(batch->indices[i]);
    }
    Vector2 *point_out = points_.ptrw();
    Vector2 *uv_out = uvs_.ptrw();
    Color *color_out = colors_.ptrw();
    for (int64_t i = 0; i < vertices; i++) {
      point_out[i] = Vector2(batch->positions[i * 2], batch->positions[i * 2 + 1]);
      uv_out[i] = Vector2(batch->uvs[i * 2], batch->uvs[i * 2 + 1]);
      color_out[i] = Color(batch->colors[i * 4], batch->colors[i * 4 + 1],
                           batch->colors[i * 4 + 2], batch->colors[i * 4 + 3]);
    }
    // Bones and weights are the two arguments in the way of the texture, which
    // is the one that matters here: a batch that names an atlas or an image
    // samples it, and a solid one draws with no texture at all.
    RID texture;
    if (batch->kind == zabloo::TextureKind::Glyphs) {
      const auto found = atlases_.find(batch->texture);
      if (found != atlases_.end() && found->second.texture.is_valid()) {
        texture = found->second.texture->get_rid();
      }
    } else if (batch->kind == zabloo::TextureKind::Image) {
      const auto *asset = static_cast<const zabloo::ImageAsset *>(batch->texture);
      const auto found = images_.find(asset->hash);
      // Nothing decoded: skipping the batch leaves the node showing the
      // background it painted underneath, which is the authored placeholder.
      // Drawing it would hand Godot its default white texture instead — a solid
      // tinted rectangle where a picture was meant to be.
      if (found == images_.end() || found->second.texture.is_null()) continue;
      texture = found->second.texture->get_rid();
    }
    server->canvas_item_add_triangle_array(canvas, indices_, points_, colors_, uvs_,
                                           PackedInt32Array(), PackedFloat32Array(), texture);
  }

  // Slots the frame did not need are emptied rather than freed: a scroller that
  // is momentarily not clipping anything will want them back next frame.
  for (size_t i = items; i < clip_items_.size(); i++) {
    server->canvas_item_clear(clip_items_[i].item);
  }
}

// --- input ----------------------------------------------------------------

void ZablooView::_gui_input(const Ref<InputEvent> &event) {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;

  // `_gui_input` hands positions already local to this Control, and the core lays
  // out from (0, 0), so there is no transform to undo. The pad is G13 (ZAB-146).
  bool changed = false;
  bool handled = true;
  const Ref<InputEventMouseButton> button = event;
  const Ref<InputEventMouseMotion> motion = event;
  const Ref<InputEventScreenTouch> touch = event;
  const Ref<InputEventScreenDrag> screen_drag = event;
  const Ref<InputEventPanGesture> pan = event;

  if (button.is_valid()) {
    const Vector2 at = button->get_position();
    const MouseButton index = button->get_button_index();
    if (index == MOUSE_BUTTON_LEFT) {
      if (button->is_pressed()) {
        // Touching a view is using it: among several, this one now takes the keys.
        claim_input(this);
        changed = view->pointer_down(at.x, at.y);
      } else {
        changed = view->pointer_up(at.x, at.y);
      }
    } else if (button->is_pressed() &&
               (index == MOUSE_BUTTON_WHEEL_UP || index == MOUSE_BUTTON_WHEEL_DOWN ||
                index == MOUSE_BUTTON_WHEEL_LEFT || index == MOUSE_BUTTON_WHEEL_RIGHT)) {
      // A notch arrives as a press and then a release; only the press scrolls, or
      // every notch would count twice.
      const double step = WHEEL_NOTCH_PX * static_cast<double>(button->get_factor());
      const double dx = index == MOUSE_BUTTON_WHEEL_RIGHT  ? step
                        : index == MOUSE_BUTTON_WHEEL_LEFT ? -step
                                                           : 0.0;
      const double dy = index == MOUSE_BUTTON_WHEEL_DOWN ? step
                        : index == MOUSE_BUTTON_WHEEL_UP ? -step
                                                         : 0.0;
      changed = view->pointer_wheel(at.x, at.y, dx, dy);
    } else {
      handled = false;
    }
  } else if (motion.is_valid()) {
    const Vector2 at = motion->get_position();
    changed = view->pointer_move(at.x, at.y);
    // A mouse that is only passing over inert content has not been "used": letting
    // the motion through keeps whatever is under this view able to see it.
    handled = changed;
  } else if (touch.is_valid()) {
    const Vector2 at = touch->get_position();
    if (touch->is_pressed()) {
      claim_input(this);
      // A finger is not a cursor: it lights nothing up on the way past, and it is
      // not sitting anywhere once it lifts.
      changed = view->pointer_down(at.x, at.y, false);
    } else {
      changed = view->pointer_up(at.x, at.y, false);
    }
  } else if (screen_drag.is_valid()) {
    const Vector2 at = screen_drag->get_position();
    changed = view->pointer_move(at.x, at.y, false);
  } else if (pan.is_valid()) {
    // A trackpad reports a pan rather than notches, and in the same units Godot's
    // own ScrollContainer reads them in — so it takes the same step.
    const Vector2 delta = pan->get_delta();
    changed = view->pointer_wheel(pan->get_position().x, pan->get_position().y,
                                  delta.x * WHEEL_NOTCH_PX, delta.y * WHEEL_NOTCH_PX);
  } else {
    handled = false;
  }

  if (handled) accept_event();
  flush_events();
  // Only when something actually moved: a redraw per mouse motion over an inert
  // panel is a frame nobody asked for.
  if (changed) relayout();
}

/**
 * The keyboard: four directions, a press and a release, and nothing else.
 *
 * Navigation is spatial (2026-08-04) — the core walks the live layout rects — so
 * there is no tab order here to keep, and what has the focus INSIDE the view is
 * the core's business while what has it in the SCENE is Godot's.
 *
 * That split is why this is `_unhandled_key_input` and why the view deliberately
 * takes no Godot focus of its own (`focus_mode` stays `NONE`). Unhandled is
 * exactly "no focused Control claimed this key", which is the faithful
 * translation of the web's rule that the keys are the renderer's only while the
 * page's focus is on the view or on nothing (ZAB-109): a game's own focused
 * Button still gets the Enter the engine owes it. Taking the focus here would do
 * the opposite — Godot's focus navigation would eat the very arrows this reads.
 *
 * Exactly one view acts on it. Unhandled input reaches every node in the tree,
 * so two views in a scene would each move their own focus on the same arrow
 * (`input_owner.h`).
 */
void ZablooView::_unhandled_key_input(const Ref<InputEvent> &event) {
  zabloo::View *view = document_.view();
  const Ref<InputEventKey> key = event;
  if (view == nullptr || key.is_null() || !owns_input(this)) return;
  // Auto-repeat is the OS repeating the key, which is what a player holding an
  // arrow expects; a repeated Enter is not a second press of the same button.
  const bool repeat = key->is_echo();

  bool changed = false;
  switch (key->get_keycode()) {
    case KEY_LEFT: changed = key->is_pressed() && view->move_focus(-1, 0); break;
    case KEY_RIGHT: changed = key->is_pressed() && view->move_focus(1, 0); break;
    case KEY_UP: changed = key->is_pressed() && view->move_focus(0, -1); break;
    case KEY_DOWN: changed = key->is_pressed() && view->move_focus(0, 1); break;
    case KEY_ENTER:
    case KEY_KP_ENTER:
    case KEY_SPACE:
      if (repeat && key->is_pressed()) return;  // held, not pressed again
      changed = view->press_focused(key->is_pressed());
      break;
    case KEY_ESCAPE:
      // A dismiss request for the modal that owns the input — the keyboard's B
      // button. With nothing up it is NOT ours: an Escape this view did not use
      // belongs to the game's own pause menu, so it falls through untouched.
      if (!key->is_pressed() || !view->dismiss_top_modal()) return;
      changed = true;
      break;
    default:
      return;  // not ours: leave it for the scene
  }
  // Accepted whether or not anything moved: an arrow that found no candidate is
  // still an arrow this view answered, and letting it through would move Godot's
  // own focus out of the game.
  accept_event();
  flush_events();
  if (changed) relayout();
}

void ZablooView::flush_events() {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;
  for (const zabloo::ActionEvent &action : view->drain_actions()) {
    Dictionary context;
    if (!action.item_path.empty()) context["path"] = String::utf8(action.item_path.c_str());
    emit_signal("action", String::utf8(action.name.c_str()), context);
  }
  for (const zabloo::DataChange &change : view->drain_data_changes()) {
    emit_signal("data_changed", String::utf8(change.path.c_str()), to_variant(change.value));
  }
}
