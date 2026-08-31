#include "validate.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace zabloo {
namespace {

// --- formatting -----------------------------------------------------------

/** A key as a JSON string literal, so a dotted view id cannot fake a path. */
std::string quote(std::string_view key) {
  std::string out = "\"";
  for (const char c : key) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buffer[8];
          std::snprintf(buffer, sizeof(buffer), "\\u%04x", c);
          out += buffer;
        } else {
          out += c;
        }
    }
  }
  return out + "\"";
}

std::string number_text(double value) {
  if (value == std::floor(value) && std::fabs(value) < 1e15) {
    return std::to_string(static_cast<long long>(value));
  }
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%g", value);
  return buffer;
}

/** What a bad value IS, for a message that says more than "invalid". */
std::string describe(JsonRef value) {
  if (!value.exists()) return "nothing";
  switch (value.type()) {
    case JsonType::Null: return "null";
    case JsonType::Bool: return value.as_bool() ? "true" : "false";
    case JsonType::Number: return number_text(value.as_number());
    case JsonType::String: return quote(value.as_string());
    case JsonType::Array: return "an array";
    case JsonType::Object: return "an object";
  }
  return "nothing";
}

std::string view_path(std::string_view id) { return "views[" + quote(id) + "]"; }

std::string child_path(const std::string &path, uint32_t index) {
  return path + ".children[" + std::to_string(index) + "]";
}

std::string field(const std::string &path, std::string_view key) {
  return path + "." + std::string(key);
}

// --- predicates -----------------------------------------------------------

bool is_string(JsonRef value) { return value.is_string(); }
bool is_non_empty_string(JsonRef value) { return value.is_string() && !value.as_string().empty(); }
bool is_boolean(JsonRef value) { return value.is_bool(); }

/** JSON has no infinities, so "is a number" is already "is finite". */
bool is_finite_number(JsonRef value) {
  return value.is_number() && std::isfinite(value.as_number());
}

bool is_string_or_number(JsonRef value) {
  return is_non_empty_string(value) || is_finite_number(value);
}

bool is_token_ref(JsonRef value) {
  if (!value.is_string()) return false;
  const std::string_view text = value.as_string();
  return text.size() > 2 && text.front() == '{' && text.back() == '}';
}

bool is_dim(JsonRef value) { return is_finite_number(value) || is_token_ref(value); }

bool is_bind(JsonRef value) { return value.is_object() && value.get("bind").is_string(); }

bool is_bindable(JsonRef value, bool (*ok)(JsonRef)) { return ok(value) || is_bind(value); }

bool is_base64(JsonRef value) {
  if (!value.is_string()) return false;
  const std::string_view text = value.as_string();
  if (text.size() % 4 != 0) return false;
  size_t padding = 0;
  for (size_t i = 0; i < text.size(); i++) {
    const char c = text[i];
    if (c == '=') {
      // At most two, and only at the tail — which the guard below already
      // enforces, since anything that is not a `=` after one has been seen ends
      // the string. The reference spells the same rule as `={0,2}$`.
      if (++padding > 2) return false;
      continue;
    }
    if (padding > 0) return false;
    const bool alnum = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (!alnum && c != '+' && c != '/') return false;
  }
  return true;
}

// --- the walk's state -----------------------------------------------------

struct Ctx {
  std::vector<Diagnostic> *diagnostics = nullptr;
  const Envelope *envelope = nullptr;
  /** Per view: the ids seen so far, and the anchors waiting to resolve. */
  std::vector<std::string> ids;
  std::vector<std::pair<std::string, std::string>> anchors;
};

void push(std::vector<Diagnostic> &diagnostics, DiagnosticLevel level, DiagnosticCode code,
          const std::string &path, const std::string &detail) {
  Diagnostic diagnostic;
  diagnostic.level = level;
  diagnostic.code = code;
  diagnostic.path = path;
  diagnostic.message =
      path.empty() ? "IR envelope: " + detail : "IR envelope: " + path + " — " + detail;
  diagnostics.push_back(std::move(diagnostic));
}

void warn(Ctx &ctx, DiagnosticCode code, const std::string &path, const std::string &detail) {
  push(*ctx.diagnostics, DiagnosticLevel::Warn, code, path, detail);
}

EnvelopeReport fail(std::vector<Diagnostic> diagnostics, DiagnosticCode code,
                    const std::string &path, const std::string &detail) {
  EnvelopeReport report;
  report.diagnostics = std::move(diagnostics);
  push(report.diagnostics, DiagnosticLevel::Fatal, code, path, detail);
  report.ok = false;
  return report;
}

/**
 * A `{token}` the dictionary does not define. A warning and not a repair: the
 * consumer resolves it to "no value" and the node falls back to its default,
 * which is a visible degradation the author can see and fix.
 */
