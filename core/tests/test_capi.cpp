// The golden corpus through the C ABI (UN2, ZAB-195).
//
// `test_golden.cpp` proves the CORE reproduces the corpus; this proves the
// BRIDGE does not change the answer. Every call to the core in this file goes
// through `capi/zabloo.h` — a document is a `zb_document *`, a frame is a
// `zb_view_layout_frame`, data arrives as JSON text, the pad is polled through
// `zb_pad_poll` — and the snapshot that comes back is compared to the very same
// bytes under `golden/metrics/`. If an envelope gives another metric across the
// frontier, the culprit is in the bridge, and this is what says so before Unity
// exists to say it worse.
//
// `corpus.h` is included for the FILES and the case list — what a corpus datum
// means is written once, there. The staging is deliberately NOT reused: how a
// case is mounted (the data channel, the settling frames, the clock, the pad
// script) is exactly what is under test here, so it is spelled out again in C
// terms. Nothing in this file names a `View` or a `Document`.
//
// The C-ness of the header is guarded elsewhere: `capi_header_alone.c` is the
// same header compiled by the C compiler, and the symbol it defines is used
// below so the object cannot be dropped.

#include <clocale>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "corpus.h"
#include "json.h"
#include "testing.h"
#include "zabloo.h"

extern "C" const char *zabloo_capi_header_compiles_as_c(void);

using zabloo::JsonDoc;
using zabloo::JsonParse;
using zabloo::JsonRef;
using zabloo::JsonType;
using zabloo::testing::corpus_cases;
using zabloo::testing::corpus_file;

namespace {

/** Viewport a corpus case is measured at unless it asks for another. */
constexpr double DEFAULT_WIDTH = 480.0;
constexpr double DEFAULT_HEIGHT = 320.0;

std::string_view sv(zb_str text) { return std::string_view(text.data, text.len); }

// --- a JSON writer for the test's own use ------------------------------------
//
// A corpus datum is a parsed `JsonRef`, and the ABI takes TEXT — the bridge's
// own writer is on the far side of the frontier, and using it here would test
// it against itself. Numbers go through the reference spelling in `data.h`,
// which `corpus.h` already pulls in.

void write_json(JsonRef value, std::string &out) {
  if (!value.exists() || value.type() == JsonType::Null) {
    out += "null";
    return;
  }
  switch (value.type()) {
    case JsonType::Bool: out += value.as_bool() ? "true" : "false"; return;
    case JsonType::Number: out += zabloo::number_to_text(value.as_number()); return;
    case JsonType::String: {
      out.push_back('"');
      for (const char c : value.as_string()) {
        if (c == '"' || c == '\\') out.push_back('\\');
        if (c == '\n') {
          out += "\\n";
        } else {
          out.push_back(c);
        }
      }
      out.push_back('"');
      return;
    }
    case JsonType::Array:
      out.push_back('[');
      for (uint32_t i = 0; i < value.size(); i++) {
        if (i > 0) out.push_back(',');
        write_json(value.at(i), out);
      }
      out.push_back(']');
      return;
    case JsonType::Object:
      out.push_back('{');
      for (uint32_t i = 0; i < value.size(); i++) {
        if (i > 0) out.push_back(',');
        out.push_back('"');
        out += std::string(value.key_at(i));
        out += "\":";
        write_json(value.at(i), out);
      }
      out.push_back('}');
      return;
    case JsonType::Null: out += "null"; return;
  }
}

std::string json_text(JsonRef value) {
  std::string out;
  write_json(value, out);
  return out;
}

// --- a document, through the header ------------------------------------------

/** Owns a `zb_document` for the length of a test, and the pad if one is plugged in. */
struct Handle {
  zb_document *doc = zb_document_create();
  zb_view *view = nullptr;
  zb_pad *pad = nullptr;
  double clock = 0.0;

  ~Handle() {
    zb_pad_destroy(pad);
    zb_document_destroy(doc);
  }
  Handle() = default;
  Handle(const Handle &) = delete;
  Handle &operator=(const Handle &) = delete;

  bool load(const std::string &json) {
    const bool ok = zb_document_load(doc, json.data(), json.size()) != 0;
    view = zb_document_view(doc);
    return ok;
  }

  int set_data(const std::string &path, const std::string &json) {
    return zb_document_set_data_json(doc, path.data(), path.size(), json.data(), json.size());
  }

