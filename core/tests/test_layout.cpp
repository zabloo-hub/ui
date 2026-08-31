#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>

#include "json.h"
#include "testing.h"
#include "validate.h"
#include "view.h"

using namespace zabloo;

namespace {

/** Everything the corpus rounds to, and everything this compares to. */
constexpr double EPSILON = 0.001;

std::string golden(const std::string &relative) {
  return zabloo::testing::read_file(zabloo::testing::repo_root() + "/golden/" + relative);
}

/** The recorded style is the RESOLVED one: tokens looked up, states merged. */
void compare_styles(const LayoutNode &node, JsonRef expected, const std::string &where) {
  const JsonRef style = expected.get("style");
  const std::string ref = std::string(expected.get("ref").as_string());
  const auto number = [&](const char *key, double actual) {
    if (!style.get(key).exists()) return;
    CHECK_NEAR(actual, style.get(key).as_number(), EPSILON);
    if (std::fabs(actual - style.get(key).as_number()) > EPSILON) {
      ::zabloo::testing::report(__FILE__, __LINE__, std::string(key) + " at " + where + " (" + ref + ")");
    }
  };
  const auto color = [&](const char *key, const std::optional<Color> &actual) {
    if (!style.get(key).exists()) return;
    Color wanted;
    CHECK(parse_color_literal(style.get(key).as_string(), wanted));
    CHECK(actual.has_value());
    if (actual.has_value() && !(*actual == wanted)) {
      ::zabloo::testing::report(__FILE__, __LINE__, std::string(key) + " at " + where + " (" + ref + ")");
    }
  };
  color("background", node.resolved.background);
  color("color", node.resolved.color);
  color("borderColor", node.resolved.border_color);
  number("borderWidth", node.resolved.border_width);
  number("radius", node.resolved.radius);
  number("padding", node.resolved.padding);
  number("gap", node.resolved.gap);
  number("opacity", node.resolved.opacity);

  const JsonRef children = expected.get("children");
  for (uint32_t i = 0; i < std::min<uint32_t>(children.size(), node.children.size()); i++) {
    compare_styles(node.children[i], children.at(i), where + "." + std::to_string(i));
  }
}

}  // namespace

// `flex-layout` is compared BYTE FOR BYTE by the golden harness
// (`test_golden.cpp`), which walks the whole `ViewSnapshot` and not just the
// rects. What stays here is the half of the corpus that harness cannot reach
// yet — `states-tokens`, whose styles are final while its text is G4's — and the
// rules on their own, so a corpus failure has somewhere to point.

namespace {

/** Lays out one hand-written view and hands back its runtime tree. */
class Fixture {
 public:
  Fixture(const std::string &view_json, double width, double height) {
    const std::string text = R"({"v":1,"tokens":{"space.2":8},"views":{"a":)" + view_json + "}}";
    loaded_ = document_.load(text);
    document_.show("a");
    if (document_.view() != nullptr) {
      document_.view()->set_size(width, height);
      document_.view()->layout_frame();
    }
  }

  bool loaded() const { return loaded_; }
  const LayoutNode &root() const { return document_.view()->root(); }
  const LayoutNode &child(size_t i) const { return root().children[i]; }

 private:
  Document document_;
  bool loaded_ = false;
};

}  // namespace

TEST(layout, padding_and_gap_come_out_of_the_content_box) {
  const Fixture fixture(R"({"type":"Container","layout":{"direction":"row","padding":10,"gap":"{space.2}"},
      "children":[{"type":"Container","layout":{"width":20,"height":20}},
                  {"type":"Container","layout":{"width":30,"height":20}}]})",
                        200, 100);
  CHECK(fixture.loaded());
  CHECK_NEAR(fixture.child(0).rect.x, 10.0, EPSILON);
  // The gap is a token: movement and spacing are themeable the same way.
  CHECK_NEAR(fixture.child(1).rect.x, 38.0, EPSILON);
  CHECK_NEAR(fixture.child(0).rect.y, 10.0, EPSILON);
  CHECK_NEAR(fixture.root().measured.x, 10.0 + 20.0 + 8.0 + 30.0 + 10.0, EPSILON);
}