void note_token_ref(Ctx &ctx, JsonRef value, const std::string &path) {
  if (!is_token_ref(value)) return;
  const std::string_view text = value.as_string();
  const std::string_view name = text.substr(1, text.size() - 2);
  if (ctx.envelope->token(name) != nullptr) return;
  warn(ctx, DiagnosticCode::UnknownToken, path,
       "token " + std::string(text) +
           " is not in the envelope's dictionary — the value is ignored");
}

/**
 * A binding whose PATH is malformed (empty segments, a leading or trailing dot).
 * The data itself is never checked: a path that reads nothing is the game's
 * state, not an envelope error, and bound UI degrades to "no value" by design.
 */
void note_binding(Ctx &ctx, JsonRef value, const std::string &path) {
  if (!is_bind(value)) return;
  const std::string_view bind = value.get("bind").as_string();
  bool empty_segment = bind.empty();
  size_t start = 0;
  while (!empty_segment && start <= bind.size()) {
    const size_t dot = bind.find('.', start);
    const size_t end = dot == std::string_view::npos ? bind.size() : dot;
    if (end == start) empty_segment = true;
    if (dot == std::string_view::npos) break;
    start = dot + 1;
  }
  if (!empty_segment) return;
  warn(ctx, DiagnosticCode::InvalidBinding, field(path, "bind"),
       "\"" + std::string(bind) + "\" is not a usable data path — it will always read as no value");
}

void drop_prop(Ctx &ctx, JsonRef value, const std::string &path, std::string_view key,
               std::string_view expected) {
  warn(ctx, DiagnosticCode::InvalidProp, field(path, key),
       "expected " + std::string(expected) + ", got " + describe(value.get(key)) +
           " — property dropped");
}

// --- property readers -----------------------------------------------------
//
// Each one answers "did the author give me a usable value?", warns when the
// answer is no, and leaves the struct's default in place. Dropping a prop in a
// typed model IS leaving it unset — the repair the reference implementation
// performs with `Reflect.deleteProperty`.

bool typed_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
                bool (*ok)(JsonRef), std::string_view expected, JsonRef &out) {
  const JsonRef value = node.get(key);
  if (!value.exists()) return false;
  if (!ok(value)) {
    drop_prop(ctx, node, path, key, expected);
    return false;
  }
  out = value;
  return true;
}

void string_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
                 std::string &out) {
  JsonRef value;
  if (typed_prop(ctx, node, path, key, is_non_empty_string, "a non-empty string", value)) {
    out = std::string(value.as_string());
  }
}

void bool_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key, bool &out) {
  JsonRef value;
  if (typed_prop(ctx, node, path, key, is_boolean, "a boolean", value)) out = value.as_bool();
}

void bool_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
               std::optional<bool> &out) {
  JsonRef value;
  if (typed_prop(ctx, node, path, key, is_boolean, "a boolean", value)) out = value.as_bool();
}

void number_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
                 std::optional<double> &out) {
  JsonRef value;
  if (typed_prop(ctx, node, path, key, is_finite_number, "a finite number", value)) {
    out = value.as_number();
  }
}

void number_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
                 double &out) {
  std::optional<double> parsed;
  number_prop(ctx, node, path, key, parsed);
  if (parsed.has_value()) out = *parsed;
}

void dim_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key, Dim &out) {
  JsonRef value;
  if (typed_prop(ctx, node, path, key, is_dim, "a number or a `{token}` reference", value)) {
    if (value.is_number()) {
      out = Dim::of(value.as_number());
    } else {
      const std::string_view text = value.as_string();
      out.kind = Dim::Kind::Token;
      out.token = std::string(text.substr(1, text.size() - 2));
    }
  }
  note_token_ref(ctx, node.get(key), field(path, key));
}

void color_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
                ColorValue &out) {
  JsonRef value;
  if (typed_prop(ctx, node, path, key, is_non_empty_string,
                 "a color string or a `{token}` reference", value)) {
    const std::string_view text = value.as_string();
    if (is_token_ref(value)) {
      out.kind = ColorValue::Kind::Token;
      out.text = std::string(text.substr(1, text.size() - 2));
    } else {
      out.kind = ColorValue::Kind::Literal;
      out.text = std::string(text);
    }
  }
  note_token_ref(ctx, node.get(key), field(path, key));
}

Scalar scalar_of(JsonRef value) {
  Scalar scalar;
  if (value.is_number()) {
    scalar.kind = Scalar::Kind::Number;
    scalar.number = value.as_number();
  } else if (value.is_string()) {
    scalar.kind = Scalar::Kind::Text;
    scalar.text = std::string(value.as_string());
  }
  return scalar;
}

