#include "zabloo_view.h"

#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/global_constants.hpp>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

using namespace godot;

ZablooView::ZablooView() {
  set_mouse_filter(Control::MOUSE_FILTER_STOP);
}

void ZablooView::_bind_methods() {
  ClassDB::bind_method(D_METHOD("load_envelope", "json"), &ZablooView::load_envelope);
  ClassDB::bind_method(D_METHOD("load_file", "path"), &ZablooView::load_file);
  ClassDB::bind_method(D_METHOD("show_view", "id"), &ZablooView::show_view);
  ClassDB::bind_method(D_METHOD("get_diagnostics"), &ZablooView::get_diagnostics);
  ClassDB::bind_method(D_METHOD("is_loaded"), &ZablooView::is_loaded);
  ClassDB::bind_method(D_METHOD("set_data", "path", "value"), &ZablooView::set_data);

  ClassDB::bind_method(D_METHOD("set_envelope_path", "path"), &ZablooView::set_envelope_path);
  ClassDB::bind_method(D_METHOD("get_envelope_path"), &ZablooView::get_envelope_path);
  ClassDB::bind_method(D_METHOD("set_view_id", "id"), &ZablooView::set_view_id);
  ClassDB::bind_method(D_METHOD("get_view_id"), &ZablooView::get_view_id);
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "envelope_path", PROPERTY_HINT_FILE, "*.json"),
               "set_envelope_path", "get_envelope_path");
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "view_id"), "set_view_id", "get_view_id");

  // A named action leaving the UI, exposed the way the engine expects rather
  // than the way the IR spells it — the whole point of a per-engine adapter.
  // `context` is empty until G12 (ZAB-145) gives an action fired inside a
  // `Repeat` item the path, key and index of the item it came from.
  ADD_SIGNAL(MethodInfo("action", PropertyInfo(Variant::STRING, "name"),
                        PropertyInfo(Variant::DICTIONARY, "context")));
}

void ZablooView::_ready() {
  if (!envelope_path_.is_empty()) load_file(envelope_path_);
}

void ZablooView::_notification(int what) {
  if (what == NOTIFICATION_RESIZED) relayout();
}

// --- loading --------------------------------------------------------------

bool ZablooView::load_envelope(const String &json) {
  const CharString utf8 = json.utf8();
  const bool ok = document_.load(std::string_view(utf8.get_data(), utf8.length()));
  report_diagnostics();
  if (!ok) return false;
  if (!view_id_.is_empty()) show_view(view_id_);
  relayout();
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
  for (const zabloo::Diagnostic &diagnostic : document_.diagnostics()) {
    const String line = String("[zabloo] ") + zabloo::diagnostic_code_name(diagnostic.code) + ": " +
                        String::utf8(diagnostic.message.c_str());
    if (diagnostic.level == zabloo::DiagnosticLevel::Fatal) {
      UtilityFunctions::push_error(line);
    } else {
      UtilityFunctions::push_warning(line);
    }
  }
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
  zabloo::DataValue data;
  switch (value.get_type()) {
    case Variant::BOOL:
      data.kind = zabloo::DataValue::Kind::Bool;
      data.boolean = value;
      break;
    case Variant::INT:
    case Variant::FLOAT:
      data.kind = zabloo::DataValue::Kind::Number;
      data.number = value;
      break;
    default:
      data.kind = zabloo::DataValue::Kind::Text;
      data.text = String(value).utf8().get_data();
      break;
  }
  const CharString utf8 = path.utf8();
  document_.set_data(std::string_view(utf8.get_data(), utf8.length()), data);
  relayout();
}

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
  view->layout_frame();
  queue_redraw();
}

/**
 * Upload: one `canvas_item_add_triangle_array` per batch, which is one draw call
 * per batch. G4 (ZAB-137) brings the glyph atlas, and solids join it through the
 * reserved white pixel, so a whole screen of shapes and text becomes one call.
 */
void ZablooView::_draw() {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;

  RenderingServer *server = RenderingServer::get_singleton();
  const RID canvas = get_canvas_item();
  for (const zabloo::Batch &batch : view->paint().batches()) {
    if (batch.empty()) continue;
    const int64_t vertices = static_cast<int64_t>(batch.vertex_count());
    indices_.resize(static_cast<int64_t>(batch.indices.size()));
    points_.resize(vertices);
    colors_.resize(vertices);
    uvs_.resize(vertices);

    int32_t *index_out = indices_.ptrw();
    for (size_t i = 0; i < batch.indices.size(); i++) {
      index_out[i] = static_cast<int32_t>(batch.indices[i]);
    }
    Vector2 *point_out = points_.ptrw();
    Vector2 *uv_out = uvs_.ptrw();
    Color *color_out = colors_.ptrw();
    for (int64_t i = 0; i < vertices; i++) {
      point_out[i] = Vector2(batch.positions[i * 2], batch.positions[i * 2 + 1]);
      uv_out[i] = Vector2(batch.uvs[i * 2], batch.uvs[i * 2 + 1]);
      color_out[i] = Color(batch.colors[i * 4], batch.colors[i * 4 + 1], batch.colors[i * 4 + 2],
                           batch.colors[i * 4 + 3]);
    }
    server->canvas_item_add_triangle_array(canvas, indices_, points_, colors_, uvs_);
  }
}

// --- input ----------------------------------------------------------------

void ZablooView::_gui_input(const Ref<InputEvent> &event) {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;

  // `_gui_input` hands positions already local to this Control, and the core
  // lays out from (0, 0), so there is no transform to undo. That is the entire
  // input half of the adapter for G2; the keyboard and the pad are G7 and G13.
  bool changed = false;
  const Ref<InputEventMouseButton> button = event;
  if (button.is_valid() && button->get_button_index() == MOUSE_BUTTON_LEFT) {
    const Vector2 at = button->get_position();
    changed = button->is_pressed() ? view->pointer_down(at.x, at.y)
                                   : view->pointer_up(at.x, at.y);
    accept_event();
  } else {
    const Ref<InputEventMouseMotion> motion = event;
    if (motion.is_valid()) {
      const Vector2 at = motion->get_position();
      changed = view->pointer_move(at.x, at.y);
    }
  }

  flush_actions();
  // Only when something actually moved: a redraw per mouse motion over an inert
  // panel is a frame nobody asked for.
  if (changed) relayout();
}

void ZablooView::flush_actions() {
  zabloo::View *view = document_.view();
  if (view == nullptr) return;
  for (const zabloo::ActionEvent &action : view->drain_actions()) {
    Dictionary context;
    if (!action.item_path.empty()) context["path"] = String::utf8(action.item_path.c_str());
    emit_signal("action", String::utf8(action.name.c_str()), context);
  }
}
