/*
 * The core's C ABI (UN2, ZAB-195): the second door into the core.
 *
 * Godot and Unreal enter through C++ (`view.h`). Unity — and anything else with
 * an FFI, one day the visual editor's WASM canvas — enters through C, and this
 * header IS that door. It wraps `view.h`; it never edits it. If a binding needs
 * something the C++ surface does not expose, that is a small, separate change to
 * the core, not a patch inside `capi/`.
 *
 * The contract, in one place, because a C# transcription reads it field by field
 * (`sdk/unity/Runtime/Interop/NativeMethods.cs`):
 *
 *  - C11, `extern "C"`, every symbol marked `ZB_EXPORT` and nothing else visible.
 *  - Opaque handles (`zb_document`, `zb_view`, `zb_pad`). No C++ type and no
 *    `std::string` ever crosses. Strings are UTF-8 with an EXPLICIT length, in
 *    both directions: `const char *, size_t` going in, `zb_str` coming out (also
 *    NUL-terminated, as a courtesy to C callers — the length is the contract).
 *  - NO callback from native to managed. Everything the core produces — named
 *    actions, values controls wrote back, diagnostics — is DRAINED after the
 *    frame, which is what the Godot adapter already does (`flush_events`) and
 *    what an AOT-safe bridge under IL2CPP needs.
 *  - No exceptions cross. The host channel's `bool`s come back as `int`
 *    (1 = true, 0 = false).
 *  - ONE thread: every call on a document, its view and its pad happens on the
 *    thread that created the document.
 *  - Values travel as JSON in both directions (`zb_document_set_data_json`, and
 *    `zb_data_change.value_json`): one marshalling rule for bool / number /
 *    string / array / object instead of a visitor API. Numbers are written the
 *    way `String(number)` writes them in ECMA-262 — locale-free, shortest
 *    round-trip — so a game running under a Spanish locale still gets `0.5`.
 *  - Pointer LIFETIMES are written on every function that hands one out. The
 *    rule of thumb: what `zb_view_paint` returns is good until the next paint;
 *    an atlas's pixels until the next `zb_view_layout_frame`; a diagnostic's
 *    strings until the next `zb_document_load`; a drained array until the next
 *    drain of the same kind. That is what lets C# read them as `NativeArray`
 *    views without a copy.
 *
 * Coordinates are the core's: view-space pixels, y DOWN, origin top-left. The
 * adapter flips on its own transform if its engine wants y up (UN4).
 */

#ifndef ZABLOO_CAPI_H
#define ZABLOO_CAPI_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#if defined(ZB_BUILDING)
#define ZB_EXPORT __declspec(dllexport)
#elif defined(ZB_SHARED)
#define ZB_EXPORT __declspec(dllimport)
#else
#define ZB_EXPORT
#endif
#else
#define ZB_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* --- handles --------------------------------------------------------------- */

/** One loaded envelope and the data the game pushed. The game's stable handle. */
typedef struct zb_document zb_document;
/**
 * The view on screen. Owned by its document: the pointer `zb_document_view`
 * hands out is stable for the document's life and always names whatever view is
 * on screen NOW — a `load` or a `show` swaps the view underneath it, never the
 * handle. Everything cached off it (batches, strings, pixels) follows the
 * per-function lifetimes below.
 */
typedef struct zb_view zb_view;
/**
 * A gamepad's poll loop — the device's state, which is why it is not the view's:
 * a hot-update rebuilds the view, and a button held across it must stay held.
 */
typedef struct zb_pad zb_pad;

/* --- values ---------------------------------------------------------------- */

/** A string coming OUT of the core: UTF-8, `len` bytes, also NUL-terminated. */
typedef struct zb_str {
  const char *data;
  size_t len;
} zb_str;

/** A clipping region a batch is cut to. `radius` 0 means square corners. */
typedef struct zb_clip {
  double x;
  double y;
  double width;
  double height;
  double radius;
} zb_clip;

