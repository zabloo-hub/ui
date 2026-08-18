# `@zabloo/react` reference

The authoring layer. It is **not part of the format**: your components run on your machine,
at export time, and what the SDK receives is always a tree of the
[13 node types](components/README.md). Composites and variants are resolved on the way out
and never reach the IR.

This page is the API surface. What each component *emits* is on its
[catalog page](components/README.md); this is the module's exports, its types, and the two
functions a project calls when it does not use the CLI.

```ts
import { renderToIR, ThemeProvider, Column, Text /* … */ } from "@zabloo/react";
```

## `renderToIR(element): ZNode`

Mounts the element into the reconciler, serializes the tree and unmounts — one shot,
synchronous, no DOM anywhere.

```ts
import { renderToIR, ThemeProvider } from "@zabloo/react";
import { createElement } from "react";
import MainMenu from "./views/main-menu.js";
import { variants, transitions } from "./theme.js";

const node = renderToIR(
  createElement(ThemeProvider, { theme: { variants, transitions } }, createElement(MainMenu)),
);
```

The element must resolve to **exactly one root primitive** — wrap siblings in a
`<Container>`. Raw text at the root is refused too: it has no node to be.

Anything the authoring layer rejects throws here, with the message naming the component and
the fix; `zabloo export` prints it as the export's failure. The full list is in
[Troubleshooting](troubleshooting.md#authoring-errors).

`ZNode` comes from [`@zabloo/format`](format/envelope.md), which is also where the envelope
around it is assembled: `renderToIR` returns one view's tree, not an envelope.

## `ThemeProvider`

```tsx
<ThemeProvider theme={{ variants, transitions }}>{children}</ThemeProvider>
```

Supplies the project's [variants](theming.md#variants) and per-component motion defaults to
everything below it. `zabloo export` wraps every view in one, built from `src/theme.ts`, so
a project that uses the CLI never writes this element by hand.

**Tokens are not in it.** `"{color.primary}"` is resolved by the SDK against the envelope's
dictionary at render time, so tokens travel in the [envelope](format/envelope.md#tokens),
not through React. The provider carries only what has to be resolved *before* the IR
exists.

### Theme types

| Type | Shape |
|---|---|
| `ZablooTheme` | `{ variants?: ThemeVariants; transitions?: ThemeTransitions }` |
| `ThemeVariants` | `Record<Component, Record<VariantName, VariantDef>>` — `{ Button: { primary: {…} } }` |
| `ThemeTransitions` | `Record<Component, Transition>` — `{ Button: { duration: "{motion.fast}" } }` |
| `VariantDef` | `{ style?: Style; states?: Partial<Record<StateName, StateOverride>>; transition?: Transition }` |

Both maps are keyed by **primitive** name, not by the component you wrote — see
[Theming](theming.md#variants-are-keyed-by-primitive), which is the page that covers how
they resolve and merge.

## `CommonProps`

Every component takes these, and they mirror the IR's
[node base](format/envelope.md#the-node-base) one for one. Re-exported so your own wrappers
can be typed without repeating the list.

| Prop | Type | Description |
|---|---|---|
| `id` | `string` | Addressed by the [host channel](format/host-channel.md) and by an anchored overlay. Unique within a view. |
| `visible` | `Bindable<boolean>` | Out of layout when false — `display: none` semantics, not `opacity: 0`. |
| `disabled` | `Bindable<boolean>` | Takes this node **and everything inside it** out of the interaction model. It inherits; every node it reaches can dress itself through `states.disabled`. |
| `layout` | `Layout` | The [Flexbox subset](format/layout.md). |
| `style` | `Style` | The [style set](format/style.md). |
| `states` | `Partial<Record<StateName, StateOverride>>` | Per-state overrides, merged in the format's [normative order](format/style.md). |
| `transition` | `Transition` | Tweens this node's animatable values. One object per node, base node only — no cascade, no per-state override. |
| `variant` | `string` | Named style set from the theme. **Authoring only** — resolved at export, never in the IR. |
| `autofocus` | `boolean` | Receives initial focus. |
| `clip` | `boolean` | Clips children's paint *and* hit-testing to this node's rect. Implied by `<ScrollView>`. |

`Bindable<T>` is a literal `T` or `{ bind: "path.into.data" }` — see
[Bindings](format/bindings.md).

## Item templates

A [`<List>`](components/repeat.md) or `<Grid>` emits its template **once** and the SDK
instantiates it per element of the bound array. Inside it, bindings are written against an
alias.

### `ItemRef`

```ts
export interface ItemRef {
  (path?: string): string;
  readonly $index: string;
}
```

A callable that builds the template's binding paths, so the alias lives in one place:
rename `as` and every binding follows.

| Call | With `as="it"` | Reads |
|---|---|---|
| `it("price")` | `"it.price"` | The item's `price` field. |
| `it("price.amount")` | `"it.price.amount"` | Any depth. |
| `it()` | `"it"` | The whole element — a `<Text bind={it()}>` over an array of strings. |
| `it.$index` | `"it.$index"` | The element's **position**, a number the data does not contain. |

Only that exact leaf is reserved: `it("a.$index")` is an ordinary segment that reads
nothing.

### `ItemTemplate`

```ts
export type ItemTemplate = ReactNode | ((item: ItemRef) => ReactNode);
```

Nodes that bind by hand, or a function given the item's paths:

```tsx
<List items="shop.items" as="it" keyPath="id" layout={{ gap: 8 }}>
  {(it) => (
    <Row layout={{ gap: 12, align: "center" }}>
      <Text bind={it("name")} />
      <Text bind={it("price")} />
    </Row>
  )}
</List>
```

## Base prop types

Two prop types are **public on purpose**, so a wrapper over any of the components that
share them can be typed without copying the list. They have no component of their own: the
primitives they belong to (`Toggle`, `Repeat`) are not exported, because their children are
[positional slots](components/README.md#positional-slots).

### `ToggleControlProps`

Shared by `<Checkbox>`, `<Switch>` and `<Radio>`. Extends `CommonProps`.

| Prop | Type | Default | Description |
|---|---|---|---|
| `checked` | `Bindable<boolean>` | `false` | Initial state, or a **read/write** binding: the SDK writes the new value back and notifies the game. |
| `onChange` | `string` | none | Named action fired after every change, however it was caused. Inside a `<RadioGroup>` or `<Select>`, only when this option **takes** the selection — the one that loses it says nothing; the [group's own `onChange`](components/toggle.md#radio-and-radiogroup) is what reports the move. |
| `size` | `number` | `22` | Indicator size in px — the box side, the switch track height. |
| `children` | `ReactNode` | none | The label. Rendered next to the indicator, and tapping it toggles too. |

`<Radio>` omits `checked` (the group owns the selection) and adds `value`.

### `RepeatProps`

Shared by `<List>` and `<Grid>`. Extends `CommonProps`.

| Prop | Type | Default | Description |
|---|---|---|---|
| `items` | `string` | — | Data path of the array. Always a binding: the game owns the data, the document carries only structure. |
| `as` | `string` | `"item"` | Alias the template binds against. Declared rather than reserved, so a nested list can still reach the outer element — pick a name that is not a root of your data, which it would shadow. |
| `keyPath` | `string` | positional | Path **relative to the item** naming its stable identity (`"id"`, `"meta.sku"`). It keeps per-item state — focus, a checked toggle, a scroll offset — with the item across a reorder. Named `keyPath` because React owns `key`. |
| `empty` | `ReactNode` | none | Shown while the array is empty, absent or not an array at all. |

## What the module exports

**Primitives** — the component *is* the node type:

`Container` · `Text` · `Button` · `Collapse` · `ScrollView` · `Image` · `Overlay` ·
`TextInput`

**Slot builders** — the node type is a primitive whose children are
[positional](components/README.md#positional-slots), so the primitive is not exported and
these are the one place the convention is written down:

`Checkbox` · `Switch` · `Radio` (→ `Toggle`) · `Slider` · `ProgressBar` · `Spinner` ·
`List` · `Grid` (→ `Repeat`)

**Composites**, flattened into primitives at authoring time:

`Row` · `Column` · `Accordion` · `Tabs` / `Tab` · `RadioGroup` · `Select` / `Option` ·
`Badge` · `Modal` · `Toast` · `Tooltip`

**Functions and elements:** `renderToIR`, `ThemeProvider`.

**Types:** `CommonProps`, `ItemRef`, `ItemTemplate`, `ToggleControlProps`, `RepeatProps`,
`ZablooTheme`, `ThemeVariants`, `ThemeTransitions`, `VariantDef`, `AnchorAt` (aliased as
`OverlayPosition` — the nine placements are one vocabulary), and one `…Props` interface per
component.

Which node each component emits — and its slots, states and degradation — is in the
[component catalog](components/README.md).

## Related

- [Project structure & CLI](project-structure.md) — where views, theme and assets live.
- [Theming](theming.md) — the `src/theme.ts` contract and how variants resolve.
- [Troubleshooting](troubleshooting.md) — every authoring error this layer throws.
