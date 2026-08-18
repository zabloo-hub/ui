# TextInput

An editable line of text — and the first node with an **interior**. The capability it adds
is the **caret**: an insertion point and a selection the player moves through content they
are writing. Every control before it produced a value by pointing at geometry (a boolean,
a number, an index); this one has a position inside itself, and that is what makes it a
type rather than a `Text` with a flag.

```jsonc
{
  "type": "TextInput",
  "id": "player-name",
  "value": { "bind": "profile.name" },
  "placeholder": "Your name",
  "maxLength": 16,
  "onSubmit": "name-accept",
  "layout": { "width": 220, "padding": 8 },
  "style":  { "background": "{color.field}", "radius": 6, "color": "{color.text}" },
  "states": { "empty": { "style": { "color": "{color.muted}" } } }
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<string>` | `""` | Current text, or a **read/write** binding. |
| `placeholder` | `string` | absent | Shown while the value is empty. |
| `onChange` | `string` | absent | Named action fired after every edit. |
| `onSubmit` | `string` | absent | Named action fired when the player confirms (Enter). |
| `maxLength` | `number` | unbounded | Cap on what the **player** can type. |

A content-bearing **leaf**, like `Text` and `Image`: it takes no children and paints its own
value through the ordinary text path.

## Value

`value` may be a literal initial string or a **read/write** binding: the SDK writes every
change into its data store and notifies the game. A `<Text bind>` on the same path follows
what is typed, with no game code in between.

`maxLength` **bounds input, not data**. A longer string pushed by the game through a binding
is shown whole: silently truncating the game's own data would be a lie about what it holds.

## Two hooks, and one that does not exist

- **`onChange`** fires on every edit — the live hook, symmetric with `Slider.onChange`. A
  search that filters as you type hangs here.
- **`onSubmit`** fires when the player confirms the field. The search that runs, the name
  that is accepted.

There is deliberately **no `onCommit` and no commit-on-blur**. Unlike a drag, a text field
already has an explicit confirming gesture — Enter — so the live/settled pair exists; only
the second hook's name differs, and it differs because the gesture does: *submit* is
something the player **does**, while a slider's *commit* is something they **stop** doing.

Commit-on-blur does not translate to a game. With arrow and gamepad navigation the focus
leaves the field every time the player crosses it on the way to another control, so a blur
commit would fire spurious "settled" values — and a bound field has already written every
edit into the data, so nothing is lost by leaving.

## Single line in v1

The node measures as **one line** of text and scrolls its content horizontally to keep the
caret visible. A newline is never inserted; a pasted one becomes a space.

The multiline field is a compatible extension over the [wrap algorithm](text.md#text-layout-normative)
— a caret with a row as well as a column, and a selection across lines — and is deferred.

## Placeholder

`placeholder` is painted in the field's **own text style** while the value is empty, and the
`empty` [state](../format/style.md#states) is what styles it:

```jsonc
"states": { "empty": { "style": { "color": "{color.muted}" } } }
```

No second color field and no slot: the node already owns the text paint, so a placeholder is
that same paint with another string. `empty` opens the merge order — it is the weakest thing
a control says about its value, so anything the author declares for a focused or selected
field wins over it.

## Behavior

**States:** `empty`, plus `hover` and `focused` — and `disabled`, its own or inherited.
There is **no `pressed`**: a press on a field places the caret, it does not activate
anything, so there is no down-state to dress. A disabled field takes no caret and no
keystroke, and still shows what it holds.

**Focusable:** yes, unless [`disabled`](../format/input.md#disabled-normative). It takes the
arrow keys to move its caret but **gives them back at the extremes**: at the end of the text, one more press leaves the field. This is deliberately
unlike the `Slider`, which never releases the arrows on its axis — walking out of a long
string one keypress at a time is not a reasonable price.

**Painted by the SDK:** the caret and the selection highlight, both from the field's own
`style.color` — the same "color of this node's content" that tints glyphs and images. Their
blink and their styling are behavior, not IR, the same split that keeps the `ScrollView`'s
scrollbar out of the format.

**Actions:** `onChange`, `onSubmit`.

**Degradation:** as an empty `Container` — a leaf, so what survives is the box. The field is
not editable and its text does not show.

## Authoring

```tsx
<TextInput
  value={{ bind: "profile.name" }}
  placeholder="Your name"
  maxLength={16}
  onSubmit="name-accept"
  states={{ empty: { style: { color: "{color.muted}" } } }}
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Bindable<string>` | `""` | Current text, or a read/write binding. |
| `placeholder` | `string` | absent | Hint shown while the field is empty. |
| `onChange` / `onSubmit` | `string` | absent | The live and the confirm hooks. |
| `maxLength` | `number` | unbounded | Cap on what the player can type. |
| `width` | `number` | `220` | Field width along its line, in px. |
| `padding` | `number` | `8` | Space between the box and the text, in px. |

A field does not resize with what is typed into it, so it needs a width of its own. An
explicit `layout` still wins — `grow: 1` fills a row.