/** What `zb_batch.texture` points at. */
enum {
  ZB_TEXTURE_NONE = 0,
  /** A glyph atlas: `zb_view_atlas_info` finds it by handle. LA8 pixels. */
  ZB_TEXTURE_GLYPHS = 1,
  /** A manifest image: `zb_view_image_info` finds it by handle. Encoded bytes. */
  ZB_TEXTURE_IMAGE = 2
};

/**
 * One draw call: a run of triangles sharing a texture and a clip region.
 *
 * The arrays are the core's own, separate (not interleaved) because that is what
 * every engine's immediate API asks for: `positions` is `x, y` per vertex,
 * `uvs` is `u, v`, `colors` is `r, g, b, a` with the inherited opacity already
 * in the alpha, `indices` are `index_count` triangle corners. Valid until the
 * next `zb_view_paint` on the same view, or the next `zb_document_load`.
 *
 * Batches arrive in DRAW ORDER, grouped by `group` — the clip group's ordinal
 * this frame. Group by the ordinal and not by the region: two adjacent groups
 * may share a region (both unclipped, typically) and still have to be drawn one
 * after the other (`start_root` in `tessellator.h`). Inside a group the order is
 * solids, then one batch per image, then one per glyph atlas, and that order is
 * visible — the reference paints it, so a target that reordered would answer
 * the same envelope with a different picture. Empty batches are not listed.
 */
typedef struct zb_batch {
  const float *positions;
  const float *uvs;
  const float *colors;
  const uint32_t *indices;
  uint32_t vertex_count;
  uint32_t index_count;
  /** Atlas or image handle, or NULL for untextured geometry (every solid). */
  const void *texture;
  /** One of `ZB_TEXTURE_*`. */
  int32_t texture_kind;
  /** The region to scissor to (and, with a radius, to discard corners of), or NULL. */
  const zb_clip *clip;
  uint32_t group;
} zb_batch;

/** A painted frame: `batch_count` batches in draw order. */
typedef struct zb_frame {
  const zb_batch *batches;
  uint32_t batch_count;
} zb_frame;

/** One live glyph atlas. */
typedef struct zb_atlas_info {
  /** What a `zb_batch.texture` of kind `ZB_TEXTURE_GLYPHS` names. */
  const void *handle;
  /** Bumped every time the pixels change: re-upload when it moved. */
  uint32_t version;
  /** Side in pixels. Square, a power of two, and it can GROW (then re-create). */
  int32_t size;
  /**
   * `size * size * 2` bytes, LA8 row-major: luminance always 255, alpha is the
   * coverage. Valid until the next `zb_view_layout_frame` or `zb_view_paint` on
   * this view — either may rasterize a glyph and grow the surface.
   */
  const uint8_t *pixels;
  size_t pixel_bytes;
} zb_atlas_info;

/**
 * One manifest image the view has resolved. The core carries the ENCODED bytes
 * and decodes nothing: the engine's own codec turns them into a texture, keyed by
 * `hash` so a hot-update that ships the same picture keeps the texture it has.
 */
typedef struct zb_image_info {
  /** What a `zb_batch.texture` of kind `ZB_TEXTURE_IMAGE` names. */
  const void *handle;
  /** Content hash — the key a texture cache should use. */
  zb_str hash;
  /** `image/png`, `image/jpeg`… as the manifest declared it. */
  zb_str mime;
  /**
   * The encoded file, decoded from its base64 once and cached. Valid until the
   * next `zb_view_paint` (which sweeps assets the frame no longer references) or
   * the next `zb_document_load`. `byte_count` is 0 for an entry with no data.
   */
  const uint8_t *bytes;
  size_t byte_count;
  /** Intrinsic size from the manifest; 0 when it carried none (see `adopt_size`). */
  double width;
  double height;
} zb_image_info;

