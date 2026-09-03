// The C ABI's implementation: `zabloo.h` over `view.h`, and nothing more.
//
// Every function here is a translation — a `std::string_view` built from a
// pointer and a length, a `bool` widened to an `int`, a vector's `data()` handed
// out as a pointer with the lifetime the header promises. What is NOT here is
// deliberate: no layout, no text, no input rules, no state. Anything of that
// kind would fall out of the golden corpus's reach on the C++ side and be tested
// twice on this one.
//
// The wrapper state that does exist is exactly what a C caller cannot hold:
// a frame's batches in C shape (the core's `Batch` carries vectors), decoded
// image bytes, the drained arrays, and the last snapshot string. Each lives on
// the handle that hands it out and dies with it.

#define ZB_BUILDING 1
#include "zabloo.h"

#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "assets.h"
#include "diagnostics.h"
#include "glyphs.h"
#include "json.h"
#include "json_value.h"
#include "pad.h"
#include "snapshot.h"
#include "tessellator.h"
#include "view.h"

// Written by `core/SConstruct` from `packages/format/package.json` — a header
// rather than a `-D`, so the quoted string never meets a shell. A build that did
// not write it (another build system picking these sources up) gets a version
// that says so instead of a wrong one.
#if defined(__has_include)
#if __has_include("zb_version.h")
#include "zb_version.h"
#endif
#endif
#ifndef ZB_VERSION
#define ZB_VERSION "0.0.0-dev"
#endif

using namespace zabloo;

namespace {

std::string_view text_of(const char *data, size_t len) {
  return data == nullptr ? std::string_view() : std::string_view(data, len);
}

zb_str str_of(const std::string &text) { return zb_str{text.c_str(), text.size()}; }

zb_str str_of(const char *text) { return zb_str{text, text == nullptr ? 0 : std::strlen(text)}; }

void fill_diagnostic(const Diagnostic &diagnostic, zb_diagnostic *out) {
  out->level = diagnostic.level == DiagnosticLevel::Fatal ? ZB_DIAGNOSTIC_FATAL : ZB_DIAGNOSTIC_WARN;
  out->code = static_cast<int32_t>(diagnostic.code);
  out->code_name = str_of(diagnostic_code_name(diagnostic.code));
  out->path = str_of(diagnostic.path);
  out->message = str_of(diagnostic.message);
}

}  // namespace

/**
 * The view handle. Owned by the document (see `zb_view` in the header): the
 * address is stable, and `view` is re-pointed by every load and show.
 */
struct zb_view {
  View *view = nullptr;

  // --- one painted frame, in C shape ---
  /** The regions of this frame, one per distinct core clip, so identity holds. */
  std::vector<zb_clip> clips;
  std::vector<zb_batch> batches;

  // --- image bytes, decoded once per asset and kept while the asset lives ---
  std::unordered_map<const ImageAsset *, std::vector<uint8_t>> image_bytes;

  // --- the drained arrays ---
  std::vector<ActionEvent> actions;
  std::vector<zb_action> action_views;
  std::vector<DataChange> changes;
  std::vector<std::string> change_json;
  std::vector<zb_data_change> change_views;

  std::string snapshot;
  std::string selection;

  /** Everything cached off a view that is about to be replaced. */
  void forget() {
    clips.clear();
    batches.clear();
    image_bytes.clear();
    actions.clear();
    action_views.clear();
    changes.clear();
    change_json.clear();
    change_views.clear();
    snapshot.clear();
    selection.clear();
  }
};

struct zb_document {
  Document document;
  zb_view view;

  /** Re-points the handle at whatever the document shows now. */
  void sync_view() {
    View *current = document.view();
    if (view.view != current) {
      view.forget();
      view.view = current;
    }
  }
};

struct zb_pad {
  PadController controller;
  /** Kept alive across polls so a poll allocates nothing in steady state. */
  PadSnapshot snapshot;
};

// --- the library ------------------------------------------------------------

