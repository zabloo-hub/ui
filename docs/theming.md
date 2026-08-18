# Theming

A theme is one file — `src/theme.ts` — and it answers three questions that look alike and
resolve at different times:

| It defines | Reaches the game as | Resolved |
|---|---|---|
| **Tokens** | The envelope's flat dictionary | At **render time**, by the SDK, per node. Hot-updatable on its own. |
| **Variants** | Nothing — the nodes come out resolved | At **export time**, by `@zabloo/react`. |
| **Motion defaults** | A `transition` on the nodes that carry one | At **export time**, same as variants. |

That split is the whole model. A color swapped in the token dictionary re-themes a running
game without re-emitting a single node; a variant changed in the theme is a different tree,
so it takes a re-export.

## The contract

```ts
// src/theme.ts
import type { ThemeTransitions, ThemeVariants } from "@zabloo/react";

export const tokens = { "color.primary": "#4f46e5", "space.3": 12 };
export const transitions: ThemeTransitions = { Button: { duration: "{motion.fast}" } };
export const variants: ThemeVariants = { Button: { primary: { style: {} } } };
```

`zabloo export` reads exactly these three **named exports** and nothing else. All three are
optional, and so is the file: without it a project exports with no tokens, no variants and
no motion defaults.

`tokens` goes straight into the envelope. `variants` and `transitions` are handed to a
[`ThemeProvider`](react-api.md#themeprovider) wrapped around every view, which is why they
never appear in the output.

## Tokens

The dictionary is **flat**: the key is the whole name, dots included, so a lookup is one
hash hit and never a walk.

```ts
export const tokens = {
  "color.primary": "#4f46e5",
  "color.primary.hover": "#6366f1",
  "color.text": "#eceff4",
  "radius.md": 8,
  "space.3": 12,
  "motion.fast": 120,
};
```

A **token reference** is the name in braces, and it is valid anywhere a `Dim` or a
`ColorValue` is accepted — which includes `transition.duration`, so motion is themeable like
color:

```tsx
<Button
  style={{ background: "{color.primary}", radius: "{radius.md}" }}
  layout={{ padding: "{space.3}" }}
  transition={{ duration: "{motion.fast}" }}
/>
```

Values are strings or numbers. Nothing else: a token is a leaf the SDK substitutes, not an
expression. A token the dictionary does not define never breaks the frame — it is reported
once as `unknown-token` and falls back to the property's default (see
[the envelope](format/envelope.md#tokens) for the exact fallbacks).

### Naming

Nothing enforces a scheme; the dot is a convention that keeps a dictionary readable and
makes a family greppable. The scaffolded theme uses `color.*`, `space.*`, `radius.*` and
`motion.*`, and states are a suffix on the base name (`color.primary` → `color.primary.hover`).

## Variants

A variant is a named style set for one component:

```ts
export const variants: ThemeVariants = {
  Button: {
    primary: {
      style: { background: "{color.primary}", radius: "{radius.md}" },
      states: {
        hover: { style: { background: "{color.primary.hover}" } },
        pressed: { style: { background: "#4338ca" } },
        focused: { style: { borderWidth: 2, borderColor: "#ffffff" } },
      },
      transition: { duration: "{motion.fast}" },
    },
  },
};
```

```tsx
<Button variant="primary" onClick="buy">…</Button>
```

**An unknown variant throws** during the export, listing the ones the theme does define for
that component. Authoring time is the right moment to hear it, and it is why `variant` can
be resolved away instead of travelling.

### Variants are keyed by primitive

The key is the **IR node type** the component lowers to, never the component you wrote.
`<Checkbox variant="row">` looks for `variants.Toggle.row`, because a `Checkbox` *is* a
`Toggle`:

| Key | Components that read it |
|---|---|
| `Container` | `<Container>` · `<Row>` · `<Column>` · `<Accordion>` · `<Tabs>` · `<RadioGroup>` · `<Badge>` |
| `Text` | `<Text>` |
| `Button` | `<Button>` · `<Select>` (its closed face) |
| `Toggle` | `<Checkbox>` · `<Switch>` · `<Radio>` · `<Option>` |
| `Overlay` | `<Overlay>` · `<Modal>` · `<Toast>` · `<Tooltip>` |
| `Repeat` | `<List>` · `<Grid>` |
| `Collapse` · `ScrollView` · `Image` · `Slider` · `TextInput` · `ProgressBar` · `Spinner` | the component of the same name |

The [catalog](components/README.md#every-authoring-component) has the full component → node
mapping; the keys above are that same column.

One consequence worth knowing: a composite passes `variant` to the **outermost** primitive
it emits. `<Modal variant="danger">` dresses the backdrop `Overlay`, not the panel inside
it — the panel is styled with the `panel` prop. Same for `<Tabs>` (the group container, not
the bar buttons) and `<Slider>` (the rail, not the fill or the thumb).

### The merge is explicit-wins

At export time the variant is merged **under** the node's own props:

| Piece | How |
|---|---|
| `style` | Field by field. The node's `style` wins per property; the variant fills the rest. |
| `states` | Per state, then field by field inside it. A state whose merge carries no style is dropped rather than emitted empty. |
| `transition` | **Whole.** It is one object per node, so the most specific declaration wins entirely — never field by field. |

```tsx
// variants.Button.primary = { style: { background: "{color.primary}", radius: "{radius.md}" } }
<Button variant="primary" style={{ radius: 0 }} />
// emits: style { background: "{color.primary}", radius: 0 }
```

The order is the same one the format states for authoring: **node prop > variant > theme
default**. What the envelope receives is the node fully resolved, which keeps the IR's
founding rule intact — [resolved per node, no cascade](format/style.md).

## Motion defaults

`transitions` answers the same question as `variants` one level up — "how does a Button move
here?" — and is keyed the same way:

```ts
export const transitions: ThemeTransitions = {
  Button: { duration: "{motion.fast}" },
  Toggle: { duration: "{motion.fast}" },
  Collapse: { duration: "{motion.slow}", easing: "ease-in-out" },
  Slider: { duration: "{motion.slow}", easing: "ease-out" },
};
```

Every `Button` in the project now moves like that without repeating the prop, and a node's
own `transition` still wins whole. It applies **with or without a variant**: motion is a
property of the component type, not of one of its looks.

There is deliberately no single global default. With `duration` tokenized, a theme already
tunes every component's motion from one place (`motion.*`), while only the types that
actually move carry a `transition` into the envelope.

**Keying by primitive has a price here**, and it is the one to be aware of: the containers
the sugar builds — a `<Switch>`'s rails, a `<Tabs>`' panels, a `<Slider>`'s fill and thumb,
a `<ProgressBar>`'s fill — count as `Container`. A `transitions.Container` reaches all of
them.

### A reduce-motion theme

Because durations are tokens, stopping the whole UI is a dictionary swap and nothing else:

```ts
export const tokens = { ...base, "motion.fast": 0, "motion.slow": 0 };
```

A `duration` of `0` or less is instant. No node changes, no re-export is needed if the
tokens are swapped as a [hot-update](format/host-channel.md) — which is the point of having
motion in the dictionary at all.

## Hot-updating a theme

Tokens are resolved per node, per frame, against the envelope's dictionary. So a new
envelope that changes only `tokens` re-themes the running UI: same tree, same identities,
same runtime state (focus, scroll offsets, what is checked), new values — and the changed
ones **animate**, because a token swapped by a theme update is an ordinary value change and
[there is no trigger list](format/motion.md#there-is-no-trigger-list).

What a token cannot do is change *structure*. A different variant, a different set of
states, a node that was not there — all of that is a re-export and a full envelope.

Practical shape of a themed project:

```
src/
├── theme.ts        tokens + variants + transitions
└── views/*.tsx     styles reference "{token}" and variant names, never literals
```

Keeping literals out of the views is what makes the first column of the table at the top of
this page useful: the more a view says `"{color.surface}"` instead of `"#1f2430"`, the more
of it a hot-update can re-theme.

## Related

- [Style](format/style.md) — the style set, the states and their normative merge order.
- [Motion](format/motion.md) — what animates, what snaps, the easing curves.
- [The envelope](format/envelope.md#tokens) — how the SDK resolves a token, and what a
  dangling one does.
- [`@zabloo/react` reference](react-api.md#theme-types) — the theme types themselves.