/** The keys a focused text field claims (`EditKey` in `view.h`, same order). */
enum {
  ZB_KEY_OTHER = 0,
  ZB_KEY_LEFT = 1,
  ZB_KEY_RIGHT = 2,
  ZB_KEY_HOME = 3,
  ZB_KEY_END = 4,
  ZB_KEY_BACKSPACE = 5,
  ZB_KEY_DELETE = 6,
  ZB_KEY_SUBMIT = 7,
  ZB_KEY_TAB = 8,
  ZB_KEY_SPACE = 9,
  /** Ctrl/Cmd+A. Only meaningful with `shortcut` set. */
  ZB_KEY_SELECT_ALL = 10
};

/** A keystroke as an INTENTION, not a platform event (see `KeyIntent`). */
typedef struct zb_key_intent {
  /** One of `ZB_KEY_*`. */
  int32_t key;
  int32_t shift;
  /** Ctrl on most platforms, Cmd on macOS: the adapter decides which. */
  int32_t shortcut;
  /** The OS repeating a held key — a held Enter is not a second submission. */
  int32_t repeat;
} zb_key_intent;

/**
 * The text field holding the focus, as an adapter's keyboard half needs it
 * (UN5, ZAB-198): where to put the IME's candidate list, what to hand a phone's
 * on-screen keyboard, and the phase the caret blinks at. Nothing here is an
 * intention — the field's state stays the core's — which is why it is a
 * struct to read and not a set of calls.
 */
typedef struct zb_field_info {
  /** The field's rect in view space (y down), scroll already applied. */
  double x;
  double y;
  double width;
  double height;
  /**
   * What the field holds right now, UTF-8. Valid until the next edit of the
   * field — a key, a paste, a composition, `zb_view_set_text` — or the next
   * `zb_view_layout_frame` or load. Read it, do not keep it.
   */
  zb_str text;
  /**
   * When the last edit landed, on the view's clock (`zb_view_set_now`). The
   * blink is a closed form of the time since: the caret is visible for the
   * first half of every `blink_ms` period, so the only frames a blink needs are
   * the two per period on which that answer changes (ZAB-73, ZAB-144).
   */
  double caret_since;
  double blink_ms;
  /** An IME composition is in flight. */
  int32_t composing;
} zb_field_info;

/**
 * One poll's worth of a gamepad, in the STANDARD MAPPING's indices
 * (https://w3c.github.io/gamepad/#remapping): A = 0, B = 1, d-pad = 12..15,
 * left stick = axes 0/1, right stick = 2/3. An engine numbers its buttons its
 * own way; the adapter translates on the way in, so one vocabulary reaches the
 * core whatever device produced it. Short arrays are fine: a missing index is
 * "not pressed" / "at rest".
 */
typedef struct zb_pad_snapshot {
  /** One byte per button, non-zero = pressed. */
  const uint8_t *buttons;
  size_t button_count;
  /** -1..1 per axis. */
  const double *axes;
  size_t axis_count;
} zb_pad_snapshot;

/**
 * A named action leaving the UI for the game — `onClick: "buy"` — with the
 * `ActionContext` it fired from (ZAB-29): the innermost `Repeat` item, or an
 * empty `item_path` for an action from the document itself.
 */
typedef struct zb_action {
  zb_str name;
  zb_str item_path;
  /** The item's raw key, absent when identity is positional. */
  int32_t has_key;
  int32_t key_is_number;
  double key_number;
  zb_str key_text;
  /** The item's index in its array. Meaningless without `item_path`. */
  int32_t index;
} zb_action;

/** A control writing its own value back through a bound path (ZAB-23). */
typedef struct zb_data_change {
  zb_str path;
  /** The value, as JSON: `true`, `0.35`, `"Sergi"`… */
  zb_str value_json;
} zb_data_change;

/** What the last paint cost — `FrameStats` in `view.h`. Telemetry, not contract. */
typedef struct zb_frame_stats {
  uint32_t draw_calls;
  uint32_t vertices;
  uint32_t indices;
  uint32_t atlases;
  uint64_t atlas_bytes;
  uint32_t resolved;
  uint32_t text_layouts;
  uint32_t buffer_growths;
  int32_t repaint_only;
} zb_frame_stats;