extern "C" {

ZB_EXPORT const char *zb_version(void) { return ZB_VERSION; }

ZB_EXPORT void zb_abi_sizes(zb_abi_size_table *out) {
  if (out == nullptr) return;
  out->str = static_cast<uint32_t>(sizeof(zb_str));
  out->clip = static_cast<uint32_t>(sizeof(zb_clip));
  out->batch = static_cast<uint32_t>(sizeof(zb_batch));
  out->frame = static_cast<uint32_t>(sizeof(zb_frame));
  out->atlas_info = static_cast<uint32_t>(sizeof(zb_atlas_info));
  out->image_info = static_cast<uint32_t>(sizeof(zb_image_info));
  out->key_intent = static_cast<uint32_t>(sizeof(zb_key_intent));
  out->pad_snapshot = static_cast<uint32_t>(sizeof(zb_pad_snapshot));
  out->action = static_cast<uint32_t>(sizeof(zb_action));
  out->data_change = static_cast<uint32_t>(sizeof(zb_data_change));
  out->frame_stats = static_cast<uint32_t>(sizeof(zb_frame_stats));
  out->diagnostic = static_cast<uint32_t>(sizeof(zb_diagnostic));
  out->abi_size_table = static_cast<uint32_t>(sizeof(zb_abi_size_table));
}

// --- the document -----------------------------------------------------------

ZB_EXPORT zb_document *zb_document_create(void) { return new zb_document(); }

ZB_EXPORT void zb_document_destroy(zb_document *doc) { delete doc; }

ZB_EXPORT int zb_document_load(zb_document *doc, const char *json, size_t json_len) {
  if (doc == nullptr) return 0;
  const bool ok = doc->document.load(text_of(json, json_len));
  // A refused payload leaves the view where it was — and so its caches, whose
  // lifetimes the header ties to a SUCCESSFUL load.
  if (ok) doc->sync_view();
  return ok ? 1 : 0;
}

ZB_EXPORT int zb_document_loaded(const zb_document *doc) {
  return doc != nullptr && doc->document.loaded() ? 1 : 0;
}

ZB_EXPORT int zb_document_show(zb_document *doc, const char *view_id, size_t view_id_len) {
  if (doc == nullptr) return 0;
  const bool ok = doc->document.show(text_of(view_id, view_id_len));
  if (ok) doc->sync_view();
  return ok ? 1 : 0;
}

ZB_EXPORT zb_view *zb_document_view(zb_document *doc) {
  if (doc == nullptr) return nullptr;
  doc->sync_view();
  return doc->view.view == nullptr ? nullptr : &doc->view;
}

ZB_EXPORT uint32_t zb_document_diagnostic_count(const zb_document *doc) {
  return doc == nullptr ? 0 : static_cast<uint32_t>(doc->document.diagnostics().size());
}

ZB_EXPORT int zb_document_diagnostic(const zb_document *doc, uint32_t index, zb_diagnostic *out) {
  if (doc == nullptr || out == nullptr) return 0;
  const std::vector<Diagnostic> &list = doc->document.diagnostics();
  if (index >= list.size()) return 0;
  fill_diagnostic(list[index], out);
  return 1;
}

ZB_EXPORT int zb_document_set_data_json(zb_document *doc, const char *path, size_t path_len,
                                        const char *value_json, size_t value_json_len) {
  if (doc == nullptr) return 0;
  const JsonParse parsed = JsonDoc::parse(text_of(value_json, value_json_len));
  if (!parsed.ok) return 0;
  doc->document.set_data(text_of(path, path_len), capi::data_from_json(parsed.doc.root()));
  return 1;
}

// --- the view ---------------------------------------------------------------

ZB_EXPORT void zb_view_set_size(zb_view *view, double width, double height) {
  if (view != nullptr && view->view != nullptr) view->view->set_size(width, height);
}

ZB_EXPORT void zb_view_set_now(zb_view *view, double milliseconds) {
  if (view != nullptr && view->view != nullptr) view->view->set_now(milliseconds);
}

ZB_EXPORT double zb_view_now(const zb_view *view) {
  return view != nullptr && view->view != nullptr ? view->view->now() : 0.0;
}

ZB_EXPORT void zb_view_layout_frame(zb_view *view) {
  if (view != nullptr && view->view != nullptr) view->view->layout_frame();
}

ZB_EXPORT int zb_view_animating(const zb_view *view) {
  return view != nullptr && view->view != nullptr && view->view->animating() ? 1 : 0;
}

ZB_EXPORT void zb_view_paint(zb_view *view, zb_frame *out) {
  if (out != nullptr) *out = zb_frame{nullptr, 0};
  if (view == nullptr || view->view == nullptr) return;

  const GeometryBuilder &geometry = view->view->paint();
  const std::vector<const Batch *> &batches = geometry.batches();

  // The regions first, deduplicated by the core's own identity, into a vector
  // sized once — a batch points into it, so it must not grow underneath them.
  view->clips.clear();
  std::unordered_map<const Clip *, size_t> clip_index;
  for (const Batch *batch : batches) {
    if (batch->empty() || batch->clip == nullptr) continue;
    if (clip_index.count(batch->clip) == 0) {
      clip_index.emplace(batch->clip, view->clips.size());
      const Clip &clip = *batch->clip;
      view->clips.push_back(zb_clip{clip.x, clip.y, clip.width, clip.height, clip.radius});
    }
  }

  view->batches.clear();
  for (const Batch *batch : batches) {
    // A group that painted no text still owns an (empty) atlas batch: the core
    // lists it and its callers skip it. Skipping it HERE spares every binding
    // the same check.
    if (batch->empty()) continue;
    zb_batch out_batch;
    out_batch.positions = batch->positions.data();
    out_batch.uvs = batch->uvs.data();
    out_batch.colors = batch->colors.data();
    out_batch.indices = batch->indices.data();
    out_batch.vertex_count = batch->vertex_count();
    out_batch.index_count = static_cast<uint32_t>(batch->indices.size());
    out_batch.texture = batch->texture;
    switch (batch->kind) {
      case TextureKind::Glyphs: out_batch.texture_kind = ZB_TEXTURE_GLYPHS; break;
      case TextureKind::Image: out_batch.texture_kind = ZB_TEXTURE_IMAGE; break;
      case TextureKind::None: out_batch.texture_kind = ZB_TEXTURE_NONE; break;
    }
    out_batch.clip =
        batch->clip == nullptr ? nullptr : &view->clips[clip_index.find(batch->clip)->second];
    out_batch.group = batch->group;
    view->batches.push_back(out_batch);
  }

  // The sweep the header promises: bytes of an asset the frame no longer lists
  // are let go here, and nowhere else.
  if (!view->image_bytes.empty()) {
    std::unordered_map<const ImageAsset *, std::vector<uint8_t>> kept;
    for (const std::unique_ptr<ImageAsset> &asset : view->view->images().all()) {
      auto found = view->image_bytes.find(asset.get());
      if (found != view->image_bytes.end()) kept.emplace(found->first, std::move(found->second));
    }
    view->image_bytes = std::move(kept);
  }

  if (out != nullptr) {
    out->batches = view->batches.data();
    out->batch_count = static_cast<uint32_t>(view->batches.size());
  }
}

ZB_EXPORT uint32_t zb_view_atlas_count(const zb_view *view) {
  if (view == nullptr || view->view == nullptr) return 0;
  return static_cast<uint32_t>(view->view->fonts().all().size());
}

ZB_EXPORT int zb_view_atlas_info(const zb_view *view, uint32_t index, zb_atlas_info *out) {
  if (view == nullptr || view->view == nullptr || out == nullptr) return 0;
  const std::vector<std::unique_ptr<GlyphAtlas>> &atlases = view->view->fonts().all();
  if (index >= atlases.size()) return 0;
  const GlyphAtlas &atlas = *atlases[index];
  out->handle = &atlas;
  out->version = atlas.version();
  out->size = atlas.size();
  out->pixels = atlas.pixels().data();
  out->pixel_bytes = atlas.pixels().size();
  return 1;
}

ZB_EXPORT uint32_t zb_view_image_count(const zb_view *view) {
  if (view == nullptr || view->view == nullptr) return 0;
  // `images()` is non-const on the view for `adopt_size`'s sake; counting is not a write.
  return static_cast<uint32_t>(const_cast<View *>(view->view)->images().all().size());
}

ZB_EXPORT int zb_view_image_info(zb_view *view, uint32_t index, zb_image_info *out) {
  if (view == nullptr || view->view == nullptr || out == nullptr) return 0;
  const std::vector<std::unique_ptr<ImageAsset>> &assets = view->view->images().all();
  if (index >= assets.size()) return 0;
  const ImageAsset &asset = *assets[index];

  auto found = view->image_bytes.find(&asset);
  if (found == view->image_bytes.end()) {
    std::vector<uint8_t> bytes;
    if (asset.entry != nullptr) bytes = decode_asset_data(*asset.entry);
    found = view->image_bytes.emplace(&asset, std::move(bytes)).first;
  }

  out->handle = &asset;
  out->hash = str_of(asset.hash);
  out->mime = str_of(asset.mime);
  out->bytes = found->second.data();
  out->byte_count = found->second.size();
  out->width = asset.width;
  out->height = asset.height;
  return 1;
}

ZB_EXPORT int zb_view_image_adopt_size(zb_view *view, const void *image_handle, double width,
                                       double height) {
  if (view == nullptr || view->view == nullptr || image_handle == nullptr) return 0;
  // The handle came out of `zb_view_image_info`, so it names one of the view's
  // own assets; a stranger's pointer is found by nothing and adopts nothing.
  for (const std::unique_ptr<ImageAsset> &asset : view->view->images().all()) {
    if (asset.get() == image_handle) {
      return view->view->images().adopt_size(*asset, width, height) ? 1 : 0;
    }
  }
  return 0;
}

ZB_EXPORT uint32_t zb_view_warning_count(const zb_view *view) {
  if (view == nullptr || view->view == nullptr) return 0;
  return static_cast<uint32_t>(view->view->warnings().size());
}

ZB_EXPORT int zb_view_warning(const zb_view *view, uint32_t index, zb_diagnostic *out) {
  if (view == nullptr || view->view == nullptr || out == nullptr) return 0;
  const std::vector<Diagnostic> &list = view->view->warnings();
  if (index >= list.size()) return 0;
  fill_diagnostic(list[index], out);
  return 1;
}

// --- pointer ----------------------------------------------------------------

#define ZB_VIEW_OR(view, fallback) \
  if ((view) == nullptr || (view)->view == nullptr) return fallback

ZB_EXPORT int zb_view_pointer_move(zb_view *view, double x, double y, int mouse) {
  ZB_VIEW_OR(view, 0);
  return view->view->pointer_move(x, y, mouse != 0) ? 1 : 0;
}

ZB_EXPORT int zb_view_pointer_down(zb_view *view, double x, double y, int mouse) {
  ZB_VIEW_OR(view, 0);
  return view->view->pointer_down(x, y, mouse != 0) ? 1 : 0;
}

ZB_EXPORT int zb_view_pointer_up(zb_view *view, double x, double y, int mouse) {
  ZB_VIEW_OR(view, 0);
  return view->view->pointer_up(x, y, mouse != 0) ? 1 : 0;
}

ZB_EXPORT int zb_view_pointer_wheel(zb_view *view, double x, double y, double dx, double dy) {
  ZB_VIEW_OR(view, 0);
  return view->view->pointer_wheel(x, y, dx, dy) ? 1 : 0;
}

ZB_EXPORT int zb_view_pointer_exit(zb_view *view) {
  ZB_VIEW_OR(view, 0);
  return view->view->pointer_exit() ? 1 : 0;
}

ZB_EXPORT int zb_view_pointer_cancel(zb_view *view) {
  ZB_VIEW_OR(view, 0);
  return view->view->pointer_cancel() ? 1 : 0;
}

// --- keyboard ---------------------------------------------------------------

ZB_EXPORT int zb_view_edit_key(zb_view *view, const zb_key_intent *intent) {
  ZB_VIEW_OR(view, 0);
  if (intent == nullptr) return 0;
  KeyIntent key;
  // The header's constants ARE the enum's values, in order; anything past the
  // last one is a key the field cannot use.
  key.key = intent->key >= ZB_KEY_OTHER && intent->key <= ZB_KEY_SELECT_ALL
                ? static_cast<EditKey>(intent->key)
                : EditKey::Other;
  key.shift = intent->shift != 0;
  key.shortcut = intent->shortcut != 0;
  key.repeat = intent->repeat != 0;
  return view->view->edit_key(key) ? 1 : 0;
}

ZB_EXPORT int zb_view_insert_text(zb_view *view, const char *text, size_t text_len) {
  ZB_VIEW_OR(view, 0);
  return view->view->insert_text(text_of(text, text_len)) ? 1 : 0;
}

ZB_EXPORT int zb_view_set_composition(zb_view *view, const char *text, size_t text_len) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_composition(text_of(text, text_len)) ? 1 : 0;
}

