#include <string>
#include <vector>

#include "diagnostics.h"
#include "testing.h"
#include "validate.h"

using namespace zabloo;

namespace {

struct Expected {
  const char *level;
  const char *code;
  const char *path;
};

const char *level_name(DiagnosticLevel level) {
  return level == DiagnosticLevel::Fatal ? "fatal" : "warn";
}

/** Compares a report against what `@zabloo/format` emits for the same input. */
void expect_diagnostics(const EnvelopeReport &report, const std::vector<Expected> &expected) {
  CHECK_EQ(report.diagnostics.size(), expected.size());
  const size_t shared = std::min(report.diagnostics.size(), expected.size());
  for (size_t i = 0; i < shared; i++) {
    const Diagnostic &actual = report.diagnostics[i];
    const std::string where = "[" + std::to_string(i) + "] ";
    CHECK_EQ(where + level_name(actual.level), where + expected[i].level);
    CHECK_EQ(where + diagnostic_code_name(actual.code), where + expected[i].code);
    CHECK_EQ(where + actual.path, where + expected[i].path);
  }
}

std::string golden(const char *name) {
  return zabloo::testing::read_file(zabloo::testing::repo_root() + "/golden/envelopes/" + name);
}

}  // namespace

TEST(validate, the_corpus_loads_the_way_the_corpus_says_it_does) {
  // `golden/cases.json` declares exactly one refusal in eighteen cases, and the
  // other seventeen as clean loads. That claim is the contract this port has to
  // reproduce before any of the harder ones matter.
  for (const char *name : {"flex-layout.json", "states-tokens.json", "unknown-type.json"}) {
    const std::string text = golden(name);
    CHECK(!text.empty());
    const EnvelopeReport report = read_envelope(text);
    CHECK(report.ok);
    expect_diagnostics(report, {});
  }
}

TEST(validate, an_incompatible_major_is_refused_and_nothing_renders) {
  // The one forward-tolerance rule that is a refusal rather than a degradation:
  // `v` is the major and the comparison is equality in both directions.
  const EnvelopeReport report = read_envelope(golden("future-major.json"));
  CHECK(!report.ok);
  CHECK(report.envelope.views.empty());
  expect_diagnostics(report, {{"fatal", "unsupported-version", ""}});
  CHECK_EQ(report.diagnostics[0].message,
           std::string("IR envelope: unsupported major version 2 (this reader implements v1)"));
}

TEST(validate, a_hostile_payload_produces_the_same_diagnostics_as_the_reference) {
  // Every code, in the order `@zabloo/format` emits them, over one fixture that
  // is deliberately wrong in as many ways as fit in a file. This is the parity
  // test: same input, same codes, same paths, same sequence.
  const std::string text =
      zabloo::testing::read_file(zabloo::testing::repo_root() + "/core/tests/fixtures/hostile.json");
  CHECK(!text.empty());
  const EnvelopeReport report = read_envelope(text);
  CHECK(report.ok);
  expect_diagnostics(
      report,
      {
          {"warn", "invalid-token", "tokens[\"bad.token\"]"},
          {"warn", "invalid-token", "tokens[\"also.bad\"]"},
          {"warn", "invalid-asset", "assets[\"icons/broken.png\"]"},
          {"warn", "invalid-asset", "assets[\"icons/nodata.png\"]"},
          {"warn", "invalid-prop", "views[\"hostile\"].layout.direction"},
          {"warn", "unknown-token", "views[\"hostile\"].layout.gap"},
          {"warn", "invalid-prop", "views[\"hostile\"].layout.grow"},
          {"warn", "invalid-prop", "views[\"hostile\"].layout.wrap"},
          {"warn", "invalid-prop", "views[\"hostile\"].style.radius"},
          {"warn", "invalid-prop", "views[\"hostile\"].style.opacity"},
          {"warn", "invalid-prop", "views[\"hostile\"].states[\"focused\"].style.borderColor"},
          {"warn", "invalid-prop", "views[\"hostile\"].states[\"pressed\"]"},
          {"warn", "invalid-prop", "views[\"hostile\"].transition"},
          {"warn", "duplicate-id", "views[\"hostile\"].children[0].id"},
          {"warn", "invalid-node", "views[\"hostile\"].children[0].text"},
          {"warn", "invalid-binding", "views[\"hostile\"].children[2].text.bind"},
          {"warn", "unknown-asset", "views[\"hostile\"].children[3].src"},
          {"warn", "invalid-node", "views[\"hostile\"].children[4].src"},
          {"warn", "invalid-node", "views[\"hostile\"].children[5]"},
          {"warn", "invalid-node", "views[\"hostile\"].children[6]"},
          {"warn", "invalid-prop", "views[\"hostile\"].children[8].open"},
          {"warn", "invalid-node", "views[\"hostile\"].children[8].children[1]"},
          {"warn", "invalid-prop", "views[\"hostile\"].children[9].min"},
          {"warn", "invalid-node", "views[\"hostile\"].children[10].items"},
          {"warn", "invalid-prop", "views[\"hostile\"].children[11].modal"},
          {"warn", "invalid-prop", "views[\"hostile\"].children[12].children"},
          {"warn", "unknown-anchor", "views[\"hostile\"].children[11].anchor.id"},
          {"warn", "invalid-node", "views[\"gone\"].text"},
      });
}