TEST(layout, grow_shares_out_what_is_left_on_the_line) {
  const Fixture fixture(R"({"type":"Container","layout":{"direction":"row","width":300},
      "children":[{"type":"Container","layout":{"grow":1,"height":10}},
                  {"type":"Container","layout":{"grow":3,"height":10}},
                  {"type":"Container","layout":{"width":100,"height":10}}]})",
                        300, 100);
  CHECK_NEAR(fixture.child(0).rect.width, 50.0, EPSILON);
  CHECK_NEAR(fixture.child(1).rect.width, 150.0, EPSILON);
  CHECK_NEAR(fixture.child(2).rect.width, 100.0, EPSILON);
}

TEST(layout, justify_places_the_leftover_and_align_places_the_cross) {
  const Fixture centered(R"({"type":"Container","layout":{"direction":"row","justify":"center","align":"center","width":200,"height":100},
      "children":[{"type":"Container","layout":{"width":40,"height":20}}]})",
                         200, 100);
  CHECK_NEAR(centered.child(0).rect.x, 80.0, EPSILON);
  CHECK_NEAR(centered.child(0).rect.y, 40.0, EPSILON);

  const Fixture between(R"({"type":"Container","layout":{"direction":"row","justify":"space-between","width":200,"height":20},
      "children":[{"type":"Container","layout":{"width":40,"height":20}},
                  {"type":"Container","layout":{"width":40,"height":20}}]})",
                        200, 100);
  CHECK_NEAR(between.child(0).rect.x, 0.0, EPSILON);
  CHECK_NEAR(between.child(1).rect.x, 160.0, EPSILON);

  // Below the root on purpose: the root is always arranged into the viewport, so
  // a declared size on it only ever changes what it MEASURES.
  const Fixture stretched(R"({"type":"Container","children":[
      {"type":"Container","layout":{"direction":"row","align":"stretch","width":200,"height":60},
       "children":[{"type":"Container","layout":{"width":40,"height":10}}]}]})",
                          200, 100);
  CHECK_NEAR(stretched.child(0).children[0].rect.height, 60.0, EPSILON);
}

TEST(layout, a_grid_is_a_row_that_wraps) {
  // ZAB-32: `wrap` only takes effect on a ROW — the measure pass carries a width
  // offer and nothing else, so a column has no length to break against.
  const Fixture grid(R"({"type":"Container","children":[
      {"type":"Container","layout":{"direction":"row","wrap":true,"width":100,"gap":10},
       "children":[{"type":"Container","layout":{"width":40,"height":20}},
                   {"type":"Container","layout":{"width":40,"height":20}},
                   {"type":"Container","layout":{"width":40,"height":20}}]}]})",
                     200, 200);
  const LayoutNode &row = grid.child(0);
  CHECK_NEAR(row.children[0].rect.x, 0.0, EPSILON);
  CHECK_NEAR(row.children[1].rect.x, 50.0, EPSILON);
  CHECK_NEAR(row.children[2].rect.x, 0.0, EPSILON);
  CHECK_NEAR(row.children[2].rect.y, 30.0, EPSILON);

  const Fixture column(R"({"type":"Container","children":[
      {"type":"Container","layout":{"direction":"column","wrap":true,"height":50},
       "children":[{"type":"Container","layout":{"width":10,"height":40}},
                   {"type":"Container","layout":{"width":10,"height":40}}]}]})",
                       200, 200);
  // One line, overflowing: the degradation an SDK that predates the flag gives.
  CHECK_NEAR(column.child(0).children[1].rect.y, 40.0, EPSILON);
  CHECK_NEAR(column.child(0).children[1].rect.x, 0.0, EPSILON);
}