ZB_EXPORT int zb_view_end_composition(zb_view *view) {
  ZB_VIEW_OR(view, 0);
  return view->view->end_composition() ? 1 : 0;
}

ZB_EXPORT int zb_view_field_selection_text(zb_view *view, zb_str *out) {
  if (out != nullptr) *out = zb_str{"", 0};
  ZB_VIEW_OR(view, 0);
  view->selection = view->view->field_selection_text();
  if (out != nullptr) *out = str_of(view->selection);
  return view->selection.empty() ? 0 : 1;
}

ZB_EXPORT int zb_view_move_focus(zb_view *view, double dx, double dy) {
  ZB_VIEW_OR(view, 0);
  return view->view->move_focus(dx, dy) ? 1 : 0;
}

ZB_EXPORT int zb_view_press_focused(zb_view *view, int down) {
  ZB_VIEW_OR(view, 0);
  return view->view->press_focused(down != 0) ? 1 : 0;
}

ZB_EXPORT int zb_view_dismiss_top_modal(zb_view *view) {
  ZB_VIEW_OR(view, 0);
  return view->view->dismiss_top_modal() ? 1 : 0;
}

ZB_EXPORT int zb_view_cancel_focused_press(zb_view *view) {
  ZB_VIEW_OR(view, 0);
  return view->view->cancel_focused_press() ? 1 : 0;
}

