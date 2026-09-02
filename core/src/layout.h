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
#include <vector>

#include "bindings.h"
#include "color.h"
#include "data.h"
#include "envelope.h"
#include "states.h"
#include "text.h"
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
  std::vector<LayoutNode> children;

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
   * The selected value of an `"exclusive-check"` group. Options derive their
   * `checked` from it and never store one of their own — the selection is ONE
   * value, which is the semantics of a radio (2026-08-11, ZAB-23).
   */
  DataValue group_value;
  /**
   * The item scopes this node was instantiated under, or null outside every
   * template — shared and never written to, so the common case costs a pointer.
   * G12 (ZAB-145) is what opens one.
   */
  const std::vector<ItemScope> *scopes = nullptr;
  /** The static or bound `visible`, and the section flag a Collapse/Tabs owns. */
  bool visible_flag = true;
  bool section_shown = true;
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
