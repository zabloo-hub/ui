#include "snapshot.h"

#include "hit.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "color.h"
#include "layout.h"
#include "text.h"

namespace zabloo {
namespace {

/** Path of the view's root. Not a valid id, so it can never collide with one. */
constexpr const char *ROOT_PATH = "$root";

/** 10^SNAPSHOT_PRECISION — what a number is quantized against. */
constexpr double SCALE = 1000.0;

/**
 * A number as the reference writes it.
 *
 * `JSON.stringify` prints the shortest decimal that round-trips, and every number
 * here has already been rounded to three decimals — so the shortest decimal IS
 * the quantized one, and printing it is arithmetic on an integer rather than a
 * float format. That matters twice over: `std::to_chars` for `double` is not
 * available on every libc++ this builds against (the SConstruct says why for its
 * reading half), and `printf` reads the decimal separator from the LOCALE, so a
 * game running under a Spanish locale would write `0,5` and every metric
 * downstream would silently stop comparing.
 */
std::string number(double value) { return snapshot_number(value); }

}  // namespace

std::string snapshot_number(double value) {
  // What `JSON.stringify` does with one: there is no NaN in JSON.
  if (!std::isfinite(value)) return "null";
  // Far outside anything a layout produces, and past where value * 1000 still
  // fits an int64. No fraction survives at this magnitude anyway.
  if (std::fabs(value) >= 9.0e15) {
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%.0f", value);
    return buffer;
  }

  const long long units = std::llround(value * SCALE);
  // -0 normalizes to 0, as `JSON.stringify` writes it.
  if (units == 0) return "0";

  const bool negative = units < 0;
  const unsigned long long magnitude =
      negative ? 0ULL - static_cast<unsigned long long>(units) : static_cast<unsigned long long>(units);
  std::string out = std::to_string(magnitude / 1000ULL);
  unsigned long long fraction = magnitude % 1000ULL;
  if (fraction != 0) {
    char digits[4] = {static_cast<char>('0' + fraction / 100), static_cast<char>('0' + (fraction / 10) % 10),
                      static_cast<char>('0' + fraction % 10), '\0'};
    std::string_view kept(digits);
    while (kept.size() > 1 && kept.back() == '0') kept.remove_suffix(1);
    out += ".";
    out += kept;
  }
  return negative ? "-" + out : out;
}

namespace {

/** The quantized value, as the comparison of two numbers sees them. */
long long quantized(double value) {
  if (!std::isfinite(value) || std::fabs(value) >= 9.0e15) return 0;
  return std::llround(value * SCALE);
}

bool same(double a, double b) { return quantized(a) == quantized(b); }

/** `#rrggbb`, or `#rrggbbaa` when the color is not fully opaque. */
std::string hex(const Color &color) {
  static const char *DIGITS = "0123456789abcdef";
  const auto channel = [](float value) {
    const int scaled = static_cast<int>(std::lround(value * 255.0f));
    return std::max(0, std::min(255, scaled));
  };
  const auto append = [&](std::string &out, int byte) {
    out += DIGITS[(byte >> 4) & 0xf];
    out += DIGITS[byte & 0xf];
  };

  std::string out = "#";
  append(out, channel(color.r));
  append(out, channel(color.g));
  append(out, channel(color.b));
  if (color.a < 1.0f) append(out, channel(color.a));
  return out;
}

/**
 * Writes JSON in `JSON.stringify(value, null, 2)` shape: two-space indent, one
 * member per line, and an empty object or array collapsed to `{}` / `[]`.
 *
 * It tracks the comma itself rather than asking the caller to, because the whole
 * point of "absent means default" is that a member is written or not written at
 * the point the decision is made.
 */
class Writer {
 public:
  void begin_object() { open('{'); }
  void end_object() { close('}'); }
  void begin_array() { open('['); }
  void end_array() { close(']'); }

  /** `"name": ` — the value follows. */
  void key(std::string_view name) {
    separator();
    out_ += '"';
    out_ += name;
    out_ += "\": ";
  }

  /** The next element of an array. */
  void element() { separator(); }

  void string(std::string_view value) {
    out_ += '"';
    for (const char c : value) {
      switch (c) {
        case '"': out_ += "\\\""; break;
        case '\\': out_ += "\\\\"; break;
        case '\b': out_ += "\\b"; break;
        case '\f': out_ += "\\f"; break;
        case '\n': out_ += "\\n"; break;
        case '\r': out_ += "\\r"; break;
        case '\t': out_ += "\\t"; break;
        default:
          if (static_cast<unsigned char>(c) < 0x20) {
            char escape[7];
            std::snprintf(escape, sizeof(escape), "\\u%04x", static_cast<unsigned char>(c));
            out_ += escape;
          } else {
            // Everything else passes through as its own bytes — a `JSON.stringify`
            // leaves UTF-8 alone, so `Poción` is `Poción` on both sides.
            out_ += c;
          }
      }
    }
    out_ += '"';
  }

