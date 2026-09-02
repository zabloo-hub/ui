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
#include <unordered_map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include "data.h"
#include "assets.h"
#include "clip.h"
#include "glyphs.h"
#include "groups.h"
#include "layout.h"
#include "overlay_layer.h"
#include "tessellator.h"
#include "transition.h"
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

/**
 * A control writing its own value back through a bound path — the return leg of
 * the data channel (2026-08-11, ZAB-23).
 *
 * It is a queue and not a callback for the same reason actions are: the adapter
 * drains it after handing the core an input, so a signal never fires from inside
 * a layout pass. The game hears these on `data_changed`, exactly as it would
 * hear a real gesture.
 */
struct DataChange {
  std::string path;
  DataValue value;
};

class View {
 public:
  /**
   * The store is the DOCUMENT's, not the view's: data the game pushed outlives
   * the envelope it was pushed for, so a hot-update comes back up filled in
   * (2026-08-03). A view reads it and writes into it; it never owns it.
   */
  View(const Envelope &envelope, std::string_view view_id, DataStore &data);
  // The tree holds parent pointers into its own children vectors, so a View that
  // moved would leave every one of them naming where its parent used to be.
  View(const View &) = delete;
  View &operator=(const View &) = delete;

  /** The viewport the tree is laid out against, in view space units. */
  void set_size(double width, double height);

  /**
   * The clock every tween reads, in milliseconds.
   *
   * Injected rather than taken from the engine, and that is the point: the core
   * never asks what time it is, so the golden harness can advance it in exact
   * steps and record a frame at a stated instant. Two `layout_frame`s at the same
   * `now` are two frames at the same moment — which is how a mount settles the
   * structure the data drives before any motion begins.
   */
  void set_now(double milliseconds) { now_ = milliseconds; }
  double now() const { return now_; }

  /** Resolve → measure → arrange. Everything geometric happens here. */
  void layout_frame();

  /**
   * Whether the last frame left anything moving — a tween in flight, a Spinner's
   * loop. It is what the adapter watches to ask for the next frame and, when it
   * goes false, to stop: motion costs frames for exactly as long as it lasts.
   */
  bool animating() const { return animating_; }

  /** Tessellates the arranged tree. Call after `layout_frame`. */
  const GeometryBuilder &paint();

  // --- pointer input ---
  // The three answer "did anything change?", so the adapter only redraws when
  // something did.
  // `mouse` is what separates a cursor from a finger: hover is a mouse state, so
  // a touch that taps and leaves must not leave a control lit up behind it.
  bool pointer_move(double x, double y, bool mouse = true);
  bool pointer_down(double x, double y, bool mouse = true);
  bool pointer_up(double x, double y, bool mouse = true);
  /**
   * A wheel notch or a trackpad pan, in view-space pixels: it scrolls the
   * nearest `ScrollView` under the point, and nothing at all when there is none.
   */
  bool pointer_wheel(double x, double y, double dx, double dy);
  /** The pointer left the surface: whatever it held is released, nothing fires. */
  bool pointer_exit();
  /**
   * The gesture ended without concluding — a touch the system took away, a
   * window that lost the pointer. Every hold is dropped and NOTHING fires: no
   * action, no `Collapse` toggling, no backdrop dismissed. The same rule a press
   * released outside its control already follows (ZAB-70).
   */
  bool pointer_cancel();

  // --- keyboard and directional navigation (2026-08-04) ---

  /**
   * Moves the focus along a unit axis. False when nothing moved — no candidate
   * lies that way, or there is nothing focusable at all.
   */
  bool move_focus(double dx, double dy);
  /**
   * Press/release the focused node: Enter and Space on a keyboard, A on a pad.
   * Releasing is what activates, and only on the node that was pressed.
   */
  bool press_focused(bool down);

  /**
   * Asks the modal that owns the input to close — Escape on a keyboard, B on a
   * pad. False when no modal is up, and that answer matters to the adapter: an
   * Escape this view did not use belongs to the game's own pause menu.
   */
  bool dismiss_top_modal();

  // --- the host channel, by id (`docs/format/host-channel.md`) ---
  // Each answers whether it found the control. A `false` means no node of that
  // type carries that id and NOTHING was applied — a game looping over ids must
  // not die because one screen was hot-updated out from under it.
  //
  // They are the player's gesture, hooks included: `set_checked` fires the
  // toggle's `onChange` and, inside a group, the group's.