TEST(validate, the_repaired_tree_is_what_the_reference_repairs_it_to) {
  const std::string text =
      zabloo::testing::read_file(zabloo::testing::repo_root() + "/core/tests/fixtures/hostile.json");
  const EnvelopeReport report = read_envelope(text);
  CHECK_EQ(report.envelope.views.size(), 1u);
  const View *view = report.envelope.view("hostile");
  CHECK(view != nullptr);
  if (view == nullptr) return;

  // Five of thirteen children were unusable; a dropped child in an ordinary
  // list simply goes, so the survivors close ranks.
  const std::vector<std::string> kept = {"Text",   "Text",   "Image",   "HoloPanel",
                                         "Collapse", "Slider", "Overlay", "Container"};
  CHECK_EQ(view->root.children.size(), kept.size());
  for (size_t i = 0; i < std::min(view->root.children.size(), kept.size()); i++) {
    CHECK_EQ(view->root.children[i].type_name, kept[i]);
  }

  // The unknown type keeps what the normative degradation says it keeps.
  const Node &unknown = view->root.children[3];
  CHECK_EQ(static_cast<int>(unknown.type), static_cast<int>(NodeType::Unknown));
  CHECK_EQ(unknown.layout.width.number, 40.0);
  CHECK_EQ(unknown.disabled.literal(false), true);

  // A dropped SLOT is replaced, not removed: taking it out would renumber the
  // slots after it and silently change what they mean.
  const Node &collapse = view->root.children[4];
  CHECK_EQ(collapse.children.size(), 2u);
  CHECK_EQ(collapse.children[1].type_name, std::string("Container"));
  CHECK_EQ(collapse.children[1].children.size(), 0u);

  // Crossed bounds leave the slider its defaults rather than an empty range.
  const Node &slider = view->root.children[5];
  CHECK(!slider.min.has_value());
  CHECK(!slider.max.has_value());

  // A mistyped prop falls to its default; the node itself is untouched.
  CHECK(!collapse.open.has_value());
  CHECK_EQ(view->root.children[6].modal, true);
  CHECK_EQ(static_cast<int>(view->root.layout.direction), static_cast<int>(Direction::Row));
  CHECK(!view->root.transition.present);

  // Tokens survive as the flat dictionary; the two malformed entries do not.
  CHECK_EQ(report.envelope.tokens.size(), 2u);
  CHECK(report.envelope.token("space.4") != nullptr);
  CHECK(report.envelope.token("bad.token") == nullptr);
  CHECK_EQ(report.envelope.assets.size(), 1u);
}

