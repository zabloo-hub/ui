# ScrollView

A window onto content bigger than itself.

```jsonc
{
  "type": "ScrollView",
  "id": "shop-list",
  "axis": "vertical",
  "layout": { "width": 460, "height": 340, "align": "stretch", "gap": 4 },
  "children": []
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `axis` | `"vertical" \| "horizontal" \| "both"` | `"vertical"` | The axis children are measured **unconstrained** on. |
| `scrollbar` | `boolean` | `true` | Overlay position indicator painted by the SDK. |
| `children` | `ZNode[]` | `[]` | Ordinary flow children. |

## Layout

A `ScrollView` is a **normal flex container on both sides**: its own size comes from its
`layout`, and `direction`/`justify`/`align`/`gap`/`padding` lay its children out as any
container would. One thing differs — on the scrollable axis, children are measured
**unconstrained**, so they take their natural size and that is what the player scrolls
through.

Two consequences worth stating plainly:

- **Size the viewport yourself.** Give it a `width`/`height`; a `ScrollView` without one
  hugs its content, and there is then nothing to scroll. `grow` alone does not size it
  either — its measured size is the whole content, so no leftover reaches it. To fill what
  is left of a parent, zero the base on that axis: `height: 0` with `grow: 1` in a column
  ([why](../format/layout.md#2-arrange)).
- **`axis` is not `direction`.** `axis` says which way the content may overflow;
  `layout.direction` says which way the children flow. A horizontal scroller of chips is
  `axis: "horizontal"` **and** `direction: "row"`.
- A scrollable axis offers no width to children, so [`Text`](text.md) inside a horizontal
  scroller never wraps.

`padding` counts as content: it pads the children and expands the scrollable bounds.

## Behavior

**It always clips**, paint *and* hit-testing. An explicit `clip: false` is ignored. A row
past the edge is neither drawn nor tappable.

**The offset is runtime state**, owned by the SDK. It is never authored and never
serialized, and it is re-clamped to `max(0, contentSize − viewport)` on every relayout — so
closing a `Collapse` inside a list settles it at the new end instead of leaving it hanging
past it.

Input the SDK handles: wheel, drag, the gamepad's right stick, and the
[auto-reveal](../format/input.md#directional-navigation-normative) that brings a newly
focused node into view.

**States:** none. A `ScrollView` is not focusable and carries no
`hover`/`pressed`/`selected`/`checked`, so `states.*` on it never applies. Its children keep
theirs — scrolling by drag does not turn into a click on the `Button` under the finger.

**Actions:** none. There is no `onScroll` in v1, and the offset is not bindable. A game
moves it through the host channel: `SetScroll(id, x, y)`.

**Degradation:** as a `Container` — the content shows in full, overflowing its parent, with
nothing to scroll and nothing clipped.

Deferred, all compatible extensions: an authored or bindable offset, inertia, snapping, and
a styleable scrollbar (the boolean becomes an object).

## Authoring

```tsx
<ScrollView layout={{ width: 460, height: 340, align: "stretch", gap: 4 }}>
  {items.map((item) => <ItemRow key={item.id} item={item} />)}
</ScrollView>

<ScrollView axis="horizontal" scrollbar={false} layout={{ direction: "row", width: 460, gap: 8 }}>
  {categories.map((name) => <Chip key={name} name={name} />)}
</ScrollView>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `axis` | `"vertical" \| "horizontal" \| "both"` | `"vertical"` | Scrollable axis. `"both"` frees both. |
| `scrollbar` | `boolean` | `true` | The SDK's overlay indicator, visible only while there is something to scroll. |
| `children` | `ReactNode` | — | Content. |

A data-driven list is a [`<List>`](repeat.md) **inside** a `<ScrollView>`: repetition and
scrolling are separate capabilities and compose.
