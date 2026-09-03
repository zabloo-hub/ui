#include "corpus.h"

#include <cstdint>

#include "pad.h"
#include "testing.h"

namespace zabloo::testing {

std::string corpus_file(const std::string &relative) {
  return read_file(repo_root() + "/golden/" + relative);
}

JsonRef corpus_cases() {
  // Held by value for the life of the process: a `JsonRef` is a cursor into its
  // document, so every ref handed out below would dangle the moment it was rebuilt.
  static const JsonParse parsed = JsonDoc::parse(corpus_file("cases.json"));
  return parsed.doc.root();
}

DataValue to_data_value(JsonRef value) {
  if (value.is_bool()) return DataValue::of_bool(value.as_bool());
  if (value.is_number()) return DataValue::of_number(value.as_number());
  if (value.is_string()) return DataValue::of_text(std::string(value.as_string()));
  if (value.is_array()) {
    DataValue out = DataValue::array();
    for (uint32_t i = 0; i < value.size(); i++) out.push(to_data_value(value.at(i)));
    return out;
  }
  if (value.is_object()) {
    DataValue out = DataValue::object();
    for (uint32_t i = 0; i < value.size(); i++) {
      out.insert(std::string(value.key_at(i)), to_data_value(value.at(i)));
    }
    return out;
  }
  return DataValue();
}

namespace {

/** Viewport a corpus case is measured at unless it asks for another. */
constexpr double DEFAULT_WIDTH = 480.0;
constexpr double DEFAULT_HEIGHT = 320.0;

/**
 * `golden/perf/scenes.json`, parsed once for the life of the process. Held by
 * value because a `JsonRef` is a cursor into its document: every ref handed out
 * below would dangle the moment it was rebuilt.
 */
JsonRef perf_index() {
  static const JsonParse parsed = JsonDoc::parse(corpus_file("perf/scenes.json"));
  return parsed.doc.root();
}

/**
 * Replays a case's `pad` script against the view.
 *
 * A pad is POLLED, never pushed: a `press` only becomes an intention on a frame
 * that reads it, so a step that changes the state does nothing until an
 * `advanceMs` gives the loop one. That is the whole reason the corpus can carry
 * a gamepad at all — a declarative script of a STATE replays anywhere, while a
 * stream of one platform's events would not.
 *
 * `clock` arrives at the instant the case's own `advanceMs` left it and leaves
 * where the script ends, because the frame that gets measured is the last one
 * this ran.
 */
void replay_pad(View &view, JsonRef steps, double &clock) {
  // Shaped the way a standard-mapping pad reports itself — 17 buttons and 4 axes,
  // all at rest — exactly as the reference harness plugs one in.
  PadSnapshot pad;
  pad.buttons.assign(17, false);
  pad.axes.assign(4, 0.0);
  PadController controller;
  controller.connect(clock);

  const auto button = [&pad](JsonRef index, bool down) {
    const size_t at = static_cast<size_t>(index.as_number(0.0));
    if (at >= pad.buttons.size()) pad.buttons.resize(at + 1, false);
    pad.buttons[at] = down;
  };

  for (uint32_t i = 0; i < steps.size(); i++) {
    const JsonRef step = steps.at(i);
    if (step.get("press").exists()) {
      button(step.get("press"), true);
    } else if (step.get("release").exists()) {
      button(step.get("release"), false);
    } else if (step.get("axis").exists()) {
      const size_t at = static_cast<size_t>(step.get("axis").as_number(0.0));
      if (at >= pad.axes.size()) pad.axes.resize(at + 1, 0.0);
      pad.axes[at] = step.get("value").as_number(0.0);
    } else {
      clock += step.get("advanceMs").as_number(0.0);
      view.set_now(clock);
      controller.poll(view, pad, clock);
      view.layout_frame();
    }
  }
}

/** Loads an envelope and shows its first view, or says why it could not. */
Staged mount(const std::string &envelope_text, const std::string &where, double width,
             double height, std::string &failure) {
  Staged staged;
  if (envelope_text.empty()) {
    failure = where + " is missing or empty";
    return staged;
  }
  if (!staged.document.load(envelope_text)) {
    failure = "the envelope was refused";
    for (const Diagnostic &diagnostic : staged.document.diagnostics()) {
      if (diagnostic.level == DiagnosticLevel::Fatal) {
        failure += std::string(" (") + diagnostic_code_name(diagnostic.code) + ")";
        break;
      }
    }
    return staged;
  }
  View *view = staged.document.view();
  if (view == nullptr) {
    failure = "the envelope loaded but showed no view";
    return staged;
  }
  view->set_size(width, height);
  staged.view = view;
  return staged;
}

}  // namespace

void Staged::advance(double ms) {
  if (view == nullptr) return;
  clock += ms;
  view->set_now(clock);
  view->layout_frame();
}

Staged stage_corpus_case(JsonRef spec, std::string &failure) {
  const std::string file = std::string(spec.get("envelope").as_string());
  Staged staged = mount(corpus_file("envelopes/" + file), "envelopes/" + file,
                        spec.get("width").as_number(DEFAULT_WIDTH),
                        spec.get("height").as_number(DEFAULT_HEIGHT), failure);
  if (staged.view == nullptr) return staged;

  const JsonRef data = spec.get("data");
  for (uint32_t i = 0; i < data.size(); i++) {
    staged.document.set_data(data.key_at(i), to_data_value(data.at(i)));
  }

  // Two frames, and the second is part of the contract rather than a rig detail:
  // it is the settling frame `golden/README.md` requires after the data.
  staged.view->layout_frame();
  staged.view->layout_frame();

  // Then the clock, in one jump, exactly as the reference harness runs it: the
  // record is of the frame at that instant, not of the frames on the way there.
  // Both settling frames happen at time 0, which is what makes them a mount — and
  // a mount snaps, so nothing has started moving before the clock does.
  const double advance = spec.get("advanceMs").as_number(0.0);
  if (advance > 0.0) staged.advance(advance);

  // And last the pad, which moves the clock the rest of the way in the steps its
  // own script asks for: a poll is a frame, so the spans between them are where a
  // held direction repeats and where the scroll stick covers ground.
  const JsonRef pad = spec.get("pad");
  if (pad.exists()) replay_pad(*staged.view, pad, staged.clock);
  return staged;
}

const std::vector<std::string> &perf_scene_names() {
  static const std::vector<std::string> names = [] {
    std::vector<std::string> out;
    const JsonRef scenes = perf_index().get("scenes");
    for (uint32_t i = 0; i < scenes.size(); i++) out.emplace_back(scenes.key_at(i));
    return out;
  }();
  return names;
}

double perf_motion_ms() { return perf_index().get("motionMs").as_number(0.0); }

Staged stage_perf_scene(const std::string &name, std::string &failure) {
  const JsonRef spec = perf_index().get("scenes").get(name);
  if (!spec.exists()) {
    failure = name + " is not in golden/perf/scenes.json";
    return Staged{};
  }
  const std::string envelope = std::string(spec.get("envelope").as_string());
  Staged staged = mount(corpus_file("perf/" + envelope), "perf/" + envelope,
                        spec.get("width").as_number(DEFAULT_WIDTH),
                        spec.get("height").as_number(DEFAULT_HEIGHT), failure);
  if (staged.view == nullptr) return staged;

  // A scene's data is a file of its own, not an inline object: one of them is a
  // thousand rows, and an index nobody can read is an index nobody checks.
  if (spec.get("data").is_string()) {
    const std::string file = std::string(spec.get("data").as_string());
    const JsonParse data = JsonDoc::parse(corpus_file("perf/" + file));
    const JsonRef root = data.doc.root();
    for (uint32_t i = 0; i < root.size(); i++) {
      staged.document.set_data(root.key_at(i), to_data_value(root.at(i)));
    }
  }

  staged.view->layout_frame();
  staged.view->layout_frame();
  return staged;
}

const LayoutNode *find_node(const LayoutNode &root, std::string_view id) {
  if (root.ir != nullptr && root.ir->id == id) return &root;
  for (const LayoutNode &child : root.children) {
    if (const LayoutNode *found = find_node(child, id)) return found;
  }
  return nullptr;
}

}  // namespace zabloo::testing