TEST(validate, an_empty_text_is_content_but_an_absent_one_is_not) {
  // ZAB-65: `""` is a label with nothing to say today — a Select with no value,
  // a bound path the game has not filled. What sinks the node is the field
  // being absent, which is a tree nobody meant to author.
  const EnvelopeReport kept =
      read_envelope(R"({"v":1,"views":{"a":{"type":"Text","text":""}}})");
  CHECK(kept.ok);
  expect_diagnostics(kept, {{"warn", "invalid-tokens", ""}});

  const EnvelopeReport gone = read_envelope(R"({"v":1,"views":{"a":{"type":"Text"}}})");
  CHECK(!gone.ok);
  expect_diagnostics(gone, {{"warn", "invalid-tokens", ""},
                            {"warn", "invalid-node", "views[\"a\"].text"},
                            {"fatal", "no-usable-views", ""}});
}

TEST(validate, the_fatal_diagnostics_are_the_ones_that_leave_no_tree) {
  const EnvelopeReport bad_json = read_envelope("{\"v\":1,");
  CHECK(!bad_json.ok);
  expect_diagnostics(bad_json, {{"fatal", "invalid-json", ""}});

  expect_diagnostics(read_envelope("[]"), {{"fatal", "not-an-object", ""}});
  expect_diagnostics(read_envelope("\"a string is not a document\""),
                     {{"fatal", "not-an-object", ""}});
  expect_diagnostics(read_envelope(R"({"views":{}})"), {{"fatal", "missing-version", ""}});
  expect_diagnostics(read_envelope(R"({"v":"1","views":{}})"), {{"fatal", "missing-version", ""}});
  // `v` is the major and it is an INTEGER: 1.5 is not "close enough to 1".
  expect_diagnostics(read_envelope(R"({"v":1.5,"views":{}})"),
                     {{"fatal", "unsupported-version", ""}});
  expect_diagnostics(read_envelope(R"({"v":1})"), {{"fatal", "missing-views", ""}});
  expect_diagnostics(read_envelope(R"({"v":1,"tokens":{},"views":{}})"),
                     {{"fatal", "no-usable-views", ""}});
  CHECK_EQ(read_envelope(R"({"v":1,"tokens":{},"views":{}})").diagnostics[0].message,
           std::string("IR envelope: the `views` map is empty"));
}

TEST(validate, a_tree_deeper_than_the_cap_loses_the_subtree_not_the_screen) {
  std::string open;
  std::string close;
  for (int i = 0; i < MAX_DEPTH + 2; i++) {
    open += R"({"type":"Container","children":[)";
    close += "]}";
  }
  const std::string text =
      R"({"v":1,"tokens":{},"views":{"deep":)" + open + R"({"type":"Text","text":"x"})" + close +
      "}}";
  const EnvelopeReport report = read_envelope(text);
  // The cut is a warning like any other: the payload still loads.
  CHECK(report.ok);
  bool saw_too_deep = false;
  for (const Diagnostic &diagnostic : report.diagnostics) {
    if (diagnostic.code == DiagnosticCode::TooDeep) saw_too_deep = true;
  }
  CHECK(saw_too_deep);
}

TEST(validate, unknown_members_of_a_closed_set_load_and_take_the_default) {
  // Shapes, never vocabularies: validating the value would make tomorrow's
  // content today's error. `"diagonal"` is a well-formed string, so it loads
  // clean and simply behaves as the default.
  const EnvelopeReport report = read_envelope(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"ScrollView","axis":"diagonal","layout":{"justify":"sideways"},
      "style":{"textAlign":"middle"},"transition":{"duration":100,"easing":"bouncy"}}}})");
  CHECK(report.ok);
  expect_diagnostics(report, {});
  const Node &root = report.envelope.views[0].root;
  CHECK_EQ(static_cast<int>(root.scroll_axis), static_cast<int>(ScrollAxis::Vertical));
  CHECK_EQ(static_cast<int>(root.layout.justify), static_cast<int>(Justify::Start));
  CHECK_EQ(static_cast<int>(*root.style.text_align), static_cast<int>(TextAlign::Start));
  CHECK(root.transition.present);
  CHECK_EQ(static_cast<int>(root.transition.easing), static_cast<int>(Easing::Linear));
}

TEST(validate, unknown_props_pass_in_silence) {
  const EnvelopeReport report = read_envelope(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","glow":true,"layout":{"skew":4}}}})");
  CHECK(report.ok);
  expect_diagnostics(report, {});
}