/** A prop that is either a static value or a `{ bind }` — the read/write props. */
template <typename T, typename Convert>
void bindable_prop(Ctx &ctx, JsonRef node, const std::string &path, std::string_view key,
                   bool (*ok)(JsonRef), std::string_view expected, Bindable<T> &out,
                   Convert convert) {
  const JsonRef value = node.get(key);
  if (!value.exists()) return;
  if (!is_bindable(value, ok)) {
    drop_prop(ctx, node, path, key, std::string(expected) + " or a { bind } path");
    return;
  }
  if (is_bind(value)) {
    out.kind = Bindable<T>::Kind::Bind;
    out.bind = std::string(value.get("bind").as_string());
  } else {
    out.kind = Bindable<T>::Kind::Value;
    out.value = convert(value);
  }
  note_binding(ctx, value, field(path, key));
}

// --- enum mapping ---------------------------------------------------------
//
// Read AFTER the string check, so an unknown member is a well-formed string that
// simply takes the default. That is the whole forward-tolerance rule for closed
// sets, and the reason none of these emit a diagnostic.

template <typename T, size_t N>
T enum_from(const std::string &text, const std::pair<const char *, T> (&table)[N], T fallback) {
  for (const auto &entry : table) {
    if (text == entry.first) return entry.second;
  }
  return fallback;
}

constexpr std::pair<const char *, Direction> DIRECTIONS[] = {
    {"row", Direction::Row}, {"column", Direction::Column}};
constexpr std::pair<const char *, Justify> JUSTIFIES[] = {{"start", Justify::Start},
                                                          {"center", Justify::Center},
                                                          {"end", Justify::End},
                                                          {"space-between", Justify::SpaceBetween}};
constexpr std::pair<const char *, Align> ALIGNS[] = {{"start", Align::Start},
                                                     {"center", Align::Center},
                                                     {"end", Align::End},
                                                     {"stretch", Align::Stretch}};
constexpr std::pair<const char *, TextAlign> TEXT_ALIGNS[] = {
    {"start", TextAlign::Start}, {"center", TextAlign::Center}, {"end", TextAlign::End}};
constexpr std::pair<const char *, TextOverflow> OVERFLOWS[] = {{"clip", TextOverflow::Clip},
                                                               {"ellipsis", TextOverflow::Ellipsis}};
constexpr std::pair<const char *, Easing> EASINGS[] = {{"linear", Easing::Linear},
                                                       {"ease-in", Easing::EaseIn},
                                                       {"ease-out", Easing::EaseOut},
                                                       {"ease-in-out", Easing::EaseInOut}};
constexpr std::pair<const char *, GroupBehavior> GROUPS[] = {
    {"exclusive-open", GroupBehavior::ExclusiveOpen},
    {"exclusive-select", GroupBehavior::ExclusiveSelect},
    {"exclusive-check", GroupBehavior::ExclusiveCheck}};
constexpr std::pair<const char *, ScrollAxis> SCROLL_AXES[] = {
    {"vertical", ScrollAxis::Vertical}, {"horizontal", ScrollAxis::Horizontal},
    {"both", ScrollAxis::Both}};
constexpr std::pair<const char *, SliderAxis> SLIDER_AXES[] = {
    {"horizontal", SliderAxis::Horizontal}, {"vertical", SliderAxis::Vertical}};
constexpr std::pair<const char *, ImageFit> FITS[] = {
    {"contain", ImageFit::Contain}, {"cover", ImageFit::Cover}, {"stretch", ImageFit::Stretch}};
constexpr std::pair<const char *, OverlayTrigger> TRIGGERS[] = {
    {"hover", OverlayTrigger::Hover}, {"manual", OverlayTrigger::Manual},
    {"press", OverlayTrigger::Press}};
constexpr std::pair<const char *, AnchorAt> ANCHOR_ATS[] = {
    {"center", AnchorAt::Center},         {"top", AnchorAt::Top},
    {"bottom", AnchorAt::Bottom},         {"left", AnchorAt::Left},
    {"right", AnchorAt::Right},           {"top-left", AnchorAt::TopLeft},
    {"top-right", AnchorAt::TopRight},    {"bottom-left", AnchorAt::BottomLeft},
    {"bottom-right", AnchorAt::BottomRight}};
constexpr std::pair<const char *, StateName> STATE_NAMES[] = {
    {"empty", StateName::Empty},     {"selected", StateName::Selected},
    {"checked", StateName::Checked}, {"hover", StateName::Hover},
    {"focused", StateName::Focused}, {"pressed", StateName::Pressed},
    {"disabled", StateName::Disabled}};

// --- sections -------------------------------------------------------------