  void frame() { zb_view_layout_frame(view); }

  void advance(double ms) {
    clock += ms;
    zb_view_set_now(view, clock);
    frame();
  }

  std::string snapshot() {
    zb_str out{};
    zb_view_snapshot_json(view, &out);
    return std::string(sv(out));
  }

  /** The first fatal diagnostic's wire code, or empty. */
  std::string fatal_code() const {
    for (uint32_t i = 0; i < zb_document_diagnostic_count(doc); i++) {
      zb_diagnostic diagnostic{};
      zb_document_diagnostic(doc, i, &diagnostic);
      if (diagnostic.level == ZB_DIAGNOSTIC_FATAL) return std::string(sv(diagnostic.code_name));
    }
    return std::string();
  }
};

/**
 * Replays a case's `pad` script through `zb_pad_poll` — the same steps and the
 * same meaning `corpus.cpp` gives them, in the header's vocabulary: a snapshot
 * of bytes and doubles, polled on every `advanceMs`.
 */
void replay_pad(Handle &handle, JsonRef steps) {
  std::vector<uint8_t> buttons(17, 0);
  std::vector<double> axes(4, 0.0);
  handle.pad = zb_pad_create();
  zb_pad_connect(handle.pad, handle.clock);

  for (uint32_t i = 0; i < steps.size(); i++) {
    const JsonRef step = steps.at(i);
    if (step.get("press").exists() || step.get("release").exists()) {
      const bool down = step.get("press").exists();
      const size_t at = static_cast<size_t>((down ? step.get("press") : step.get("release")).as_number(0.0));
      if (at >= buttons.size()) buttons.resize(at + 1, 0);
      buttons[at] = down ? 1 : 0;
    } else if (step.get("axis").exists()) {
      const size_t at = static_cast<size_t>(step.get("axis").as_number(0.0));
      if (at >= axes.size()) axes.resize(at + 1, 0.0);
      axes[at] = step.get("value").as_number(0.0);
    } else {
      handle.clock += step.get("advanceMs").as_number(0.0);
      zb_view_set_now(handle.view, handle.clock);
      const zb_pad_snapshot snapshot{buttons.data(), buttons.size(), axes.data(), axes.size()};
      zb_pad_poll(handle.pad, handle.view, &snapshot, handle.clock);
      handle.frame();
    }
  }
}

/**
 * Mounts one corpus case through the header, in the order `golden/README.md`
 * fixes: envelope, data, viewport, two settling frames, the clock, the pad.
 */
bool stage(Handle &handle, JsonRef spec, std::string &failure) {
  const std::string file = std::string(spec.get("envelope").as_string());
  const std::string text = corpus_file("envelopes/" + file);
  if (text.empty()) {
    failure = "envelopes/" + file + " is missing or empty";
    return false;
  }
  if (!handle.load(text)) {
    failure = "the envelope was refused (" + handle.fatal_code() + ")";
    return false;
  }
  if (handle.view == nullptr) {
    failure = "the envelope loaded but showed no view";
    return false;
  }
  zb_view_set_size(handle.view, spec.get("width").as_number(DEFAULT_WIDTH),
                   spec.get("height").as_number(DEFAULT_HEIGHT));

  const JsonRef data = spec.get("data");
  for (uint32_t i = 0; i < data.size(); i++) {
    const std::string path(data.key_at(i));
    if (handle.set_data(path, json_text(data.at(i))) == 0) {
      failure = "set_data_json refused " + path;
      return false;
    }
  }

  handle.frame();
  handle.frame();
  const double advance = spec.get("advanceMs").as_number(0.0);
  if (advance > 0.0) handle.advance(advance);
  if (spec.get("pad").exists()) replay_pad(handle, spec.get("pad"));
  return true;
}

/** Where two byte strings first part, with a little of each around it. */
std::string first_difference(const std::string &expected, const std::string &actual) {
  size_t at = 0;
  while (at < expected.size() && at < actual.size() && expected[at] == actual[at]) at++;
  const size_t from = at > 60 ? at - 60 : 0;
  return "first difference at byte " + std::to_string(at) + "\n    expected: …" +
         expected.substr(from, 120) + "…\n    actual:   …" + actual.substr(from, 120) + "…";
}

/** The golden harness's own skip list — a case it cannot reproduce, this cannot either. */
bool skipped(const std::string &name) {
  static const JsonParse list = JsonDoc::parse(
      zabloo::testing::read_file(zabloo::testing::repo_root() + "/core/tests/golden-skip.json"));
  return list.ok && list.doc.root().get("cases").get(name).exists();
}

/** A Button, a bound Toggle and a bound Slider with a label reading its value. */
const char *CONTROLS = R"({"v":1,"views":{"panel":{"type":"Container",
  "layout":{"direction":"column","gap":10,"padding":10},"children":[
    {"type":"Button","id":"buy","autofocus":true,"layout":{"width":100,"height":40},
     "onClick":"buy","children":[{"type":"Text","text":"Buy"}]},
    {"type":"Toggle","id":"sound","checked":{"bind":"settings.sound"},"onChange":"sound-changed",
     "layout":{"width":40,"height":20},"children":[
       {"type":"Container","layout":{"width":16,"height":16}},
       {"type":"Container","layout":{"width":16,"height":16}}]},
    {"type":"Slider","id":"volume","value":{"bind":"settings.volume"},"min":0,"max":1,"step":0.25,
     "onChange":"volume-preview","onCommit":"volume-apply","layout":{"width":200,"height":20},
     "children":[{"type":"Container","layout":{"height":4}},
                 {"type":"Container","layout":{"width":20,"height":20}}]},
    {"type":"Text","id":"volume-label","text":{"bind":"settings.volume"}}]}}})";

