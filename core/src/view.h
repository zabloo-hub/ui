// The runtime: one loaded envelope, one view on screen.
//
// This is the frontier drawn in ZAB-134, from the core's side: everything here
// runs without an engine. A `View` resolves styles, lays the tree out, produces
// triangles and answers input — and it does all of it against a viewport it was
// simply told the size of. That is what lets the golden corpus run against a
// native binary on a bare CPU (G3), and what makes any logic that leaks into the
// adapter fall out of that net automatically.
//
// `Document` is the game's stable handle. Views are disposable: a hot-update
// replaces the envelope and rebuilds them, while the data the game pushed stays
// on the document and is replayed into whatever loads next. Manual import, dev
// push and hot-update are the same call, which is the invariant the format has
// carried since 2026-08-01.

#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "glyphs.h"
#include "layout.h"
#include "tessellator.h"
#include "validate.h"

namespace zabloo {

/** A named action leaving the UI for the game — `onClick: "buy"`. */
struct ActionEvent {
  std::string name;
  /**
   * Where it fired from, when it fired inside a `Repeat` item (ZAB-29). Empty
   * until G12 (ZAB-145) instantiates items: an action from the document itself
   * carries no context, which is exactly what an empty path means.
   */
  std::string item_path;
};

class View {
 public:
  View(const Envelope &envelope, std::string_view view_id);
  // The tree holds parent pointers into its own children vectors, so a View that
  // moved would leave every one of them naming where its parent used to be.
  View(const View &) = delete;
  View &operator=(const View &) = delete;

  /** The viewport the tree is laid out against, in view space units. */
  void set_size(double width, double height);

  /** Resolve → measure → arrange. Everything geometric happens here. */
  void layout_frame();

  /** Tessellates the arranged tree. Call after `layout_frame`. */
  const GeometryBuilder &paint();

  // --- pointer input ---
  // The three answer "did anything change?", so the adapter only redraws when
  // something did.
  bool pointer_move(double x, double y);
  bool pointer_down(double x, double y);
  bool pointer_up(double x, double y);
  /** The pointer left the surface: whatever it held is released, nothing fires. */
  bool pointer_exit();

  /** Named actions produced since the last drain, in the order they fired. */
  std::vector<ActionEvent> drain_actions();

  const LayoutNode &root() const { return root_; }
  /**
   * The live glyph atlases, most recently used last.
   *
   * The adapter reconciles its own textures against this list every frame: an
   * atlas that is gone from it has been evicted, and one whose `version()` moved
   * has new glyphs in it. A list of at most eight is cheaper to sweep than a
   * callback is to wire, and there is no window in which a texture outlives the
   * atlas it belongs to.
   */
  const FontLibrary &fonts() const { return fonts_; }
  /** The node holding focus, or null. Moving it is G7's (ZAB-140). */
  const LayoutNode *focus() const { return focus_; }
  /** The node under the pointer, and the one it is holding down. Either may be null. */
  const LayoutNode *hover() const { return hovered_; }
  const LayoutNode *pressed() const { return pressed_; }
  const std::string &id() const { return id_; }
  /** The viewport the last `set_size` gave, at the origin. */
  const Rect &viewport() const { return viewport_; }

 private:
  const Envelope *envelope_ = nullptr;
  std::string id_;
  const Node *ir_root_ = nullptr;
  LayoutNode root_;
  Rect viewport_;
  GeometryBuilder geometry_;
  /**
   * One atlas per point size, at a device scale of 1: the corpus measures there,
   * and a HiDPI surface is the adapter telling the view about its scale, which
   * is G15's (ZAB-148). Every metric this hands back is in logical px either way.
   */
  FontLibrary fonts_;
  std::vector<ActionEvent> actions_;
  /** Bumped per frame; what stamps the per-node style cache. */
  int64_t frame_ = 0;
  LayoutNode *pressed_ = nullptr;
  LayoutNode *hovered_ = nullptr;
  LayoutNode *focus_ = nullptr;

  class Leaves;
  friend class Leaves;

  void sync_flags(LayoutNode &node);
  /** Breaks a `Text` into lines, reusing last frame's block when nothing moved. */
  Size measure_text(LayoutNode &node, std::optional<double> available);
  /** Places every laid-out `Text` of the tree — one pass, right after the arrange. */
  void place_text(LayoutNode &node);
  /** The resolved `fontSize`, rounded and clamped: the key an atlas is kept by. */
  double font_size(const Style &style) const;
  TextLayoutOptions text_options(const Style &style, double font_line_height,
                                 std::optional<double> max_width) const;
  LayoutNode *first_autofocus(LayoutNode &node);
  void resolve(LayoutNode &node);
  void paint_node(LayoutNode &node, double opacity);
  const Style &style_of(LayoutNode &node);

  double dim(const Dim &value, double fallback) const;
  std::optional<double> optional_dim(const Dim &value) const;
  Color color(const ColorValue &value, Color fallback) const;
  std::optional<Color> optional_color(const ColorValue &value, Color fallback) const;

  LayoutNode *hit(LayoutNode &node, double x, double y);
  LayoutNode *pressable_at(double x, double y);
  void fire(const LayoutNode &node, const std::string &action);
};

/**
 * A value the game pushed down the data channel. Bindings read it from G7
 * (ZAB-140); until then the document simply keeps it, which is the half of the
 * contract that has to survive a reload either way.
 */
struct DataValue {
  enum class Kind : uint8_t { Bool, Number, Text };

  Kind kind = Kind::Bool;
  bool boolean = false;
  double number = 0.0;
  std::string text;
};

class Document {
 public:
  /**
   * The one loading path: a manually imported file, a dev push and a platform
   * hot-update all arrive here.
   *
   * It NEVER throws, and a payload it refuses leaves the previous one ON SCREEN
   * — a corrupt hot-update costs the update, not the session (ZAB-37). The
   * return says whether the new envelope took; `diagnostics()` says why.
   */
  bool load(std::string_view json_text);

  /** What the last `load` found, whether it took or not. */
  const std::vector<Diagnostic> &diagnostics() const { return diagnostics_; }
  bool loaded() const { return loaded_; }

  /** Shows a view by id. False if this envelope has no such view. */
  bool show(std::string_view view_id);
  /** The view on screen, or null before the first successful `show`. */
  View *view() { return view_.get(); }
  const View *view() const { return view_.get(); }

  /**
   * The game→core data channel. Cached ON THE DOCUMENT, so it outlives the view
   * it fed: pushed data survives a content swap, which is production hot-update
   * behavior and not a dev convenience (2026-08-03).
   */
  void set_data(std::string_view path, const DataValue &value);
  const DataValue *data(std::string_view path) const;
  const std::vector<std::pair<std::string, DataValue>> &data() const { return data_; }

 private:
  /**
   * Held behind a pointer so its ADDRESS survives: a `View` reads its tokens
   * through one, and a `Document` that moved would otherwise leave every view it
   * owns pointing at where its envelope used to be.
   */
  std::unique_ptr<Envelope> envelope_;
  bool loaded_ = false;
  std::vector<Diagnostic> diagnostics_;
  std::unique_ptr<View> view_;
  std::vector<std::pair<std::string, DataValue>> data_;
};

}  // namespace zabloo