/** `zb_diagnostic.level`. */
enum { ZB_DIAGNOSTIC_WARN = 0, ZB_DIAGNOSTIC_FATAL = 1 };

/** `zb_diagnostic.code` — `DiagnosticCode` in `diagnostics.h`, same order. */
enum {
  ZB_DIAGNOSTIC_INVALID_JSON = 0,
  ZB_DIAGNOSTIC_NOT_AN_OBJECT = 1,
  ZB_DIAGNOSTIC_MISSING_VERSION = 2,
  ZB_DIAGNOSTIC_UNSUPPORTED_VERSION = 3,
  ZB_DIAGNOSTIC_MISSING_VIEWS = 4,
  ZB_DIAGNOSTIC_NO_USABLE_VIEWS = 5,
  ZB_DIAGNOSTIC_INVALID_TOKENS = 6,
  ZB_DIAGNOSTIC_INVALID_TOKEN = 7,
  ZB_DIAGNOSTIC_INVALID_ASSETS = 8,
  ZB_DIAGNOSTIC_INVALID_ASSET = 9,
  ZB_DIAGNOSTIC_INVALID_NODE = 10,
  ZB_DIAGNOSTIC_INVALID_PROP = 11,
  ZB_DIAGNOSTIC_INVALID_BINDING = 12,
  ZB_DIAGNOSTIC_TOO_DEEP = 13,
  ZB_DIAGNOSTIC_DUPLICATE_ID = 14,
  ZB_DIAGNOSTIC_UNKNOWN_TOKEN = 15,
  ZB_DIAGNOSTIC_UNKNOWN_ASSET = 16,
  ZB_DIAGNOSTIC_UNKNOWN_ANCHOR = 17
};

/**
 * What a load (or a view's build) found. The `code_name` — `"invalid-node"`,
 * `"unsupported-version"` — is the wire spelling and the contract: the same input
 * produces the same code here as in `@zabloo/format`.
 */
typedef struct zb_diagnostic {
  /** `ZB_DIAGNOSTIC_WARN` or `ZB_DIAGNOSTIC_FATAL`. */
  int32_t level;
  /** One of `ZB_DIAGNOSTIC_*` codes. */
  int32_t code;
  zb_str code_name;
  /** Where, as a path into the envelope. Empty is the envelope itself. */
  zb_str path;
  zb_str message;
} zb_diagnostic;

/**
 * `sizeof` every struct above, as THIS build laid them out. A binding asserts
 * these against its own transcription (`Marshal.SizeOf` in C#): a field missing,
 * mistyped or misaligned on either side shows up here before any corpus case can.
 */
typedef struct zb_abi_size_table {
  uint32_t str;
  uint32_t clip;
  uint32_t batch;
  uint32_t frame;
  uint32_t atlas_info;
  uint32_t image_info;
  uint32_t key_intent;
  uint32_t pad_snapshot;
  uint32_t action;
  uint32_t data_change;
  uint32_t frame_stats;
  uint32_t diagnostic;
  uint32_t abi_size_table;
  uint32_t field_info;
} zb_abi_size_table;

/* --- the library ----------------------------------------------------------- */

/**
 * The version this binary was built as — the npm `fixed` group's, the one number
 * that answers "which SDK goes with the packages I installed" (2026-09-03, G17).
 * NUL-terminated, static, valid forever.
 */
ZB_EXPORT const char *zb_version(void);

/** Fills `out` with the sizes of every ABI struct. See `zb_abi_size_table`. */
ZB_EXPORT void zb_abi_sizes(zb_abi_size_table *out);

/* --- the document ---------------------------------------------------------- */

ZB_EXPORT zb_document *zb_document_create(void);
/** Destroys the document, its view and everything they handed out. NULL is fine. */
ZB_EXPORT void zb_document_destroy(zb_document *doc);

