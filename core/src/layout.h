// The layout pass: pure geometry over resolved inputs.
//
// A port of `renderer-web/src/layout.ts`, and a deliberately literal one. The
// corpus compares the two target's rects to the decimal, so the interesting
// thing about this file is not that it computes a flex layout — it is that it
// computes THE SAME flex layout, with the same rounding at the same steps.
//
// The pass never reads the IR's declared dims. It reads `resolved`, which the
// view fills in a pass of its own: tokens looked up, states merged, and (from G8
// on) transitions interpolated. That split is what decision ZAB-33 §4 bought —
// interpolate declared INPUTS and then lay out once, rather than interpolating
// computed rects — and it is why one frame is one measure and one arrange, with
// no feedback loop between them.
//
// Allocation: the per-pass scratch (which children flow, how wide each item is,
// where the lines break) lives ON the node and is only ever cleared, so a
// steady-state relayout of an unchanged tree allocates nothing.

#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "bindings.h"
#include "color.h"
#include "data.h"
#include "envelope.h"
#include "repeat.h"
#include "states.h"
#include "text.h"
#include "textinput.h"
#include "transition.h"

namespace zabloo {

struct Rect {
  double x = 0.0;
  double y = 0.0;
  double width = 0.0;
  double height = 0.0;

  bool contains(double px, double py) const {
    return px >= x && px <= x + width && py >= y && py <= y + height;
  }
};

struct Size {
  double x = 0.0;
  double y = 0.0;
};

/**
 * This frame's animatable values, tokens resolved and states merged.
 *
 * The optionals are not tidiness: "absent" is a value the pass acts on. An
 * absent `width` is AUTO — the measured size stands — while an absent color
 * means nothing is painted, which is a different thing from painting black.
 */
struct ResolvedValues {
  std::optional<Color> background;
  std::optional<Color> border_color;
  std::optional<Color> color;
  /** The renderer has defaults for these, so they always resolve to a number. */
  double opacity = 1.0;
  double radius = 0.0;
  double border_width = 0.0;
  double gap = 0.0;
  double padding = 0.0;
  std::optional<double> width;
  std::optional<double> height;
};

/**
 * The runtime of one `TextInput` (ZAB-26): its buffer, its caret and the
 * horizontal scroll of its own content.
 *
 * None of it is authored. `value` seeds the buffer and the game can write it
 * again, but where the caret is, what is selected and how far the content has
 * slid are the field's, exactly as the offset is the `ScrollView`'s — which is
 * also why none of them is in the IR.
 */
struct FieldState {
  /** What the field holds right now, in UTF-8 — what the snapshot records. */
  std::string text;
  /**
   * `text` decoded, split once per edit.
   *
   * The caret, the highlight and the field's own scroll each want the same
   * split several times a frame, and decoding the buffer for every one of them
   * was six or eight vectors a frame for a string nobody had touched (ZAB-73).
   * It is a function of the buffer, so it dies with it.
   */
  std::vector<char32_t> chars;
  Selection selection;
  double scroll = 0.0;
  /** When the last edit landed: the blink is a closed form of the time since. */
  double caret_since = 0.0;

  /**
   * An IME composition in flight, and what the field held before it started.
   *
   * The web renderer gets this for free — a hidden `<textarea>` holds the whole
   * value and hands it back complete on every update. Here the platform reports
   * only the composing string, so each update has to replace the previous one:
   * the base is what makes that a replacement rather than an append.
   */
  bool composing = false;
  std::string composing_base;
  Selection composing_selection;
};

struct LayoutNode;

/**
 * A node's children, owned, with STABLE addresses.
 *
 * Nodes are held behind pointers rather than stored by value, and that is not a
 * style choice: the view keeps raw pointers into this tree everywhere it has
 * state to remember — the focus, the pressed and hovered nodes, the id index,
 * the bound list, the fields, the overlays, the modal stack, a drag in flight.
 * Until G12 that was safe by accident, because the tree was built once at load
 * and never restructured. A `Repeat` restructures it every frame: reordering,
 * inserting and dropping instances as the data and the window move. With nodes
 * stored by value each of those moves would leave every one of those pointers
 * dangling, so address stability is what this type exists to guarantee.
 *
 * It reads like a vector of nodes on purpose — `for (LayoutNode &child :
 * node.children)` and `node.children[0].children[1]` both mean what they say —
 * so the indirection is spelled once here instead of at every walk in the core.
 */
class NodeList {
 public:
  /** Iterates as `LayoutNode&`: the pointers are this type's business, not the caller's. */
  template <typename Slot, typename Ref>
  class Iterator {
   public:
    explicit Iterator(Slot *slot) : slot_(slot) {}