  bool set_open(std::string_view id, bool open);
  bool set_selected_tab(std::string_view id, int index);
  bool set_checked(std::string_view id, bool checked);
  /**
   * Scrolls a `ScrollView`. Host API and not IR: the offset has no prop to
   * author (2026-08-11, ZAB-9), and whatever lands here is clamped to the bounds
   * the last relayout computed.
   */
  bool set_scroll(std::string_view id, double x, double y);

  /** Named actions produced since the last drain, in the order they fired. */
  std::vector<ActionEvent> drain_actions();
  /** Values controls wrote back since the last drain, in the order they landed. */
  std::vector<DataChange> drain_data_changes();

  /**
   * A path was written: every bound node reading it re-derives its state.
   *
   * Called by the document, which owns the store — so a `SetData` before this
   * view existed is not a special case, it is simply data the build pass reads.
   */
  void data_written(std::string_view path);

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
  /**
   * The manifest images this view has resolved, for the adapter to reconcile its
   * textures against — the same sweep `fonts()` is there for, and non-const
   * because reporting a decoded size back is the one thing that flows the other
   * way (`ImageLibrary::adopt_size`).
   */
  ImageLibrary &images() { return images_; }
  /**
   * The overlay layer as this frame PAINTED it: every present Overlay in
   * `(z, document order)`, plus whatever is still fading out. Each entry carries
   * its own `presence`, which is what the paint pass and the snapshot fade it by.
   */
  const std::vector<LayoutNode *> &paint_layer() const { return paint_layer_; }
  /** The node holding focus, or null. Moving it is G7's (ZAB-140). */
  const LayoutNode *focus() const { return focus_; }
  /** The node under the pointer, and the one it is holding down. Either may be null. */
  const LayoutNode *hover() const { return hovered_; }
  const LayoutNode *pressed() const { return pressed_; }
  const std::string &id() const { return id_; }
  /** The viewport the last `set_size` gave, at the origin. */
  const Rect &viewport() const { return viewport_; }
  /**
   * What building this view's runtime found — a malformed `"exclusive-select"`
   * group, so far. Reported once per load next to the envelope's own: it is a
   * property of the document, not of the gesture that reads it.
   */
  const std::vector<Diagnostic> &warnings() const { return warnings_; }

 private:
  // The layer reads and writes the view directly rather than through a seam: the
  // reference's `OverlayHost` exists to break a TypeScript import cycle, and here
  // it would buy a virtual call per node per frame and nothing else.
  friend class OverlayLayer;

  const Envelope *envelope_ = nullptr;
  DataStore *data_ = nullptr;
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
  /** Resolved lazily, on the first measure that asks for a `src`. */
  ImageLibrary images_;
  std::vector<ActionEvent> actions_;
  std::vector<DataChange> data_changes_;
  std::vector<Diagnostic> warnings_;
  /** Nodes whose STATE is driven by a binding — what a write has to revisit. */
  std::vector<LayoutNode *> bound_;
  /**
   * Every `Overlay` of the view, hidden ones included. Kept as the tree is built
   * rather than found by walking it (ZAB-73): on a thousand-row list that walk is
   * five thousand visits to find three panels, once a frame.
   */
  std::vector<LayoutNode *> overlays_;
  /** The live layer this frame — what owns input, focus and the timers. */
  std::vector<LayoutNode *> layer_;
  /** The live layer plus whatever is still fading out: what PAINTS. */
  std::vector<LayoutNode *> paint_layer_;
  OverlayLayer overlay_layer_{*this};
  /** Ids the host channel addresses. The last node realized under an id wins. */
  std::unordered_map<std::string, LayoutNode *> by_id_;
  /**
   * Where a `"<alias>.$index"` read lands, since a position is a number the data
   * does not contain and so has nowhere in the store to be. Consumed by the
   * caller before anything else can read it.
   */
  DataValue index_value_;
  /** Bumped per frame; what stamps the per-node style cache. */
  int64_t frame_ = 0;
  /** The injected clock, and whether the last frame left anything moving. */
  double now_ = 0.0;
  bool animating_ = false;
  /**
   * One targets scratch for the whole tree, refilled per node by the resolve pass:
   * `step_node` reads it synchronously and never keeps it, so an animating frame
   * allocates nothing per node (ZAB-55).
   */
  ResolvedValues targets_;
  LayoutNode *pressed_ = nullptr;
  LayoutNode *hovered_ = nullptr;
  LayoutNode *focus_ = nullptr;
  /**
   * The regions of the frame currently painted. The batches point INTO this, so
   * it may only be reset by the paint pass itself; the input path gets its own
   * (below) rather than stomping the addresses the adapter is about to read.
   */
  ClipArena paint_clips_;
  ClipArena hit_clips_;