void read_style(Ctx &ctx, JsonRef value, const std::string &at, Style &out) {
  color_prop(ctx, value, at, "background", out.background);
  color_prop(ctx, value, at, "borderColor", out.border_color);
  color_prop(ctx, value, at, "color", out.color);
  dim_prop(ctx, value, at, "radius", out.radius);
  dim_prop(ctx, value, at, "borderWidth", out.border_width);
  dim_prop(ctx, value, at, "fontSize", out.font_size);
  dim_prop(ctx, value, at, "lineHeight", out.line_height);
  number_prop(ctx, value, at, "opacity", out.opacity);
  number_prop(ctx, value, at, "maxLines", out.max_lines);

  std::string text;
  text.clear();
  string_prop(ctx, value, at, "textAlign", text);
  if (!text.empty()) out.text_align = enum_from(text, TEXT_ALIGNS, TextAlign::Start);
  text.clear();
  string_prop(ctx, value, at, "textAlignY", text);
  if (!text.empty()) out.text_align_y = enum_from(text, TEXT_ALIGNS, TextAlign::Start);
  text.clear();
  string_prop(ctx, value, at, "overflow", text);
  if (!text.empty()) out.overflow = enum_from(text, OVERFLOWS, TextOverflow::Clip);
  bool_prop(ctx, value, at, "wrap", out.wrap);
}

void read_style_prop(Ctx &ctx, JsonRef node, const std::string &path, Style &out) {
  const JsonRef style = node.get("style");
  if (!style.exists()) return;
  if (!style.is_object()) {
    drop_prop(ctx, node, path, "style", "an object");
    return;
  }
  read_style(ctx, style, field(path, "style"), out);
}

void read_layout(Ctx &ctx, JsonRef node, const std::string &path, Layout &out) {
  const JsonRef layout = node.get("layout");
  if (!layout.exists()) return;
  if (!layout.is_object()) {
    drop_prop(ctx, node, path, "layout", "an object");
    return;
  }
  const std::string at = field(path, "layout");
  std::string text;
  string_prop(ctx, layout, at, "direction", text);
  if (!text.empty()) out.direction = enum_from(text, DIRECTIONS, Direction::Column);
  text.clear();
  string_prop(ctx, layout, at, "justify", text);
  if (!text.empty()) out.justify = enum_from(text, JUSTIFIES, Justify::Start);
  text.clear();
  string_prop(ctx, layout, at, "align", text);
  if (!text.empty()) out.align = enum_from(text, ALIGNS, Align::Start);
  dim_prop(ctx, layout, at, "gap", out.gap);
  dim_prop(ctx, layout, at, "padding", out.padding);
  dim_prop(ctx, layout, at, "width", out.width);
  dim_prop(ctx, layout, at, "height", out.height);
  number_prop(ctx, layout, at, "grow", out.grow);
  bool_prop(ctx, layout, at, "wrap", out.wrap);
}

/** `states` is a map of state name → `{ style }`; a broken entry loses that state. */
void read_states(Ctx &ctx, JsonRef node, const std::string &path, Node &out) {
  const JsonRef states = node.get("states");
  if (!states.exists()) return;
  if (!states.is_object()) {
    drop_prop(ctx, node, path, "states", "an object");
    return;
  }
  for (uint32_t i = 0; i < states.size(); i++) {
    const std::string name(states.key_at(i));
    const JsonRef override_value = states.at(i);
    const std::string at = path + ".states[" + quote(name) + "]";
    if (!override_value.is_object()) {
      warn(ctx, DiagnosticCode::InvalidProp, at,
           "expected an object, got " + describe(override_value) + " — state dropped");
      continue;
    }
    // An unknown state name is one this build never activates — forward
    // tolerance, not a parse error — so it is kept out of the table in silence.
    const StateName state = enum_from(name, STATE_NAMES, StateName::Count);
    Style parsed;
    Style *target = state == StateName::Count ? &parsed : &out.state_style[static_cast<size_t>(state)];
    const JsonRef style = override_value.get("style");
    if (style.exists()) {
      if (style.is_object()) {
        read_style(ctx, style, at + ".style", *target);
        if (state != StateName::Count) out.has_state[static_cast<size_t>(state)] = true;
      } else {
        drop_prop(ctx, override_value, at, "style", "an object");
      }
    }
  }
}

/** A transition without a usable `duration` is no transition: the node snaps. */
void read_transition(Ctx &ctx, JsonRef node, const std::string &path, Transition &out) {
  const JsonRef transition = node.get("transition");
  if (!transition.exists()) return;
  if (!transition.is_object() || !is_dim(transition.get("duration"))) {
    drop_prop(ctx, node, path, "transition", "an object with a `duration`");
    return;
  }
  const std::string at = field(path, "transition");
  out.present = true;
  dim_prop(ctx, transition, at, "duration", out.duration);
  std::string easing;
  string_prop(ctx, transition, at, "easing", easing);
  if (!easing.empty()) out.easing = enum_from(easing, EASINGS, Easing::Linear);
}

/**
 * An `anchor` that is not a usable relation loses the whole field, never the
 * node: the overlay still carries its layer placement, which is exactly the
 * pre-ZAB-46 rendering it degrades to.
 */