ZB_EXPORT int zb_view_scroll_focused_by(zb_view *view, double dx, double dy) {
  ZB_VIEW_OR(view, 0);
  return view->view->scroll_focused_by(dx, dy) ? 1 : 0;
}

ZB_EXPORT int zb_view_settle_slider_keys(zb_view *view) {
  ZB_VIEW_OR(view, 0);
  return view->view->settle_slider_keys() ? 1 : 0;
}

// --- the host channel, by id ------------------------------------------------

ZB_EXPORT int zb_view_set_open(zb_view *view, const char *id, size_t id_len, int open) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_open(text_of(id, id_len), open != 0) ? 1 : 0;
}

ZB_EXPORT int zb_view_set_selected_tab(zb_view *view, const char *id, size_t id_len,
                                       int32_t index) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_selected_tab(text_of(id, id_len), index) ? 1 : 0;
}

ZB_EXPORT int zb_view_set_checked(zb_view *view, const char *id, size_t id_len, int checked) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_checked(text_of(id, id_len), checked != 0) ? 1 : 0;
}

ZB_EXPORT int zb_view_set_value(zb_view *view, const char *id, size_t id_len, double value) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_value(text_of(id, id_len), value) ? 1 : 0;
}

ZB_EXPORT int zb_view_set_text(zb_view *view, const char *id, size_t id_len, const char *text,
                               size_t text_len) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_text(text_of(id, id_len), text_of(text, text_len)) ? 1 : 0;
}

