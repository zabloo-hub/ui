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
#include <godot_cpp/classes/image_texture.hpp>
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/classes/shader.hpp>
#include <godot_cpp/classes/shader_material.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "view.h"

namespace godot {

class ZablooView : public Control {
  GDCLASS(ZablooView, Control)

 public:
  ZablooView();
  ~ZablooView() override = default;

  void _ready() override;
  void _draw() override;
  /**
   * A frame of motion. Enabled only while the core says something is moving, so a
   * still UI is not laid out sixty times a second for nothing.
   */
  void _process(double delta) override;
  void _notification(int what);
  void _gui_input(const Ref<InputEvent> &event) override;
  /**
   * The keyboard, taken here rather than in `_gui_input` for a reason worth
   * writing down: `_gui_input` only fires for the Control the mouse is over, and
   * navigating a menu with the arrows must not need the mouse to be hovering it.
   * Unhandled input reaches the whole tree instead, which is why exactly one
   * view may act on it — see `input_owner.h`.
   */
  void _unhandled_key_input(const Ref<InputEvent> &event) override;

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

  // --- the host channel (`docs/format/host-channel.md`) ---
  // The operations, their arguments and their effects are the contract; only the
  // spelling follows the engine — snake_case here, and the callbacks are signals.

  /**
   * The game→UI data channel. Cached on the document, so it survives a content
   * swap: pushed data outlives the envelope it was pushed for (2026-08-03).
   *
   * Arrays and dictionaries are carried whole: a bound path is an ADDRESS into
   * what was pushed, so `set_data("shop.items", [...])` is what makes
   * `{"bind": "shop.items.1.name"}` resolve.
   */
  void set_data(const String &path, const Variant &value);

  // Each of these answers whether it FOUND the control. A `false` means no node
  // of that type carries that id and nothing was applied — a game looping over
  // ids must not die because one screen was hot-updated out from under it.
  //
  // They are the player's gesture, hooks included: `set_checked` fires the
  // toggle's `onChange` and, inside a group, the group's.

  /** Opens or closes a `Collapse`. */
  bool set_open(const String &id, bool open);
  /** Selects a tab of an `"exclusive-select"` group, by the GROUP's id. */
  bool set_selected_tab(const String &id, int index);
  /** Sets a `Toggle`, or picks an option of an `"exclusive-check"` group. */
  bool set_checked(const String &id, bool checked);
  /** Scrolls a `ScrollView`, clamped to the bounds of the last relayout. */
  bool set_scroll(const String &id, double x, double y);
  /** Re-loads the current content. The same path a hot-update takes. */
  bool reload(const String &json);

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

  /** One texture per live glyph atlas, and the atlas version it was made from. */
  struct AtlasTexture {
    Ref<ImageTexture> texture;
    uint32_t version = 0;
    int size = 0;
  };
  /** Keyed by the core's atlas pointer, which is what a batch names. */
  std::unordered_map<const void *, AtlasTexture> atlases_;

  /** One texture per manifest image, plus whether its bytes refused to decode. */
  struct AssetTexture {
    Ref<ImageTexture> texture;
    /**
     * A decode that failed is remembered, never retried: the bytes will not get
     * better, and a codec running once a frame over a corrupt PNG is a frame
     * budget spent on producing the same error.
     */
    bool failed = false;
  };
  /**
   * Keyed by CONTENT HASH, not by the core's asset pointer.
   *
   * That is what makes a hot-update cheap: `load_envelope` builds a whole new
   * document, so every core-side address changes, but an image whose bytes did
   * not change keeps the texture already decoded for it. The same
   * content-addressed property the platform's CDN and the dev loop's transport
   * are built on (2026-08-11).
   */
  std::unordered_map<std::string, AssetTexture> images_;

  /**
   * One canvas item per clip group of the frame, parented to this Control's own
   * and reused across frames.
   *
   * A child item is what buys an exact scissor without a `Control` per node:
   * `canvas_item_set_clip` + `canvas_item_set_custom_rect` is the very mechanism
   * `Control.clip_contents` uses, reached directly. The rects the core computes
   * are already in this Control's local space, and a child item with no
   * transform of its own shares it, so nothing has to be converted.
   */
  struct ClipItem {
    RID item;
    /** Only a ROUNDED region needs one: the scissor alone cuts a square. */
    Ref<ShaderMaterial> material;
  };
  std::vector<ClipItem> clip_items_;
  /**
   * The rounded half of clipping, shared by every rounded group: the scissor has
   * already cut everything outside the rect, so all that is left is discarding
   * the four corners as a signed distance faded over one device pixel. Verbatim
   * the reference's (ZAB-7) — stencil was the obvious alternative and costs a
   * buffer, mask geometry and a push/pop state machine per nesting level, and
   * still leaves the cut aliased.
   */
  Ref<Shader> clip_shader_;

  /** Claims the item for one group, clearing it and arming its region. */
  RID clip_item(size_t index, const zabloo::Clip *clip, int draw_index);
  /** Hands every canvas item back to the server. */
  void free_clip_items();

  /** Re-runs the core's layout against the current control size and redraws. */
  void relayout();
  /** The engine's monotonic clock in milliseconds — the one the core is given. */
  double clock_ms() const;
  /**
   * Brings the atlas textures up to date with the core's live atlases: uploads
   * the ones that gained glyphs, and forgets the ones the LRU dropped.
   *
   * A sweep rather than a callback (see `View::fonts`): eight entries at most,
   * and one mechanism answers both "did it grow?" and "is it gone?".
   */
  void sync_atlases();
  /**
   * Emits what the last input produced: the named actions, and the values the
   * controls wrote back through their bindings.
   *
   * Drained after the fact rather than emitted from inside the core, so a signal
   * handler never runs in the middle of a layout pass — and so a game that
   * re-enters the view from one (a `set_data` in response to an action) finds it
   * in a settled state.
   */
  void flush_events();
  /**
   * The same sweep for the manifest images: decodes the ones newly in play, and
   * drops the textures of hashes the current envelope no longer references —
   * which is what makes a reload release what it stopped using, with no eviction
   * callback anywhere in the core.
   *
   * Decoding is where the engine earns its keep: the core carries the bytes and
   * refuses to own a codec (zero dependencies), and Godot already has one.
   */
  void sync_images();
  /** One asset's bytes through Godot's own codec, chosen by the manifest's MIME. */
  AssetTexture decode(const zabloo::ImageAsset &asset);
  /** Emits everything the last input produced as `action` signals. */
  void flush_actions();
  void report_diagnostics() const;
};

}  // namespace godot
