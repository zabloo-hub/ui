// The IR, as the core holds it in memory.
//
// The whole v1 model lands here at once — 13 node types and every prop — rather
// than growing type by type with the capabilities. The web renderer already
// closed the catalog, so there is nothing to discover: a `Slider` this build
// cannot yet drag still has to LOAD, keep its bounds and hold its slots, or the
// forward-tolerance rules would be tested against a reader that only knows half
// the format.
//
// Two shapes carry the format's oddities, and both exist because "absent" is a
// real value in the IR, distinct from zero and from false:
//
//   * `Dim` and `ColorValue` are "a literal, a `{token}` reference, or nothing" —
//     the token indirection that makes themes hot-updatable (2026-08-01 #5).
//   * `Bindable<T>` is "a value, a `{ bind }` path, or nothing" — one of the two
//     dynamic mechanisms, read AND write since ZAB-23.
//
// A node is one flat struct with every type's props on it, not a hierarchy. The
// reference implementation reads a plain JS object the same way, layout and paint
// branch on `type` rather than on a class, and the alternative — a variant or a
// vtable — buys type safety the JSON never had in exchange for a cast at every
// use. The cost is bytes per node, which is the cheapest thing in this file.

#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace zabloo {

/** Major IR version this reader implements. */
inline constexpr int IR_VERSION = 1;

/**
 * `v` is the major and the only version number of the format (2026-08-13). The
 * comparison is EQUALITY in both directions: a v1 reader carries no v2 semantics,
 * and a v2 reader has not kept v1's. Everything additive is handled by the
 * forward-tolerance rules instead, which is why there is no minor.
 */
inline bool supports_version(double v) {
  return v == static_cast<double>(static_cast<int64_t>(v)) && v == IR_VERSION;
}

// --- value shapes ---------------------------------------------------------

/** A number or a `{token}` — the tokenizable half of `Layout` and `Style`. */
struct Dim {
  enum class Kind : uint8_t { Absent, Number, Token };

  Kind kind = Kind::Absent;
  double number = 0.0;
  /** Token name WITHOUT the braces, ready for a flat dictionary lookup. */
  std::string token;

  bool present() const { return kind != Kind::Absent; }

  static Dim of(double value) {
    Dim dim;
    dim.kind = Kind::Number;
    dim.number = value;
    return dim;
  }
};

/** A color literal (`"#4f46e5"`) or a `{token}`. Same indirection as `Dim`. */
struct ColorValue {
  enum class Kind : uint8_t { Absent, Literal, Token };

  Kind kind = Kind::Absent;
  /** The literal, or the token name without braces. */
  std::string text;

  bool present() const { return kind != Kind::Absent; }
};

/** A static value, a `{ bind }` data path, or nothing. */
template <typename T>
struct Bindable {
  enum class Kind : uint8_t { Absent, Value, Bind };

  Kind kind = Kind::Absent;
  T value{};
  std::string bind;

  bool present() const { return kind != Kind::Absent; }
  bool is_bound() const { return kind == Kind::Bind; }
  /** The static value, or `fallback` for an absent or bound prop. */
  T literal(T fallback) const { return kind == Kind::Value ? value : fallback; }
};

/**
 * A string or a number, whichever the payload wrote. The IR asks for this in
 * two places that look unrelated and are not: a token's value, and the `value`
 * of the controls — a radio group selects by a string, a slider by a number,
 * and the format lets either sit in the same field.
 */
struct Scalar {
  enum class Kind : uint8_t { None, Number, Text };

  Kind kind = Kind::None;
  double number = 0.0;
  std::string text;

  bool present() const { return kind != Kind::None; }
  /** Selection compares by identity of value: absent never matches absent. */
  bool same_as(const Scalar &other) const {
    if (kind != other.kind || kind == Kind::None) return false;
    return kind == Kind::Number ? number == other.number : text == other.text;
  }
};

/** A token's value: the dictionary is flat and holds strings or numbers. */
struct TokenValue {
  bool is_number = false;
  double number = 0.0;
  std::string text;
};

// --- enums ----------------------------------------------------------------
//
// Unknown members of a closed set fall back to the default at READ time, never
// at validation time: the validator checks shapes, never vocabularies, because
// validating the value would turn tomorrow's content into today's error
// (2026-08-12). What that means here is that `axis: "diagonal"` loads clean and
// simply behaves as the default, exactly as the web renderer does with it.

enum class Direction : uint8_t { Row, Column };
enum class Justify : uint8_t { Start, Center, End, SpaceBetween };
enum class Align : uint8_t { Start, Center, End, Stretch };
enum class TextAlign : uint8_t { Start, Center, End };
enum class TextOverflow : uint8_t { Clip, Ellipsis };
enum class Easing : uint8_t { Linear, EaseIn, EaseOut, EaseInOut };
enum class GroupBehavior : uint8_t { None, ExclusiveOpen, ExclusiveSelect, ExclusiveCheck };
enum class ScrollAxis : uint8_t { Vertical, Horizontal, Both };
enum class SliderAxis : uint8_t { Horizontal, Vertical };
enum class ImageFit : uint8_t { Contain, Cover, Stretch };
enum class OverlayTrigger : uint8_t { Manual, Hover, Press };
enum class AnchorAt : uint8_t {
  Center,
  Top,
  Bottom,
  Left,
  Right,
  TopLeft,
  TopRight,
  BottomLeft,
  BottomRight,
};

/**
 * The runtime states a style override can dress, in NO particular order — the
 * normative precedence lives in `states.h`, which is the one place that decides
 * it for every target.
 */
enum class StateName : uint8_t {
  Empty,
  Selected,
  Checked,
  Hover,
  Focused,
  Pressed,
  Disabled,
  Count,
};

