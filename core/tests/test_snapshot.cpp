// The `ViewSnapshot` serializer, on the rules a golden file cannot pin down.
//
// `golden/metrics/flex-layout.json` proves the common path byte for byte, but a
// corpus case only exercises what it happens to contain. What lives here is the
// rest of the contract: how a hidden node is written, what a duplicated id
// addresses, how a number and a color are spelled, and which defaults stay
// silent. Each of them is a place where two targets could drift without any
// recorded case noticing.

#include <string>

#include "snapshot.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;

namespace {

/** Loads one envelope, lays it out at 200×100 and returns its snapshot text. */
std::string snapshot_of(const char *json, double width = 200, double height = 100) {
  static Document document;
  document = Document();
  if (!document.load(json)) return "load failed";
  View *view = document.view();
  if (view == nullptr) return "no view";
  view->set_size(width, height);
  view->layout_frame();
  return snapshot_view(*view);
}

bool contains(const std::string &haystack, const std::string &needle) {
  return haystack.find(needle) != std::string::npos;
}

}  // namespace

TEST(snapshot, a_node_out_of_layout_says_only_that_it_is_out) {
  // Its rect, its style and its children are whatever the last frame that DID
  // lay it out left behind: recording them would be a lie about a node that is
  // not on screen. Which mechanism hid it is the one thing worth saying.
  //
  // The `visible` here is BOUND, which is the only way a node reports itself out
  // this way: a statically hidden one is never built, so it has nothing to say.
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","layout":{"width":100,"height":50},
      "children":[{"type":"Container","id":"gone","visible":{"bind":"ui.gone"},
                   "style":{"background":"#ff0000"},"layout":{"width":10,"height":10},
                   "children":[{"type":"Container","id":"inside"}]}]}}})");

  CHECK(contains(text, "\"ref\": \"gone\",\n        \"out\": \"visible\""));
  // The walk stopped: nothing under it, and none of its own geometry.
  CHECK(!contains(text, "inside"));
  CHECK(!contains(text, "#ff0000"));
}

TEST(snapshot, an_id_two_nodes_share_addresses_neither_of_them) {
  // Every instance a `Repeat` builds carries the id its template declared, so an
  // id is unique in the DOCUMENT and not in the tree the view expands from it.
  // Both fall back to their path, which keeps one ref pointing at one node.
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","children":[
        {"type":"Container","id":"row"},{"type":"Container","id":"row"},
        {"type":"Container","id":"only"}]}}})");

  CHECK(contains(text, "\"ref\": \"0\""));
  CHECK(contains(text, "\"ref\": \"1\""));
  CHECK(contains(text, "\"ref\": \"only\""));
  CHECK(!contains(text, "\"ref\": \"row\""));
  // A root with no id of its own is the one path that is not a number.
  CHECK(contains(text, "\"ref\": \"$root\""));
}

TEST(snapshot, the_pointer_and_the_focus_are_named_at_the_top) {
  Document document;
  CHECK(document.load(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","children":[
        {"type":"Button","id":"buy","autofocus":true,
         "layout":{"width":100,"height":40},"style":{"background":"#4f46e5"}}]}}})"));
  View *view = document.view();
  view->set_size(200, 100);
  view->layout_frame();
  CHECK(contains(snapshot_view(*view), "\"focus\": \"buy\",\n  \"hover\": null,\n  \"pressed\": null"));

  view->pointer_down(10, 10);
  view->layout_frame();
  const std::string pressed = snapshot_view(*view);
  CHECK(contains(pressed, "\"hover\": \"buy\",\n  \"pressed\": \"buy\""));
  // And the node carries them itself, in the format's normative merge order.
  CHECK(contains(
      pressed,
      "\"states\": [\n          \"hover\",\n          \"focused\",\n          \"pressed\"\n        ]"));
}

TEST(snapshot, a_number_is_written_the_way_the_corpus_recorded_it) {
  // Three decimals, trailing zeros trimmed — the same digits `JSON.stringify`
  // writes for a value already rounded to three. Locale-free on purpose: a game
  // under a Spanish locale must not write `33,333`.
  // The root is arranged into the viewport, so the thirds are of 100.
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","layout":{"direction":"row"},
      "children":[{"type":"Container","layout":{"grow":1,"height":10}},
                  {"type":"Container","layout":{"grow":1,"height":10}},
                  {"type":"Container","layout":{"grow":1,"height":10}}]}}})",
                                       100, 10);

  CHECK(contains(text, "\"width\": 33.333"));
  CHECK(contains(text, "\"x\": 66.667"));
  // A whole number keeps no decimal point at all.
  CHECK(contains(text, "\"height\": 10"));
}