  /** A drag on a `ScrollView`, before the tap-or-drag threshold resolves it. */
  struct ScrollDrag {
    LayoutNode *node = nullptr;
    double start_x = 0.0;
    double start_y = 0.0;
    double last_x = 0.0;
    double last_y = 0.0;
    /** Once true the gesture is a scroll, and the release is no longer a tap. */
    bool moved = false;
  };
  ScrollDrag drag_;
  /** The modal whose backdrop took the press, dismissed if the release lands there too. */
  LayoutNode *backdrop_press_ = nullptr;
  /**
   * The node a just-opened popover focused, to be revealed once this frame's
   * boxes are final. `reveal_focused` otherwise reads rects that are already laid
   * out; a popover's are not, so this defers it by exactly one PASS instead of by
   * one frame (`reveal_opened_popover`).
   */
  LayoutNode *pending_reveal_ = nullptr;

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
  /** Initial state and bindings, once, over the freshly built tree. */
  void prepare(LayoutNode &node);
  /** Derives from data everything this node's state reads. */
  void apply_bindings(LayoutNode &node);
  /** The values whose BINDING drives this node's state — Text is read at measure. */
  bool watches(const LayoutNode &node, std::string_view written) const;
  /** The value behind a bound prop for this node, or null for no value. */
  const DataValue *read_bind(const LayoutNode &node, const std::string &bind);
  /** The absolute path a binding WRITES to — an index is a position, not a slot. */
  bool write_path(const LayoutNode &node, const std::string &bind, std::string &out) const;
  void write_data(const std::string &path, DataValue value);
  /** What a `Text` paints this frame: its literal, or what its binding reads. */
  std::string text_of(const LayoutNode &node);

  // --- Collapse, groups and the Toggle's value ---
  void apply_open(LayoutNode &node);
  bool set_collapse_open(LayoutNode &node, bool open);
  /** Puts a new `open` into effect: the height tween, or the plain show/hide. */
  void start_collapse(LayoutNode &node);
  void enforce_group(LayoutNode &opened);
  TabsGroup tabs_of(const LayoutNode &group) const;
  void apply_selection(LayoutNode &group);
  bool set_selected(LayoutNode &group, int index);
  /** The group and the index this button occupies in it, if it is a tab. */
  LayoutNode *tab_group_of(LayoutNode &button, int &index);
  LayoutNode *exclusive_group_of(LayoutNode &node) const;
  void group_options(LayoutNode &group, LayoutNode &node, std::vector<LayoutNode *> &out) const;
  void apply_group_value(LayoutNode &group);
  void set_toggle_checked(LayoutNode &node, bool checked);
  /** One path for a tap, Enter and the pad: what a control does when activated. */
  void activate(LayoutNode &node);
  /** What a release does, whether the press came from a finger or from a key. */
  void release(LayoutNode &node);
  /** The Toggle's indicator cross-fade, applied after its children resolve. */
  void crossfade_slots(LayoutNode &node, NodeAnim *anim, const ResolvedTransition *transition,
                       double now);
  /** A node addressed by the host channel, or null when the type does not match. */
  LayoutNode *find_by_id(std::string_view id, NodeType type);