ZB_EXPORT int zb_view_set_scroll(zb_view *view, const char *id, size_t id_len, double x,
                                 double y) {
  ZB_VIEW_OR(view, 0);
  return view->view->set_scroll(text_of(id, id_len), x, y) ? 1 : 0;
}

// --- draining ---------------------------------------------------------------

ZB_EXPORT uint32_t zb_view_drain_actions(zb_view *view, const zb_action **out) {
  if (out != nullptr) *out = nullptr;
  ZB_VIEW_OR(view, 0);
  // The events themselves are kept — they own the strings the C structs point at.
  view->actions = view->view->drain_actions();
  view->action_views.clear();
  view->action_views.reserve(view->actions.size());
  for (const ActionEvent &action : view->actions) {
    zb_action item;
    item.name = str_of(action.name);
    item.item_path = str_of(action.item_path);
    item.has_key = action.has_key ? 1 : 0;
    item.key_is_number = action.key_is_number ? 1 : 0;
    item.key_number = action.key_number;
    item.key_text = str_of(action.key_text);
    item.index = action.item_index;
    view->action_views.push_back(item);
  }
  if (out != nullptr) *out = view->action_views.data();
  return static_cast<uint32_t>(view->action_views.size());
}

ZB_EXPORT uint32_t zb_view_drain_data_changes(zb_view *view, const zb_data_change **out) {
  if (out != nullptr) *out = nullptr;
  ZB_VIEW_OR(view, 0);
  view->changes = view->view->drain_data_changes();
  view->change_json.clear();
  view->change_json.reserve(view->changes.size());
  for (const DataChange &change : view->changes) {
    view->change_json.push_back(capi::json_from_data(change.value));
  }
  view->change_views.clear();
  view->change_views.reserve(view->changes.size());
  for (size_t i = 0; i < view->changes.size(); i++) {
    view->change_views.push_back(
        zb_data_change{str_of(view->changes[i].path), str_of(view->change_json[i])});
  }
  if (out != nullptr) *out = view->change_views.data();
  return static_cast<uint32_t>(view->change_views.size());
}