/**
 * The one loading path: a file imported by hand, a dev push and a platform
 * hot-update all arrive here. It never fails loudly. A payload the core refuses
 * leaves the previous one ON SCREEN and returns 0 — a corrupt hot-update costs
 * the update, not the session (ZAB-37); `zb_document_diagnostic` says why.
 *
 * On success the view that was on screen keeps its place if the new envelope
 * still has it, and the first view takes over otherwise. Data the game pushed
 * survives the swap.
 */
ZB_EXPORT int zb_document_load(zb_document *doc, const char *json, size_t json_len);
/** 1 once an envelope has loaded — a refused one does not count. */
ZB_EXPORT int zb_document_loaded(const zb_document *doc);
/** Shows a view by id. 0 if this envelope has no such view; nothing changes then. */
ZB_EXPORT int zb_document_show(zb_document *doc, const char *view_id, size_t view_id_len);
/** The view on screen, or NULL before the first successful load. See `zb_view`. */
ZB_EXPORT zb_view *zb_document_view(zb_document *doc);

/** Diagnostics of the last load, whether it took or not. */
ZB_EXPORT uint32_t zb_document_diagnostic_count(const zb_document *doc);
/**
 * The i-th diagnostic, worst first. 0 for an index out of range. Its strings are
 * valid until the next `zb_document_load`.
 */
ZB_EXPORT int zb_document_diagnostic(const zb_document *doc, uint32_t index,
                                     zb_diagnostic *out);

/**
 * The game→UI data channel. `value_json` is any JSON value — a number, a string,
 * `true`, an array, an object — and a bound path is an ADDRESS into what was
 * pushed: `"shop.items"` set to `[{"name": "…"}]` is what makes
 * `{"bind": "shop.items.1.name"}` resolve. Cached on the document, so pushed data
 * outlives the view it was pushed for (2026-08-03).
 *
 * Returns 0 and writes NOTHING when `value_json` is not valid JSON.
 */
ZB_EXPORT int zb_document_set_data_json(zb_document *doc, const char *path, size_t path_len,
                                        const char *value_json, size_t value_json_len);

/* --- the view: size, clock, frames ---------------------------------------- */

/** The viewport the tree is laid out against, in view-space units. */
ZB_EXPORT void zb_view_set_size(zb_view *view, double width, double height);
/**
 * The clock every tween reads, in milliseconds. INJECTED: the core never asks
 * what time it is, which is what lets a harness plant a frame at an exact
 * instant. Give it a monotonic engine clock; ignore delta time.
 */
ZB_EXPORT void zb_view_set_now(zb_view *view, double milliseconds);
ZB_EXPORT double zb_view_now(const zb_view *view);
/** Resolve → measure → arrange. Everything geometric happens here. */
ZB_EXPORT void zb_view_layout_frame(zb_view *view);
/**
 * Whether the last frame left anything moving — a tween, a Spinner, an armed
 * `autoCloseMs`. Ask for the next frame while it is 1, and stop when it is not.
 */
ZB_EXPORT int zb_view_animating(const zb_view *view);
/**
 * Tessellates the arranged tree into `out`. Call after `zb_view_layout_frame`
 * (a paint without a layout in between is a REPAINT — what a blinking caret
 * costs — and `zb_view_stats` says so). The frame's arrays are valid until the
 * next paint on this view or the next load. Paint FIRST, then sweep the atlases:
 * a text field rasterizes its glyphs while painting (ZAB-144).
 */
ZB_EXPORT void zb_view_paint(zb_view *view, zb_frame *out);

/**
 * The live glyph atlases, least recently used first. Sweep them every frame:
 * an atlas gone from the list was evicted, one whose `version` moved has new
 * pixels, one whose `size` grew needs a new texture. At most eight.
 */
ZB_EXPORT uint32_t zb_view_atlas_count(const zb_view *view);
/** 0 for an index out of range. */
ZB_EXPORT int zb_view_atlas_info(const zb_view *view, uint32_t index, zb_atlas_info *out);

