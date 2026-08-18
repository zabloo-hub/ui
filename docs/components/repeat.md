# Repeat

The first node whose **children come from data** instead of from the document. `items`
binds an array and the SDK instantiates the template once per element.

```jsonc
{
  "type": "Repeat",
  "items": { "bind": "shop.items" },
  "as": "item",
  "key": "id",
  "layout": { "direction": "column", "gap": 8 },
  "children": [
    { "type": "Row", "…": "the item template" },
    { "type": "Text", "text": "Nothing here yet" }
  ]
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `items` | `{ bind: string }` | — | The bound array. **Always** a binding. |
| `as` | `string` | `"item"` | Alias the template binds against. |
| `key` | `string` | absent | Path **relative to the item** naming its stable identity. Absent = positional. |
| `children` | `ZNode[]` | absent | `children[0]` = item template; `children[1..]` = empty state. |

`items` is always a binding: a literal array here would put game **data** into the
document, and the document carries structure.

It is a node type rather than a prop on `Container` for the reason that has settled every
similar question in this format: the SDK dispatches behavior **by type**, never by type
*and* prop.

## The Repeat is the container

Its own `layout` — `direction`, `gap`, `padding`, `justify`, `align`, `wrap` — lays the
instances out, exactly as any container lays out its children. That is what lets `<List>`
and `<Grid>` be authoring sugar over it rather than node types of their own.

## Slots

- **`children[0]` is the template**, emitted once and instantiated per element.
- **`children[1..]` is the empty state**, in layout only while the bound value is an empty
  array, absent, or not an array at all (`display:none` semantics — the one hiding
  mechanism).

The empty state exists as a **slot** because "show *Nothing here yet*" would otherwise need
a boolean expression over the data, and the IR has no expressions by design.

## Binding inside the template

Paths in the template may start with the alias and are resolved against the current
element:

| Path | Resolves to |
|---|---|
| `"item"` | the element itself — `"shop.items.3"` |
| `"item.name"` | `"shop.items.3.name"` |
| `"item.$index"` | the element's **position** — a number the data does not contain |
| `"player.gold"` | itself: a path under no known alias is absolute |

Scopes nest and the **innermost alias wins**, which is why the alias is declared rather
than reserved: a nested list can still reach the outer element by its own alias. It also
means an alias **shadows** a data root of the same name — pick names that are not roots of
your data.

Full rules, including `$index`: [Bindings › Item scopes](../format/bindings.md#item-scopes).

## Identity

`key` names a path relative to the item pointing at a stable field (`"id"`, `"meta.sku"`).
Identity is what makes updates stable: reordering a keyed array moves the SDK's per-item
state — focus, a checked `Toggle`, a scroll offset, an in-flight transition — **with** the
item instead of leaving it pinned to a position. It is also what makes recycling and
virtualization possible.

Without a `key`, identity is positional.

The focus is keyed by that identity too, and it survives a row being **un-realized** by
virtualization — see
[Input & focus › Focus in a virtualized list](../format/input.md#focus-in-a-virtualized-list-normative).

## Actions from inside an item

A named action fired from within a template carries an
[action context](../format/bindings.md#action-context): `{ path, key, index }`. That is what
lets one `onClick: "buy"` in the template say **which** row was bought.

## Behavior

**States:** `disabled` only, and it reaches every instance — one prop switches off a whole
list of rows.

**Actions:** none of its own.

**Degradation:** as a `Container` — the template shows **once**, static and unresolved (its
bindings read nothing), alongside the empty state. The content survives; the repetition
does not.

## Authoring

There is no `<Repeat>` component: the slots are positional, and `<List>`/`<Grid>` are the
one place that convention is written down. They share these props (`RepeatProps`):

| Prop | Type | Default | Description |
|---|---|---|---|
| `items` | `string` | — | Data path of the array, e.g. `"shop.items"`. |
| `as` | `string` | `"item"` | Alias the template binds against. |
| `keyPath` | `string` | absent | Path relative to the item naming its identity. Named `keyPath` because React owns `key`. |
| `empty` | `ReactNode` | absent | Shown while the array is empty, absent or not an array. |

### `<List>`

```tsx
<List items="shop.items" as="it" keyPath="id" layout={{ gap: 8 }}
      empty={<Text>Nothing here yet</Text>}>
  {(it) => (
    <Row layout={{ gap: 12, align: "center" }}>
      <Text bind={it("name")} />
      <Text bind={it("price")} />
      <Button onClick="buy"><Text>Buy</Text></Button>
    </Row>
  )}
</List>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `axis` | `"vertical" \| "horizontal"` | `"vertical"` | Item flow. |
| `children` | node **or** `(item) => node` | absent | The item template — a **single** node. |

The template is a single node because `children[0]` *is* the template: wrap an item's
contents in a `<Row>` or `<Column>`.

The render-prop form gives you the item's paths as a function — `it("name")` →
`"it.name"`, `it()` → `"it"`, `it.$index` → `"it.$index"` — so the alias lives in one
place and renaming `as` follows through every binding. Writing the paths by hand works
too.

### `<Grid>`

A list that wraps into lines of `columns` cells — the same `Repeat`, laid out as a
[wrapping row](../format/layout.md#wrapping).

```tsx
<Grid items="inventory.slots" columns={4} itemWidth={72} layout={{ gap: 8 }}>
  {(slot) => <Text bind={slot("name")} />}
</Grid>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `columns` | `number` | — | Items per line. An integer `>= 1`. |
| `itemWidth` | `number` | absent | Width of one cell, in px. Give this **or** `layout.width`. |
| `cell` | container props | `{}` | Props for the cell container that sizes each column. |
| `children` | node(s) **or** `(item) => nodes` | absent | The item template; the cell holds them. |

The geometry is **arithmetic, not a percentage**: v1 has no fractional dims, so the grid
solves `itemWidth` from `layout.width` (or the other way round) at authoring time and each
cell carries the resulting px. `columns` never reaches the IR.

That is also why `gap` and `padding` must be **numbers** on a `<Grid>` — a token only
resolves inside the SDK, too late for this sum.
