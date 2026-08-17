# Bindings & actions

The IR contains **no logic**. It cannot branch, compute or call anything: it is data. What
it *does* carry are two declared hooks into the game, and everything dynamic in a zabloo
UI is built from them.

| Mechanism | Direction | What it is |
|---|---|---|
| **Named actions** | UI → game | `"onClick": "buy"` — a name the game subscribes to. |
| **Data bindings** | game ↔ UI | `{ "bind": "player.gold" }` — an address into the game's data. |

There are no expressions, by design. No conditionals, no formatting, no arithmetic — a
value is shown as it is, and anything that needs deciding is decided by the game, which
then moves a value the UI is bound to.

## Named actions

An action prop is a **string the game chose**, exposed idiomatically per engine: a C#
event, a signal, a Blueprint node. The IR declares that the hook exists; what happens is
never in the JSON.

| Prop | Node | Fires when |
|---|---|---|
| `onClick` | `Button` | It is activated (tap, Enter, gamepad A). |
| `onChange` | `Toggle`, `Slider`, `TextInput` | The value changed, however it was caused. |
| `onCommit` | `Slider` | A drag or key gesture **ended** — the value the player settled on. |
| `onSubmit` | `TextInput` | The player confirmed the field (Enter). |
| `onDismiss` | `Overlay` | A dismiss was requested (Escape, gamepad B, backdrop tap, `autoCloseMs`). |

Several nodes may declare the same action name; the game receives one callback either way.

### Action context

An action fired from **inside a repeated item** carries the item it fired from — otherwise
`onClick: "buy"` could not say *which* row was bought:

```jsonc
{ "path": "shop.items.3", "key": "sword-01", "index": 3 }
```

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Absolute data path of the item. |
| `key` | `string \| number` | The item's raw key, when its `Repeat` declares one. Absent for positional identity. |
| `index` | `number` | Its position in the array. |

It describes the **innermost** item, which is enough for nested lists: `path` already
embeds every enclosing index (`"shop.cats.2.items.5"`), so the game can address the whole
chain from it. An action fired outside a `Repeat` carries no context.

## Data paths

A path is a **dot-separated address into the game's data**, not an opaque key:

```
player.gold
shop.items.3.name
settings.audio.master
```

A **numeric segment indexes an array** — and nothing else does: `"length"` is a field name,
not a length. Reading is total and never throws: a missing segment, or one walked through a
non-object, yields *no value*, and bound UI degrades to "nothing to show" rather than
breaking the frame.

Reference implementation: `readPath` in `@zabloo/format`.

### What can be bound

Any `Bindable<T>` prop takes `{ "bind": "some.path" }` in place of a literal.

**Read-only** — the game pushes, the UI follows:

| Prop | Node |
|---|---|
| `visible` | every node |
| `disabled` | every node (inherited by its subtree — see [Input & focus](input.md#disabled-normative)) |
| `text` | `Text` |
| `value` | `ProgressBar` |
| `items` | `Repeat` (always a binding — never a literal array) |

**Read/write** — the SDK also writes back:

| Prop | Node |
|---|---|
| `checked` | `Toggle` |
| `value` | `Slider` |
| `value` | `TextInput` |
| `value` | `Container` with `group: "exclusive-check"` |

A control that owns a value writes every change into the SDK's own data store and notifies
the game through one callback. That is what closes the loop for forms: a bound
`<TextInput>` and a `<Text>` on the same path stay in sync with no game code at all, and
the game learns the new value without polling.

`Repeat.items` is **always** a binding: a literal array there would put game *data* into
the document, and the document carries structure.

Note that `style` is **not** bindable. A bar that changes color with its value is done by
the game moving a token, not by the UI computing one.

## Item scopes

Inside a [`Repeat`](../components/repeat.md) template, a path may start with the item's
**alias** and is resolved against the current element:

```jsonc
{ "type": "Repeat", "items": { "bind": "shop.items" }, "as": "item", "children": [
  { "type": "Text", "text": { "bind": "item.name" } }
] }
```

Resolution rules (normative — `resolveBinding` in `@zabloo/format`):

1. Scopes nest, and the **innermost matching alias wins**. A nested list declaring
   `as: "cat"` can still reach the outer element by its alias, which is why the alias is
   declared rather than reserved. It also means an alias **shadows** a data root of the
   same name — pick alias names that are not roots of your data.
2. `"<alias>"` alone resolves to the element itself (`"shop.items.3"`).
3. `"<alias>.rest"` resolves to `"shop.items.3.rest"`.
4. `"<alias>.$index"` — and only that exact leaf — resolves to the element's **position**,
   a number the data does not contain. Anything deeper (`"item.a.$index"`) is an ordinary
   segment and simply reads no value.
5. A path under no known alias is **absolute** and passes through untouched — which is how
   a row inside a list still binds `player.gold`.

### Item identity

`Repeat.key` names a path *relative to the item* pointing at a stable field (`"id"`,
`"meta.sku"`). Identity is what keeps per-item runtime state — focus, a checked `Toggle`, a
scroll offset, an in-flight transition — with its item when the array is reordered, and it
is what makes recycling possible.

Only a non-empty string or a finite number identifies an item; anything else falls back to
the position. The two spaces are kept **disjoint** (keyed identities are prefixed), so an
item whose key is `"0"` can never inherit the state of the unkeyed element at position 0.

Reference implementations: `itemKey` and `itemIdentity` in `@zabloo/format`.

## The host channel

The game drives the UI through the SDK's API, not through the format. It is the counterpart
of the actions coming the other way, and it is deliberately **not** in the IR: these are
runtime operations, and the document has no place to put them.

| Operation | What it does |
|---|---|
| `SetData(path, value)` | Writes into the data store. Every binding reading that path updates, and the layout re-runs where it must. |
| `SetOpen(id, open)` | Opens or closes a `Collapse`. |
| `SetSelectedTab(id, index)` | Selects a tab of an `"exclusive-select"` group. |
| `SetChecked(id, checked)` | Sets a `Toggle`. |
| `SetValue(id, value)` | Moves a `Slider` — exactly the gesture the player would have made, hooks included. |
| `SetText(id, text)` | Writes a `TextInput`'s text, as if it had been typed. |
| `SetScroll(id, x, y)` | Moves a `ScrollView`'s offset. |

And in the other direction, two callbacks: one for **named actions** (with the action
context, when there is one) and one for **data changed by the UI** (`path`, `value`).

Each SDK exposes these in its own idiom — a C# method, a signal, a JS method on the view
handle — so the exact spelling follows the engine's conventions. The operations, their
arguments and their effects are the same everywhere.

Writes through `SetData` are **cached and replayed**: data pushed before a view is mounted,
or before a bound node exists, applies as soon as it does.