// --- telemetry and the contract ---------------------------------------------

ZB_EXPORT void zb_view_stats(const zb_view *view, zb_frame_stats *out) {
  if (out == nullptr) return;
  *out = zb_frame_stats{};
  ZB_VIEW_OR(view, );
  const FrameStats &stats = view->view->stats();
  out->draw_calls = stats.draw_calls;
  out->vertices = stats.vertices;
  out->indices = stats.indices;
  out->atlases = stats.atlases;
  out->atlas_bytes = static_cast<uint64_t>(stats.atlas_bytes);
  out->resolved = stats.resolved;
  out->text_layouts = stats.text_layouts;
  out->buffer_growths = stats.buffer_growths;
  out->repaint_only = stats.repaint_only ? 1 : 0;
}

ZB_EXPORT int zb_view_snapshot_json(zb_view *view, zb_str *out) {
  if (out != nullptr) *out = zb_str{"", 0};
  ZB_VIEW_OR(view, 0);
  view->snapshot = snapshot_view(*view->view);
  if (out != nullptr) *out = str_of(view->snapshot);
  return 1;
}

// --- the gamepad ------------------------------------------------------------

ZB_EXPORT zb_pad *zb_pad_create(void) { return new zb_pad(); }

ZB_EXPORT void zb_pad_destroy(zb_pad *pad) { delete pad; }

ZB_EXPORT void zb_pad_connect(zb_pad *pad, double now) {
  if (pad != nullptr) pad->controller.connect(now);
}

ZB_EXPORT int zb_pad_poll(zb_pad *pad, zb_view *view, const zb_pad_snapshot *snapshot,
                          double now) {
  if (pad == nullptr || view == nullptr || view->view == nullptr || snapshot == nullptr) return 0;
  // Copied into the kept snapshot rather than re-allocated: `assign` reuses the
  // capacity, so a poll a frame costs no allocation once the sizes have settled.
  PadSnapshot &state = pad->snapshot;
  state.buttons.resize(snapshot->buttons == nullptr ? 0 : snapshot->button_count);
  for (size_t i = 0; i < state.buttons.size(); i++) state.buttons[i] = snapshot->buttons[i] != 0;
  state.axes.resize(snapshot->axes == nullptr ? 0 : snapshot->axis_count);
  for (size_t i = 0; i < state.axes.size(); i++) state.axes[i] = snapshot->axes[i];
  return pad->controller.poll(*view->view, state, now) ? 1 : 0;
}

ZB_EXPORT int zb_pad_disconnect(zb_pad *pad, zb_view *view) {
  if (pad == nullptr) return 0;
  View *target = view == nullptr ? nullptr : view->view;
  return pad->controller.disconnect(target) ? 1 : 0;
}

ZB_EXPORT int zb_pad_holding(const zb_pad *pad) {
  return pad != nullptr && pad->controller.holding() ? 1 : 0;
}

}  // extern "C"