  // --- focus ---
  void set_focus(LayoutNode *node);
  /** Where the focus may live right now: the top modal's subtree, or the root. */
  LayoutNode &scope();
  /**
   * The scope's initial focus. A popover opens ON its selection — the option the
   * group already holds — and everything else on its declared `autofocus`.
   */
  LayoutNode *autofocus(LayoutNode &scope);
  /**
   * Whether this node is still on screen this frame: in layout, or an Overlay
   * that has left the live layer and is painting out its fade. That exception is
   * the only place a node outside the layout is drawn at all, and it is bounded
   * to the layer.
   */
  static bool shown(const LayoutNode &node);
  /**
   * Navigation candidates: everything focusable inside `scope`, minus the
   * subtrees of overlays that are not up. A closed popover stays `in_layout` —
   * the open flag lives on the overlay, not on the layout flags — so `in_layout`
   * alone would offer its options, stale rects included.
   */
  void candidates_in(LayoutNode &scope, std::vector<LayoutNode *> &out);
  /**
   * Reveals the focus a POPOVER opened on, once this frame's boxes are final.
   * True when it moved a scroll offset, so the caller re-arranges.
   */
  bool reveal_opened_popover();
  /** Drops hover and press from a node that has left the layout under them. */
  void prune_hover();
  /** Releases what a node that has just become disabled was holding. */
  void prune_disabled();

  void resolve(LayoutNode &node, double now);
  /** The node's declared `transition`, its duration resolved to milliseconds. */
  std::optional<ResolvedTransition> transition_of(const LayoutNode &node) const;
  /** Its tween state, allocated on first use — null for a node that cannot animate. */
  NodeAnim *anim_of(LayoutNode &node, const ResolvedTransition *transition);
  void resolve_progress(LayoutNode &node, NodeAnim *anim, const ResolvedTransition *transition,
                        double now);
  /** The bar's bound or literal `value`, read normatively (`clamp_progress`). */
  double progress_target(LayoutNode &node);
  void resolve_collapse(LayoutNode &node, NodeAnim *anim, const ResolvedTransition *transition,
                        double now);
  /** The Spinner's wave over its beads, sampled from the loop's phase. */
  void spin(LayoutNode &node, double now);
  /** A whole subtree's motion, forgotten — what leaving the layout costs. */
  void forget_anim(LayoutNode &node);
  /** One node's, for the same reason: the next step snaps, like a mount. */
  void forget_tweens(LayoutNode &node);
  void paint_node(LayoutNode &node, double opacity, const Clip *clip);
  /** The `ScrollView`'s own overlay indicator, inside the viewport and over it. */
  void paint_scrollbar(LayoutNode &node, double opacity, const Clip *clip);
  const Style &style_of(LayoutNode &node);

  double dim(const Dim &value, double fallback) const;
  std::optional<double> optional_dim(const Dim &value) const;
  Color color(const ColorValue &value, Color fallback) const;
  std::optional<Color> optional_color(const ColorValue &value, Color fallback) const;

  /** The layer first (top-down, a modal captures), then the tree. */
  LayerHit hit_layer(double x, double y);
  /** The same, for the callers that have nothing to say about a backdrop. */
  LayoutNode *hit(double x, double y);
  /** Is this node's own rect reachable at that point, given its ancestors' clips? */
  bool reachable_at(LayoutNode &node, double x, double y);
  /** The nearest `ScrollView` above a node, stopping at an `Overlay`. */
  LayoutNode *scroller_of(LayoutNode &node) const;
  /** The one path a scroll offset moves through — wheel, drag and `set_scroll`. */
  bool set_scroll_offset(LayoutNode &node, double x, double y);
  /**
   * Brings the focus into view, bubbling outward so nested scrollers converge in
   * one pass. Navigation only: a pointer press focuses what the player is already
   * looking at (2026-08-12, ZAB-47).
   */
  bool reveal_focused(LayoutNode &node);
  LayoutNode *hoverable_at(double x, double y);
  LayoutNode *collapse_header_at(double x, double y);
  void fire(const LayoutNode &node, const std::string &action);
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
  void set_data(std::string_view path, DataValue value);
  const DataValue *data(std::string_view path) const;
  DataStore &store() { return *data_; }

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
  /**
   * Cached ON THE DOCUMENT so it outlives the view it feeds: pushed data
   * survives a content swap, which is production hot-update behavior and not a
   * dev convenience (2026-08-03).
   *
   * Behind a pointer for the same reason the envelope is: the view holds a
   * reference to it, and a `Document` that moved would otherwise leave that
   * reference naming where its store USED to be.
   */
  std::unique_ptr<DataStore> data_ = std::make_unique<DataStore>();
};

}  // namespace zabloo
