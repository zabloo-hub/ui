#include "layout.h"

#include "scroll.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>

#include "progress.h"
#include "slider.h"

namespace zabloo {
namespace {

void link_parents(LayoutNode &node) {
  for (LayoutNode &child : node.children) {
    child.parent = &node;
    link_parents(child);
  }
}

bool is_row(const LayoutNode &node) { return node.ir->layout.direction == Direction::Row; }

/**
 * Whether a node breaks its children into several lines (2026-08-11, ZAB-32 — a
 * grid IS a row that wraps). `wrap` only takes effect on a ROW: the measure pass
 * carries a width offer and nothing else, so a column has no length to break
 * against and lays its children on one line — the same degradation an SDK that
 * predates the flag gives.
 */
bool wraps_lines(const LayoutNode &node) {
  return node.ir->layout.wrap && is_row(node);
}

/**
 * The width a node's children may use. A `ScrollView` offers nothing on a
 * scrollable axis: its children are measured unconstrained there, which is what
 * makes the content overflow the viewport, so a horizontal scroller never wraps
 * its text.
 */
std::optional<double> child_width(const LayoutNode &node, std::optional<double> inner) {
  if (node.ir->type != NodeType::ScrollView) return inner;
  return node.ir->scroll_axis == ScrollAxis::Vertical ? inner : std::nullopt;
}

/**
 * The boxes a node lays its children into: one per in-flow child, EXCEPT a
 * Toggle's two indicator slots, which share one (2026-08-11, ZAB-36).
 *
 * They are alternatives of the same thing — the checked and unchecked look of
 * one indicator — so laying them on top of each other rather than one after the
 * other is what turns the swap into a crossfade the transition engine can drive.
 * The shared box is as big as the larger slot, so the control does not resize
 * when it flips, and everything after them (the label) flows on as usual.
 */
void fill_flow_items(LayoutNode &node) {
  node.items.clear();
  for (uint32_t i = 0; i < node.children.size(); i++) {
    if (!in_flow(node.children[i])) continue;  // display:none, or lifted to the layer
    if (node.ir->type == NodeType::Toggle && i == 1 && !node.items.empty() &&
        node.items.back().first == 0) {
      node.items.back().count++;
      continue;
    }
    node.items.push_back(FlowItem{i, 1});
  }
}

/**
 * Groups items into the lines they lay out on, greedy first-fit. Lines partition
 * the item sequence in order, so where each starts is the whole answer.
 *
 * Without `wrap` there is a single line: what every node emitted before ZAB-32
 * assumes, and the reason nothing else in the pass had to change.
 */
void break_lines(LayoutNode &node, std::optional<double> content_main, double gap) {
  node.line_starts.clear();
  if (node.items.empty()) return;
  if (!wraps_lines(node) || !content_main.has_value()) {
    node.line_starts.push_back(0);
    return;
  }
  node.line_starts.push_back(0);
  double used = 0.0;
  uint32_t in_line = 0;
  for (uint32_t index = 0; index < node.items.size(); index++) {
    const double main = node.item_mains[index];
    const double needed = in_line == 0 ? main : used + gap + main;
    if (in_line > 0 && needed > *content_main) {
      node.line_starts.push_back(index);
      in_line = 0;
    }
    used = in_line == 0 ? main : used + gap + main;
    in_line++;
  }
}

uint32_t line_end(const LayoutNode &node, size_t line) {
  return line + 1 < node.line_starts.size() ? node.line_starts[line + 1]
                                            : static_cast<uint32_t>(node.items.size());
}

/**
 * The size the children take as a whole: the longest line on the main axis, the
 * lines stacked on the cross one.
 */
Size flow_size(const LayoutNode &node, double gap) {
  double main = 0.0;
  double cross = 0.0;
  for (size_t line = 0; line < node.line_starts.size(); line++) {
    const uint32_t begin = node.line_starts[line];
    const uint32_t end = line_end(node, line);
    double line_main = gap * static_cast<double>(end - begin - 1);
    double line_cross = 0.0;
    for (uint32_t i = begin; i < end; i++) {
      line_main += node.item_mains[i];
      line_cross = std::max(line_cross, node.item_crosses[i]);
    }
    main = std::max(main, line_main);
    cross += line_cross;
  }
  cross += gap * static_cast<double>(std::max<size_t>(node.line_starts.size(), 1) - 1);
  return Size{main, cross};
}

/**
 * A slot's size across the rail — its own if it has one, else the full rail.
 *
 * Read from `resolved`, like the whole pass: the declared value is an input the
 * resolve pass has already collapsed, so a token that does not resolve is auto
 * (full rail) instead of "declared", and a height mid-tween moves the slot.
 */
double cross_of(const LayoutNode &node, bool horizontal, double fallback) {
  const std::optional<double> &resolved = horizontal ? node.resolved.height : node.resolved.width;
  if (!resolved.has_value()) return fallback;
  return horizontal ? node.measured.y : node.measured.x;
}

/**
 * The Slider's own arrange (2026-08-11, ZAB-24): the node IS the track, and its
 * two positional slots are placed from the VALUE instead of by the flex pass —
 * `children[0]` (the fill) spans the value's fraction of the rail and
 * `children[1]` (the thumb) rides the travel, inset by half its own size so it
 * never paints outside the node's rect.
 *
 * Both slots keep their measured size across the track (a thin rail with a fat
 * thumb is the normal case) and are centered on it; `padding` insets the rail,
 * like it does everywhere else. A vertical slider runs bottom-to-top.
 */
void arrange_slider(LayoutNode &node, const Rect &rect) {
  const double padding = node.resolved.padding;
  const bool horizontal = !grows_upward(node.ir->slider_axis);
  const Rect content{rect.x + padding, rect.y + padding, std::max(0.0, rect.width - padding * 2),
                     std::max(0.0, rect.height - padding * 2)};
  const double length = horizontal ? content.width : content.height;
  const double across = horizontal ? content.height : content.width;

  // The PAINTED value, which trails the logical one while a bound change glides
  // in — the same rule as the ProgressBar: the value is tweened, never the rect.
  const double fraction =
      fraction_of(node.slider_display, resolve_range(node.ir->min, node.ir->max, node.ir->step));

  LayoutNode *fill = !node.children.empty() ? &node.children[0] : nullptr;
  LayoutNode *thumb = node.children.size() > 1 ? &node.children[1] : nullptr;
  // A thumb out of flow was not measured this frame, so it has no size to read:
  // the travel is the whole rail, exactly as it is on a slider with no thumb.
  const double thumb_size =
      thumb != nullptr && in_flow(*thumb)
          ? std::min(horizontal ? thumb->measured.x : thumb->measured.y, length)
          : 0.0;
  const SliderGeometry geometry = slider_geometry(fraction, length, thumb_size);

  // `start` runs along the axis from the rail's beginning; on a vertical track
  // that beginning is the BOTTOM, so it is mirrored into view space.
  const auto place = [&](LayoutNode &child, double start, double size) {
    // Centered across the rail, at its OWN size: the usual slider is a fat thumb
    // on a thin rail, so the thumb overflows its parent on the cross axis — which
    // is ordinary here (a `clip` is the only thing that cuts paint or input, ZAB-7).
    const double cross_size = cross_of(child, horizontal, across);
    const double cross_pos = (horizontal ? content.y : content.x) + (across - cross_size) * 0.5;
    const Rect box = horizontal
                         ? Rect{content.x + start, cross_pos, size, cross_size}
                         : Rect{cross_pos, content.y + length - start - size, cross_size, size};
    arrange(child, box);
  };

  if (fill != nullptr && in_flow(*fill)) place(*fill, 0.0, geometry.fill_length);
  if (thumb != nullptr && in_flow(*thumb)) place(*thumb, geometry.thumb_start, thumb_size);
  // Extra children are not part of the contract: they would have no defined
  // position, so they are left where they are (measured, never arranged).
}

}  // namespace

void build_layout_tree(const Node &ir, LayoutNode &out) {
  out.ir = &ir;
  out.children.clear();
  // Reserved exactly, so pushing a child never moves the ones already there.
  out.children.reserve(ir.children.size());
  for (const Node &child : ir.children) {
    // A statically hidden subtree is not built at all. `visible: false` has
    // display:none semantics and nothing can turn it back on, so it has no
    // runtime worth keeping — and the snapshot of a view that declares one shows
    // no node, which is what the reference records. A BOUND `visible` builds
    // normally: the data may well say yes.
    if (child.visible.kind == Bindable<bool>::Kind::Value && !child.visible.value) continue;
    out.children.emplace_back();
    build_layout_tree(child, out.children.back());
  }
  // Parents are linked only once the whole tree is built: a node moves while its
  // siblings are being appended, so a pointer taken during the walk would name
  // where a node USED to be.
  if (out.parent == nullptr) link_parents(out);
}

bool in_layout(const LayoutNode &node) { return node.visible_flag && node.section_shown; }

bool in_flow(const LayoutNode &node) {
  return in_layout(node) && node.ir->type != NodeType::Overlay;
}

/**
 * `available` is the width the parent offers (the view's own at the root, absent
 * for unconstrained): a node's `layout.width`, when declared, REPLACES the offer,
 * and what is left after its padding flows down to every child — in a row as much
 * as in a column, since v1 measures no cross-child competition for it. Only the
 * leaves use it: it is the width a `Text` wraps to (2026-08-11, ZAB-17).
 */
Size measure(LayoutNode &node, LeafMeasurer &leaf, std::optional<double> available) {
  const double padding = node.resolved.padding;
  const std::optional<double> own = node.resolved.width.has_value() ? node.resolved.width : available;
  const std::optional<double> inner =
      own.has_value() ? std::optional<double>(std::max(0.0, *own - padding * 2)) : std::nullopt;

  Size size;
  if (node.ir->type == NodeType::Slider) {
    // A Slider measures as a LEAF: the rail's length and thickness are its own
    // layout props, never the sum of its slots (an 18px thumb must not define a
    // 220px track). The slots are still measured — the thumb's own size is what
    // the value-driven arrange positions — they just do not add up.
    //
    // In flow only, like every other branch: the resolve pass returns early for a
    // node out of layout, so its `resolved` is whatever the last frame that
    // painted it left there, and measuring with those is measuring the past.
    for (LayoutNode &child : node.children) {
      if (in_flow(child)) measure(child, leaf, inner);
    }
    size = Size{padding * 2, padding * 2};
  } else if (node.children.empty()) {
    const Size measured = leaf.measure_leaf(node, inner);
    size = Size{measured.x + padding * 2, measured.y + padding * 2};
  } else {
    const bool row = is_row(node);
    const double gap = node.resolved.gap;
    const std::optional<double> offer = child_width(node, inner);

    fill_flow_items(node);
    node.item_mains.clear();
    node.item_crosses.clear();
    for (const FlowItem &item : node.items) {
      // Every member of a shared box is measured; the box takes the largest.
      double main = 0.0;
      double cross = 0.0;
      for (uint32_t i = 0; i < item.count; i++) {
        const Size child = measure(node.children[item.first + i], leaf, offer);
        main = std::max(main, row ? child.x : child.y);
        cross = std::max(cross, row ? child.y : child.x);
      }
      node.item_mains.push_back(main);
      node.item_crosses.push_back(cross);
    }
    break_lines(node, inner, gap);
    const Size flow = flow_size(node, gap);
    size = row ? Size{flow.x + padding * 2, flow.y + padding * 2}
               : Size{flow.y + padding * 2, flow.x + padding * 2};
  }

  // What the content asks for, kept before any override replaces it: the
  // Collapse's motion (G8) needs "how tall is this with the content in".
  node.natural = size;
  // Absent = auto: the measured size stands, which is also what a token that
  // does not resolve gives.
  if (node.resolved.width.has_value()) size.x = *node.resolved.width;
  if (node.resolved.height.has_value()) size.y = *node.resolved.height;
  node.measured = size;
  return size;
}

void arrange(LayoutNode &node, const Rect &rect) {
  node.rect = rect;
  // The Slider places its slots from its VALUE and not by the flex pass, so it
  // never reaches the distribution below.
  if (node.ir->type == NodeType::Slider) {
    arrange_slider(node, rect);
    return;
  }
  fill_flow_items(node);
  if (node.items.empty()) {
    // Nothing in flow, nothing to scroll to. The extent has to fall back to zero
    // HERE, or a scroller whose children all went `visible: false` would keep the
    // reach the last populated frame computed and scroll into nothing.
    if (node.ir->type == NodeType::ScrollView) {
      node.scroll_max = Size{};
      node.scroll_offset = Size{};
    }
    return;
  }

  const Layout &layout = node.ir->layout;
  const bool row = is_row(node);
  const double padding = node.resolved.padding;
  const double gap = node.resolved.gap;
  const Rect content{rect.x + padding, rect.y + padding, std::max(0.0, rect.width - padding * 2),
                     std::max(0.0, rect.height - padding * 2)};

  // The ProgressBar owns its child's main size (the fraction), so it never goes
  // through the flex distribution: the fill's own width/height/grow are ignored on
  // that axis by construction, and `justify` still anchors the bar (2026-08-11,
  // ZAB-35). Children past the fill are out of layout already.
  if (node.ir->type == NodeType::ProgressBar) {
    LayoutNode &fill = node.children[node.items[0].first];
    arrange(fill, fill_rect(content, row, node.progress, layout.justify));
    return;
  }

  const double content_main = row ? content.width : content.height;
  const double content_cross = row ? content.height : content.width;

  // Sizes per ITEM: a shared box takes the largest of the nodes in it.
  node.item_mains.clear();
  node.item_crosses.clear();
  for (const FlowItem &item : node.items) {
    double main = 0.0;
    double cross = 0.0;
    for (uint32_t i = 0; i < item.count; i++) {
      const LayoutNode &child = node.children[item.first + i];
      main = std::max(main, row ? child.measured.x : child.measured.y);
      cross = std::max(cross, row ? child.measured.y : child.measured.x);
    }
    node.item_mains.push_back(main);
    node.item_crosses.push_back(cross);
  }
  break_lines(node, content_main, gap);

  // The scrollable reach, recomputed from the boxes this pass just sized, and the
  // offset re-clamped against it: content that shrank can never leave the view
  // scrolled past its own end (2026-08-11, ZAB-5).
  const bool scroller = node.ir->type == NodeType::ScrollView;
  if (scroller) {
    // `flow_size` answers in main/cross, whatever the direction is — the same
    // pair `resolve_scroll_max` maps back onto physical x and y.
    const Size flow = flow_size(node, gap);
    node.scroll_max = resolve_scroll_max(layout.direction, node.ir->scroll_axis,
                                         flow.x - content_main, flow.y - content_cross);
    node.scroll_offset = Size{clamp_scroll(node.scroll_offset.x, 0.0, node.scroll_max.x),
                              clamp_scroll(node.scroll_offset.y, 0.0, node.scroll_max.y)};
  }

  const bool wrapping = wraps_lines(node);
  // Where the next line starts on the cross axis — the one value that genuinely
  // carries from one line to the next.
  double stack_cross = row ? content.y : content.x;
  const double main_lead = row ? content.x : content.y;

  for (size_t line = 0; line < node.line_starts.size(); line++) {
    const uint32_t begin = node.line_starts[line];
    const uint32_t end = line_end(node, line);
    const uint32_t count = end - begin;

    // Main sizes: measured + the grow share of what is left ON THIS LINE (`grow`
    // is per line), and a shared box grows by its FIRST member's `grow` — the
    // slots of a Toggle are one item, so they can only ever grow as one.
    double total_main = gap * static_cast<double>(count - 1);
    double total_grow = 0.0;
    for (uint32_t i = begin; i < end; i++) {
      total_main += node.item_mains[i];
      total_grow += node.children[node.items[i].first].ir->layout.grow.value_or(0.0);
    }

    const double slack = content_main - total_main;
    const bool growing = slack > 0.0 && total_grow > 0.0;
    const double remaining = growing ? 0.0 : slack;

    // Justify: distribute leftover main-axis space, within the line.
    const double leftover = std::max(0.0, remaining);
    const double lead = layout.justify == Justify::Center    ? leftover * 0.5
                        : layout.justify == Justify::End     ? leftover
                                                             : 0.0;
    const double between = layout.justify == Justify::SpaceBetween && count > 1
                               ? gap + leftover / static_cast<double>(count - 1)
                               : gap;

    // A single line owns the whole cross axis (`align: stretch` fills the node);
    // wrapped lines own only what their tallest item takes, and stack from the
    // start — how the lines themselves distribute is out of the subset (ZAB-32).
    double line_cross = content_cross;
    if (wrapping) {
      line_cross = 0.0;
      for (uint32_t i = begin; i < end; i++) line_cross = std::max(line_cross, node.item_crosses[i]);
    }

    double pen_main = main_lead + lead;
    for (uint32_t i = begin; i < end; i++) {
      const double measured_cross = node.item_crosses[i];
      const bool stretched = layout.align == Align::Stretch;
      const double cross_size = stretched ? line_cross : measured_cross;
      const double cross_offset = layout.align == Align::Center
                                      ? (line_cross - measured_cross) * 0.5
                                  : layout.align == Align::End ? line_cross - measured_cross
                                                               : 0.0;
      const double cross_pos = stack_cross + cross_offset;
      const double main_size =
          growing ? node.item_mains[i] + slack * (node.children[node.items[i].first]
                                                      .ir->layout.grow.value_or(0.0) /
                                                  total_grow)
                  : node.item_mains[i];

      Rect child_rect = row ? Rect{pen_main, cross_pos, main_size, cross_size}
                            : Rect{cross_pos, pen_main, cross_size, main_size};
      if (scroller) {
        child_rect.x -= node.scroll_offset.x;
        child_rect.y -= node.scroll_offset.y;
      }
      // Every member of the item gets the SAME rect: that is what a shared box is.
      const FlowItem &item = node.items[i];
      for (uint32_t member = 0; member < item.count; member++) {
        arrange(node.children[item.first + member], child_rect);
      }
      pen_main += main_size + between;
    }
    stack_cross += line_cross + gap;
  }
}

}  // namespace zabloo