TEST(layout, a_hidden_node_leaves_the_layout_and_takes_its_gap_with_it) {
  // `visible` is the single hiding mechanism, with display:none semantics — and
  // a STATICALLY hidden subtree is not built at all: nothing can ever turn it
  // back on, so it has no runtime worth keeping. What survives is the gap it
  // took with it.
  const Fixture fixture(R"({"type":"Container","layout":{"direction":"row","gap":10},
      "children":[{"type":"Container","layout":{"width":20,"height":20}},
                  {"type":"Container","visible":false,"layout":{"width":20,"height":20}},
                  {"type":"Container","layout":{"width":20,"height":20}}]})",
                        200, 100);
  CHECK_EQ(fixture.root().children.size(), 2u);
  CHECK_NEAR(fixture.child(1).rect.x, 30.0, EPSILON);
  CHECK_NEAR(fixture.root().measured.x, 50.0, EPSILON);
}

TEST(layout, a_bound_visible_with_no_data_starts_hidden) {
  // Data-driven visibility means "visible when the data says so" (2026-08-03),
  // and until G7 reads the store every binding reads as no value.
  const Fixture fixture(R"({"type":"Container","layout":{"direction":"row"},
      "children":[{"type":"Container","visible":{"bind":"shop.open"},"layout":{"width":50,"height":20}}]})",
                        200, 100);
  CHECK_NEAR(fixture.root().measured.x, 0.0, EPSILON);
}

TEST(layout, an_overlay_is_declared_in_place_and_leaves_its_parents_flow) {
  // 2026-08-11: it belongs to the view's layer, so it is neither measured nor
  // arranged by its parent — its own width is ignored, and it pushes no sibling.
  const Fixture fixture(R"({"type":"Container","layout":{"direction":"row","gap":10},
      "children":[{"type":"Container","layout":{"width":20,"height":20}},
                  {"type":"Overlay","layout":{"width":500,"height":500}},
                  {"type":"Container","layout":{"width":20,"height":20}}]})",
                        200, 100);
  CHECK_NEAR(fixture.root().measured.x, 50.0, EPSILON);
  CHECK_NEAR(fixture.child(2).rect.x, 30.0, EPSILON);
}

TEST(layout, a_declared_size_replaces_the_offer_and_the_measurement) {
  const Fixture fixture(R"({"type":"Container","layout":{"width":80,"height":30},
      "children":[{"type":"Container","layout":{"width":200,"height":200}}]})",
                        400, 400);
  CHECK_NEAR(fixture.root().measured.x, 80.0, EPSILON);
  CHECK_NEAR(fixture.root().measured.y, 30.0, EPSILON);
  // What the content asked for is kept apart, since the Collapse's motion (G8)
  // needs "how tall is this with the content in".
  CHECK_NEAR(fixture.root().natural.x, 200.0, EPSILON);
}

TEST(layout, states_tokens_resolves_the_styles_the_corpus_recorded) {
  // The other half of a frame, and the half that does not wait on the text
  // engine: flat token lookup, the normative merge order, `autofocus` putting a
  // Button in `focused`, and opacity resolved per node. The rects of this case
  // only settle when G4 (ZAB-137) can measure a glyph; these numbers are final
  // today.
  const std::string envelope_text = golden("envelopes/states-tokens.json");
  const std::string metrics_text = golden("metrics/states-tokens.json");
  Document document;
  CHECK(document.load(envelope_text));
  CHECK(document.show("states-tokens"));
  View *view = document.view();
  CHECK(view != nullptr);
  if (view == nullptr) return;
  view->set_size(480, 320);
  view->layout_frame();

  const JsonParse metrics = JsonDoc::parse(metrics_text);
  CHECK(metrics.ok);
  // The corpus says which node holds the focus, and it got there through
  // `autofocus` alone.
  CHECK(view->focus() != nullptr);
  if (view->focus() != nullptr) {
    CHECK_EQ(view->focus()->ir->id, std::string(metrics.doc.root().get("focus").as_string()));
  }

  compare_styles(view->root(), metrics.doc.root().get("tree"), "root");
}
