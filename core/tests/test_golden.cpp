// The golden harness (G3): the corpus under `golden/`, replayed against the core.
//
// This is the net that makes the rest of F11 verifiable, and it is built now
// rather than at the end — the lesson of ZAB-38, which sat gated behind an SDK
// that never arrived. From here on, a G# ticket closes when its cases compare
// byte-identical against `golden/metrics/`.
//
// It runs where CI runs: a bare CPU, no engine, no GPU. That is not a
// convenience, it is the frontier ZAB-134 drew — the core can produce a
// `ViewSnapshot` with no Godot at all, so any logic that leaks into the adapter
// falls out of this net automatically.
//
// A case is `(envelope, data, viewport, clock, pad)` and nothing else
// (`golden/README.md`). Two rules the reference runner applies and this one has
// to apply too: text is measured with our own rasterizer and never the engine's,
// and there is ONE settling frame after the data — the frame a bound array
// arrives on is the one that measures its items, and the window over them is
// computed from those measurements on the next.
//
// `golden-skip.json` holds what the core cannot reproduce yet. It is a checklist,
// not a carpet: a skipped case is still run, and one that starts passing fails
// the suite asking to be removed from the list.

#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

#include "json.h"
#include "pad.h"
#include "snapshot.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;

namespace {

/** Viewport every case is measured at unless it asks for another. */
constexpr double DEFAULT_WIDTH = 480.0;
constexpr double DEFAULT_HEIGHT = 320.0;

/** Differences printed before a diff starts repeating itself. */
constexpr size_t MAX_DIFFS = 20;

std::string corpus_file(const std::string &relative) {
  return zabloo::testing::read_file(zabloo::testing::repo_root() + "/golden/" + relative);
}

/**
 * The corpus and the skip list, parsed once.
 *
 * Both are held by value for the life of the process: a `JsonRef` is a cursor
 * into its document, so every ref handed around below would dangle the moment
 * either was rebuilt.
 */
struct Corpus {
  JsonParse cases;
  JsonParse skip;
};

const Corpus &corpus() {
  static const Corpus parsed = [] {
    Corpus out;
    out.cases = JsonDoc::parse(corpus_file("cases.json"));
    out.skip = JsonDoc::parse(
        zabloo::testing::read_file(zabloo::testing::repo_root() + "/core/tests/golden-skip.json"));
    return out;
  }();
  return parsed;
}

JsonRef cases() { return corpus().cases.doc.root(); }
JsonRef skipped() { return corpus().skip.doc.root().get("cases"); }

/** The reason this case is skipped, or an absent ref if it is not. */
JsonRef skip_reason(std::string_view name) { return skipped().get(name); }

/** A case with `refuses` records a LOAD, not a frame — there is nothing to measure. */
bool is_refusal(JsonRef spec) { return spec.get("refuses").exists(); }

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

/**
 * A corpus `data` entry as the channel carries it.
 *
 * Arrays and objects included: a path is an ADDRESS into what the game pushed
 * (`shop.items.1.name` is one push and two segments of walking), so a channel
 * that only carried scalars could not express the corpus at all.
 */
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

/**
 * Replays one case and gives back the frame it measured, or an empty string with
 * `failure` saying why there is none.
 */
std::string replay(JsonRef spec, std::string &failure) {
  const std::string file = std::string(spec.get("envelope").as_string());
  const std::string envelope_text = corpus_file("envelopes/" + file);
  if (envelope_text.empty()) {
    failure = "envelopes/" + file + " is missing or empty";
    return {};
  }

  Document document;
  if (!document.load(envelope_text)) {
    failure = "the envelope was refused";
    for (const Diagnostic &diagnostic : document.diagnostics()) {
      if (diagnostic.level == DiagnosticLevel::Fatal) {
        failure += std::string(" (") + diagnostic_code_name(diagnostic.code) + ")";
        break;
      }
    }
    return {};
  }
  View *view = document.view();
  if (view == nullptr) {
    failure = "the envelope loaded but showed no view";
    return {};
  }

  view->set_size(spec.get("width").as_number(DEFAULT_WIDTH),
                 spec.get("height").as_number(DEFAULT_HEIGHT));

  const JsonRef data = spec.get("data");
  for (uint32_t i = 0; i < data.size(); i++) {
    document.set_data(data.key_at(i), to_data_value(data.at(i)));
  }

  // Two frames, and the second is part of the contract rather than a rig detail:
  // it is the settling frame `golden/README.md` requires after the data.
  view->layout_frame();
  view->layout_frame();

  // Then the clock, in one jump, exactly as the reference harness runs it: the
  // record is of the frame at that instant, not of the frames on the way there.
  // Both settling frames happen at time 0, which is what makes them a mount — and
  // a mount snaps, so nothing has started moving before the clock does.
  double clock = 0.0;
  const double advance = spec.get("advanceMs").as_number(0.0);
  if (advance > 0.0) {
    clock = advance;
    view->set_now(clock);
    view->layout_frame();
  }

  // And last the pad, which moves the clock the rest of the way in the steps its
  // own script asks for: a poll is a frame, so the spans between them are where
  // a held direction repeats and where the scroll stick covers ground.
  const JsonRef pad = spec.get("pad");
  if (pad.exists()) replay_pad(*view, pad, clock);
  return snapshot_view(*view);
}

// --- diffing --------------------------------------------------------------

std::string show(JsonRef value) {
  if (!value.exists()) return "(absent)";
  switch (value.type()) {
    case JsonType::Null: return "null";
    case JsonType::Bool: return value.as_bool() ? "true" : "false";
    case JsonType::Number: return snapshot_number(value.as_number());
    case JsonType::String: return "\"" + std::string(value.as_string()) + "\"";
    case JsonType::Array: return "(array of " + std::to_string(value.size()) + ")";
    case JsonType::Object: return "(object)";
  }
  return "(?)";
}

/** `tree.children[0].rect` — the root's own members carry no leading dot. */
std::string join(const std::string &path, const std::string &key) {
  return path.empty() ? key : path + "." + key;
}

/** The node this path is inside, so a difference names something an author wrote. */
std::string ref_suffix(const std::string &ref) {
  return ref.empty() ? std::string() : " (ref \"" + ref + "\")";
}

void diff(JsonRef expected, JsonRef actual, const std::string &path, const std::string &ref,
          std::vector<std::string> &out);

void diff_object(JsonRef expected, JsonRef actual, const std::string &path, const std::string &ref,
                 std::vector<std::string> &out) {
  // A node's own `ref` takes over for everything below it — that is the address
  // the corpus is read by, and the one a fix is looked up under.
  const std::string here =
      expected.get("ref").is_string() ? std::string(expected.get("ref").as_string()) : ref;
  for (uint32_t i = 0; i < expected.size() && out.size() < MAX_DIFFS; i++) {
    const std::string key(expected.key_at(i));
    diff(expected.at(i), actual.get(key), join(path, key), here, out);
  }
  for (uint32_t i = 0; i < actual.size() && out.size() < MAX_DIFFS; i++) {
    const std::string key(actual.key_at(i));
    if (expected.has(key)) continue;
    out.push_back(join(path, key) + ref_suffix(here) + ": expected (absent), actual " +
                  show(actual.at(i)));
  }
}

void diff_array(JsonRef expected, JsonRef actual, const std::string &path, const std::string &ref,
                std::vector<std::string> &out) {
  if (expected.size() != actual.size()) {
    out.push_back(path + ref_suffix(ref) + ": expected " + std::to_string(expected.size()) +
                  " entries, actual " + std::to_string(actual.size()));
  }
  const uint32_t shared = std::min(expected.size(), actual.size());
  for (uint32_t i = 0; i < shared && out.size() < MAX_DIFFS; i++) {
    diff(expected.at(i), actual.at(i), path + "[" + std::to_string(i) + "]", ref, out);
  }
}

/** Walks the recorded document and the produced one together, naming where they part. */
void diff(JsonRef expected, JsonRef actual, const std::string &path, const std::string &ref,
          std::vector<std::string> &out) {
  if (out.size() >= MAX_DIFFS) return;
  if (!expected.exists() || !actual.exists() || expected.type() != actual.type()) {
    if (expected.exists() || actual.exists()) {
      out.push_back(path + ref_suffix(ref) + ": expected " + show(expected) + ", actual " +
                    show(actual));
    }
    return;
  }
  switch (expected.type()) {
    case JsonType::Object: diff_object(expected, actual, path, ref, out); return;
    case JsonType::Array: diff_array(expected, actual, path, ref, out); return;
    case JsonType::Number:
      if (snapshot_number(expected.as_number()) != snapshot_number(actual.as_number())) {
        out.push_back(path + ref_suffix(ref) + ": expected " + show(expected) + ", actual " +
                      show(actual));
      }
      return;
    case JsonType::String:
      if (expected.as_string() != actual.as_string()) {
        out.push_back(path + ref_suffix(ref) + ": expected " + show(expected) + ", actual " +
                      show(actual));
      }
      return;
    case JsonType::Bool:
      if (expected.as_bool() != actual.as_bool()) {
        out.push_back(path + ref_suffix(ref) + ": expected " + show(expected) + ", actual " +
                      show(actual));
      }
      return;
    case JsonType::Null: return;
  }
}

/** The difference between a case's record and what it just produced, ready to print. */
std::string describe(const std::string &name, const std::string &expected_text,
                     const std::string &actual_text) {
  const JsonParse expected = JsonDoc::parse(expected_text);
  const JsonParse actual = JsonDoc::parse(actual_text);
  std::string out = name + " does not reproduce golden/metrics/" + name + ".json";
  if (!expected.ok) return out + "\n    the recorded file is not valid JSON: " + expected.error;
  if (!actual.ok) return out + "\n    the snapshot is not valid JSON: " + actual.error;

  std::vector<std::string> differences;
  diff(expected.doc.root(), actual.doc.root(), "", "", differences);
  if (differences.empty()) {
    // Same values, different bytes: key order, spacing or how a number was
    // written. The corpus compares BYTES, so this is a real failure and the walk
    // simply cannot see it — saying so beats printing nothing.
    out += "\n    the values match but the bytes do not — key order or number formatting";
    return out;
  }
  for (const std::string &difference : differences) out += "\n    " + difference;
  if (differences.size() >= MAX_DIFFS) out += "\n    … and possibly more";
  return out;
}

/** Every case that produces metrics — all of them but the refusals. */
std::vector<std::pair<std::string, JsonRef>> metric_cases() {
  std::vector<std::pair<std::string, JsonRef>> out;
  const JsonRef all = cases();
  for (uint32_t i = 0; i < all.size(); i++) {
    if (is_refusal(all.at(i))) continue;
    out.emplace_back(std::string(all.key_at(i)), all.at(i));
  }
  return out;
}

/** True when the case reproduced its record exactly. */
bool reproduces(const std::string &name, JsonRef spec, std::string &why) {
  // Nothing is skipped for want of a runner any more: a case is
  // `(envelope, data, viewport, clock, pad)` and this replays all five, which is
  // what makes `golden-skip.json` a list of missing CAPABILITIES and nothing
  // else. A case asking for something new has to teach this function to produce
  // it, rather than being measured on a frame it never reached.
  std::string failure;
  const std::string actual = replay(spec, failure);
  if (!failure.empty()) {
    why = name + ": " + failure;
    return false;
  }
  const std::string expected = corpus_file("metrics/" + name + ".json");
  if (expected.empty()) {
    why = name + ": golden/metrics/" + name + ".json is missing or empty";
    return false;
  }
  if (expected == actual) return true;
  why = describe(name, expected, actual);
  return false;
}

}  // namespace

