// Pure `Repeat` semantics (ZAB-29) — the slots, the identity of each instance
// and the virtualization geometry.
//
// A port of `renderer-web/src/repeat.ts`, kept apart from the view for the same
// reason it is there: these are the rules every target has to agree on, and they
// are testable without a tree, a font or a motor.
//
// **Virtualization is a renderer concern, not an IR one** (spec 2026-08-11): the
// format carries no size hints, so the window is derived from ONE assumption —
// every instance of a template is the same size along the axis it stacks on.
// That is what turns "hundreds of items" into a constant amount of work: the node
// reserves the space of the whole array, instantiates the lines the viewport can
// see (plus a buffer) and offsets them by the space it skipped, so the scroll
// bounds and the scrollbar stay exact while only the visible rows exist.
//
// A wrapping `Repeat` (the `<Grid>` of ZAB-32) stacks its LINES on the cross
// axis, so the same math applies one level up: `per_line` items per line, and a
// line is what the window counts.

#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

#include "bindings.h"
#include "data.h"
#include "envelope.h"

namespace zabloo {

/** Lines kept realized beyond each edge of the viewport, so a scroll never shows a hole. */
inline constexpr int BUFFER_LINES = 2;

/** How many items are realized before the first layout has measured anything. */
inline constexpr int INITIAL_WINDOW = 24;

/** One realized position: the element it shows and the identity its state is keyed by. */
struct ItemSlot {
  int index = 0;
  std::string identity;
};

/** The uniform geometry a virtualized `Repeat` assumes, along the axis its lines stack on. */
struct ItemMetrics {
  /** One line's size on the stacking axis (an item's own size when nothing wraps). */
  double extent = 0.0;
  /** The node's `gap`, which separates lines as much as items. */
  double gap = 0.0;
  /** Items per line. 1 unless the node wraps. */
  int per_line = 1;
};

/** The realized window plus the space reserved around it — layout's whole share of it. */
struct ItemSpan {
  /** First realized item. */
  int first = 0;
  /** How many items are realized. */
  int count = 0;
  /** Space skipped before the first realized line: what puts it at its real position. */
  double lead = 0.0;
  /** Size of every line, realized or not — what the node measures on the stacking axis. */
  double reserved = 0.0;
  /** Items per line, so layout breaks exactly where the window assumed it would. */
  int per_line = 1;
};

/** `children[0]` is the item template — the node instantiated once per element. */
const Node *item_template(const Node &ir);

/**
 * The elements to repeat. Anything that is not an array — missing data, a value
 * of the wrong shape — is the empty case, which is exactly when the empty-state
 * slot enters layout (decision 2026-08-11, ZAB-29).
 */
const DataValue *items_of(const DataValue *value);

/**
 * The identities of a window of items, appended to `out`. Reconciliation is keyed
 * by these: reusing an instance is what carries its state (focus, `checked`, an
 * inner scroll offset, a transition in flight) across a `SetData` that reorders
 * the array.
 *
 * Two elements resolving the SAME key is a data error, and it cannot be honored:
 * one identity is one instance. The duplicate falls back to its POSITIONAL
 * identity — disjoint from the keyed space by construction (`item_identity`), so
 * the list still reconciles deterministically instead of rebuilding a row per
 * frame; it is only that row that stops travelling with its data.
 */
void window_slots(const DataValue *items, std::string_view key_path, int first, int count,
                  std::vector<ItemSlot> &out);

/** One window position matched against the previous frame, by identity. */
template <typename T>
struct WindowEntry {
  ItemSlot slot;
  /** The instance to reuse, or null to build one. */
  const T *instance = nullptr;
};

/**
 * Matches a window against the instances of the previous frame, by identity.
 * `entries` comes out in window order; `dropped` holds what left the window (or
 * the array) — theirs is the state that dies.
 *
 * Templated on the instance type so this file needs to know nothing about the
 * runtime tree: the view instantiates it with its own handle, the tests with a
 * string.
 */
template <typename Map, typename T>
void reconcile_window(const Map &previous, const std::vector<ItemSlot> &slots,
                      std::vector<WindowEntry<T>> &entries, std::vector<T> &dropped) {
  entries.clear();
  dropped.clear();
  std::unordered_set<std::string> kept;
  for (const ItemSlot &slot : slots) {
    WindowEntry<T> entry;
    entry.slot = slot;
    const auto found = previous.find(slot.identity);
    // Never the same instance twice: a duplicate identity in the window would
    // otherwise hand one node to two positions.
    if (found != previous.end() && kept.insert(slot.identity).second) {
      entry.instance = &found->second;
    }
    entries.push_back(std::move(entry));
  }
  for (const auto &[identity, instance] : previous) {
    if (kept.count(identity) == 0) dropped.push_back(instance);
  }
}

/**
 * How many items fit on one line — the greedy first-fit the wrap pass performs,
 * computed from the uniform item size so the window and layout break in the same
 * place. Always at least one: an item wider than the line still gets a line.
 */
int items_per_line(double content, double item, double gap);

int line_count(int items, int per_line);

/**
 * The window a viewport sees, in item indices, plus the space that stands in for
 * everything outside it. `view_start` is how far into the node's content the
 * viewport begins (negative while the node has not been reached yet) and
 * `view_length` how much of it is visible.
 *
 * The window is computed from the PREVIOUS frame's rects — the only ones that
 * exist when a frame starts — so a fast scroll can outrun it by one frame. That
 * is what the buffer is for: it is the lines that make the lag invisible.
 */
ItemSpan visible_span(int item_count, const ItemMetrics &metrics, double view_start,
                      double view_length, int buffer = BUFFER_LINES);

}  // namespace zabloo
