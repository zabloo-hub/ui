// Forward-compat (G16): what a build that does not have a capability draws.
//
// This pins the promise hot-update rests on. Content is authored against a
// format that keeps growing and lands in games that shipped months ago, so "the
// SDK is older than its content" is the ordinary case, not the edge. The rules
// are normative in `docs/format/loading.md`, the policy that leans on them is in
// `docs/format/versioning.md`, and the observed behaviour — what a player
// actually sees — is the matrix in `docs/format/degradation.md`, of which this
// file is the evidence.
//
// **How an older SDK is synthesized, and why it is not a flag.** An older reader
// does not carry a switch that turns a capability off: it carries a SMALLER
// VOCABULARY. So every case here is one rewrite of the payload — an identifier
// spelled in a way this build has never heard of:
//
//     a type   "type": "Overlay"       ->  "type": "Overlay@next"
//     a prop   "transition": { ... }   ->  "transition@next": { ... }
//     a value  "easing": "ease-out"    ->  "easing": "ease-out@next"
//
// Renaming rather than deleting is what makes this faithful. The payload keeps
// its shape and stays valid JSON, and the rewrite drives the very code paths a
// real old SDK takes: `node_type_from` returning `Unknown`, an unread key
// ignored in silence, `enum_from` falling to the default. A flag on the loader
// would have tested a second route to the same states and added production
// surface that only tests use.
//
// The subjects come from the corpus: every capability below is exercised by a
// `golden/` envelope, so nothing here is a fixture written to make its own point.
//
// One boundary is stated rather than asserted around, and has its own case at
// the bottom: a `ViewSnapshot` records a FRAME. Motion, actions and the UVs of a
// fit mode are not in it, so for those capabilities the degraded frame is
// byte-identical and the loss is real but elsewhere.

#include <algorithm>
#include <functional>
#include <iterator>
#include <string>
#include <utility>
#include <vector>

#include "corpus.h"
#include "json.h"
#include "snapshot.h"
#include "testing.h"
#include "view.h"

using namespace zabloo;

namespace {

using zabloo::testing::corpus_file;

/**
 * The suffix that makes a spelling foreign to this build.
 *
 * Legal inside a JSON string and impossible to confuse with a member of any
 * vocabulary, present or future — which is what a reader meeting tomorrow's
 * content experiences: not a corrupt name, a name.
 */
const std::string NEXT = "@next";

std::string replace_all(std::string text, const std::string &needle, const std::string &replacement) {
  if (needle.empty()) return text;
  size_t at = 0;
  while ((at = text.find(needle, at)) != std::string::npos) {
    text.replace(at, needle.size(), replacement);
    at += replacement.size();
  }
  return text;
}

/** Both spellings a formatter may leave behind, so the rewrite is not a bet. */
std::string rewrite_pair(std::string json, const std::string &prefix, const std::string &from,
                         const std::string &to) {
  json = replace_all(std::move(json), prefix + " " + from, prefix + " " + to);
  return replace_all(std::move(json), prefix + from, prefix + to);
}

/** A node type this build does not implement: it lands as `Unknown`. */
std::string unknown_type(std::string json, const std::string &type) {
  return rewrite_pair(std::move(json), "\"type\":", "\"" + type + "\"", "\"" + type + NEXT + "\"");
}

/** A property this build never reads: the key is simply not one it knows. */
std::string unknown_prop(std::string json, const std::string &key) {
  return replace_all(std::move(json), "\"" + key + "\":", "\"" + key + NEXT + "\":");
}

/**
 * A member of a closed set this build does not have: it takes the default.
 *
 * Scoped to the KEY it sits under, because a vocabulary word is not reserved:
 * `horizontal` is a `ScrollAxis` and it is also, in `scroll-clip`, the id an
 * author gave a node. Rewriting by value alone renamed both, and the sweep then
 * reported content loss no reader would ever see.
 */
std::string unknown_value(std::string json, const std::string &key, const std::string &value) {
  return rewrite_pair(std::move(json), "\"" + key + "\":", "\"" + value + "\"",
                      "\"" + value + NEXT + "\"");
}

// --- one rendered frame ---------------------------------------------------

/**
 * A frame, held with the document it was parsed from so cursors into it stay valid.
 *
 * No `JsonRef` is stored here on purpose: a ref holds the ADDRESS of its
 * `JsonDoc`, so one taken before this struct was moved would point at where the
 * document used to be. Everything reads through `root()`.
 */
struct Frame {
  bool loaded = false;
  bool fatal = false;
  std::string failure;
  std::string json;
  JsonParse parsed;