TEST(golden, the_corpus_reproduces_the_metrics_it_recorded) {
  CHECK(corpus().cases.ok);
  CHECK(corpus().skip.ok);

  int compared = 0;
  for (const auto &entry : metric_cases()) {
    if (skip_reason(entry.first).exists()) continue;
    compared++;
    std::string why;
    if (!reproduces(entry.first, entry.second, why)) {
      ::zabloo::testing::report(__FILE__, __LINE__, why);
    }
  }
  // The corpus is the contract, so an empty run is a broken harness rather than
  // a clean one.
  CHECK(compared > 0);
}

TEST(golden, a_skipped_case_that_now_passes_has_to_leave_the_skip_list) {
  // What keeps `golden-skip.json` from rotting into a list nobody reads: every
  // skipped case is still replayed, and one that agrees with its record is a
  // capability that landed. Deleting the line is part of that ticket's exit
  // criteria, and this is what notices when it was forgotten.
  for (const auto &entry : metric_cases()) {
    if (!skip_reason(entry.first).exists()) continue;
    std::string why;
    if (reproduces(entry.first, entry.second, why)) {
      ::zabloo::testing::report(__FILE__, __LINE__,
                                entry.first +
                                    " reproduces its metrics now — remove it from "
                                    "core/tests/golden-skip.json");
    }
  }
}