void read_anchor(Ctx &ctx, JsonRef node, const std::string &path, OverlayAnchor &out) {
  const JsonRef anchor = node.get("anchor");
  if (!anchor.exists()) return;
  if (!anchor.is_object() || !is_non_empty_string(anchor.get("id"))) {
    drop_prop(ctx, node, path, "anchor", "an object with a non-empty `id`");
    return;
  }
  const std::string at = field(path, "anchor");
  out.present = true;
  out.id = std::string(anchor.get("id").as_string());
  std::string text;
  string_prop(ctx, anchor, at, "at", text);
  if (!text.empty()) out.at = enum_from(text, ANCHOR_ATS, AnchorAt::Bottom);
  text.clear();
  string_prop(ctx, anchor, at, "trigger", text);
  if (!text.empty()) out.trigger = enum_from(text, TRIGGERS, OverlayTrigger::Manual);
  dim_prop(ctx, anchor, at, "offset", out.offset);
  ctx.anchors.emplace_back(out.id, field(at, "id"));
}

/** The unit interval a Slider falls back to for a bound left undeclared. */
constexpr double DEFAULT_MIN = 0.0;
constexpr double DEFAULT_MAX = 1.0;

/** A bound as the warning names it — the declared number, or the default. */
std::string bound_text(const std::optional<double> &declared, double effective) {
  return declared.has_value() ? number_text(effective) : number_text(effective) + " by default";
}

/**
 * `min`/`max` that cross leave the Slider its defaults instead of an empty
 * range. Checked against the EFFECTIVE bounds: a lone `min: 5` crosses the
 * default `max` of 1 just as surely as `{min: 5, max: 1}` does.
 */
void check_range(Ctx &ctx, const std::string &path, Node &out) {
  if (!out.min.has_value() && !out.max.has_value()) return;
  const double low = out.min.value_or(DEFAULT_MIN);
  const double high = out.max.value_or(DEFAULT_MAX);
  if (low < high) return;
  warn(ctx, DiagnosticCode::InvalidProp, field(path, "min"),
       "`min` (" + bound_text(out.min, low) + ") is not below `max` (" + bound_text(out.max, high) +
           ") — both dropped, the range falls back to 0..1");
  out.min.reset();
  out.max.reset();
}

/** What a dropped node costs, worded for where it sat. */
enum class NodeKind : uint8_t { Node, View, Slot };

const char *dropped_text(NodeKind kind) {
  switch (kind) {
    case NodeKind::Node: return "node dropped";
    case NodeKind::View: return "view dropped";
    case NodeKind::Slot: return "slot replaced by an empty Container";
  }
  return "node dropped";
}

bool sanitize_node(Ctx &ctx, JsonRef value, const std::string &path, NodeKind kind, int depth,
                   Node &out);

void sanitize_children(Ctx &ctx, JsonRef value, const std::string &path, bool positional, int depth,
                       Node &out) {
  const JsonRef children = value.get("children");
  if (!children.exists()) return;
  if (!children.is_array()) {
    drop_prop(ctx, value, path, "children", "an array of nodes");
    return;
  }
  for (uint32_t i = 0; i < children.size(); i++) {
    Node child;
    const bool kept = sanitize_node(ctx, children.at(i), child_path(path, i),
                                    positional ? NodeKind::Slot : NodeKind::Node, depth + 1, child);
    if (kept) {
      out.children.push_back(std::move(child));
      continue;
    }
    // A dropped child leaves a hole only where position carries meaning. In a
    // slot list, removing it would renumber the ones after it and change what
    // they mean, so an inert Container stands in its place.
    if (positional) {
      Node placeholder;
      placeholder.type = NodeType::Container;
      placeholder.type_name = "Container";
      out.children.push_back(std::move(placeholder));
    }
  }
}

/**
 * Repairs one node, or answers false when nothing usable is left of it — which
 * is the case for a value that is not a node object at all, and for a node whose
 * type REQUIRES a field it does not have (a `Text` with no `text`, an `Image`
 * with no `src`, a `Repeat` with nothing to repeat).
 */