    Ref &operator*() const { return **slot_; }
    Iterator &operator++() {
      slot_++;
      return *this;
    }
    bool operator!=(const Iterator &other) const { return slot_ != other.slot_; }

   private:
    Slot *slot_;
  };

  using Slot = std::unique_ptr<LayoutNode>;
  using iterator = Iterator<Slot, LayoutNode>;
  using const_iterator = Iterator<const Slot, const LayoutNode>;

  LayoutNode &operator[](size_t index) { return *items_[index]; }
  const LayoutNode &operator[](size_t index) const { return *items_[index]; }
  LayoutNode &back() { return *items_.back(); }
  const LayoutNode &back() const { return *items_.back(); }
  size_t size() const { return items_.size(); }
  bool empty() const { return items_.empty(); }

  iterator begin() { return iterator(items_.data()); }
  iterator end() { return iterator(items_.data() + items_.size()); }
  const_iterator begin() const { return const_iterator(items_.data()); }
  const_iterator end() const { return const_iterator(items_.data() + items_.size()); }

  /** A fresh child at the end — the shape every static build site uses. */
  LayoutNode &emplace_back();
  /** Adopts a node built elsewhere: how a `Repeat` puts an instance back in place. */
  void push_back(Slot node) { items_.push_back(std::move(node)); }
  /** Empties the list into `out`, keeping order: a reorder is that plus `push_back`. */
  void take_all(std::vector<Slot> &out) {
    out.clear();
    out.swap(items_);
  }
  void clear() { items_.clear(); }
  /** The position of a child, or `size()` when it is not one — document order. */
  size_t index_of(const LayoutNode &child) const;

 private:
  std::vector<Slot> items_;
};

/** One live instance of a template, and the child slot that owns it. */
struct RepeatInstance {
  LayoutNode *node = nullptr;
  /**
   * Where it sat in the node's children when the last expansion left it there.
   *
   * Kept with the pointer rather than searched for: reconciliation hands back an
   * instance and the expansion then has to take its OWNING slot out of the list,
   * and on a list realized whole that lookup would be a scan per row per frame.
   */
  uint32_t slot = 0;
};

/**
 * A `Repeat`'s runtime state (ZAB-31) — the instances it has realized, keyed by
 * the identity of the item they show, plus the uniform size the virtualization
 * assumes. Owned by the view; the layout pass only ever reads `virtual_span`.
 */
struct RepeatState {
  /** Live template instances, by `item_identity` — this is what reordering moves. */
  std::unordered_map<std::string, RepeatInstance> instances;
  /** The empty-state slot (`children[1..]`), built once and kept out of layout. */
  std::vector<LayoutNode *> empty;
  /** One line's measured size on the stacking axis, until a frame measures one. */
  std::optional<double> extent;
  /** One item's measured size on the main axis — what decides how many fit per line. */
  std::optional<double> item_main;
  /** The width those two were measured at: another one means they are stale. */
  std::optional<double> measured_width;
  /** Elements in the bound array on the last expansion. */
  int item_count = 0;
  /** The window that expansion realized — what the next frame's plan is compared against. */
  int first = 0;
  int count = 0;

  /**
   * Per-expansion scratch, cleared and refilled so a steady frame allocates
   * nothing. `taken` holds the children while they are being reordered and is
   * empty everywhere outside `expand`.
   */
  std::vector<std::unique_ptr<LayoutNode>> taken;
  std::vector<ItemSlot> slots;
  std::vector<WindowEntry<RepeatInstance>> entries;
  std::vector<RepeatInstance> dropped;
  std::unordered_map<std::string, RepeatInstance> next;
};

/** One or two children sharing a box — see `flow_items`. */
struct FlowItem {
  uint32_t first = 0;
  uint32_t count = 0;
};

/**
 * The runtime tree: one node per IR node, carrying the state the IR does not.
 *
 * The IR is immutable content; this is where "is it pressed", "where did it land"
 * and "what did it resolve to" live. Keeping them apart is what lets the same
 * envelope be rendered twice, and what makes a hot-update a swap of one and not
 * of both.
 */
struct LayoutNode {
  const Node *ir = nullptr;
  LayoutNode *parent = nullptr;
  NodeList children;

  // --- geometry ---
  /** What the content asked for, before a declared width/height replaced it. */
  Size natural;
  Size measured;
  Rect rect;