TEST(golden, the_skip_list_names_cases_that_exist_and_says_why) {
  const JsonRef list = skipped();
  CHECK(list.is_object());
  for (uint32_t i = 0; i < list.size(); i++) {
    const std::string name(list.key_at(i));
    const JsonRef spec = cases().get(name);
    CHECK_EQ(name + " is a case of the corpus: " + (spec.exists() ? "yes" : "no"),
             name + " is a case of the corpus: yes");
    // A refusal has no metrics to reproduce, so it can never be waiting on one.
    CHECK_EQ(name + " measures a frame: " + (spec.exists() && is_refusal(spec) ? "no" : "yes"),
             name + " measures a frame: yes");
    // The reason has to name the ticket that will delete this line: a skip
    // without an owner is a gap nobody has agreed to close.
    const std::string reason(list.at(i).as_string());
    CHECK_EQ(name + " names the ticket that removes it: " +
                 (reason.find("ZAB-") != std::string::npos ? "yes" : "no"),
             name + " names the ticket that removes it: yes");
  }
}

TEST(golden, a_difference_is_reported_by_path_with_both_values_and_the_node_it_is_in) {
  // The readable half of the harness. A diff that only says "the files differ"
  // sends you reading two hundred lines of JSON; one that names the path, the
  // node an author wrote and both numbers is a fix. The format is the same one
  // the reference harness prints, so a diff reads alike on both targets.
  const std::string recorded = R"({"view":"a","tree":{"type":"Container","ref":"root","rect":{
      "x":0,"y":0,"width":480,"height":320},"children":[
      {"type":"Button","ref":"buy","rect":{"x":8,"y":8,"width":128,"height":40},
       "style":{"radius":6}}]}})";
  const std::string produced = R"({"view":"a","tree":{"type":"Container","ref":"root","rect":{
      "x":0,"y":0,"width":480,"height":320},"children":[
      {"type":"Button","ref":"buy","rect":{"x":8,"y":8,"width":132,"height":40},
       "style":{}}]}})";

  const std::string report = describe("demo", recorded, produced);
  CHECK(report.find("tree.children[0].rect.width (ref \"buy\"): expected 128, actual 132") !=
        std::string::npos);
  CHECK(report.find("tree.children[0].style.radius (ref \"buy\"): expected 6, actual (absent)") !=
        std::string::npos);
  // Nothing else moved, so nothing else is printed: what shows up in a diff is
  // what changed, not the noise around it.
  CHECK_EQ(std::count(report.begin(), report.end(), '\n'), 2);
}