bool sanitize_node(Ctx &ctx, JsonRef value, const std::string &path, NodeKind kind, int depth,
                   Node &out) {
  if (depth > MAX_DEPTH) {
    warn(ctx, DiagnosticCode::TooDeep, path,
         "nested deeper than " + std::to_string(MAX_DEPTH) + " levels — subtree dropped");
    return false;
  }
  if (!value.is_object()) {
    warn(ctx, DiagnosticCode::InvalidNode, path,
         "expected a node object, got " + describe(value) + " — " + dropped_text(kind));
    return false;
  }
  const JsonRef type_value = value.get("type");
  if (!is_non_empty_string(type_value)) {
    warn(ctx, DiagnosticCode::InvalidNode, path,
         std::string("missing a non-empty `type` — ") + dropped_text(kind));
    return false;
  }
  out.type_name = std::string(type_value.as_string());
  out.type = node_type_from(out.type_name);

  // --- NodeBase, shared by every type including the unknown ones ---
  const JsonRef id = value.get("id");
  if (is_non_empty_string(id)) {
    out.id = std::string(id.as_string());
    if (std::find(ctx.ids.begin(), ctx.ids.end(), out.id) != ctx.ids.end()) {
      warn(ctx, DiagnosticCode::DuplicateId, field(path, "id"),
           "id \"" + out.id + "\" is already used in this view — the SDK addresses only one of them");
    }
    ctx.ids.push_back(out.id);
  } else if (id.exists()) {
    drop_prop(ctx, value, path, "id", "a non-empty string");
  }
  bindable_prop(ctx, value, path, "visible", is_boolean, "a boolean", out.visible,
                [](JsonRef v) { return v.as_bool(); });
  bindable_prop(ctx, value, path, "disabled", is_boolean, "a boolean", out.disabled,
                [](JsonRef v) { return v.as_bool(); });
  bool_prop(ctx, value, path, "autofocus", out.autofocus);
  bool_prop(ctx, value, path, "clip", out.clip);
  read_layout(ctx, value, path, out.layout);
  read_style_prop(ctx, value, path, out.style);
  read_states(ctx, value, path, out);
  read_transition(ctx, value, path, out.transition);

  // --- per type: required fields first, since they can sink the node ---
  std::string text;
  switch (out.type) {
    case NodeType::Text:
      // `is_string`, NOT `is_non_empty_string`: an empty string is CONTENT — the
      // label of a Select with no value yet, a Badge with no count, a bound path
      // the game has not filled in (ZAB-65). The node holds its slot and measures
      // one empty line, so a row does not re-space itself the frame its text goes
      // blank. What sinks the node is the field being ABSENT.
      if (!is_bindable(value.get("text"), is_string)) {
        warn(ctx, DiagnosticCode::InvalidNode, field(path, "text"),
             "Text has no usable `text` (" + describe(value.get("text")) + ") — " +
                 dropped_text(kind));
        return false;
      }
      bindable_prop(ctx, value, path, "text", is_string, "a string", out.text,
                    [](JsonRef v) { return std::string(v.as_string()); });
      break;
    case NodeType::Image:
      if (!(value.get("src").is_string() && is_asset_ref(value.get("src").as_string()))) {
        warn(ctx, DiagnosticCode::InvalidNode, field(path, "src"),
             "Image has no usable `src` (" + describe(value.get("src")) +
                 "; expected \"asset:<id>\") — " + dropped_text(kind));
        return false;
      }
      out.src = std::string(value.get("src").as_string());
      if (ctx.envelope->asset(asset_id_from_ref(out.src)) == nullptr) {
        warn(ctx, DiagnosticCode::UnknownAsset, field(path, "src"),
             "\"" + out.src +
                 "\" is not in the envelope's asset manifest — the node paints its background only");
      }
      string_prop(ctx, value, path, "fit", text);
      if (!text.empty()) out.fit = enum_from(text, FITS, ImageFit::Contain);
      break;
    case NodeType::Repeat:
      // Stricter than an ordinary binding: elsewhere a path that reads nothing is
      // just no value, but a Repeat with no array has no children at all.
      if (!is_bind(value.get("items")) || value.get("items").get("bind").as_string().empty()) {
        warn(ctx, DiagnosticCode::InvalidNode, field(path, "items"),
             "Repeat has no usable `items` binding (" + describe(value.get("items")) + ") — " +
                 dropped_text(kind));
        return false;
      }
      out.items_bind = std::string(value.get("items").get("bind").as_string());
      note_binding(ctx, value.get("items"), field(path, "items"));
      string_prop(ctx, value, path, "as", out.item_alias);
      string_prop(ctx, value, path, "key", out.key_path);
      break;
    case NodeType::Container:
      string_prop(ctx, value, path, "group", text);
      if (!text.empty()) out.group = enum_from(text, GROUPS, GroupBehavior::None);
      number_prop(ctx, value, path, "selected", out.selected);
      bindable_prop(ctx, value, path, "value", is_string_or_number, "a string or a number",
                    out.value, scalar_of);
      string_prop(ctx, value, path, "onChange", out.on_change);
      break;
    case NodeType::Button:
      string_prop(ctx, value, path, "onClick", out.on_click);
      break;
    case NodeType::Collapse:
      bool_prop(ctx, value, path, "open", out.open);
      break;
    case NodeType::ScrollView:
      string_prop(ctx, value, path, "axis", text);
      if (!text.empty()) out.scroll_axis = enum_from(text, SCROLL_AXES, ScrollAxis::Vertical);
      bool_prop(ctx, value, path, "scrollbar", out.scrollbar);
      break;
    case NodeType::Toggle: {
      bindable_prop(ctx, value, path, "checked", is_boolean, "a boolean", out.checked,
                    [](JsonRef v) { return v.as_bool(); });
      JsonRef raw;
      if (typed_prop(ctx, value, path, "value", is_string_or_number, "a string or a number", raw)) {
        out.value.kind = Bindable<Scalar>::Kind::Value;
        out.value.value = scalar_of(raw);
      }
      string_prop(ctx, value, path, "onChange", out.on_change);
      break;
    }
    case NodeType::Slider:
      bindable_prop(ctx, value, path, "value", is_finite_number, "a number", out.value, scalar_of);
      number_prop(ctx, value, path, "min", out.min);
      number_prop(ctx, value, path, "max", out.max);
      number_prop(ctx, value, path, "step", out.step);
      check_range(ctx, path, out);
      string_prop(ctx, value, path, "axis", text);
      if (!text.empty()) out.slider_axis = enum_from(text, SLIDER_AXES, SliderAxis::Horizontal);
      string_prop(ctx, value, path, "onChange", out.on_change);
      string_prop(ctx, value, path, "onCommit", out.on_commit);
      break;
    case NodeType::TextInput:
      bindable_prop(ctx, value, path, "value", is_string, "a string", out.value, scalar_of);
      string_prop(ctx, value, path, "placeholder", out.placeholder);
      number_prop(ctx, value, path, "maxLength", out.max_length);
      string_prop(ctx, value, path, "onChange", out.on_change);
      string_prop(ctx, value, path, "onSubmit", out.on_submit);
      break;
    case NodeType::ProgressBar:
      bindable_prop(ctx, value, path, "value", is_finite_number, "a number", out.value, scalar_of);
      break;
    case NodeType::Spinner:
      dim_prop(ctx, value, path, "period", out.period);
      number_prop(ctx, value, path, "min", out.min);
      string_prop(ctx, value, path, "easing", text);
      if (!text.empty()) out.spinner_easing = enum_from(text, EASINGS, Easing::EaseInOut);
      break;
    case NodeType::Overlay:
      read_anchor(ctx, value, path, out.anchor);
      bool_prop(ctx, value, path, "modal", out.modal);
      number_prop(ctx, value, path, "z", out.z);
      number_prop(ctx, value, path, "autoCloseMs", out.auto_close_ms);
      string_prop(ctx, value, path, "onDismiss", out.on_dismiss);
      break;
    case NodeType::Unknown:
      // Its own props belong to a version this reader does not implement, so
      // they are none of its business. What it keeps is NodeBase, read above:
      // layout, style, visible, disabled and children — `disabled` on that list
      // because dropping it would bring a control the author switched off back
      // to life (ZAB-63).
      break;
  }

  const bool positional = out.type == NodeType::Collapse || out.type == NodeType::Toggle ||
                          out.type == NodeType::Slider || out.type == NodeType::ProgressBar ||
                          out.type == NodeType::Repeat ||
                          (out.type == NodeType::Container &&
                           out.group == GroupBehavior::ExclusiveSelect);
  sanitize_children(ctx, value, path, positional, depth, out);
  return true;
}

