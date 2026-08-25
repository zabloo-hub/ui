// The adapter: a Godot node that hands the core's triangles to a draw call.
//
// Everything this file does is translation. Layout, text, tessellation, styles,
// hit-testing and the loader all live in `core/`, which knows about no engine at
// all; what is left over here is exactly the shape of the frontier drawn in
// ZAB-134 — upload geometry, turn `InputEvent` into the core's intentions, and
// expose the results as Godot signals. If something else ends up in this file,
// it has fallen out of the golden corpus's reach, because that runs against the
// core alone.
//
// Godot's own layout is deliberately unused: `ZablooView` is a `Control` for its
// input and its rect, and every child rect inside it is computed by our flex
// pass. Anchors and Containers would be a second layout system disagreeing with
// the one every other target runs.

#pragma once

#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>

#include "view.h"

namespace godot {

class ZablooView : public Control {
  GDCLASS(ZablooView, Control)

 public:
  ZablooView();
  ~ZablooView() override = default;

  void _ready() override;
  void _draw() override;
  void _notification(int what);
  void _gui_input(const Ref<InputEvent> &event) override;

  /**
   * The one loading path (2026-08-01): a file imported by hand, a dev push and a
   * platform hot-update all arrive through `load_envelope`.
   *
   * It never fails loudly. A payload the core refuses leaves whatever is on
   * screen exactly where it was, and says why in `get_diagnostics()`.
   */
  bool load_envelope(const String &json);
  /** Reads `path` (`res://`, `user://`, absolute) and loads what is in it. */
  bool load_file(const String &path);
  /** Switches to another view of the loaded envelope. */
  bool show_view(const String &id);

  /** Every diagnostic of the last load, worst first, as readable lines. */
  PackedStringArray get_diagnostics() const;
  /** True once an envelope has loaded — a refused one does not count. */
  bool is_loaded() const;

  /**
   * The game→UI data channel. Cached on the document, so it survives a content
   * swap: pushed data outlives the envelope it was pushed for (2026-08-03).
   * Bound props start reading it in G7 (ZAB-140).
   */
  void set_data(const String &path, const Variant &value);

  void set_envelope_path(const String &path);
  String get_envelope_path() const;
  void set_view_id(const String &id);
  String get_view_id() const;

 protected:
  static void _bind_methods();

 private:
  zabloo::Document document_;
  String envelope_path_;
  String view_id_;

  // Reused across frames: `resize` keeps the buffer when the size has not
  // changed, so a steady-state redraw does not allocate four arrays.
  PackedInt32Array indices_;
  PackedVector2Array points_;
  PackedColorArray colors_;
  PackedVector2Array uvs_;

  /** Re-runs the core's layout against the current control size and redraws. */
  void relayout();
  /** Emits everything the last input produced as `action` signals. */
  void flush_actions();
  void report_diagnostics() const;
};

}  // namespace godot