  void number_value(double value) { out_ += number(value); }
  void bool_value(bool value) { out_ += value ? "true" : "false"; }
  void null_value() { out_ += "null"; }

  std::string take() { return std::move(out_); }

 private:
  // The separator before a container was already written by the `key` or
  // `element` that introduced it.
  void open(char brace) {
    out_ += brace;
    empty_.push_back(true);
  }

  void close(char brace) {
    const bool empty = empty_.back();
    empty_.pop_back();
    if (!empty) {
      out_ += '\n';
      indent(static_cast<int>(empty_.size()));
    }
    out_ += brace;
  }

  /** Newline + indent before a member, with the comma that precedes it. */
  void separator() {
    if (empty_.back()) {
      empty_.back() = false;
    } else {
      out_ += ',';
    }
    out_ += '\n';
    indent(static_cast<int>(empty_.size()));
  }

  void indent(int depth) { out_.append(static_cast<size_t>(depth) * 2, ' '); }

  std::string out_;
  std::vector<bool> empty_;
};

using Refs = std::unordered_map<const LayoutNode *, std::string>;

void collect_paths(const LayoutNode &node, const std::string &path, Refs &paths,
                   std::unordered_map<std::string, int> &counts) {
  paths[&node] = path;
  if (!node.ir->id.empty()) counts[node.ir->id]++;
  for (size_t i = 0; i < node.children.size(); i++) {
    const std::string child = path == ROOT_PATH ? std::to_string(i) : path + "." + std::to_string(i);
    collect_paths(node.children[i], child, paths, counts);
  }
}

/**
 * A stable address for every node: its `id` when it has one, its positional path
 * (`"0.2.1"`) when it does not — so a snapshot can point at a node the author
 * never named, and two runs agree on the name.
 *
 * An id shared by several nodes addresses NONE of them: every instance a
 * `Repeat` builds carries the id its template declared, so an id is unique in the
 * document but not in the tree the view expands from it. They all fall back to
 * their path, which keeps one ref pointing at one node — a rule that has to hold
 * on both sides of the cross-target comparison.
 */
Refs ref_map(const LayoutNode &root) {
  Refs paths;
  std::unordered_map<std::string, int> counts;
  collect_paths(root, ROOT_PATH, paths, counts);

  Refs refs;
  refs.reserve(paths.size());
  for (const auto &entry : paths) {
    const std::string &id = entry.first->ir->id;
    const bool unique = !id.empty() && counts[id] == 1;
    refs[entry.first] = unique ? id : entry.second;
  }
  return refs;
}

std::string ref_of(const Refs &refs, const LayoutNode *node) {
  const auto found = refs.find(node);
  return found == refs.end() ? std::string("?") : found->second;
}

/**
 * The states a node can carry, in the merge order the format declares normative
 * (`base → empty → selected → checked → open → hover → focused → pressed →
 * disabled`). Listing them in that order means a diff of two snapshots compares
 * the same positions.
 *
 * `empty` is the one still missing: it belongs to a TextInput holding no text,
 * and the runtime that holds a field's text arrives with G11 (ZAB-144).
 * Reporting a `false` nobody computed would be a different lie from the honest
 * silence of a field that does not exist.
 */
struct StateEntry {
  const char *name;
  bool (*of)(const LayoutNode &node);
};

const StateEntry STATES[] = {
    {"selected", [](const LayoutNode &node) { return node.selected; }},
    {"checked", [](const LayoutNode &node) { return node.checked; }},
    // `open` is a Collapse's, and only a Collapse's: every other node is born
    // open and nothing ever closes it.
    {"open",
     [](const LayoutNode &node) { return node.ir->type == NodeType::Collapse && node.open; }},
    {"hover", [](const LayoutNode &node) { return node.hovered; }},
    {"focused", [](const LayoutNode &node) { return node.focused; }},
    {"pressed", [](const LayoutNode &node) { return node.pressed; }},
    // The EFFECTIVE flag, inherited included: what a second target has to
    // reproduce is which nodes are out of the interaction model, not which ones
    // declared it (ZAB-63).
    {"disabled", [](const LayoutNode &node) { return node.disabled; }},
};

/** Resolved values worth recording, in a fixed order. Colors serialize as hex. */
struct StyleEntry {
  const char *name;
  bool is_color;
  Color color;
  double value;
};

/**
 * A zero border, a zero radius and a full opacity are the defaults every node
 * resolves to — recording them would bury the ones that mean something.
 */
std::vector<StyleEntry> style_of(const LayoutNode &node) {
  const ResolvedValues &resolved = node.resolved;
  std::vector<StyleEntry> style;
  const auto color = [&](const char *name, const std::optional<Color> &value) {
    if (value.has_value()) style.push_back({name, true, *value, 0.0});
  };
  const auto scalar = [&](const char *name, double value, double omitted) {
    if (value != omitted) style.push_back({name, false, Color{}, value});
  };

  color("background", resolved.background);
  color("color", resolved.color);
  color("borderColor", resolved.border_color);
  scalar("borderWidth", resolved.border_width, 0.0);
  scalar("radius", resolved.radius, 0.0);
  scalar("opacity", resolved.opacity, 1.0);
  scalar("padding", resolved.padding, 0.0);
  scalar("gap", resolved.gap, 0.0);
  return style;
}

void write_rect(Writer &writer, const Rect &rect) {
  writer.begin_object();
  writer.key("x");
  writer.number_value(rect.x);
  writer.key("y");
  writer.number_value(rect.y);
  writer.key("width");
  writer.number_value(rect.width);
  writer.key("height");
  writer.number_value(rect.height);
  writer.end_object();
}

/**
 * A node and its subtree, under `inherited` — the region its own rect is cut to.
 *
 * An out-of-layout node stops the walk: its rect, its style and its children are
 * whatever the last frame that DID lay it out left behind, and recording stale
 * numbers would be a lie about a node that is not on screen.
 */
void write_node(Writer &writer, const LayoutNode &node, const Refs &refs, const Clip *inherited,
                ClipArena &arena) {
  writer.begin_object();
  writer.key("type");
  writer.string(node.ir->type_name);
  writer.key("ref");
  writer.string(ref_of(refs, &node));

  if (!in_layout(node)) {
    // Both hiding mechanisms have `display:none` semantics; which one it was is
    // the only thing left worth saying about the node.
    writer.key("out");
    writer.string(node.visible_flag ? "section" : "visible");
    writer.end_object();
    return;
  }

  writer.key("rect");
  write_rect(writer, node.rect);

  // The size the measure pass asked for, when the arrange pass gave it another
  // one — a stretched or grown child. Silent when they agree.
  if (!same(node.measured.x, node.rect.width) || !same(node.measured.y, node.rect.height)) {
    writer.key("measured");
    writer.begin_object();
    writer.key("x");
    writer.number_value(node.measured.x);
    writer.key("y");
    writer.number_value(node.measured.y);
    writer.end_object();
  }

  bool any_state = false;
  for (const StateEntry &state : STATES) {
    if (!state.of(node)) continue;
    if (!any_state) {
      writer.key("states");
      writer.begin_array();
      any_state = true;
    }
    writer.element();
    writer.string(state.name);
  }
  if (any_state) writer.end_array();

  const std::vector<StyleEntry> style = style_of(node);
  if (!style.empty()) {
    writer.key("style");
    writer.begin_object();
    for (const StyleEntry &entry : style) {
      writer.key(entry.name);
      if (entry.is_color) {
        writer.string(hex(entry.color));
      } else {
        writer.number_value(entry.value);
      }
    }
    writer.end_object();
  }

  // How this frame broke the text and where the lines landed. Only a `Text` has
  // any, and only once the measure pass has broken it — so an empty `Text` still
  // reports its one empty line, which is what says it holds a slot (ZAB-65).
  if (node.ir->type == NodeType::Text && node.has_text_block) {
    writer.key("text");
    writer.begin_object();
    writer.key("lines");
    writer.begin_array();
    for (size_t i = 0; i < node.text_block.lines.size(); i++) {
      const TextLine &line = node.text_block.lines[i];
      const PlacedLine placed = i < node.text_lines.size() ? node.text_lines[i] : PlacedLine{};
      writer.element();
      writer.begin_object();
      writer.key("text");
      writer.string(line.text);
      writer.key("width");
      writer.number_value(line.width);
      writer.key("x");
      writer.number_value(placed.x);
      // The tessellator adds the ascent to the placed top: that sum IS the baseline.
      writer.key("baseline");
      writer.number_value(placed.y + node.text_ascent);
      writer.end_object();
    }
    writer.end_array();
    writer.key("lineHeight");
    writer.number_value(node.text_block.line_height);
    writer.key("truncated");
    writer.bool_value(node.text_block.truncated);
    writer.end_object();
  }

  // An `Overlay` is a paint root laid out against the view rect, so the regions of
  // wherever it was DECLARED never apply to it — the same boundary `effective_clip`
  // and the paint pass draw. The region restarts here.
  const Clip *cut = node.ir->type == NodeType::Overlay ? nullptr : inherited;
  if (cut != nullptr) {
    writer.key("clip");
    writer.begin_object();
    writer.key("x");
    writer.number_value(cut->x);
    writer.key("y");
    writer.number_value(cut->y);
    writer.key("width");
    writer.number_value(cut->width);
    writer.key("height");
    writer.number_value(cut->height);
    writer.key("radius");
    writer.number_value(cut->radius);
    writer.end_object();
  }

  if (node.ir->type == NodeType::ScrollView) {
    writer.key("scroll");
    writer.begin_object();
    writer.key("x");
    writer.number_value(node.scroll_offset.x);
    writer.key("y");
    writer.number_value(node.scroll_offset.y);
    writer.key("maxX");
    writer.number_value(node.scroll_max.x);
    writer.key("maxY");
    writer.number_value(node.scroll_max.y);
    writer.end_object();
  }

  // The one number a control's behavior owns. A Toggle's is its cross-fade
  // progress, a ProgressBar's is its tweened fraction, and a Slider's is the
  // value it PAINTS — which trails the logical one while a change the game made
  // glides in, and is what the rects beside it were laid out from.
  if (node.ir->type == NodeType::Toggle) {
    writer.key("value");
    writer.number_value(node.checked_progress);
  } else if (node.ir->type == NodeType::ProgressBar) {
    writer.key("value");
    writer.number_value(node.progress);
  } else if (node.ir->type == NodeType::Slider) {
    writer.key("value");
    writer.number_value(node.slider_display);
  }

  // `field` (G11, ZAB-144) and `window` (G12, ZAB-145) belong here, in that
  // order. Each is written by the ticket that gives the runtime something to
  // say; until then the field is absent, which is what "this node has none"
  // already means everywhere else in this document.

  if (!node.children.empty()) {
    // The region a child inherits, computed exactly as paint and hit-testing do.
    const Clip *inner = child_clip(node, cut, arena);
    writer.key("children");
    writer.begin_array();
    for (const LayoutNode &child : node.children) {
      writer.element();
      write_node(writer, child, refs, inner, arena);
    }
    writer.end_array();
  }
  writer.end_object();
}

void write_ref_or_null(Writer &writer, const Refs &refs, const LayoutNode *node) {
  if (node == nullptr) {
    writer.null_value();
  } else {
    writer.string(ref_of(refs, node));
  }
}

}  // namespace

std::string snapshot_view(const View &view) {
  Writer writer;
  writer.begin_object();
  writer.key("view");
  writer.string(view.id());
  writer.key("size");
  writer.begin_object();
  writer.key("width");
  writer.number_value(view.viewport().width);
  writer.key("height");
  writer.number_value(view.viewport().height);
  writer.end_object();

  const LayoutNode &root = view.root();
  // A view whose id named nothing in the envelope has no tree at all. It cannot
  // arrive through `Document::show`, which refuses an unknown id — but reporting
  // it is still better than dereferencing it.
  const Refs refs = root.ir != nullptr ? ref_map(root) : Refs();

  writer.key("focus");
  write_ref_or_null(writer, refs, view.focus());
  writer.key("hover");
  write_ref_or_null(writer, refs, view.hover());
  writer.key("pressed");
  write_ref_or_null(writer, refs, view.pressed());

  // Overlays in `(z, document order)`, bottom-most first — the layer as this
  // frame PAINTED it, so an entry still fading out is in it, with the `presence`
  // it is fading by.
  writer.key("layer");
  writer.begin_array();
  for (const LayoutNode *overlay : view.paint_layer()) {
    writer.element();
    writer.begin_object();
    writer.key("ref");
    writer.string(ref_of(refs, overlay));
    writer.key("z");
    writer.number_value(overlay->ir->z);
    writer.key("modal");
    writer.bool_value(overlay->ir->modal);
    writer.key("presence");
    writer.number_value(overlay->presence);
    writer.key("rect");
    write_rect(writer, overlay->rect);
    writer.end_object();
  }
  writer.end_array();

  writer.key("tree");
  // The snapshot resolves its own regions rather than reading the paint pass's:
  // it describes the frame that was LAID OUT, and asking for one must not be able
  // to disturb what the adapter is about to draw. Both walks run the same rule,
  // so the numbers are the same numbers.
  ClipArena arena;
  if (root.ir != nullptr) {
    write_node(writer, root, refs, nullptr, arena);
  } else {
    writer.null_value();
  }
  writer.end_object();

  std::string out = writer.take();
  out += '\n';
  return out;
}

}  // namespace zabloo
