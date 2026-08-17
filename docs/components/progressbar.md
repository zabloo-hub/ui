# ProgressBar

A track that fills to a **fraction**. It is a node type and not sugar because nothing else
in v1 can express "a fraction of my parent": `Layout` dims are pixels and are not bindable,
and `grow` is neither. The fraction is exactly the capability this primitive adds.

```jsonc
{
  "type": "ProgressBar",
  "value": { "bind": "player.hp" },
  "clip": true,
  "layout": { "direction": "row", "height": 8 },
  "style":  { "background": "{color.track}", "radius": 4 },
  "children": [
    { "type": "Container", "style": { "background": "{color.hp}", "radius": 4 } }
  ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<number>` | `0` | Progress in `0..1`, clamped. Static or a read binding. |
| `children` | `ZNode[]` | `[]` | `children[0]` = the fill. Further children are **reserved**. |

## Geometry (normative)

The **node is the track** — its `style` paints the groove and its `layout` sizes it — and
`children[0]` is the **fill**, an ordinary node whose own style paints the bar. A positional
slot, like `Collapse`'s header: paint stays implicit, so the fill is a composed child rather
than a new draw command.

Along the main axis (`layout.direction`, which defaults to `"column"` like everywhere else
in the format — the `<ProgressBar>` component sets `"row"` for you):

- The SDK sizes the fill at **`contentMain × value`**, where `contentMain` is the track's
  main axis minus its `padding`.
- The fill **stretches across the whole cross axis**.
- `layout.justify` anchors it: `"start"` (the default) grows from the left/top, `"end"` from
  the right/bottom — a bar that drains the other way — and `"center"` grows from the middle
  out.
- The fill's **own** `width`/`height`/`grow` on the main axis are **ignored**: the SDK owns
  that number.

`children[1..]` are reserved. v1 lays out nothing else inside the track — a label on top of
the bar needs overlapping placement, which the format does not have.

## Value

`0..1`, clamped. A non-finite value — missing data, a string, NaN — reads as **`0`**. There
is one answer to "what does a broken binding show": an empty bar, never a full one and never
a crash. (Reference implementation: `clampProgress` in `@zabloo/format`.)

A read binding is the expected authoring path: `SetData` moves the bar.

## Motion

A `transition` on this node tweens the **value**, not the computed rect. The SDK interpolates
the fraction and then runs its normal layout pass with it, so there is still one pass per
frame and both targets land on the same number.

The fill's own `transition` never sees the change, since its main size is not one of its
declared inputs.

## Behavior

**States:** `disabled` only, inherited. Not focusable, so nothing else applies.

**Actions:** none.

**Degradation:** as a `Container` — the track with an unsized fill inside. The bar loses its
fraction, never the layout around it.

## Authoring

There is no `<ProgressBar>` primitive export: the fill is positional, and the component
below builds it.

```tsx
<ProgressBar value={{ bind: "player.hp" }} transition={{ duration: 200 }} />
<ProgressBar value={0.4} layout={{ direction: "column", height: 120 }} size={10} />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<number>` | `0` | Progress in `0..1`, usually a read binding. |
| `fill` | `Style` | — | Style of the fill, merged over the default bar. |
| `size` | `number` | `8` | Bar thickness in px — height for a row bar, width for a column one. |

The component defaults to a **horizontal** bar (`direction: "row"`) and to `clip: true`, so
a square fill stays inside a rounded track. `layout.justify: "end"` makes it drain from the
other side.