/** The manifest images the view has resolved, in first-sight order. Same sweep. */
ZB_EXPORT uint32_t zb_view_image_count(const zb_view *view);
/** 0 for an index out of range. Decodes the entry's base64 on first sight. */
ZB_EXPORT int zb_view_image_info(zb_view *view, uint32_t index, zb_image_info *out);
/**
 * What the engine decoded, for an image whose manifest carried no size. The
 * manifest always wins — it is what layout already reserved — so this only fills
 * a gap; 1 when it did, which is the cue to lay out again.
 */
ZB_EXPORT int zb_view_image_adopt_size(zb_view *view, const void *image_handle, double width,
                                       double height);

/**
 * What building this view's runtime found — a malformed group, an anchor that
 * cannot take input. Reported once per load next to the document's own; the
 * Godot adapter prints both. Strings valid until the next load or show.
 */
ZB_EXPORT uint32_t zb_view_warning_count(const zb_view *view);
ZB_EXPORT int zb_view_warning(const zb_view *view, uint32_t index, zb_diagnostic *out);

/* --- pointer --------------------------------------------------------------- */
/*
 * Each answers "did anything change?", so the adapter only redraws when
 * something did. `mouse` separates a cursor from a finger: hover is a mouse
 * state, so a touch that taps and leaves must not leave a control lit up.
 */

ZB_EXPORT int zb_view_pointer_move(zb_view *view, double x, double y, int mouse);
ZB_EXPORT int zb_view_pointer_down(zb_view *view, double x, double y, int mouse);
ZB_EXPORT int zb_view_pointer_up(zb_view *view, double x, double y, int mouse);
/** A wheel notch or a trackpad pan, in view-space pixels, at a point. */
ZB_EXPORT int zb_view_pointer_wheel(zb_view *view, double x, double y, double dx, double dy);
/** The pointer left the surface: whatever it held is released, nothing fires. */
ZB_EXPORT int zb_view_pointer_exit(zb_view *view);
/** The gesture ended without concluding: every hold dropped, nothing fires (ZAB-70). */
ZB_EXPORT int zb_view_pointer_cancel(zb_view *view);

/* --- keyboard, text entry and directional navigation ---------------------- */

/**
 * The keys a focused text field claims; 1 if it consumed this one. 0 lets the
 * ordinary handling run — which is what makes ↑/↓, and a ←/→ against an end,
 * navigate away instead of trapping the player (ZAB-26).
 */
ZB_EXPORT int zb_view_edit_key(zb_view *view, const zb_key_intent *intent);
/** Text into the focused field: a keystroke's character, a paste. Honors `maxLength`. */
ZB_EXPORT int zb_view_insert_text(zb_view *view, const char *text, size_t text_len);
/** An IME composition. Each update REPLACES the previous; the game is not told. */
ZB_EXPORT int zb_view_set_composition(zb_view *view, const char *text, size_t text_len);
ZB_EXPORT int zb_view_end_composition(zb_view *view);
/**
 * What a copy or a cut would take: the focused field's selection, or empty.
 * Fills `out`; the bytes are valid until the next call to this function on this
 * view, or the next load. Returns 1 when there is a selection, 0 for none.
 */
ZB_EXPORT int zb_view_field_selection_text(zb_view *view, zb_str *out);
/**
 * The text field holding the focus, or 0 when the focus is elsewhere or
 * nowhere (`out` is then zeroed). What an adapter arms the IME, the on-screen
 * keyboard and the caret's blink from — see `zb_field_info` for the lifetimes.
 */
ZB_EXPORT int zb_view_focused_field(const zb_view *view, zb_field_info *out);

/** Moves the focus along a unit axis. 0 when nothing moved. */
ZB_EXPORT int zb_view_move_focus(zb_view *view, double dx, double dy);
/** Press (`down` = 1) / release (0) the focused node. Releasing activates. */
ZB_EXPORT int zb_view_press_focused(zb_view *view, int down);
/**
 * Asks the modal that owns the input to close — Escape, or B on a pad. 0 when no
 * modal is up, and that answer matters: an Escape this view did not use belongs
 * to the game's own pause menu.
 */