/** The flat dictionary, minus the entries whose value is not a token value. */
void read_tokens(JsonRef value, std::vector<Diagnostic> &diagnostics, Envelope &out) {
  if (!value.exists()) {
    push(diagnostics, DiagnosticLevel::Warn, DiagnosticCode::InvalidTokens, "",
         "missing `tokens` dictionary — treated as empty");
    return;
  }
  if (!value.is_object()) {
    push(diagnostics, DiagnosticLevel::Warn, DiagnosticCode::InvalidTokens, "tokens",
         "expected an object — the dictionary is ignored");
    return;
  }
  for (uint32_t i = 0; i < value.size(); i++) {
    const std::string name(value.key_at(i));
    const JsonRef token = value.at(i);
    if (token.is_string() || is_finite_number(token)) {
      TokenValue parsed;
      parsed.is_number = token.is_number();
      parsed.number = token.as_number();
      parsed.text = std::string(token.as_string());
      out.tokens.emplace_back(name, std::move(parsed));
      continue;
    }
    push(diagnostics, DiagnosticLevel::Warn, DiagnosticCode::InvalidToken,
         "tokens[" + quote(name) + "]",
         "expected a string or a finite number, got " + describe(token) + " — token dropped");
  }
}

/**
 * Cheap shape checks only — `data` is never decoded here, which would pay the
 * cost twice. Returns the reason the entry is unusable, or empty when it is fine.
 */