/** Tries the spellings of a Spanish locale each platform knows. Empty if none took. */
std::string set_spanish_locale() {
  for (const char *name : {"es_ES.UTF-8", "es_ES.utf8", "es_ES", "es-ES", "Spanish_Spain.1252"}) {
    if (std::setlocale(LC_ALL, name) != nullptr) return name;
  }
  return std::string();
}

/** Restores the C locale, so the rest of the suite is not run in Spanish by accident. */
struct LocaleGuard {
  ~LocaleGuard() { std::setlocale(LC_ALL, "C"); }
};

}  // namespace

TEST(capi, the_header_compiles_as_c_and_links_to_the_same_symbols) {
  // `capi_header_alone.c` is built by the C compiler; if it compiled, the
  // header is C. Calling into it here is what keeps the linker from dropping it.
  CHECK_EQ(std::string(zabloo_capi_header_compiles_as_c()), std::string(zb_version()));
}

TEST(capi, the_corpus_reproduces_its_metrics_through_the_c_header) {
  const JsonRef all = corpus_cases();
  CHECK(all.is_object());
  int compared = 0;
  for (uint32_t i = 0; i < all.size(); i++) {
    const std::string name(all.key_at(i));
    const JsonRef spec = all.at(i);
    if (spec.get("refuses").exists() || skipped(name)) continue;
    compared++;

    Handle handle;
    std::string failure;
    if (!stage(handle, spec, failure)) {
      ::zabloo::testing::report(__FILE__, __LINE__, name + ": " + failure);
      continue;
    }
    const std::string expected = corpus_file("metrics/" + name + ".json");
    const std::string actual = handle.snapshot();
    if (expected != actual) {
      ::zabloo::testing::report(__FILE__, __LINE__,
                                name + " does not reproduce golden/metrics/" + name +
                                    ".json through the C ABI — run `scons test golden` to "
                                    "see whether the core agrees; if it does, the bridge is "
                                    "what moved it\n    " +
                                    first_difference(expected, actual));
    }
  }
  // The corpus is the contract, so an empty run is a broken harness rather than a clean one.
  CHECK(compared > 0);
}

TEST(capi, an_envelope_the_corpus_marks_as_refused_is_refused_with_its_code) {
  const JsonRef all = corpus_cases();
  int refusals = 0;
  for (uint32_t i = 0; i < all.size(); i++) {
    const JsonRef spec = all.at(i);
    if (!spec.get("refuses").exists()) continue;
    refusals++;
    const std::string name(all.key_at(i));
    const std::string text = corpus_file("envelopes/" + std::string(spec.get("envelope").as_string()));
    CHECK(!text.empty());

    Handle handle;
    CHECK_EQ(name + " loads: " + (handle.load(text) ? "yes" : "no"), name + " loads: no");
    CHECK(zb_document_loaded(handle.doc) == 0);
    CHECK(handle.view == nullptr);
    CHECK_EQ(name + ": " + handle.fatal_code(),
             name + ": " + std::string(spec.get("refuses").get("code").as_string()));

    // The numeric code names the same thing as the string, so a binding may switch on either.
    zb_diagnostic diagnostic{};
    CHECK(zb_document_diagnostic(handle.doc, 0, &diagnostic) == 1);
    if (sv(diagnostic.code_name) == "unsupported-version") {
      CHECK_EQ(diagnostic.code, static_cast<int32_t>(ZB_DIAGNOSTIC_UNSUPPORTED_VERSION));
    }
  }
  CHECK(refusals > 0);
}

