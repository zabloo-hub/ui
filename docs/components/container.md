# Container

The grouping node: a box that lays its children out. It has no content of its own, no
intrinsic size and no runtime state — everything it does comes from [layout](../format/layout.md),
[style](../format/style.md), and one declarative behavior.

```jsonc
{
  "type": "Container",
  "layout": { "direction": "row", "gap": "{space.2}", "align": "center" },
  "style":  { "background": "{color.panel}", "radius": "{radius.md}" },
  "children": []
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `group` | `"exclusive-open" \| "exclusive-select" \| "exclusive-check"` | absent | Cross-child behavior the SDK enforces. See below. |
| `selected` | `number` | `0` | Initially selected index of an `"exclusive-select"` group. Ignored otherwise. |
| `value` | `Bindable<string \| number>` | absent | Selected value of an `"exclusive-check"` group. Ignored otherwise. |
| `children` | `ZNode[]` | `[]` | Any nodes. |

**States:** `disabled` only. A `Container` is not focusable and never hovers, so no other
`states.*` on one ever applies. (Its children keep theirs.) A `Container` is in fact the
usual place to *declare* [`disabled`](../format/input.md#disabled-normative): it inherits, so
one prop here switches off every control in the section — and each of them, labels included,
still dresses itself through its own `states.disabled`.

**Actions:** none.

**Degradation:** it *is* the fallback — an unknown node type renders as a `Container`.

## Group behaviors

Composites are not IR types. They flatten to primitives at authoring time, and the
behavior that a composite has *across its children* is declared with one field the SDK
implements generically.

That is the whole mechanism: one behavior, one state it governs, no id wiring in the JSON.
An older SDK ignores a `group` it does not know and the children lay out as ordinary
siblings, which is why every composite degrades into something usable rather than into
nothing.

| Behavior | Composite | State it governs |
|---|---|---|
| `"exclusive-open"` | Accordion | `open` (of child `Collapse`s) |
| `"exclusive-select"` | Tabs | `selected` (an index) |
| `"exclusive-check"` | RadioGroup, Select | `checked` (of descendant `Toggle`s) |

### `"exclusive-open"` (normative)

When a child [`Collapse`](collapse.md) opens, its siblings close. Nothing else changes:
each `Collapse` keeps its own header, its own content and its own initial `open`.

Degradation: independent collapses, any number of them open at once.

### `"exclusive-select"` (normative)

Exactly one child is shown at a time. The contract is **positional**, like a `Collapse`'s
header:

- `children[0]` is the **bar**, and *its* children are the tab buttons.
- `children[1..n]` are the **panels**, one per button, in bar order.

Selecting index `i` puts `children[i + 1]` in layout — its siblings leave it, with
`display:none` semantics — and gives bar button `i` the `selected` state. `selected` on the
group is the initial index; the runtime selection belongs to the SDK, and the game moves it
through the host channel.

Degradation: the bar, plus every panel stacked underneath it.

### `"exclusive-check"` (normative)

One descendant [`Toggle`](toggle.md) is checked, identified by **value** rather than by
position: `value` on the group is the selection, `value` on each `Toggle` is its option.

- A `Toggle` is checked while its `value` equals the group's.
- Tapping one writes its own `value` into the group's `value` — and when that is a
  binding, into the game's data.
- The checked state of a grouped `Toggle` is **derived**, never stored per node.

The selection is ONE value, which is why the same behavior backs both a radio group and a
[dropdown](toggle.md#select) without either needing a mechanism of its own.

Degradation: independent checkboxes, any number of them checked at once.

## Authoring

### `<Container>`

```tsx
<Container layout={{ padding: "{space.4}", gap: "{space.2}" }} style={{ background: "{color.panel}" }}>
  <Text>Inventory</Text>
</Container>
```

Takes the node base props plus `group`, `selected`, `value` and `children`.

### `<Row>` and `<Column>`

Sugar for a `Container` with `direction` set. The author's own `layout` still wins on every
other field.

```tsx
<Row layout={{ gap: 8, align: "center" }}>…</Row>
<Column layout={{ gap: 4 }}>…</Column>
```

### `<Accordion>`

A column `Container` with `group: "exclusive-open"`. Its children should be `<Collapse>`s.

```tsx
<Accordion layout={{ gap: 8 }}>
  <Collapse open={false}><Text>Audio</Text><Text>…</Text></Collapse>
  <Collapse open={false}><Text>Video</Text><Text>…</Text></Collapse>
</Accordion>
```

### `<Tabs>`

Builds the positional contract of `"exclusive-select"` so the author never counts children:
each `<Tab>` contributes a bar button and a panel, in order.

```tsx
<Tabs selected={0} bar={{ layout: { gap: 4 } }}>
  <Tab label="Audio"><Text>Audio settings</Text></Tab>
  <Tab label="Video" panel={{ layout: { padding: 12 } }}><Text>Video settings</Text></Tab>
</Tabs>
```

| `<Tabs>` prop | Type | Default | Description |
|---|---|---|---|
| `selected` | `number` | `0` | Initially selected tab. Must be in range. |
| `bar` | container props | `{}` | Props for the bar container. A row unless overridden. |
| `children` | `<Tab>[]` | — | At least one. Only `<Tab>` elements are allowed. |

| `<Tab>` prop | Type | Default | Description |
|---|---|---|---|
| `label` | `ReactNode` | — | Bar button content. A bare string or number is wrapped in a `<Text>`. |
| `panel` | container props | `{}` | Props for this tab's panel container. |
| `children` | `ReactNode` | — | Panel content, shown while this tab is selected. |

A `<Tab>`'s **own** props (style, states, variant…) style its **bar button** — style the
active one through `states.selected`. `<Tab>` never renders itself: `<Tabs>` reads its props
at authoring time.

### `<Badge>`

A pill `Container` with a bound `Text` inside. It needs no IR of its own — `Text` has been
bindable since v1.

```tsx
<Badge count={{ bind: "inbox.unread" }} />
<Badge count={3} style={{ background: "{color.danger}" }} />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `count` | `Bindable<string \| number>` | `""` | The counter. |
| `label` | `Style` | — | Style of the label, merged over the default. |
| `children` | `ReactNode` | — | Custom content instead of the counter. |

There is **no "hide at zero"**: the IR has no expressions. Bind `visible` to a flag the
game owns if the badge should disappear.