std::string asset_problem(JsonRef value) {
  if (!value.is_object()) return "expected an object";
  if (!is_non_empty_string(value.get("hash"))) return "missing a non-empty `hash`";
  if (!is_non_empty_string(value.get("mime"))) return "missing a non-empty `mime`";
  const JsonRef size = value.get("size");
  if (!is_finite_number(size) || size.as_number() < 0) {
    return "missing a non-negative numeric `size`";
  }
  if (value.get("width").exists() && !is_finite_number(value.get("width"))) {
    return "`width` is not a number";
  }
  if (value.get("height").exists() && !is_finite_number(value.get("height"))) {
    return "`height` is not a number";
  }
  if (value.get("data").exists() && !is_base64(value.get("data"))) return "`data` is not base64";
  return {};
}

/**
 * The manifest, minus the malformed entries. A broken icon costs its own node a
 * texture; it never costs the UI its load, which is why an invalid entry warns
 * instead of aborting (change of policy, ZAB-37 — it used to throw).
 */
void read_assets(JsonRef value, std::vector<Diagnostic> &diagnostics, Envelope &out) {
  if (!value.exists()) return;
  if (!value.is_object()) {
    push(diagnostics, DiagnosticLevel::Warn, DiagnosticCode::InvalidAssets, "assets",
         "expected an object — the manifest is ignored");
    return;
  }
  for (uint32_t i = 0; i < value.size(); i++) {
    const std::string id(value.key_at(i));
    const JsonRef entry = value.at(i);
    const std::string reason = asset_problem(entry);
    if (!reason.empty()) {
      push(diagnostics, DiagnosticLevel::Warn, DiagnosticCode::InvalidAsset,
           "assets[" + quote(id) + "]", reason + " — asset dropped");
      continue;
    }
    AssetEntry asset;
    asset.id = id;
    asset.hash = std::string(entry.get("hash").as_string());
    asset.mime = std::string(entry.get("mime").as_string());
    asset.size = entry.get("size").as_number();
    if (is_finite_number(entry.get("width"))) asset.width = entry.get("width").as_number();
    if (is_finite_number(entry.get("height"))) asset.height = entry.get("height").as_number();
    if (entry.get("data").exists()) {
      asset.has_data = true;
      asset.data = std::string(entry.get("data").as_string());
    }
    out.assets.push_back(std::move(asset));
  }
}

}  // namespace

EnvelopeReport validate_envelope(JsonRef value) {
  std::vector<Diagnostic> diagnostics;
  if (!value.is_object()) {
    return fail(std::move(diagnostics), DiagnosticCode::NotAnObject, "", "expected a JSON object");
  }
  const JsonRef version = value.get("v");
  if (!is_finite_number(version)) {
    return fail(std::move(diagnostics), DiagnosticCode::MissingVersion, "",
                "missing numeric `v` field");
  }
  if (!supports_version(version.as_number())) {
    return fail(std::move(diagnostics), DiagnosticCode::UnsupportedVersion, "",
                "unsupported major version " + number_text(version.as_number()) +
                    " (this reader implements v" + std::to_string(IR_VERSION) + ")");
  }
  const JsonRef views = value.get("views");
  if (!views.is_object()) {
    return fail(std::move(diagnostics), DiagnosticCode::MissingViews, "", "missing `views` map");
  }

  EnvelopeReport report;
  report.envelope.v = static_cast<int>(version.as_number());
  read_tokens(value.get("tokens"), diagnostics, report.envelope);
  read_assets(value.get("assets"), diagnostics, report.envelope);

  Ctx ctx;
  ctx.diagnostics = &diagnostics;
  ctx.envelope = &report.envelope;

  for (uint32_t i = 0; i < views.size(); i++) {
    const std::string id(views.key_at(i));
    ctx.ids.clear();
    ctx.anchors.clear();
    ViewDef view;
    view.id = id;
    if (!sanitize_node(ctx, views.at(i), view_path(id), NodeKind::View, 0, view.root)) continue;
    for (const auto &anchor : ctx.anchors) {
      if (std::find(ctx.ids.begin(), ctx.ids.end(), anchor.first) != ctx.ids.end()) continue;
      warn(ctx, DiagnosticCode::UnknownAnchor, anchor.second,
           "anchor id \"" + anchor.first + "\" matches no node in view \"" + id +
               "\" — the overlay falls back to the layer placement");
    }
    report.envelope.views.push_back(std::move(view));
  }

  if (report.envelope.views.empty()) {
    return fail(std::move(diagnostics), DiagnosticCode::NoUsableViews, "",
                views.size() == 0 ? "the `views` map is empty"
                                  : "no usable views (every view was dropped)");
  }

  report.ok = true;
  report.diagnostics = std::move(diagnostics);
  return report;
}

EnvelopeReport read_envelope(std::string_view json_text) {
  const JsonParse parsed = JsonDoc::parse(json_text);
  if (!parsed.ok) {
    return fail({}, DiagnosticCode::InvalidJson, "", "not valid JSON — " + parsed.error);
  }
  return validate_envelope(parsed.doc.root());
}

}  // namespace zabloo
