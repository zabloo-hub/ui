# Component catalog

The node vocabulary is a **closed set of 13 types**, grown only by capability: a new
primitive exists when it forces something no existing node can express, never because a
design has a name for it. Everything else — cards, accordions, dropdowns, grids — is
composed.

Each page documents one node type: its props as they appear in the IR, its slots, the
states it carries, the actions it fires, how it degrades on an older SDK, and the
`@zabloo/react` components that emit it.

## The 13 node types

| Node | Capability it adds | Page |
|---|---|---|
| `Container` | Grouping and flex layout. Cross-child behavior through `group`. | [container](container.md) |
| `Text` | A run of glyphs — a leaf with an intrinsic size. | [text](text.md) |
| `Button` | An activation: press, focus, a named action. | [button](button.md) |
| `Collapse` | Runtime relayout — content entering and leaving the flow. | [collapse](collapse.md) |
| `ScrollView` | A viewport onto content bigger than itself. | [scrollview](scrollview.md) |
| `Image` | A textured rect sized by its source. | [image](image.md) |
| `Overlay` | A layer above the view: z-order, input capture, focus scope. | [overlay](overlay.md) |
| `Toggle` | A boolean the player owns, written back to the game. | [toggle](toggle.md) |
| `Slider` | A number set by pointing, whose geometry derives from it. | [slider](slider.md) |
| `TextInput` | A caret — an insertion point inside content being written. | [textinput](textinput.md) |
| `Repeat` | Structure driven by data: children from an array, not the document. | [repeat](repeat.md) |
| `ProgressBar` | A fraction of the parent — nothing else in v1 expresses one. | [progressbar](progressbar.md) |
| `Spinner` | An endless loop, indexed by identity. | [spinner](spinner.md) |

## Every authoring component

`@zabloo/react` exports more names than there are node types: composites are flattened at
authoring time and never reach the IR.

| Component | Emits | Page |
|---|---|---|
| `<Container>` | `Container` | [container](container.md) |
| `<Row>` / `<Column>` | `Container` with a `direction` | [container](container.md#row-and-column) |
| `<Accordion>` | `Container` with `group: "exclusive-open"` | [container](container.md#accordion) |
| `<Tabs>` / `<Tab>` | `Container` with `group: "exclusive-select"` | [container](container.md#tabs) |
| `<Badge>` | `Container` + a bound `Text` | [container](container.md#badge) |
| `<Text>` | `Text` | [text](text.md) |
| `<Button>` | `Button` | [button](button.md) |
| `<Collapse>` | `Collapse` | [collapse](collapse.md) |
| `<ScrollView>` | `ScrollView` | [scrollview](scrollview.md) |
| `<Image>` | `Image` | [image](image.md) |
| `<Overlay>` | `Overlay` | [overlay](overlay.md) |
| `<Modal>` | modal `Overlay` + a panel | [overlay](overlay.md#modal) |
| `<Toast>` | non-modal `Overlay` with `autoCloseMs` | [overlay](overlay.md#toast) |
| `<Tooltip>` | non-modal `Overlay`, usually anchored | [overlay](overlay.md#tooltip) |
| `<Checkbox>` / `<Switch>` / `<Radio>` | `Toggle` with indicator slots | [toggle](toggle.md) |
| `<RadioGroup>` | `Container` with `group: "exclusive-check"` | [toggle](toggle.md#radiogroup) |
| `<Select>` / `<Option>` | `Button` + anchored `Overlay` + `"exclusive-check"` group | [toggle](toggle.md#select) |
| `<Slider>` | `Slider` + its two slots | [slider](slider.md) |
| `<TextInput>` | `TextInput` | [textinput](textinput.md) |
| `<List>` / `<Grid>` | `Repeat` | [repeat](repeat.md) |
| `<ProgressBar>` | `ProgressBar` + its fill | [progressbar](progressbar.md) |
| `<Spinner>` | `Spinner` + its beads | [spinner](spinner.md) |

**"Primitive" means one of those 13 node types**, and nothing else. What `@zabloo/react`
exports is a *component*, and how closely a component matches a node type varies:

- **Seven emit exactly their node and nothing else** — `<Container>`, `<Text>`, `<Button>`,
  `<Collapse>`, `<ScrollView>`, `<Image>`, `<Overlay>`. What you write is what the IR gets.
- **Three emit their node with its children already built** — `<Slider>` adds its fill and
  thumb, `<ProgressBar>` its fill, `<Spinner>` its beads. Those children are
  [positional slots](#positional-slots), and the component is the one place that convention
  is written down, which is why you never fill them by hand.
- **`<TextInput>` emits its node with the field's defaults applied** — a leaf, so there is
  no slot convention to protect, only a size, a padding and a paint you would otherwise
  write on every field.
- **Two have no component of their own name at all.** A `Toggle` is authored as
  `<Checkbox>`, `<Switch>`, `<Radio>` or `<Option>`; a `Repeat` as `<List>` or `<Grid>`.

Everything else in the table above is a **composite**: it has no node type of its own and
flattens to these before the export.

## Props every node has

Every component takes the [node base](../format/envelope.md#the-node-base) props — `id`,
`visible`, `disabled`, `layout`, `style`, `states`, `transition`, `autofocus`, `clip` — plus
`variant` in authoring, which is resolved away at export. The pages below document only what
is specific to each type.

`disabled` is worth singling out: it is the one that **inherits**, so it is declared on a
control or on the section that owns a whole group of them, and every node it reaches — labels
included — can dress itself through `states.disabled`. See
[Input & focus](../format/input.md#disabled-normative).

**Reading the `Default` column**, here and on every page: a `—` means the prop is
**required** — there is no default because leaving it out is not a thing you can do.
`absent` means the opposite: optional, with no value standing in for it, so the node simply
does not have it.

## Positional slots

Five node types read their children **by position** rather than by flow:

| Node | `children[0]` | `children[1]` | `children[2..]` |
|---|---|---|---|
| `Collapse` | header | content | content |
| `Toggle` | checked indicator | unchecked indicator | always shown (the label) |
| `Slider` | fill | thumb | — |
| `ProgressBar` | fill | reserved | reserved |
| `Repeat` | item template | empty state | empty state |

A `Container` with `group: "exclusive-select"` is positional too: `children[0]` is the tab
bar, `children[1..n]` the panels.

Positions are part of the contract, which is why the loader replaces a dropped slot with an
inert `Container` instead of renumbering the rest, and why changing one would be a
[breaking change](../format/versioning.md#what-breaks).