  // --- text (a `Text` node only) ---
  /**
   * This frame's lines, and where they landed. Broken once by the measure pass
   * and placed once after the arrange, so paint and the snapshot read the very
   * same lines: a baseline recorded in a golden file has to be the baseline the
   * tessellator actually used, not a second computation of it that could drift.
   */
  TextBlock text_block;
  bool has_text_block = false;
  std::vector<PlacedLine> text_lines;
  /** The atlas's own metrics, kept so placement needs no font at all. */
  double text_ascent = 0.0;
  double text_font_line_height = 0.0;
  /**
   * What produced `text_block` — content, atlas identity and options. A frame
   * that changed none of them reuses the block instead of breaking the text
   * again, which is most frames for the static labels a UI is mostly made of
   * (ZAB-69).
   */
  std::string text_content;
  const void *text_metrics = nullptr;
  TextLayoutOptions text_options;

  // --- runtime state owned by the core, keyed by component identity ---
  bool pressed = false;
  bool hovered = false;
  bool focused = false;
  /** A Collapse's open/closed state. The IR's `open` is only the INITIAL one. */
  bool open = true;
  /**
   * A `ScrollView`'s runtime offset, and what it is clamped to. Neither is ever
   * authored — the offset has no prop (2026-08-11, ZAB-9) — and both are
   * recomputed by the arrange pass, so a relayout can never leave the content
   * scrolled past its own end.
   */
  Size scroll_offset;
  Size scroll_max;
  /** The chosen tab of an `"exclusive-select"` group. */
  int selected_index = 0;
  /** This button IS the chosen tab of its group. */
  bool selected = false;
  /** A Toggle's own value; inside an `"exclusive-check"` group, the group's. */
  bool checked = false;
  /**
   * The crossfade between the two indicator slots (0 = unchecked, 1 = checked).
   * Only ever 0 or 1 until G8 (ZAB-141) tweens it, which is the pre-F7 look: one
   * indicator, fully opaque.
   */
  double checked_progress = 0.0;
  /**
   * A Slider's runtime value, already clamped and quantized to its range — the
   * one the game hears about and the one an arrow key steps.
   */
  double slider_value = 0.0;
  /**
   * The value this frame PAINTS, which trails `slider_value` while a change the
   * GAME made glides in (G8's engine) and equals it exactly while the player has
   * the thumb: a thumb lagging the finger reads as a broken control, not as juice.
   */
  double slider_display = 0.0;
  /**
   * A `TextInput`'s buffer, caret and scroll, or null for every other node —
   * allocated on the first pass that sees one, like `anim`, so the common node
   * pays a pointer and nothing more.
   */
  std::unique_ptr<FieldState> field;
  /**
   * The selected value of an `"exclusive-check"` group. Options derive their
   * `checked` from it and never store one of their own — the selection is ONE
   * value, which is the semantics of a radio (2026-08-11, ZAB-23).
   */
  DataValue group_value;
  /**
   * A `Repeat`'s instances and the geometry they are windowed by, or null on
   * every other node — a pointer, like `field` and `anim`.
   */
  std::unique_ptr<RepeatState> repeat;
  /**
   * `Repeat` only: the realized window and the space that stands in for the rest.
   * Absent when the node is not virtualized (no scroller to window against, or an
   * array short enough to realize whole), and then it lays out like any container.
   */
  std::optional<ItemSpan> virtual_span;
  /**
   * The innermost item scope this node was instantiated under, or null outside
   * every template. The link is owned by the instance root it was opened for and
   * SHARED by its whole subtree, so pointing a row at another element is one
   * mutation however deep the tree under it goes.
   */
  const ItemScope *scopes = nullptr;
  /**
   * The scope this node opened, on the root of a `Repeat` instance only — what
   * every node under it points at. Owned here so it dies exactly when its row
   * does, and stable in memory because a nested chain links to it.
   */
  std::unique_ptr<ItemScope> scope_link;
  /** The static or bound `visible`, and the section flag a Collapse/Tabs owns. */
  bool visible_flag = true;
  bool section_shown = true;
  /**
   * Whether a binding drives this node's STATE — the same predicate the view's
   * bound registry is built from, kept on the node so an instance being recycled
   * can ask one node about itself without searching that list (ZAB-66).
   */
  bool data_bound = false;
  /** Declared on this node; `disabled` is that OR an ancestor's (ZAB-63). */
  bool disabled_flag = false;
  bool disabled = false;

  ResolvedValues resolved;
  /**
   * This frame's merged style, stamped with the view's frame counter. Resolve,
   * measure and paint all ask for it, and the merge is not free (ZAB-73).
   */
  int64_t style_frame = -1;
  Style style_cache;