enum class NodeType : uint8_t {
  Container,
  Text,
  Button,
  Collapse,
  ScrollView,
  Image,
  Toggle,
  Slider,
  TextInput,
  Overlay,
  Repeat,
  ProgressBar,
  Spinner,
  /**
   * A type from a version this build does not implement. It renders as a
   * `Container` preserving layout, style, visible, disabled and children — the
   * normative degradation (2026-08-11), with `disabled` on the list because
   * dropping it would bring a control the author switched off back to life.
   */
  Unknown,
};

/** The spelling from the payload, for diagnostics and for `Unknown` nodes. */
const char *node_type_name(NodeType type);
/** `Unknown` for anything outside the v1 vocabulary. */
NodeType node_type_from(std::string_view name);

// --- structures -----------------------------------------------------------

struct Layout {
  /** Column, as `docs/format/layout.md` says: a stack is the common case. */
  Direction direction = Direction::Column;
  Justify justify = Justify::Start;
  Align align = Align::Start;
  Dim gap;
  Dim padding;
  Dim width;
  Dim height;
  std::optional<double> grow;
  bool wrap = false;
};

struct Style {
  ColorValue background;
  ColorValue border_color;
  ColorValue color;
  Dim radius;
  Dim border_width;
  Dim font_size;
  Dim line_height;
  std::optional<double> opacity;
  std::optional<double> max_lines;
  std::optional<TextAlign> text_align;
  std::optional<TextAlign> text_align_y;
  std::optional<TextOverflow> overflow;
  std::optional<bool> wrap;
};

/** `Style` is the "what"; this is the "how" (ZAB-33). Absent means it snaps. */
struct Transition {
  bool present = false;
  Dim duration;
  /**
   * `ease-out` when the node declares none — the normative default
   * (`docs/format/motion.md`), and not linear. An easing the reader does not know
   * is a different case and falls back to linear, which `read_transition` does.
   */
  Easing easing = Easing::EaseOut;
};

/** Where an overlay sits and what lights it up — one field, one relation. */
struct OverlayAnchor {
  bool present = false;
  std::string id;
  AnchorAt at = AnchorAt::Bottom;
  Dim offset;
  OverlayTrigger trigger = OverlayTrigger::Manual;
};

struct AssetEntry {
  std::string id;
  std::string hash;
  std::string mime;
  double size = 0.0;
  std::optional<double> width;
  std::optional<double> height;
  /** Base64, still encoded: decoding it here would pay the cost twice. */
  std::string data;
  bool has_data = false;
};

struct Node {
  NodeType type = NodeType::Container;
  /** As written in the payload — the only place an `Unknown` keeps its name. */
  std::string type_name;

  // NodeBase, shared by every type including the unknown ones.
  std::string id;
  Bindable<bool> visible;
  Bindable<bool> disabled;
  bool autofocus = false;
  bool clip = false;
  Layout layout;
  Style style;
  Transition transition;
  /** Indexed by `StateName`; the flags say which the author declared. */
  Style state_style[static_cast<size_t>(StateName::Count)];
  bool has_state[static_cast<size_t>(StateName::Count)] = {};

  std::vector<Node> children;

  // Container.
  GroupBehavior group = GroupBehavior::None;
  std::optional<double> selected;
  std::string on_change;

  // Text.
  Bindable<std::string> text;

  // Button.
  std::string on_click;

  // Collapse.
  std::optional<bool> open;

  // ScrollView.
  ScrollAxis scroll_axis = ScrollAxis::Vertical;
  bool scrollbar = true;

  // Image.
  std::string src;
  ImageFit fit = ImageFit::Contain;

  // Toggle.
  Bindable<bool> checked;

  // The `value` of every type that has one: a `"exclusive-check"` group compares
  // by it, a Toggle carries its own, a Slider and a ProgressBar read a number
  // from it and a TextInput a string. One field because it IS one field in the
  // format — what changes per type is which half of a `Scalar` gets read.
  Bindable<Scalar> value;

  std::optional<double> min;
  std::optional<double> max;
  std::optional<double> step;
  SliderAxis slider_axis = SliderAxis::Horizontal;
  std::string on_commit;

  // TextInput.
  std::string placeholder;
  std::optional<double> max_length;
  std::string on_submit;

  // Overlay.
  OverlayAnchor anchor;
  bool modal = true;
  double z = 0.0;
  std::optional<double> auto_close_ms;
  std::string on_dismiss;

  // Repeat.
  std::string items_bind;
  std::string item_alias;
  std::string key_path;

  // Spinner.
  Dim period;
  Easing spinner_easing = Easing::EaseInOut;
};

/**
 * One view as the envelope defines it, kept with the id it loads by. Order is the
 * payload's order. `View` (view.h) is the RUNTIME of one of these on screen —
 * content and runtime are separate so a hot-update swaps one and not the other.
 */
struct ViewDef {
  std::string id;
  Node root;
};

struct Envelope {
  int v = IR_VERSION;
  std::vector<ViewDef> views;
  /** Flat, as the format defines it: one lookup, no nesting to walk. */
  std::vector<std::pair<std::string, TokenValue>> tokens;
  std::vector<AssetEntry> assets;

  const ViewDef *view(std::string_view id) const;
  const TokenValue *token(std::string_view name) const;
  const AssetEntry *asset(std::string_view id) const;
};

/** True for a well-formed `"asset:<id>"` reference with a non-empty id. */
bool is_asset_ref(std::string_view value);
/** The manifest id behind an `"asset:<id>"` reference. */
std::string_view asset_id_from_ref(std::string_view ref);

}  // namespace zabloo