ZB_EXPORT int zb_view_dismiss_top_modal(zb_view *view);
/** Releases the focused node's press WITHOUT activating it — an unplugged pad. */
ZB_EXPORT int zb_view_cancel_focused_press(zb_view *view);
/** Scrolls the `ScrollView` the focus lives in, by a pixel delta. */
ZB_EXPORT int zb_view_scroll_focused_by(zb_view *view, double dx, double dy);
/**
 * The arrow key adjusting a `Slider` was let go: the gesture ends and `onCommit`
 * fires if the value moved. The core is told about presses, not releases, so the
 * adapter — which sees the key come up — says so (ZAB-143).
 */
ZB_EXPORT int zb_view_settle_slider_keys(zb_view *view);

/* --- the host channel, by id (`docs/format/host-channel.md`) --------------- */
/*
 * Each answers whether it FOUND the control: 0 means no node of that type
 * carries that id and nothing was applied. They are the player's gesture, hooks
 * included.
 */

ZB_EXPORT int zb_view_set_open(zb_view *view, const char *id, size_t id_len, int open);
ZB_EXPORT int zb_view_set_selected_tab(zb_view *view, const char *id, size_t id_len,
                                       int32_t index);
ZB_EXPORT int zb_view_set_checked(zb_view *view, const char *id, size_t id_len, int checked);
ZB_EXPORT int zb_view_set_value(zb_view *view, const char *id, size_t id_len, double value);
ZB_EXPORT int zb_view_set_text(zb_view *view, const char *id, size_t id_len, const char *text,
                               size_t text_len);
ZB_EXPORT int zb_view_set_scroll(zb_view *view, const char *id, size_t id_len, double x,
                                 double y);

/* --- draining what the last input produced -------------------------------- */

/**
 * Named actions produced since the last drain, in the order they fired. Writes
 * the array into `*out` and returns its length; the array (and every string in
 * it) is valid until the next `zb_view_drain_actions` on this view, or the next
 * load. Drained means drained: each action is read exactly once.
 */
ZB_EXPORT uint32_t zb_view_drain_actions(zb_view *view, const zb_action **out);
/** Values controls wrote back since the last drain. Same lifetime rule. */
ZB_EXPORT uint32_t zb_view_drain_data_changes(zb_view *view, const zb_data_change **out);

/* --- telemetry and the cross-target contract ------------------------------ */

/** What the last paint cost. Zeros before one. */
ZB_EXPORT void zb_view_stats(const zb_view *view, zb_frame_stats *out);
/**
 * The `ViewSnapshot` of the frame on screen, as the bytes a golden file holds —
 * what UN10 compares against `golden/metrics/`. Fills `out`; valid until the
 * next call to this function on this view, or the next load. Always returns 1:
 * a view that exists has a frame to report.
 */
ZB_EXPORT int zb_view_snapshot_json(zb_view *view, zb_str *out);

/* --- the gamepad ----------------------------------------------------------- */

ZB_EXPORT zb_pad *zb_pad_create(void);
ZB_EXPORT void zb_pad_destroy(zb_pad *pad);
/** A pad arrived, at this instant (the scroll stick moves px per SECOND). */
ZB_EXPORT void zb_pad_connect(zb_pad *pad, double now);
/**
 * One poll: reads the snapshot and hands each intention to the view. 1 if
 * anything changed. Poll every frame while a pad is connected — the device is
 * read, it never pushes.
 */
ZB_EXPORT int zb_pad_poll(zb_pad *pad, zb_view *view, const zb_pad_snapshot *snapshot,
                          double now);
/**
 * The pad went away: a press in flight CANCELS and a Slider being nudged
 * SETTLES (ZAB-47). `view` may be NULL when there is nothing left to tell.
 */
ZB_EXPORT int zb_pad_disconnect(zb_pad *pad, zb_view *view);
/** Whether a direction is being held right now — the repeat clock is running. */
ZB_EXPORT int zb_pad_holding(const zb_pad *pad);

#ifdef __cplusplus
}
#endif

#endif /* ZABLOO_CAPI_H */