TEST(capi, a_refused_load_keeps_the_previous_document_on_screen) {
  Handle handle;
  CHECK(handle.load(corpus_file("envelopes/flex-layout.json")));
  zb_view *view = handle.view;
  CHECK(view != nullptr);
  zb_view_set_size(view, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  handle.frame();
  const std::string before = handle.snapshot();

  // Truncated mid-key: `invalid-json`, fatal, and nothing on screen moves.
  const std::string corrupt = R"({"v":1,"views":{"hud":{"type":"Contai)";
  CHECK(!handle.load(corrupt));
  CHECK_EQ(handle.fatal_code(), std::string("invalid-json"));
  CHECK(zb_document_loaded(handle.doc) == 1);
  // The handle is the SAME: a view handle is stable for the document's life.
  CHECK(handle.view == view);
  CHECK_EQ(handle.snapshot(), before);

  // And the diagnostics of the refused load are the ones on record now — a
  // loader reads why the update was lost, not what the previous one said.
  CHECK(zb_document_diagnostic_count(handle.doc) >= 1u);
}

TEST(capi, a_load_that_takes_keeps_the_view_handle_and_replays_the_data) {
  Handle handle;
  CHECK(handle.load(CONTROLS));
  zb_view *view = handle.view;
  zb_view_set_size(view, 300, 200);
  CHECK(handle.set_data("settings.volume", "0.75") == 1);
  handle.frame();

  // A second load re-points the same handle at the new view, and the data the
  // game pushed before it is already in the tree it builds.
  CHECK(handle.load(CONTROLS));
  CHECK(handle.view == view);
  zb_view_set_size(view, 300, 200);
  handle.frame();
  CHECK(handle.snapshot().find("\"text\": \"0.75\"") != std::string::npos);
}