  // --- motion (2026-08-11, ZAB-33) ---
  /**
   * The tweens in flight, or null for a node that cannot animate — which is most
   * of a UI. Allocated by the resolve pass the first time a node needs one, so the
   * common node pays a pointer and nothing more (`transition.h`).
   */
  std::unique_ptr<NodeAnim> anim;
  /**
   * A `ProgressBar`'s fraction this frame. The VALUE is what tweens, never the
   * fill's rect: the arrange derives one from the other, so there is still one
   * layout pass per frame and the rect never feeds back into its own input.
   */
  double progress = 0.0;
  /**
   * A `Collapse` whose own height is mid-tween, and the one frame it spends
   * learning what its open height is (`collapse.h`). While either is set the node
   * overrides its measured height and clips.
   */
  bool collapse_animating = false;
  bool collapse_pending = false;
  /**
   * Clipped for the duration of a motion, whatever the author asked for: a box
   * animating smaller than its own content has to cut it. Written here and
   * consumed by the clip pass of G6 (ZAB-139).
   */
  bool forced_clip = false;
  /**
   * When this node's loop started (a `Spinner`'s wave). Absent means it has not
   * begun; leaving layout clears it, so coming back starts the wave over rather
   * than resuming a cycle nobody saw.
   */
  std::optional<double> loop_started_at;

  // --- the overlay layer (2026-08-11, ZAB-19), on an `Overlay` only ---
  /**
   * How far this Overlay has entered the layer, 0 (gone) to 1 (fully up), and the
   * tween that moves it.
   *
   * The tween is deliberately NOT in `anim`: the resolve pass drops that one
   * whenever a node leaves layout, and an exit whose starting point is erased by
   * the exit itself would never animate. It is what lets a closing modal outlive
   * the `visible` that closed it by exactly one transition — and what comes out
   * of it is pixels and nothing else, because input, focus and the auto-close
   * timers all read the LIVE layer, which the overlay has already left.
   */
  double presence = 1.0;
  std::unique_ptr<NodeAnim> presence_anim;
  /** Out of the live layer but still fading: it paints, and nothing else. */
  bool presence_exiting = false;
  /**
   * A popover's open state — the one piece of overlay state that is not
   * `visible`, because "open" is runtime state and not the game's data
   * (2026-08-12, ZAB-25). Only an `anchor.trigger: "press"` overlay reads it.
   */
  bool popover_open = false;
  /**
   * When this overlay's `autoCloseMs` expires, in the view's injected clock.
   * Absent means nothing is armed: it is set on entering the layer and cleared on
   * leaving it, so a toast that closes early never fires late.
   */
  std::optional<double> auto_close_at;

  // --- per-pass scratch, cleared and refilled rather than reallocated ---
  std::vector<FlowItem> items;
  std::vector<double> item_mains;
  std::vector<double> item_crosses;
  /** Index into `items` where each line starts; lines partition the sequence. */
  std::vector<uint32_t> line_starts;

  NodeType type() const { return ir->type; }
};

/** Sizes a childless node against the width it may use. */
class LeafMeasurer {
 public:
  virtual ~LeafMeasurer() = default;
  /** `available` absent means unconstrained — what tells a `Text` not to wrap. */
  virtual Size measure_leaf(LayoutNode &node, std::optional<double> available) = 0;
};

/** Builds the runtime tree for one view. Parents are linked once it is whole. */
void build_layout_tree(const Node &ir, LayoutNode &out);

/** In layout at all: `visible` and the section flags, the one display:none path. */
bool in_layout(const LayoutNode &node);

/**
 * Whether a node breaks its children into several lines (2026-08-11, ZAB-32 — a
 * grid IS a row that wraps). `wrap` only takes effect on a ROW.
 *
 * Exported because the window a virtualized `Repeat` plans has to agree with it:
 * a wrapping node stacks its LINES on the cross axis, so which axis is scrolled
 * and what a line even is both hang off this answer.
 */
bool wraps_lines(const LayoutNode &node);

/**
 * Whether a node takes part in its parent's flow. An `Overlay` never does
 * (2026-08-11): it is declared in place but belongs to the view's layer, so the
 * view arranges it afterwards against the view rect. Two consequences come free:
 * `layout.width`/`height` on an Overlay are ignored, and an Overlay inside a
 * `ScrollView` does not scroll with the content.
 */
bool in_flow(const LayoutNode &node);

/** Bottom-up measure. `available` is the width the parent offers. */
Size measure(LayoutNode &node, LeafMeasurer &leaf, std::optional<double> available);

/** Top-down arrange into `rect`, in view space. */
void arrange(LayoutNode &node, const Rect &rect);

}  // namespace zabloo