TEST(snapshot, a_color_is_hex_and_carries_its_alpha_only_when_it_has_one) {
  const std::string text = snapshot_of(R"({"v":1,"tokens":{"color.veil":"#0000007f"},"views":{"a":{
      "type":"Container","style":{"background":"{color.veil}"},
      "layout":{"width":10,"height":10},
      "children":[{"type":"Container","style":{"background":"#4F46E5"},
                   "layout":{"width":5,"height":5}}]}}})");

  CHECK(contains(text, "\"background\": \"#0000007f\""));
  CHECK(contains(text, "\"background\": \"#4f46e5\""));
}

TEST(snapshot, the_defaults_every_node_resolves_to_stay_silent) {
  // A zero border, a zero radius and a full opacity are what every node lands on:
  // recording them would bury the ones that mean something. A zero OPACITY does
  // not — that one is a decision.
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","layout":{"width":10,"height":10},
      "children":[{"type":"Container","style":{"opacity":0},"layout":{"width":5,"height":5}}]}}})");

  CHECK(!contains(text, "borderWidth"));
  CHECK(!contains(text, "radius"));
  CHECK(!contains(text, "\"opacity\": 1"));
  CHECK(contains(text, "\"opacity\": 0"));
  // A node with nothing to say about its paint has no `style` key at all.
  CHECK(contains(text, "\"ref\": \"$root\",\n    \"rect\""));
}

TEST(snapshot, a_string_is_escaped_and_utf8_passes_through) {
  // `JSON.stringify` escapes the quote and the backslash and leaves the bytes of
  // a multi-byte character alone — so `Poción` is `Poción` on both sides.
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"po\"ción":{
      "type":"Container","layout":{"width":10,"height":10}}}})");

  CHECK(contains(text, "\"view\": \"po\\\"ción\""));
}

TEST(snapshot, an_empty_layer_is_written_as_an_empty_array) {
  // The shape is complete from day one even where the runtime has nothing to put
  // in it: a view with no overlays and a target that cannot assemble the layer
  // yet write the same two characters, which is what makes the field additive.
  CHECK(contains(snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{"type":"Container"}}})"),
                 "\"layer\": [],"));
}

TEST(snapshot, the_measured_size_shows_up_only_when_the_arrange_overrode_it) {
  // A stretched or grown child asked for one size and got another; a child that
  // got what it asked for says nothing, and the diff stays about what moved.
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","layout":{"direction":"row"},
      "children":[{"type":"Container","layout":{"grow":1}},
                  {"type":"Container","layout":{"width":30,"height":20}}]}}})",
                                       100, 20);

  // The grown child asked for nothing and was given 70 wide.
  CHECK(contains(text, "\"width\": 70"));
  CHECK(contains(text, "\"measured\""));
  // The second one got exactly what it measured, so it says nothing about it.
  CHECK(contains(text,
                 "\"ref\": \"1\",\n        \"rect\": {\n          \"x\": 70,\n          \"y\": 0,\n"
                 "          \"width\": 30,\n          \"height\": 20\n        }\n      }"));
}

TEST(snapshot, a_field_records_its_text_its_caret_and_its_own_scroll) {
  const std::string text = snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{
      "type":"TextInput","id":"name","value":"Sergi","layout":{"width":100}}}})");
  // The ends are written in the GESTURE's order, not sorted: a selection dragged
  // backwards is a different state from the same span dragged forwards, and it
  // is the one shift+arrow shrinks.
  CHECK(contains(text, "\"field\": {\n      \"text\": \"Sergi\",\n      \"anchor\": 5,\n"
                       "      \"focus\": 5,\n      \"scroll\": 0\n    }"));
}

TEST(snapshot, only_a_field_holding_nothing_wears_the_empty_state) {
  const char *TWO_FIELDS = R"({"v":1,"tokens":{},"views":{"a":{
      "type":"Container","children":[
        {"type":"TextInput","id":"filled","value":"x","layout":{"width":80}},
        {"type":"TextInput","id":"blank","placeholder":"…","layout":{"width":80}}]}}})";
  const std::string text = snapshot_of(TWO_FIELDS);
  // First in the normative merge order, so it is first in the list too — which is
  // what keeps a diff of two snapshots comparing the same positions.
  CHECK(contains(text, "\"ref\": \"blank\",\n"));
  CHECK(contains(text, "\"states\": [\n          \"empty\"\n        ]"));
  // Exactly one node says it: the placeholder is a state of the VALUE, so a field
  // holding text is not in it.
  CHECK_EQ(text.find("\"empty\""), text.rfind("\"empty\""));
}

TEST(snapshot, a_node_that_is_not_a_field_says_nothing_about_one) {
  // Absent means "this node has none", which is the whole reason the block is
  // written by the type that owns it rather than defaulted everywhere.
  CHECK(!contains(snapshot_of(R"({"v":1,"tokens":{},"views":{"a":{"type":"Container"}}})"),
                  "\"field\""));
}