TEST(capi, the_arrays_of_a_frame_survive_until_the_next_paint) {
  Handle handle;
  CHECK(handle.load(corpus_file("envelopes/states-tokens.json")));
  zb_view_set_size(handle.view, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  handle.frame();

  zb_frame frame{};
  zb_view_paint(handle.view, &frame);
  CHECK(frame.batch_count > 0);
  // Nothing empty is listed: every batch has triangles to draw.
  uint32_t vertices = 0;
  for (uint32_t i = 0; i < frame.batch_count; i++) {
    CHECK(frame.batches[i].index_count > 0);
    CHECK(frame.batches[i].vertex_count > 0);
    vertices += frame.batches[i].vertex_count;
  }
  zb_frame_stats stats{};
  zb_view_stats(handle.view, &stats);
  CHECK_EQ(stats.draw_calls, frame.batch_count);
  CHECK_EQ(stats.vertices, vertices);

  // Copy what the first paint handed out, then run a layout WITHOUT a paint:
  // the promise is "until the next paint", so the arrays still read the same.
  const zb_batch first = frame.batches[0];
  std::vector<float> positions(first.positions, first.positions + first.vertex_count * 2);
  handle.frame();
  CHECK(std::memcmp(positions.data(), first.positions, positions.size() * sizeof(float)) == 0);

  // A glyph batch names an atlas the view lists, whose pixels are readable.
  bool saw_glyphs = false;
  for (uint32_t i = 0; i < frame.batch_count; i++) {
    if (frame.batches[i].texture_kind != ZB_TEXTURE_GLYPHS) continue;
    saw_glyphs = true;
    bool listed = false;
    for (uint32_t a = 0; a < zb_view_atlas_count(handle.view); a++) {
      zb_atlas_info atlas{};
      CHECK(zb_view_atlas_info(handle.view, a, &atlas) == 1);
      if (atlas.handle != frame.batches[i].texture) continue;
      listed = true;
      CHECK_EQ(atlas.pixel_bytes, static_cast<size_t>(atlas.size) * static_cast<size_t>(atlas.size) * 2);
      // The white block the atlas reserves is at the top-left: opaque, luminance 255.
      CHECK_EQ(static_cast<int>(atlas.pixels[0]), 255);
      CHECK_EQ(static_cast<int>(atlas.pixels[1]), 255);
    }
    CHECK(listed);
  }
  CHECK(saw_glyphs);

  // The second paint replaces the frame — same scene, same geometry.
  zb_frame again{};
  zb_view_paint(handle.view, &again);
  CHECK_EQ(again.batch_count, frame.batch_count);
  CHECK(std::memcmp(positions.data(), again.batches[0].positions,
                    positions.size() * sizeof(float)) == 0);
  // An index out of range is a 0, never a read past the end.
  zb_atlas_info none{};
  CHECK(zb_view_atlas_info(handle.view, 99, &none) == 0);
}

TEST(capi, a_clipped_frame_hands_out_regions_by_identity_and_groups_by_ordinal) {
  Handle handle;
  CHECK(handle.load(corpus_file("envelopes/scroll-clip.json")));
  zb_view_set_size(handle.view, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  handle.frame();
  zb_frame frame{};
  zb_view_paint(handle.view, &frame);

  bool saw_clip = false;
  uint32_t last_group = 0;
  for (uint32_t i = 0; i < frame.batch_count; i++) {
    const zb_batch &batch = frame.batches[i];
    // Groups arrive in draw order and never go back.
    CHECK(batch.group >= last_group);
    last_group = batch.group;
    if (batch.clip == nullptr) continue;
    saw_clip = true;
    CHECK(batch.clip->width > 0.0);
    CHECK(batch.clip->height > 0.0);
    // Two batches of one group name the very same region — identity, not value.
    for (uint32_t j = i + 1; j < frame.batch_count; j++) {
      if (frame.batches[j].group == batch.group) CHECK(frame.batches[j].clip == batch.clip);
    }
  }
  CHECK(saw_clip);
}

TEST(capi, an_image_hands_out_its_bytes_by_hash_and_adopts_a_size_only_into_a_gap) {
  Handle handle;
  CHECK(handle.load(corpus_file("envelopes/assets-image.json")));
  zb_view_set_size(handle.view, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  handle.frame();
  zb_frame frame{};
  zb_view_paint(handle.view, &frame);

  CHECK(zb_view_image_count(handle.view) > 0);
  zb_image_info image{};
  CHECK(zb_view_image_info(handle.view, 0, &image) == 1);
  CHECK(!sv(image.hash).empty());
  CHECK_EQ(std::string(sv(image.mime)).substr(0, 6), std::string("image/"));
  // The bytes are the FILE, decoded from base64 once: a PNG starts with its signature.
  CHECK(image.byte_count > 8);
  if (sv(image.mime) == "image/png" && image.byte_count > 8) {
    CHECK_EQ(static_cast<int>(image.bytes[1]), 'P');
    CHECK_EQ(static_cast<int>(image.bytes[2]), 'N');
    CHECK_EQ(static_cast<int>(image.bytes[3]), 'G');
  }
  // Every image batch names an asset the view lists.
  for (uint32_t i = 0; i < frame.batch_count; i++) {
    if (frame.batches[i].texture_kind != ZB_TEXTURE_IMAGE) continue;
    bool listed = false;
    for (uint32_t a = 0; a < zb_view_image_count(handle.view); a++) {
      zb_image_info info{};
      zb_view_image_info(handle.view, a, &info);
      if (info.handle == frame.batches[i].texture) listed = true;
    }
    CHECK(listed);
  }
  // The manifest carried a size, so the manifest wins: nothing to adopt.
  CHECK(image.width > 0.0);
  CHECK(zb_view_image_adopt_size(handle.view, image.handle, 999, 999) == 0);
  // A pointer that is not one of the view's assets adopts nothing either.
  CHECK(zb_view_image_adopt_size(handle.view, &frame, 10, 10) == 0);
}

TEST(capi, a_press_drains_its_action_and_a_toggle_drains_its_write_as_json) {
  Handle handle;
  CHECK(handle.load(CONTROLS));
  zb_view_set_size(handle.view, 300, 200);
  handle.frame();

  // Nothing yet, and a drain of nothing hands out no array.
  const zb_action *actions = nullptr;
  CHECK_EQ(zb_view_drain_actions(handle.view, &actions), 0u);

  // Enter on the focused Button, through the same call a pad's A goes through.
  CHECK(zb_view_press_focused(handle.view, 1) == 1);
  CHECK(zb_view_press_focused(handle.view, 0) == 1);
  CHECK_EQ(zb_view_drain_actions(handle.view, &actions), 1u);
  CHECK(actions != nullptr);
  if (actions != nullptr) {
    CHECK_EQ(std::string(sv(actions[0].name)), std::string("buy"));
    // From the document itself: no item context.
    CHECK_EQ(actions[0].item_path.len, static_cast<size_t>(0));
    CHECK_EQ(actions[0].has_key, 0);
  }
  // Drained means drained.
  CHECK_EQ(zb_view_drain_actions(handle.view, &actions), 0u);

  // The host channel: a Toggle set by id writes its bound path and fires its hook.
  CHECK(zb_view_set_checked(handle.view, "sound", 5, 1) == 1);
  CHECK(zb_view_set_checked(handle.view, "nope", 4, 1) == 0);
  const zb_data_change *changes = nullptr;
  CHECK_EQ(zb_view_drain_data_changes(handle.view, &changes), 1u);
  if (changes != nullptr) {
    CHECK_EQ(std::string(sv(changes[0].path)), std::string("settings.sound"));
    CHECK_EQ(std::string(sv(changes[0].value_json)), std::string("true"));
  }
  CHECK_EQ(zb_view_drain_actions(handle.view, &actions), 1u);
  if (actions != nullptr) CHECK_EQ(std::string(sv(actions[0].name)), std::string("sound-changed"));

  // A Slider moved by the game: the value is quantized, written, and both hooks fire.
  CHECK(zb_view_set_value(handle.view, "volume", 6, 0.6) == 1);
  CHECK_EQ(zb_view_drain_data_changes(handle.view, &changes), 1u);
  if (changes != nullptr) CHECK_EQ(std::string(sv(changes[0].value_json)), std::string("0.5"));
  CHECK_EQ(zb_view_drain_actions(handle.view, &actions), 2u);
  if (actions != nullptr) {
    CHECK_EQ(std::string(sv(actions[0].name)), std::string("volume-preview"));
    CHECK_EQ(std::string(sv(actions[1].name)), std::string("volume-apply"));
  }
}

TEST(capi, values_cross_the_frontier_as_json_in_both_directions) {
  Handle handle;
  CHECK(handle.load(CONTROLS));
  zb_view_set_size(handle.view, 300, 200);

  // Every JSON shape lands: a scalar, a string with an escape, an array, an object.
  CHECK(handle.set_data("settings.volume", "0.25") == 1);
  CHECK(handle.set_data("player.name", R"("Ser\"gi")") == 1);
  CHECK(handle.set_data("shop.items", R"([{"name":"Poción"},{"name":"Espada"}])") == 1);
  CHECK(handle.set_data("flags", R"({"premium":true,"banned":false})") == 1);
  // And what is not JSON writes nothing.
  CHECK(handle.set_data("settings.volume", "0,25") == 0);
  CHECK(handle.set_data("settings.volume", "") == 0);
  handle.frame();
  handle.frame();
  // The refused writes left the last good value in place.
  CHECK(handle.snapshot().find("\"text\": \"0.25\"") != std::string::npos);

  // A write coming back is JSON too — the same spelling `String(number)` gives.
  CHECK(zb_view_set_value(handle.view, "volume", 6, 1.0) == 1);
  const zb_data_change *changes = nullptr;
  CHECK_EQ(zb_view_drain_data_changes(handle.view, &changes), 1u);
  if (changes != nullptr) CHECK_EQ(std::string(sv(changes[0].value_json)), std::string("1"));
}

TEST(capi, set_data_json_and_the_snapshot_do_not_read_the_locale) {
  // The hole G2 and G3 documented for `strtod` and `printf`: under a Spanish
  // locale the C library reads and writes `0,5`. Nothing on the bridge may go
  // through it — a game running in Spanish has to get the corpus's bytes.
  LocaleGuard guard;

  // First the answer in the C locale, which is the corpus's.
  std::string in_c;
  {
    Handle handle;
    std::string failure;
    CHECK(stage(handle, corpus_cases().get("bindings"), failure));
    in_c = handle.snapshot();
  }
  CHECK(!in_c.empty());
  CHECK(in_c.find("\"text\": \"1200\"") != std::string::npos);

  const std::string locale = set_spanish_locale();
  if (locale.empty()) {
    // A machine without a Spanish locale cannot arm the trap. CI installs one and
    // says so; a developer's laptop gets a note instead of a false failure.
    if (std::getenv("ZB_REQUIRE_LOCALE") != nullptr) {
      ::zabloo::testing::report(__FILE__, __LINE__,
                                "ZB_REQUIRE_LOCALE is set and no Spanish locale could be selected");
    } else {
      std::printf("    note: no Spanish locale on this machine — the locale test ran in C\n");
    }
    return;
  }
  // The positive control: the C library really is writing commas now.
  char control[32];
  std::snprintf(control, sizeof(control), "%.1f", 0.5);
  CHECK_EQ(std::string(control), std::string("0,5"));

  Handle handle;
  std::string failure;
  CHECK(stage(handle, corpus_cases().get("bindings"), failure));
  CHECK_EQ(handle.snapshot() == in_c, true);

  // And the other direction: a number pushed as JSON, read back through a write.
  Handle controls;
  CHECK(controls.load(CONTROLS));
  zb_view_set_size(controls.view, 300, 200);
  CHECK(controls.set_data("settings.volume", "0.75") == 1);
  controls.frame();
  controls.frame();
  CHECK(controls.snapshot().find("\"text\": \"0.75\"") != std::string::npos);
  CHECK(zb_view_set_value(controls.view, "volume", 6, 0.5) == 1);
  const zb_data_change *changes = nullptr;
  CHECK_EQ(zb_view_drain_data_changes(controls.view, &changes), 1u);
  if (changes != nullptr) CHECK_EQ(std::string(sv(changes[0].value_json)), std::string("0.5"));
}

TEST(capi, the_abi_sizes_are_this_builds_sizeof_of_each_struct) {
  // What a binding asserts against `Marshal.SizeOf`: a field missing or
  // mistyped on either side shows up here before any corpus case can.
  zb_abi_size_table sizes{};
  zb_abi_sizes(&sizes);
  CHECK_EQ(sizes.str, static_cast<uint32_t>(sizeof(zb_str)));
  CHECK_EQ(sizes.clip, static_cast<uint32_t>(sizeof(zb_clip)));
  CHECK_EQ(sizes.batch, static_cast<uint32_t>(sizeof(zb_batch)));
  CHECK_EQ(sizes.frame, static_cast<uint32_t>(sizeof(zb_frame)));
  CHECK_EQ(sizes.atlas_info, static_cast<uint32_t>(sizeof(zb_atlas_info)));
  CHECK_EQ(sizes.image_info, static_cast<uint32_t>(sizeof(zb_image_info)));
  CHECK_EQ(sizes.key_intent, static_cast<uint32_t>(sizeof(zb_key_intent)));
  CHECK_EQ(sizes.pad_snapshot, static_cast<uint32_t>(sizeof(zb_pad_snapshot)));
  CHECK_EQ(sizes.action, static_cast<uint32_t>(sizeof(zb_action)));
  CHECK_EQ(sizes.data_change, static_cast<uint32_t>(sizeof(zb_data_change)));
  CHECK_EQ(sizes.frame_stats, static_cast<uint32_t>(sizeof(zb_frame_stats)));
  CHECK_EQ(sizes.diagnostic, static_cast<uint32_t>(sizeof(zb_diagnostic)));
  CHECK_EQ(sizes.abi_size_table, static_cast<uint32_t>(sizeof(zb_abi_size_table)));
  // The shapes the C# transcription is written against, on every 64-bit target.
  CHECK_EQ(sizes.str, static_cast<uint32_t>(2 * sizeof(void *)));
  CHECK_EQ(sizes.clip, 40u);
  CHECK_EQ(sizes.key_intent, 16u);
  CHECK_EQ(sizes.frame_stats, 40u);
}

TEST(capi, the_version_is_the_fixed_groups) {
  // Stamped by the build from `packages/format/package.json` — the number that
  // answers "which SDK goes with the packages I installed". A checkout without
  // the packages says so rather than lying.
  const std::string manifest =
      zabloo::testing::read_file(zabloo::testing::repo_root() + "/packages/format/package.json");
  const std::string version(zb_version());
  CHECK(!version.empty());
  if (manifest.empty()) {
    CHECK_EQ(version, std::string("0.0.0-dev"));
    return;
  }
  const JsonParse parsed = JsonDoc::parse(manifest);
  CHECK(parsed.ok);
  CHECK_EQ(version, std::string(parsed.doc.root().get("version").as_string()));
}

TEST(capi, a_null_handle_is_answered_and_never_dereferenced) {
  // A binding that got NULL back from `create` or `view` must not have to guard
  // every call itself: the header answers "nothing" for a handle that is nothing.
  zb_document_destroy(nullptr);
  zb_pad_destroy(nullptr);
  CHECK(zb_document_view(nullptr) == nullptr);
  CHECK(zb_document_loaded(nullptr) == 0);
  CHECK(zb_document_load(nullptr, "{}", 2) == 0);
  zb_view_layout_frame(nullptr);
  zb_frame frame{};
  zb_view_paint(nullptr, &frame);
  CHECK_EQ(frame.batch_count, 0u);
  CHECK(zb_view_pointer_down(nullptr, 0, 0, 1) == 0);
  zb_str text{};
  CHECK(zb_view_snapshot_json(nullptr, &text) == 0);
  CHECK_EQ(text.len, static_cast<size_t>(0));

  // A document with no view yet answers the same way.
  Handle handle;
  CHECK(zb_document_view(handle.doc) == nullptr);
  CHECK_EQ(zb_document_diagnostic_count(handle.doc), 0u);
  zb_diagnostic diagnostic{};
  CHECK(zb_document_diagnostic(handle.doc, 0, &diagnostic) == 0);
}

TEST(capi, text_entry_and_the_focus_go_through_the_header) {
  // One field, one label reading it: what the keyboard half of an adapter does.
  const char *FORM = R"({"v":1,"views":{"form":{"type":"Container","layout":{"padding":10,"gap":10},
    "children":[
      {"type":"TextInput","id":"name","autofocus":true,"value":{"bind":"player.name"},
       "layout":{"width":200,"height":24},"maxLength":8},
      {"type":"Button","id":"ok","layout":{"width":80,"height":24},"onClick":"ok"}]}}})";
  Handle handle;
  CHECK(handle.load(FORM));
  zb_view_set_size(handle.view, 300, 200);
  handle.frame();

  CHECK(zb_view_insert_text(handle.view, "Sergi", 5) == 1);
  const zb_data_change *changes = nullptr;
  CHECK_EQ(zb_view_drain_data_changes(handle.view, &changes), 1u);
  if (changes != nullptr) CHECK_EQ(std::string(sv(changes[0].value_json)), std::string("\"Sergi\""));

  // Shift+Home selects back to the start; the selection is what a copy would take.
  zb_key_intent home{};
  home.key = ZB_KEY_HOME;
  home.shift = 1;
  CHECK(zb_view_edit_key(handle.view, &home) == 1);
  zb_str selection{};
  CHECK(zb_view_field_selection_text(handle.view, &selection) == 1);
  CHECK_EQ(std::string(sv(selection)), std::string("Sergi"));

  // A composition shows and is not told; ending it writes once.
  CHECK(zb_view_set_composition(handle.view, "こ", 3) == 1);
  CHECK_EQ(zb_view_drain_data_changes(handle.view, &changes), 0u);
  CHECK(zb_view_end_composition(handle.view) == 1);
  CHECK_EQ(zb_view_drain_data_changes(handle.view, &changes), 1u);

  // ↓ leaves the field for the button below it, and Enter presses that.
  CHECK(zb_view_move_focus(handle.view, 0, 1) == 1);
  CHECK(zb_view_press_focused(handle.view, 1) == 1);
  CHECK(zb_view_press_focused(handle.view, 0) == 1);
  const zb_action *actions = nullptr;
  CHECK_EQ(zb_view_drain_actions(handle.view, &actions), 1u);
  if (actions != nullptr) CHECK_EQ(std::string(sv(actions[0].name)), std::string("ok"));

  // `set_text` by id, on a field that no longer has the focus.
  CHECK(zb_view_set_text(handle.view, "name", 4, "Zamora", 6) == 1);
  handle.frame();
  CHECK(handle.snapshot().find("Zamora") != std::string::npos);
}