  JsonRef root() const { return parsed.doc.root(); }
};

using Rewrite = std::function<std::string(std::string)>;

/**
 * The named corpus case, rendered as this build sees it after `rewrite`.
 *
 * The viewport and the `data` come from `golden/cases.json`, so a degraded frame
 * is measured against the same screen the recorded one was. The clock and the
 * pad are deliberately not replayed: what is under test is what a build DRAWS
 * without a capability, and that is legible in the frame it mounts.
 */
Frame case_frame(const std::string &name, const Rewrite &rewrite = nullptr) {
  Frame out;
  const JsonRef spec = zabloo::testing::corpus_cases().get(name);
  std::string text = corpus_file("envelopes/" + std::string(spec.get("envelope").as_string()));
  if (rewrite) text = rewrite(std::move(text));

  Document document;
  out.loaded = document.load(text);
  for (const Diagnostic &diagnostic : document.diagnostics()) {
    if (diagnostic.level == DiagnosticLevel::Fatal) out.fatal = true;
  }
  if (!out.loaded) {
    out.failure = "the envelope was refused";
    return out;
  }
  View *view = document.view();
  if (view == nullptr) {
    out.failure = "loaded but showed no view";
    return out;
  }
  view->set_size(spec.get("width").as_number(480.0), spec.get("height").as_number(320.0));
  const JsonRef data = spec.get("data");
  for (uint32_t i = 0; i < data.size(); i++) {
    document.set_data(data.key_at(i), zabloo::testing::to_data_value(data.at(i)));
  }
  // Two frames, as the corpus requires: the second is the settling frame in
  // which the window over freshly measured items is computed.
  view->layout_frame();
  view->layout_frame();
  out.json = snapshot_view(*view);
  out.parsed = JsonDoc::parse(out.json);
  return out;
}

// --- reading a snapshot ---------------------------------------------------

void walk(JsonRef node, const std::function<void(JsonRef)> &visit) {
  if (!node.is_object()) return;
  visit(node);
  const JsonRef children = node.get("children");
  for (uint32_t i = 0; i < children.size(); i++) walk(children.at(i), visit);
}

/** Every node of the frame — the tree AND the overlay layer, which is content too. */
void walk_frame(JsonRef root, const std::function<void(JsonRef)> &visit) {
  walk(root.get("tree"), visit);
  const JsonRef layer = root.get("layer");
  for (uint32_t i = 0; i < layer.size(); i++) walk(layer.at(i), visit);
}

/**
 * Every id an author wrote that this frame still shows, once each.
 *
 * Deduplicated on purpose: an overlay is named BOTH by its node in the tree and
 * by its entry in the layer, so a plain list counts it twice and a difference
 * against a frame with no layer reports content that never went anywhere. That
 * artifact is what this comment exists to keep from coming back.
 */
std::vector<std::string> refs_of(JsonRef root) {
  std::vector<std::string> out;
  walk_frame(root, [&](JsonRef node) {
    if (node.get("ref").is_string()) out.push_back(std::string(node.get("ref").as_string()));
  });
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

/** Nodes of the tree alone. A layer entry is a summary of one, not another one. */
size_t tree_nodes(JsonRef root) {
  size_t out = 0;
  walk(root.get("tree"), [&](JsonRef) { out++; });
  return out;
}

/** The node an author gave this id, wherever it ended up. */
JsonRef by_ref(JsonRef root, const std::string &ref) {
  JsonRef found;
  walk_frame(root, [&](JsonRef node) {
    if (!found.exists() && node.get("ref").is_string() && node.get("ref").as_string() == ref) {
      found = node;
    }
  });
  return found;
}

size_t count_key(JsonRef root, const std::string &key) {
  size_t out = 0;
  walk_frame(root, [&](JsonRef node) {
    if (node.get(key).exists()) out++;
  });
  return out;
}

/** What the full build shows and the degraded one does not. */
std::vector<std::string> lost(JsonRef full, JsonRef degraded) {
  const std::vector<std::string> before = refs_of(full);
  const std::vector<std::string> after = refs_of(degraded);
  std::vector<std::string> out;
  std::set_difference(before.begin(), before.end(), after.begin(), after.end(),
                      std::back_inserter(out));
  return out;
}

std::string join(const std::vector<std::string> &items) {
  std::string out;
  for (const std::string &item : items) {
    if (!out.empty()) out += ", ";
    out += item;
  }
  return out.empty() ? "(none)" : out;
}

/** The envelope text a case loads, before any rewrite. */
std::string case_text(const std::string &name) {
  const JsonRef spec = zabloo::testing::corpus_cases().get(name);
  return corpus_file("envelopes/" + std::string(spec.get("envelope").as_string()));
}

/** One capability withdrawn from one screen of the corpus. */
struct Cut {
  const char *label;
  const char *case_name;
  Rewrite rewrite;
};

/**
 * A cut per node type, on a corpus screen that actually uses it.
 *
 * Twelve of the thirteen. `Container` is absent because it IS the fallback: a
 * reader without it has nothing to degrade unknown types INTO, and could not
 * render a screen at all. That is not a gap in the sweep, it is the floor of the
 * vocabulary.
 */
std::vector<Cut> type_cuts() {
  auto type = [](const char *name) {
    return [name](std::string j) { return unknown_type(std::move(j), name); };
  };
  return {
      {"Text", "text-wrap", type("Text")},
      {"Button", "gamepad-nav", type("Button")},
      {"Collapse", "collapse-tabs", type("Collapse")},
      {"ScrollView", "scroll-clip", type("ScrollView")},
      {"Image", "assets-image", type("Image")},
      {"Toggle", "controls", type("Toggle")},
      {"Slider", "controls", type("Slider")},
      {"TextInput", "textinput", type("TextInput")},
      {"Overlay", "overlays", type("Overlay")},
      {"Repeat", "repeat", type("Repeat")},
      {"ProgressBar", "controls", type("ProgressBar")},
      {"Spinner", "controls", type("Spinner")},
  };
}

/** A cut per additive property and per member of a closed set. */
std::vector<Cut> prop_cuts() {
  auto prop = [](const char *name) {
    return [name](std::string j) { return unknown_prop(std::move(j), name); };
  };
  auto value = [](const char *key, const char *name) {
    return [key, name](std::string j) { return unknown_value(std::move(j), key, name); };
  };
  return {
      {"transition", "transitions", prop("transition")},
      {"wrap", "flex-layout", prop("wrap")},
      {"anchor", "anchors", prop("anchor")},
      {"clip", "scroll-clip", prop("clip")},
      {"disabled", "disabled", prop("disabled")},
      {"autoCloseMs", "overlays", prop("autoCloseMs")},
      {"onChange", "controls", prop("onChange")},
      {"selected", "collapse-tabs", prop("selected")},
      {"group", "collapse-tabs", prop("group")},
      {"axis: horizontal", "scroll-clip", value("axis", "horizontal")},
      {"fit: cover", "assets-image", value("fit", "cover")},
      {"easing: ease-out", "transitions", value("easing", "ease-out")},
      {"at: top-left", "anchors", value("at", "top-left")},
      {"group: exclusive-select", "collapse-tabs", value("group", "exclusive-select")},
      {"group: exclusive-check", "controls", value("group", "exclusive-check")},
  };
}

}  // namespace

TEST(forward_compat, every_cut_really_rewrites_the_payload_it_claims_to) {
  // The guard that keeps the rest of this file from passing for the wrong
  // reason. A cut is a string rewrite over a corpus envelope, so a renamed id, a
  // reformatted fixture or a typo in a vocabulary word would make it match
  // NOTHING — and a capability that was never withdrawn degrades perfectly.
  //
  // It is the same shape as the golden skip-list guard: the failure mode of a
  // test that does nothing is silence, so something has to be watching for it.
  std::vector<Cut> all = type_cuts();
  const std::vector<Cut> props = prop_cuts();
  all.insert(all.end(), props.begin(), props.end());

  for (const Cut &cut : all) {
    const std::string before = case_text(cut.case_name);
    CHECK(!before.empty());
    const std::string what = std::string(cut.label) + " on " + cut.case_name;
    CHECK_EQ(what + " rewrites the payload: " + (cut.rewrite(before) == before ? "no" : "yes"),
             what + " rewrites the payload: yes");
  }
}

TEST(forward_compat, a_capability_this_build_lacks_is_never_a_refusal) {
  // The claim the whole page rests on, swept over the corpus rather than argued:
  // withdraw any one capability from a real screen and the payload still loads,
  // still yields a view, and reports nothing fatal. A degradation that refused
  // would not be a degradation — it would be the hot-update failing.
  std::vector<Cut> all = type_cuts();
  const std::vector<Cut> props = prop_cuts();
  all.insert(all.end(), props.begin(), props.end());

  for (const Cut &cut : all) {
    const Frame frame = case_frame(cut.case_name, cut.rewrite);
    const std::string what = std::string(cut.label) + " on " + cut.case_name;
    CHECK_EQ(what + ": " + (frame.loaded ? "loads" : "refused — " + frame.failure),
             what + ": loads");
    CHECK_EQ(what + " fatal: " + (frame.fatal ? "yes" : "no"), what + " fatal: no");
  }
}

TEST(forward_compat, no_content_disappears_when_a_type_goes_unknown) {
  // The normative rule says an unknown type renders as a `Container` preserving
  // its children, so every id the full build shows the degraded one shows too.
  //
  // `Repeat` is the one exception, and it is the rule stated rather than broken:
  // its children come from the DATA, so a build without it has nothing to expand
  // and falls back to the one thing the document holds — its template. That is
  // the promise `docs/format/versioning.md` makes for it, and the case below is
  // where it is checked.
  for (const Cut &cut : type_cuts()) {
    if (std::string(cut.label) == "Repeat") continue;
    const Frame full = case_frame(cut.case_name);
    const Frame degraded = case_frame(cut.case_name, cut.rewrite);
    const std::string what = std::string(cut.label) + " on " + cut.case_name;
    CHECK_EQ(what + " loses: " + join(lost(full.root(), degraded.root())),
             what + " loses: (none)");
  }
}

TEST(forward_compat, an_unknown_type_keeps_its_own_box_and_reports_its_real_name) {
  // What the fallback preserves, on a node that carries all of it: the id, the
  // style, the children — and the type spelled the way the payload spelled it,
  // which is what lets a diagnostic name a capability the reader does not have
  // instead of a generic box.
  const Frame degraded = case_frame("overlays", [](std::string j) {
    return unknown_type(std::move(j), "Overlay");
  });
  const JsonRef modal = by_ref(degraded.root(), "modal");
  CHECK_EQ(std::string(modal.get("type").as_string()), std::string("Overlay@next"));
  CHECK_EQ(modal.get("children").size(), 1u);
  CHECK(modal.get("style").exists());
  CHECK(by_ref(degraded.root(), "accept-label").exists());
}

TEST(forward_compat, a_button_a_build_does_not_know_is_a_box_nothing_can_reach) {
  // Focusability derives from component IDENTITY (2026-08-04), so a type the
  // reader does not have is not focusable — which is the honest degradation and
  // not an oversight: a box that took the focus but fired nothing would be a
  // control that looks operable, exactly what the additive rule forbids.
  const Frame full = case_frame("gamepad-nav");
  const Frame degraded = case_frame("gamepad-nav", [](std::string j) {
    return unknown_type(std::move(j), "Button");
  });
  // The menu had a focused button and now has nothing focused at all: the
  // spatial walk collects candidates by identity, and there are none left.
  CHECK_EQ(std::string(full.root().get("focus").as_string()), std::string("play"));
  CHECK_EQ(std::string(degraded.root().get("focus").as_string()), std::string());
  // `autofocus` cannot seat itself either — it names a node, and a node that
  // takes no focus does not become focusable by being pointed at.
  const Frame seated = case_frame("states-tokens");
  const Frame unseated = case_frame("states-tokens", [](std::string j) {
    return unknown_type(std::move(j), "Button");
  });
  CHECK_EQ(std::string(seated.root().get("focus").as_string()), std::string("primary"));
  CHECK_EQ(std::string(unseated.root().get("focus").as_string()), std::string());
  CHECK_EQ(join(lost(full.root(), degraded.root())), std::string("(none)"));
}

TEST(forward_compat, an_overlay_a_build_does_not_know_renders_in_the_flow) {
  // The layer is the capability. Without it the overlay is an ordinary child of
  // the node it was declared under — which is why declaring it IN PLACE was
  // worth the trouble (ZAB-19): the degradation is a panel that appears inline
  // instead of floating, and never a panel that disappears.
  const Frame full = case_frame("overlays");
  const Frame degraded = case_frame("overlays", [](std::string j) {
    return unknown_type(std::move(j), "Overlay");
  });
  CHECK(full.root().get("layer").size() > 0);
  CHECK_EQ(degraded.root().get("layer").size(), 0u);
  // And it is in the tree of both, so nothing had to move for that to be true.
  CHECK(by_ref(degraded.root(), "modal").exists());
  CHECK(by_ref(full.root(), "modal").exists());
}

TEST(forward_compat, a_repeat_a_build_does_not_know_is_one_static_copy_of_its_template) {
  // The degradation the vocabulary rule is usually explained with. `items` is a
  // binding no reader without `Repeat` will follow, so what is left is the
  // document's own child: the template, rendered once, with its item bindings
  // reading nothing.
  const Frame full = case_frame("repeat");
  const Frame degraded = case_frame("repeat", [](std::string j) {
    return unknown_type(std::move(j), "Repeat");
  });
  CHECK(tree_nodes(degraded.root()) < tree_nodes(full.root()));
  // No instance survives — an instance is addressed by its position in the data.
  CHECK_EQ(count_key(degraded.root(), "window"), 0u);
  CHECK(count_key(full.root(), "window") > 0u);
  // What a reader still has is a box holding the template, in the place the list
  // occupied: the screen keeps its shape, only the rows are gone.
  CHECK(by_ref(degraded.root(), "inventory").exists());
  // And it holds the EMPTY STATE at the same time. `children[1..]` is the slot a
  // `Repeat` shows when its array is empty, and a plain `Container` has no
  // reason to choose between its children — so the degradation is the template
  // and the "nothing here" message together, not one or the other.
  CHECK_EQ(count_key(degraded.root(), "out"), 0u);
  CHECK(count_key(full.root(), "out") > 0u);
}

TEST(forward_compat, a_scrollview_a_build_does_not_know_neither_clips_nor_offsets) {
  // The content overflows instead of scrolling, which is the whole degradation:
  // a viewport the reader cannot honour becomes no viewport at all.
  const Frame full = case_frame("scroll-clip");
  const Frame degraded = case_frame("scroll-clip", [](std::string j) {
    return unknown_type(std::move(j), "ScrollView");
  });
  CHECK(count_key(full.root(), "scroll") > 0u);
  CHECK_EQ(count_key(degraded.root(), "scroll"), 0u);
  // The clips a ScrollView implies go with it; a `clip` an author declared does not.
  CHECK(count_key(degraded.root(), "clip") < count_key(full.root(), "clip"));

  // And the second-order effect worth knowing about: virtualization is measured
  // against a viewport, so a list inside a scroller a build cannot honour
  // realizes every item instead of a window over them. It costs work, not
  // correctness — nothing is lost, there is simply more of it.
  const Frame windowed = case_frame("repeat");
  const Frame unbounded = case_frame("repeat", [](std::string j) {
    return unknown_type(std::move(j), "ScrollView");
  });
  CHECK(tree_nodes(unbounded.root()) > tree_nodes(windowed.root()));
}

TEST(forward_compat, a_control_a_build_does_not_know_keeps_its_slots_and_loses_its_value) {
  // Toggle, Slider and ProgressBar all read their children BY POSITION and size
  // or place them from a value. Without the type the slots survive as ordinary
  // flex children — still there, still styled — and the value they were arranged
  // by is the thing that goes.
  const Frame full = case_frame("controls");
  for (const char *type : {"Toggle", "Slider", "ProgressBar"}) {
    const std::string name(type);
    const Frame degraded = case_frame("controls", [&name](std::string j) {
      return unknown_type(std::move(j), name);
    });
    CHECK_EQ(name + " loses: " + join(lost(full.root(), degraded.root())), name + " loses: (none)");
    CHECK(count_key(degraded.root(), "value") < count_key(full.root(), "value"));
  }

  // The `Toggle` shows what "arranged by the type" buys, because its two
  // indicator slots SHARE a box and cross-fade (ZAB-36). A build without the
  // type has no reason to overlap them, so they become side-by-side siblings and
  // the control grows: a switch that showed one knob now shows both.
  const Frame degraded = case_frame("controls", [](std::string j) {
    return unknown_type(std::move(j), "Toggle");
  });
  auto x_of = [](JsonRef frame, const char *ref) {
    return by_ref(frame, ref).get("rect").get("x").as_number();
  };
  auto opacity_of = [](JsonRef frame, const char *ref) {
    return by_ref(frame, ref).get("style").get("opacity").as_number(1.0);
  };
  CHECK_EQ(x_of(full.root(), "switch-on"), x_of(full.root(), "switch-off"));
  CHECK(x_of(degraded.root(), "switch-on") != x_of(degraded.root(), "switch-off"));
  CHECK_EQ(opacity_of(full.root(), "switch-off"), 0.0);
  CHECK_EQ(opacity_of(degraded.root(), "switch-off"), 1.0);
  CHECK(by_ref(degraded.root(), "switch").get("rect").get("width").as_number() >
        by_ref(full.root(), "switch").get("rect").get("width").as_number());
}

TEST(forward_compat, a_textinput_a_build_does_not_know_is_an_empty_box) {
  // The one degradation that is honestly poor, and it is poor for a reason worth
  // writing down: a field's content is its VALUE, not a child, so a reader that
  // cannot edit also cannot show. It keeps its box, its background and its place
  // in the layout — an author who wants more puts it behind the field's own style.
  const Frame degraded = case_frame("textinput", [](std::string j) {
    return unknown_type(std::move(j), "TextInput");
  });
  CHECK_EQ(count_key(degraded.root(), "field"), 0u);
  CHECK(count_key(case_frame("textinput").root(), "field") > 0u);
}

TEST(forward_compat, the_two_leaves_that_carry_content_lose_it_and_that_is_the_rule_not_a_hole) {
  // `Text` and `Image` are the only nodes whose content is a PROP rather than a
  // child, so the `Container` fallback — which preserves children — has nothing
  // to preserve. This is the sharpest reading of the rule in
  // `docs/format/versioning.md`: a capability is additive only if its absence is
  // a reasonable picture, and "a reasonable picture" is exactly what a new
  // content-bearing leaf has to earn with its own box.
  const Frame text_full = case_frame("text-wrap");
  const Frame text_gone = case_frame("text-wrap", [](std::string j) {
    return unknown_type(std::move(j), "Text");
  });
  CHECK(count_key(text_full.root(), "text") > 0u);
  CHECK_EQ(count_key(text_gone.root(), "text"), 0u);
  // The boxes stay where they were, so the screen keeps its shape around the hole.
  CHECK_EQ(join(lost(text_full.root(), text_gone.root())), std::string("(none)"));

  // An `Image` splits in two, and the split is worth knowing: where the author
  // gave the node a size it keeps its box and paints its background — the very
  // placeholder ZAB-13 said to author instead of a `loading` state. Where the
  // size came from the manifest, the box is what the reader cannot compute, and
  // the node collapses.
  const Frame image_full = case_frame("assets-image");
  const Frame image_gone = case_frame("assets-image", [](std::string j) {
    return unknown_type(std::move(j), "Image");
  });
  auto width = [](JsonRef frame, const char *ref) {
    return by_ref(frame, ref).get("rect").get("width").as_number();
  };
  CHECK_EQ(width(image_gone.root(), "contained"), width(image_full.root(), "contained"));
  CHECK(width(image_full.root(), "intrinsic") > 0.0);
  CHECK_EQ(width(image_gone.root(), "intrinsic"), 0.0);
}

TEST(forward_compat, a_collapse_a_build_does_not_know_shows_every_section) {
  // `open` is the prop it cannot honour, and the safe way to not honour it is to
  // show — a section that vanished would lose content the author wrote.
  const Frame full = case_frame("collapse-tabs");
  const Frame degraded = case_frame("collapse-tabs", [](std::string j) {
    return unknown_type(std::move(j), "Collapse");
  });
  CHECK(count_key(degraded.root(), "out") < count_key(full.root(), "out"));
  CHECK_EQ(join(lost(full.root(), degraded.root())), std::string("(none)"));
}

TEST(forward_compat, an_unknown_group_behaviour_lays_the_children_out_as_siblings) {
  // A `group` is a cross-child behaviour, so a reader without it simply has no
  // behaviour to run: every panel of an `exclusive-select` is in the layout at
  // once. That is the property that let composites be flattened in the first
  // place (2026-08-03) — the content degrades, the screen does not break.
  const Frame full = case_frame("collapse-tabs");
  const Frame degraded = case_frame("collapse-tabs", [](std::string j) {
    return unknown_value(std::move(j), "group", "exclusive-select");
  });
  CHECK(count_key(degraded.root(), "out") < count_key(full.root(), "out"));
  CHECK_EQ(join(lost(full.root(), degraded.root())), std::string("(none)"));
}

TEST(forward_compat, an_unknown_closed_set_value_takes_that_property_s_default) {
  // Shapes, never vocabularies: the validator checks that a member of a closed
  // set is a string and stops there, so an unfamiliar one reads as the default
  // when the runtime asks for it. Here that is visible — an axis that is no
  // longer horizontal scrolls the other way.
  const Frame full = case_frame("scroll-clip");
  const Frame degraded = case_frame("scroll-clip", [](std::string j) {
    return unknown_value(std::move(j), "axis", "horizontal");
  });
  CHECK(full.json != degraded.json);
  CHECK_EQ(join(lost(full.root(), degraded.root())), std::string("(none)"));

  // And an anchor placement it does not know still places the bubble: the
  // default `at` is a position on screen, not the absence of one.
  const Frame anchored = case_frame("anchors", [](std::string j) {
    return unknown_value(std::move(j), "at", "top-left");
  });
  CHECK_EQ(anchored.root().get("layer").size(), case_frame("anchors").root().get("layer").size());
}

TEST(forward_compat, an_anchor_a_build_does_not_know_falls_back_to_layer_placement) {
  // The promise ZAB-46 made when it added the field: a reader that ignores
  // `anchor` still has the `justify`/`align` the author emitted alongside it, so
  // the bubble lands somewhere on the layer instead of nowhere.
  //
  // It also loses the TRIGGER, which lives inside the same object — so a tooltip
  // that was absent until hovered becomes an ordinary overlay that is simply
  // there. One more entry in the layer, not one fewer.
  const Frame full = case_frame("anchors");
  const Frame degraded = case_frame("anchors", [](std::string j) {
    return unknown_prop(std::move(j), "anchor");
  });
  CHECK_EQ(degraded.root().get("layer").size(), full.root().get("layer").size() + 1);
  CHECK_EQ(join(lost(full.root(), degraded.root())), std::string("(none)"));
}

TEST(forward_compat, a_whole_screen_survives_nine_unknown_types_at_once) {
  // The headline claim, and the one a reader of the matrix most wants: this is
  // not thirteen separate degradations that each work in isolation. `settings`
  // is the whole F5 catalog composed as one screen; withdraw everything the
  // chassis of G2 did not have and it still loads, still lays out, and still
  // shows every id its author wrote.
  const Frame full = case_frame("settings");
  const Frame degraded = case_frame("settings", [](std::string j) {
    for (const char *type : {"Overlay", "Repeat", "Toggle", "Slider", "TextInput", "ScrollView",
                             "Collapse", "ProgressBar", "Spinner"}) {
      j = unknown_type(std::move(j), type);
    }
    return j;
  });
  CHECK(degraded.loaded);
  CHECK(!degraded.fatal);
  CHECK_EQ(join(lost(full.root(), degraded.root())), std::string("(none)"));
  CHECK(tree_nodes(degraded.root()) > 0u);
}

TEST(forward_compat, what_a_snapshot_cannot_witness_is_named_rather_than_asserted_around) {
  // The honest boundary of this file, kept as a case so nobody later mistakes
  // the silence for coverage and writes a fake assertion to fill it.
  //
  // A `ViewSnapshot` records ONE FRAME: rects, styles, states, the values a
  // control resolved to. Four capabilities leave no trace in one, and for each
  // the loss is real and lives somewhere a frame cannot reach:
  //
  //   transition   the frame is the same; what is gone is the way it got there.
  //   autoCloseMs  the toast is up either way; what is gone is it going away.
  //   onChange     an action is a call to the game, and calls are not metrics.
  //   fit          `contain` and `cover` differ in UVs, and UVs are not rects.
  //
  // That is not a hole in the format's promise — it is the reason the corpus has
  // golden IMAGES as a separate, manual step, and the reason `test_view.cpp`
  // owns the sequences that a single frame cannot express.
  const std::vector<Cut> invisible = {
      {"transition", "transitions",
       [](std::string j) { return unknown_prop(std::move(j), "transition"); }},
      {"autoCloseMs", "overlays",
       [](std::string j) { return unknown_prop(std::move(j), "autoCloseMs"); }},
      {"onChange", "controls",
       [](std::string j) { return unknown_prop(std::move(j), "onChange"); }},
      {"fit", "assets-image",
       [](std::string j) { return unknown_value(std::move(j), "fit", "cover"); }},
  };
  for (const Cut &cut : invisible) {
    // Both halves matter: the payload really lost the capability, AND the frame
    // did not move. Without the first, a rewrite that matched nothing would
    // "prove" invisibility for free.
    const std::string before = case_text(cut.case_name);
    CHECK(cut.rewrite(before) != before);
    const Frame full = case_frame(cut.case_name);
    const Frame degraded = case_frame(cut.case_name, cut.rewrite);
    CHECK_EQ(std::string(cut.label) + " changes the frame: " +
                 (full.json == degraded.json ? "no" : "yes"),
             std::string(cut.label) + " changes the frame: no");
  }
}