TEST(golden, a_snapshot_that_differs_only_in_its_bytes_still_fails_and_says_so) {
  // Same values, different bytes — a key written out of order, a number written
  // another way. The corpus compares BYTES, so the walk finding nothing is not
  // permission to pass: it is the one case where the diff has to explain itself.
  const std::string report = describe("demo", R"({"a":1,"b":2})", R"({"b":2,"a":1})");
  CHECK(report.find("the values match but the bytes do not") != std::string::npos);
}

TEST(golden, an_envelope_the_corpus_marks_as_refused_is_refused_with_its_code) {
  // Not every normative rule of the format produces a frame. A case with
  // `refuses` records the other kind: the envelope must be rejected, with the
  // code it names, and nothing must render.
  const JsonRef all = cases();
  int refusals = 0;
  for (uint32_t i = 0; i < all.size(); i++) {
    const JsonRef spec = all.at(i);
    if (!is_refusal(spec)) continue;
    refusals++;
    const std::string name(all.key_at(i));
    const std::string text = corpus_file("envelopes/" + std::string(spec.get("envelope").as_string()));
    CHECK(!text.empty());

    Document document;
    CHECK_EQ(name + " loads: " + (document.load(text) ? "yes" : "no"), name + " loads: no");
    CHECK(document.view() == nullptr);

    const std::string wanted(spec.get("refuses").get("code").as_string());
    std::string reported;
    for (const Diagnostic &diagnostic : document.diagnostics()) {
      if (diagnostic.level != DiagnosticLevel::Fatal) continue;
      reported = diagnostic_code_name(diagnostic.code);
      break;
    }
    CHECK_EQ(name + ": " + reported, name + ": " + wanted);
  }
  CHECK(refusals > 0);
}

TEST(golden, every_envelope_the_corpus_measures_loads_without_a_single_diagnostic) {
  // The other half of what the reference asserts: a corpus envelope that warns is
  // a broken fixture, and its metrics would have been measured on a degraded
  // render. It holds for every case, skipped or not — loading is the one thing
  // the core has done since G2.
  for (const auto &entry : metric_cases()) {
    const std::string file(entry.second.get("envelope").as_string());
    const EnvelopeReport report = read_envelope(corpus_file("envelopes/" + file));
    CHECK_EQ(file + " loads: " + (report.ok ? "yes" : "no"), file + " loads: yes");
    for (const Diagnostic &diagnostic : report.diagnostics) {
      ::zabloo::testing::report(__FILE__, __LINE__,
                                file + " warned: " + diagnostic_code_name(diagnostic.code) + " at " +
                                    diagnostic.path);
    }
  }
}
