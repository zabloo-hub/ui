# Layout

Layout is **Flexbox**, computed by the SDK at runtime. The IR carries layout *inputs*, not
rects: nothing is baked at export time, because a UI that collapses a section, receives new
data or runs on a different screen has to lay itself out again on the device.

No engine's layout system is involved. The SDK runs its own pass, which is what makes the
result identical on every target.

## The v1 subset

A deliberately small slice of Yoga. Everything below is on `node.layout`.

| Prop | Type | Default | Description |
|---|---|---|---|
| `direction` | `"row" \| "column"` | `"column"` | Main axis of the children's flow. |
| `justify` | `"start" \| "center" \| "end" \| "space-between"` | `"start"` | Distribution of leftover space along the main axis, within a line. |
| `align` | `"start" \| "center" \| "end" \| "stretch"` | `"start"` | Placement of a child across the cross axis. |
| `gap` | `Dim` | `0` | Space between consecutive children. |
| `padding` | `Dim` | `0` | Inner space on **all four sides**. |
| `width` | `Dim` | auto | Explicit width. Absent = the measured size. |
| `height` | `Dim` | auto | Explicit height. Absent = the measured size. |
| `grow` | `number` | `0` | Share of the line's leftover main-axis space this child takes. |
| `wrap` | `boolean` | `false` | Break the main axis into several lines when the children do not fit. |

What is **not** in the subset: per-side padding, margin, `shrink`, `basis`, absolute
positioning, percentages and fractional units, `align-self`, `align-content`, and
transforms of any kind. Each of these is an additive extension a later version may
introduce; none is expressible today.

## The two passes

### 1. Measure (bottom-up)

Every node is sized from its content, against the **width its parent offers it**:

1. The view offers its own width to the root.
2. A node's own `layout.width`, when declared, **replaces** the offer for its subtree.
3. What is left after the node's `padding` on both sides flows down to every child —
   in a row exactly as in a column. v1 measures no cross-child competition for the offer:
   each child is offered the parent's full content width, never a share of it.
4. An offer may be **unconstrained** (no width anywhere up the chain, or a scrollable
   axis). A `ScrollView` offers nothing on the axis it scrolls, which is what makes its
   content overflow the viewport instead of shrinking to fit.

The offer only matters to leaves — it is the width a [`Text`](../components/text.md) wraps
to. A childless node is sized by `measureLeaf`, which is where a `Text` consults the font
metrics and an `Image` its manifest entry.

A node's measured size is `content + padding * 2` on each axis, and then `layout.width` /
`layout.height` **override** the result where they are declared.

### 2. Arrange (top-down)

Each node receives a rect and places its children inside the content box (its rect minus
`padding`):

- **`grow`** distributes the space left on the line, proportionally to each child's
  `grow`. It is **per line**: a wrapped row shares each line's own leftovers. Only a
  **positive** leftover is ever distributed: there is no `shrink` in the subset, so a
  child whose measured size is larger than the line has room for keeps that size and
  overflows.
- **`justify`** then distributes whatever is still left, along the main axis.
  `space-between` adds the leftover between the children (on top of `gap`), and does
  nothing to a line holding one child.
- **`align`** places each child across the cross axis. `stretch` makes the child fill the
  line's cross size instead of keeping its measured one.

**Growing from a zero base.** `grow` adds to a child's measured size, it does not replace
it. A node that must take *exactly* what is left has to declare that size as zero —
`height: 0` with `grow: 1` in a column, `width: 0` with `grow: 1` in a row. It is the
subset's equivalent of `flex-basis: 0`: with the base at zero the child adds nothing to
the line's total, so `grow` becomes its only source of size and the leftover *is* its size.

For a [`ScrollView`](../components/scrollview.md) this is the only way to size the viewport
from its parent. A scroller measures its children unconstrained on the axis it scrolls, so
its own measured size is that of the whole content: with `grow: 1` alone there is no
leftover left to distribute, and the scroller ends up larger than its parent with nothing
to scroll. Zeroing the base is what makes the column's leftover the viewport.

## Wrapping

`wrap: true` breaks the children into lines, greedy first-fit: a child is appended to the
current line while it fits, and starts a new one otherwise.

**`wrap` applies to a row.** The measure pass carries a width offer and nothing else, so a
column has no length to break against and lays its children out on one line. This is also
what an SDK that predates the flag does with any node — the row overflows (and clips, if
the node clips), but no content is lost.

`justify` and `align` keep meaning what they mean **within a line**. How the lines
themselves are distributed on the cross axis — Yoga's `align-content` — is out of the
subset: lines stack from the start, separated by `gap`.

A grid is this and nothing else: a wrapping row whose items have a width, so N of them fit
per line. See [`Repeat`](../components/repeat.md#grid) for how `<Grid>` solves that
arithmetic at authoring time.

## Intrinsic sizes

Some nodes measure from their content rather than from their children:

| Node | Intrinsic size |
|---|---|
| [`Text`](../components/text.md) | The laid-out text block: line widths and `lineHeight` × line count. |
| [`Image`](../components/image.md) | The source's pixel size, from the asset manifest. |
| [`TextInput`](../components/textinput.md) | One line of text, at the field's `fontSize`. |
| [`Slider`](../components/slider.md) | Its own `layout` only — the slots never add to it. |

Every other childless node measures **zero content on both axes**: its size is its
`padding`, and nothing else. An empty [`Container`](../components/container.md) used as a
block of colour — a swatch, a rule, a divider — therefore has no size on an axis it was not
given one for, and paints nothing until it gets an explicit `width`/`height` or its parent
stretches it with `align: "stretch"`.

## Nodes that place their own children

Three node types override the flex pass for positional slots, because their geometry is a
function of a value rather than of the flow:

- [`Slider`](../components/slider.md) places its fill and thumb from the current value.
- [`ProgressBar`](../components/progressbar.md) sizes its fill at `contentMain × value`.
- [`Overlay`](../components/overlay.md) is lifted out of its parent's flow entirely: it
  takes no space among its siblings, and its own rect is the view's.

Everything else — including [`Toggle`](../components/toggle.md)'s indicator slots and
[`Collapse`](../components/collapse.md)'s header — lays out through the ordinary pass.

## Hiding

`visible: false` removes a node from the layout: its siblings close the gap and it neither
paints nor takes input. This is the only hiding mechanism in the format, and it is what
`Collapse` content, unselected tab panels and `Toggle` indicator slots all use.

## Overflow

Nothing paints outside its own layout rect. It is an invariant the format keeps
deliberately, and it is what makes hit-testing on rects honest:

- Borders are **inset** — a `borderWidth` grows inward, never outward.
- `Image` with `fit: "cover"` crops through its UVs instead of overflowing.
- A `Slider`'s thumb travel is inset by half the thumb, so it stays within the track.
- Text that does not fit is clipped or ellipsized, never spilled.

Children of a container **can** overflow it — a fixed-height column with too many rows
draws past its bottom edge. `clip: true` cuts that, for paint and for input alike; a
`ScrollView` does it always.
