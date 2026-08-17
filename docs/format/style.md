# Style

Style is **resolved per node**. There is no cascade and no inheritance: a node's `style`
is the whole answer to how it looks, and the SDK never walks up the tree to compute it.
The one exception is `opacity`, which multiplies down a subtree — and it is an exception
on purpose (see below).

Paint is **implicit**. There is no draw-command layer in v1: a node's style *implies* the
rounded rectangle the tessellator draws — a fill, an inset stroke, and the node's own
content on top. An explicit paint layer (paths, arcs) is a compatible future extension.

## The style set

| Prop | Type | Default | Description |
|---|---|---|---|
| `background` | `ColorValue` | none | Fill of the node's rect. Absent = nothing is painted. |
| `radius` | `Dim` | `0` | Corner radius of the fill, the border and the clip. |
| `borderWidth` | `Dim` | `0` | Stroke thickness, **inset**. |
| `borderColor` | `ColorValue` | — | Stroke color. |
| `color` | `ColorValue` | white | Color of the node's **content** — glyphs, image tint, caret and selection. |
| `fontSize` | `Dim` | `16` | Text size in px, rounded and **clamped to `1..512`**. |
| `opacity` | `number` | `1` | 0..1, clamped. Multiplies down the subtree. |
| `textAlign` | `"start" \| "center" \| "end"` | `"start"` | Horizontal alignment of each line inside the rect. |
| `textAlignY` | `"start" \| "center" \| "end"` | `"start"` | Vertical alignment of the whole text block. |
| `lineHeight` | `Dim` | the font's metric | Distance between the tops of consecutive lines. |
| `wrap` | `boolean` | `true` | Word-wrap text to the available width. |
| `overflow` | `"clip" \| "ellipsis"` | `"clip"` | How text that does not fit is cut. |
| `maxLines` | `number` | unbounded | Cap on the number of lines. |

The text properties live in `style`, next to `fontSize` and `color`, so they are themeable
through tokens and overridable per state like every other visual input. They are read from
a `Text` node and ignored elsewhere. Their exact semantics — including the normative wrap
algorithm — are on the [`Text`](../components/text.md) page.

### Text size

`fontSize` is resolved per frame — through tokens, through states, through a transition —
and then **rounded and clamped to `1..512`** before a glyph is asked for. The ceiling is
normative, not an implementation detail of one renderer: rasterization cost grows with the
square of the point size, so an unclamped `fontSize` (an animated token overshooting, a
value that arrives from data) is the difference between a big headline and a hundreds-of-
megabytes glyph bitmap. Clamping silently is deliberate — the value is re-resolved on
every frame, so there is no single moment at which to report it.

### Border

`borderWidth` grows **inward**: the stroke is painted inside the layout rect, border-box
style, so a node with a border occupies exactly the same space as one without. This is what
keeps the invariant that nothing paints outside its own rect, and it is why a focus ring
made of a border never shifts the layout when it appears.

The fill and the border share one parameterization of the rounded perimeter, so they meet
without a seam at any radius.

### Content color

`color` is "the color of this node's content", and each node type has content of its own:
a `Text`'s glyphs, an `Image`'s tint (multiplied per channel; absent = the pixels as they
are), a `TextInput`'s glyphs plus its caret and selection highlight. A `Container` has no
content of its own, so `color` does nothing on one.

### Opacity

`opacity` is **multiplicative down the subtree**: a node at `0.5` inside a parent at `0.5`
paints at `0.25`. It is applied as per-vertex alpha, not as group opacity through a
render target — overlapping children inside a faded subtree show through each other
rather than compositing as one flattened layer.

## States

A node declares style overrides for the runtime states it can be in. The SDK owns the
states themselves, keyed by component identity — the IR declares what a state *looks*
like, never when it happens.

```jsonc
{
  "type": "Button",
  "style":  { "background": "{color.primary}" },
  "states": {
    "hover":   { "style": { "background": "{color.primary.hover}" } },
    "focused": { "style": { "borderWidth": "{border.focus}" } },
    "pressed": { "style": { "background": "{color.primary.pressed}" } }
  }
}
```

| State | Carried by | Meaning |
|---|---|---|
| `empty` | `TextInput` | The field holds no text. This is what styles a placeholder. |
| `selected` | A button of an `"exclusive-select"` group | It is the chosen tab. |
| `checked` | `Toggle` | It is on — its own value, or the one its `"exclusive-check"` group derives. |
| `hover` | Focusable nodes | The pointer is over it. |
| `focused` | Focusable nodes | It holds the focus. See [Input & focus](input.md). |
| `pressed` | `Button`, `Toggle` | A finger or button is down on it. |
| `disabled` | **Every** node | It — or an ancestor — declares [`disabled`](input.md#disabled-normative), so it is out of the interaction model. |

`hover` lights up exactly the focusable set — what takes input is what may look different
under the pointer — so a plain `Container` is never hovered.

`disabled` is the one state a node that is **not** focusable can be in, because it is the
only one that inherits: a disabled section hands it to everything inside, and the labels of
that section have to be able to dim with the controls or switching the section off would
only reach half of what the player sees.

### The merge order is normative

States overlap: a pressed button is usually also hovered and focused. They are merged in
one fixed order, least to most specific, later winning field by field:

```
base → empty → selected → checked → hover → focused → pressed → disabled
```

The **value** states come first — what the control *is* is the baseline — and the transient
interaction states paint over them. `empty` opens the list because it is the weakest thing
a control says about its value: a placeholder color must lose to anything the author says
about a selected or focused field. `hover` sits under `focused` so a mouse passing by never
hides a focus ring, and `pressed` wins over those because it lasts exactly as long as the
finger is down.

`disabled` closes the list, and its place there only matters against the **value** states: a
disabled node takes no input at all, so `hover`, `focused` and `pressed` can never be active
alongside it, while a disabled `Toggle` is still `checked` and a disabled field still
`empty`. Coming last is what lets one override speak for the whole control, whatever value
it happens to be holding.

Reference implementation: `STATE_ORDER` in the web renderer's `states.ts`. Every SDK
reproduces this order exactly.

Merging is **per field**, and only within `style` — a state override never replaces the
base style wholesale, and it cannot change layout, children or behavior. A state that
declares nothing about a field leaves whatever the layers below it resolved.

## Variants (authoring only)

`variant` is a `@zabloo/react` concept and **never reaches the IR**. A theme defines named
style sets per component:

```tsx
const theme = {
  variants: {
    Button: {
      primary: {
        style:  { background: "{color.primary}", radius: "{radius.md}" },
        states: { hover: { style: { background: "{color.primary.hover}" } } },
      },
    },
  },
};

<ThemeProvider theme={theme}>
  <Button variant="primary" onClick="buy">…</Button>
</ThemeProvider>
```

At export time the variant's `style` and `states` are merged **under** the node's explicit
props — explicit always wins — and the envelope receives the node fully resolved. An
unknown variant fails loudly during authoring, which is the right moment for it.

The theme also carries default [motion](motion.md) per component (`transitions`), resolved
the same way: node prop > variant > theme default, and the most specific one wins whole
rather than field by field.
